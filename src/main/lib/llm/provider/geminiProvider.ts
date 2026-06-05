// src/main/lib/llm/provider/geminiProvider.ts
/**
 * Google (Gemini) LLM Provider
 *
 * Talks to the Gemini API (generativelanguage.googleapis.com) via the official
 * @google/genai SDK. Gemini's wire format diverges from OpenAI more than
 * Anthropic's does:
 *   - the system prompt is a top-level `systemInstruction`, not a message
 *   - messages live in `contents[]`, the assistant role is `model`, and there
 *     are no `system` / `tool` roles
 *   - content is `parts[]`: text / inlineData / functionCall / functionResponse
 *   - tools are `functionDeclarations`, tool_choice is `toolConfig.functionCallingConfig`
 *   - streaming emits whole functionCalls (not argument fragments) and there is
 *     no `[DONE]` sentinel
 *
 * This class translates between the app's internal OpenAI-shaped types
 * (ChatMessage / ChatTool / ProviderStreamChunk) and the @google/genai SDK so
 * the rest of the app (agentChatStreamingService, providerManager) stays
 * unchanged.
 */

import {
  GoogleGenAI,
  ApiError,
  FunctionCallingConfigMode,
  type Content,
  type Part,
  type Tool,
  type ToolConfig,
  type FunctionDeclaration,
  type GenerateContentResponse,
  type GenerateContentConfig,
  type Model,
} from '@google/genai';
import { createLogger } from '../../unifiedLogger';
import {
  ILlmProvider,
  ProviderInfo,
  ProviderConfig,
  ProviderModel,
  ChatMessage,
  ChatTool,
  ChatCompletionParams,
  ChatCompletionResult,
  ProviderStreamChunk,
  ConnectionTestResult,
} from './types';
import { guessModelLimitsById } from './modelLimitsUtil';

const logger = createLogger();

/** Default base URL for the Gemini API (the SDK's own default). */
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

/** API version that exposes generateContent + function calling. */
const API_VERSION = 'v1beta';

/**
 * Fallback max output tokens when neither the request nor the model metadata
 * supplies one. Unlike Anthropic, Gemini does not require maxOutputTokens, but
 * sending a finite value keeps behavior predictable across providers.
 */
const DEFAULT_MAX_TOKENS = 4096;

export class GeminiProvider implements ILlmProvider {
  readonly info: ProviderInfo = {
    id: 'gemini',
    displayName: 'Google (Gemini)',
    requiresGitHubAuth: false,
    requiresApiKey: true,
    defaultBaseUrl: DEFAULT_BASE_URL,
    description: 'Gemini 2.5 Pro / Flash via your Google AI API key',
  };

  private config: ProviderConfig = { enabled: false };
  private client: GoogleGenAI | null = null;
  private modelsCache: ProviderModel[] = [];
  private modelsCacheTime = 0;
  private readonly MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // ── Configuration ───────────────────────────────────────────────────

  configure(config: ProviderConfig): void {
    this.config = config;
    // Rebuild the client and invalidate the model cache on reconfigure
    this.client = null;
    this.modelsCache = [];
    this.modelsCacheTime = 0;
  }

  dispose(): void {
    this.client = null;
    this.modelsCache = [];
  }

  getCachedModels(): ProviderModel[] {
    return this.modelsCache;
  }

  /** Lazily build (and memoize) the SDK client from current config. */
  private getClient(): GoogleGenAI {
    if (!this.client) {
      this.client = new GoogleGenAI({
        apiKey: this.config.apiKey || '',
        httpOptions: {
          baseUrl: this.config.baseUrl || DEFAULT_BASE_URL,
          apiVersion: API_VERSION,
        },
      });
    }
    return this.client;
  }

  // ── Model Management ──────────────────────────────────────────────────

  async listModels(): Promise<ProviderModel[]> {
    // Return cache if fresh
    if (this.modelsCache.length > 0 && Date.now() - this.modelsCacheTime < this.MODEL_CACHE_TTL_MS) {
      return this.modelsCache;
    }

    if (!this.config.apiKey) {
      logger.warn('[geminiProvider] No API key configured');
      return this.modelsCache;
    }

    try {
      const client = this.getClient();
      const models: ProviderModel[] = [];

      // models.list() returns an async-iterable pager that auto-fetches pages.
      // queryBase:true lists the base (non-tuned) models from the Gemini API.
      const pager = await client.models.list({ config: { queryBase: true } });
      for await (const m of pager) {
        const mapped = this.toProviderModel(m);
        if (mapped) models.push(mapped);
      }

      // Sort by id for stable display.
      models.sort((a, b) => a.id.localeCompare(b.id));

      this.modelsCache = models;
      this.modelsCacheTime = Date.now();
      logger.debug(`[geminiProvider] Loaded ${models.length} models`);
      return this.modelsCache;
    } catch (error) {
      logger.error(`[geminiProvider] Model fetch error: ${error instanceof Error ? error.message : String(error)}`);
      return this.modelsCache; // Return stale cache on failure
    }
  }

  async validateModel(modelId: string): Promise<boolean> {
    const models = await this.listModels();
    return models.some(m => m.id === modelId);
  }

  /**
   * Convert a @google/genai Model to our ProviderModel format.
   * Returns null for models that cannot do generateContent (e.g. embeddings),
   * so the caller can filter them out of the chat model list.
   */
  private toProviderModel(raw: Model): ProviderModel | null {
    // The API prefixes ids with "models/"; strip it for the call-site id.
    const fullName = raw.name || '';
    const id = fullName.replace(/^models\//, '');
    if (!id) return null;

    // Keep only models that support text generation. The field name has varied
    // across API versions, so check both spellings before falling back to a
    // name heuristic.
    const actions =
      (raw as { supportedActions?: string[] }).supportedActions ??
      (raw as { supportedGenerationMethods?: string[] }).supportedGenerationMethods;
    if (Array.isArray(actions) && actions.length > 0) {
      if (!actions.includes('generateContent')) return null;
    } else if (this.isNonChatModel(id)) {
      return null;
    }

    const defaults = this.guessContextDefaults(id);
    return {
      id,
      name: raw.displayName || id,
      providerId: 'gemini',
      supportsStreaming: true, // All Gemini chat models support streaming
      supportsTools: true,     // All current Gemini chat models support function calling
      supportsImages: this.guessImageSupport(id),
      maxContextTokens: raw.inputTokenLimit ?? defaults.context,
      maxOutputTokens: raw.outputTokenLimit ?? defaults.output,
      raw,
    };
  }

  /** Heuristic: is this a non-chat model (embeddings, AQA, image-only)? */
  private isNonChatModel(modelId: string): boolean {
    const id = modelId.toLowerCase();
    return id.includes('embedding') || id.includes('aqa') || id.includes('imagen');
  }

  /** Heuristic image-support fallback when capability data is absent. */
  private guessImageSupport(modelId: string): boolean {
    const id = modelId.toLowerCase();
    // Gemini 1.5+ and the 2.x families are multimodal. Legacy gemini-pro
    // (1.0) text endpoints are text-only.
    if (id === 'gemini-pro' || id.startsWith('gemini-pro-')) return false;
    return id.includes('gemini-1.5') || /gemini-[2-9]/.test(id) || id.includes('flash') || id.includes('pro');
  }

  /**
   * Best-effort context-window / output-token defaults by model family, used
   * only when the API omits explicit limits. Keeps the renderer's token-budget
   * code working with finite numbers instead of NaN.
   */
  private guessContextDefaults(modelId: string): { context: number; output: number } {
    return guessModelLimitsById(modelId, { context: 1_048_576, output: 65_536 });
  }

  // ── Chat Completion (non-streaming) ───────────────────────────────────

  async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    const client = this.getClient();
    const { systemInstruction, contents } = this.translateMessages(params.messages);

    const response = await client.models.generateContent({
      model: params.model,
      contents,
      config: this.buildConfig(params, systemInstruction),
    });

    // Collect text + functionCall parts from the first candidate.
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    let content = '';
    const toolCalls: ChatCompletionResult['toolCalls'] = [];
    let toolIndex = 0;
    let sawFunctionCall = false;

    for (const part of parts) {
      if (typeof part.text === 'string') {
        content += part.text;
      } else if (part.functionCall) {
        sawFunctionCall = true;
        const fc = part.functionCall;
        toolCalls.push({
          id: fc.id || this.synthToolId(toolIndex, fc.name),
          type: 'function',
          function: { name: fc.name || '', arguments: JSON.stringify(fc.args ?? {}) },
        });
        toolIndex++;
      }
    }

    const usage = response.usageMetadata;
    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.mapFinishReason(response.candidates?.[0]?.finishReason, sawFunctionCall),
      usage: usage ? {
        promptTokens: usage.promptTokenCount || 0,
        completionTokens: usage.candidatesTokenCount || 0,
        totalTokens: usage.totalTokenCount || ((usage.promptTokenCount || 0) + (usage.candidatesTokenCount || 0)),
      } : undefined,
      model: params.model,
    };
  }

  // ── Chat Completion (streaming) ───────────────────────────────────────

  async *chatCompletionStream(params: ChatCompletionParams): AsyncIterable<ProviderStreamChunk> {
    const client = this.getClient();
    const { systemInstruction, contents } = this.translateMessages(params.messages);

    const stream = await client.models.generateContentStream({
      model: params.model,
      contents,
      config: this.buildConfig(params, systemInstruction),
    });

    // Gemini streams whole functionCalls (not argument fragments). We assign a
    // monotonically increasing index per tool call across the whole response so
    // the downstream accumulator (agentChatStreamingService) keys them correctly.
    let toolIndex = 0;
    let sawFunctionCall = false;
    let lastFinishReason: ProviderStreamChunk['finishReason'];
    let lastUsage: ProviderStreamChunk['usage'];

    for await (const chunk of stream as AsyncIterable<GenerateContentResponse>) {
      const candidate = chunk.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];

      for (const part of parts) {
        if (typeof part.text === 'string' && part.text.length > 0) {
          yield { contentDelta: part.text };
        } else if (part.functionCall) {
          sawFunctionCall = true;
          const fc = part.functionCall;
          // Emit the full tool call (header + complete arguments) in one chunk.
          yield {
            toolCallDelta: {
              index: toolIndex,
              id: fc.id || this.synthToolId(toolIndex, fc.name),
              type: 'function',
              function: { name: fc.name || '', arguments: JSON.stringify(fc.args ?? {}) },
            },
          };
          toolIndex++;
        }
      }

      // finishReason and usageMetadata arrive on (typically the last) chunks.
      if (candidate?.finishReason) {
        lastFinishReason = this.mapFinishReason(candidate.finishReason, sawFunctionCall);
      }
      if (chunk.usageMetadata) {
        const u = chunk.usageMetadata;
        lastUsage = {
          promptTokens: u.promptTokenCount || 0,
          completionTokens: u.candidatesTokenCount || 0,
          totalTokens: u.totalTokenCount || ((u.promptTokenCount || 0) + (u.candidatesTokenCount || 0)),
        };
      }
    }

    // Trailing chunk: finish reason + final usage, so accounting lands after the
    // content/tool deltas in the consumer (mirrors the other providers).
    if (lastFinishReason || lastUsage) {
      yield {
        model: params.model,
        ...(lastFinishReason ? { finishReason: lastFinishReason } : {}),
        ...(lastUsage ? { usage: lastUsage } : {}),
      };
    }
  }

  // ── Connection Test ───────────────────────────────────────────────────

  async testConnection(): Promise<ConnectionTestResult> {
    const startTime = Date.now();

    if (!this.config.apiKey) {
      return { success: false, error: 'No API key configured. Add your Google AI API key first.' };
    }

    try {
      // Invalidate cache so the test actually hits the network.
      this.modelsCache = [];
      this.modelsCacheTime = 0;
      const models = await this.listModels();
      const latencyMs = Date.now() - startTime;

      if (models.length === 0) {
        return {
          success: false,
          latencyMs,
          error: 'Connected but no models returned. Check your API key permissions.',
        };
      }

      return {
        success: true,
        latencyMs,
        sampleModels: models.slice(0, 5).map(m => m.id),
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      // The SDK throws ApiError with an HTTP status for API-level failures.
      if (error instanceof ApiError) {
        if (error.status === 401 || error.status === 403) {
          return { success: false, latencyMs, error: 'Invalid API key or insufficient permissions. Please check and try again.' };
        }
        if (error.status === 429) {
          return { success: false, latencyMs, error: 'Rate limited. Please wait and try again.' };
        }
        return { success: false, latencyMs, error: `Gemini API error (${error.status}): ${error.message}` };
      }

      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
        return { success: false, latencyMs, error: `Cannot connect to ${this.config.baseUrl || DEFAULT_BASE_URL}. Check the URL and network.` };
      }
      if (message.includes('timeout') || message.includes('TimeoutError')) {
        return { success: false, latencyMs, error: 'Connection timed out. The server may be unreachable.' };
      }
      return { success: false, latencyMs, error: message };
    }
  }

  // ── Internal Translation Helpers ──────────────────────────────────────

  /**
   * Build the per-request GenerateContentConfig from our params + the extracted
   * system instruction. Temperature and maxOutputTokens are nested here (unlike
   * OpenAI/Anthropic where they're top-level), and the AbortSignal is passed via
   * config.abortSignal for native cancellation.
   */
  private buildConfig(params: ChatCompletionParams, systemInstruction: string | undefined): GenerateContentConfig {
    const config: GenerateContentConfig = {
      maxOutputTokens: params.maxTokens || DEFAULT_MAX_TOKENS,
    };
    if (systemInstruction) config.systemInstruction = systemInstruction;
    if (params.temperature !== undefined) config.temperature = params.temperature;
    if (params.signal) config.abortSignal = params.signal;

    const { tools, toolConfig } = this.translateTools(params);
    if (tools) config.tools = tools;
    if (toolConfig) config.toolConfig = toolConfig;

    return config;
  }

  /**
   * Translate the app's internal OpenAI-shaped messages into Gemini's format:
   *   - `system` messages are concatenated into the top-level systemInstruction
   *   - `assistant` becomes Content with role 'model'
   *   - assistant `tool_calls` become `functionCall` parts
   *   - `tool` messages become a `user` turn carrying a `functionResponse` part
   *   - plain user/assistant text passes through as a single text part
   *
   * Gemini correlates a tool result to its call by function *name*. We build an
   * id→name map from assistant tool_calls so a later `tool` message (which only
   * carries tool_call_id in our internal format) can resolve the right name. We
   * also set `id` on the functionResponse so the id round-trips when supported.
   */
  private translateMessages(
    chatMessages: ChatMessage[],
  ): { systemInstruction: string | undefined; contents: Content[] } {
    const systemParts: string[] = [];
    const contents: Content[] = [];
    const idToName = new Map<string, string>();

    for (const msg of chatMessages) {
      if (msg.role === 'system') {
        systemParts.push(this.contentToText(msg.content));
        continue;
      }

      if (msg.role === 'tool') {
        const id = msg.tool_call_id || '';
        const name = idToName.get(id) || id;
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              id: id || undefined,
              name,
              // Gemini expects a JSON object; wrap raw text under an "output" key.
              response: this.toResponseObject(msg.content),
            },
          }],
        });
        continue;
      }

      if (msg.role === 'assistant') {
        const parts: Part[] = [];
        const text = this.contentToText(msg.content);
        if (text) parts.push({ text });
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            if (tc.id) idToName.set(tc.id, tc.function.name);
            parts.push({
              functionCall: {
                id: tc.id || undefined,
                name: tc.function.name,
                args: this.safeJsonParse(tc.function.arguments),
              },
            });
          }
        }
        // A model turn must have at least one part.
        contents.push({ role: 'model', parts: parts.length > 0 ? parts : [{ text: '' }] });
        continue;
      }

      // role === 'user'
      contents.push({ role: 'user', parts: [{ text: this.contentToText(msg.content) }] });
    }

    return {
      systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
      contents,
    };
  }

  /**
   * Translate OpenAI-format tools + tool_choice to Gemini's shape.
   * Returns partials so the caller can attach them conditionally.
   */
  private translateTools(params: ChatCompletionParams): {
    tools?: Tool[];
    toolConfig?: ToolConfig;
  } {
    if (!params.tools || params.tools.length === 0) return {};

    const functionDeclarations: FunctionDeclaration[] = params.tools.map((t: ChatTool) => ({
      name: t.function.name,
      description: t.function.description,
      // OpenAI's `parameters` JSON Schema maps to Gemini's parametersJsonSchema,
      // which accepts a standard JSON Schema object without Gemini-specific typing.
      parametersJsonSchema: t.function.parameters ?? { type: 'object', properties: {} },
    }));

    const tools: Tool[] = [{ functionDeclarations }];

    let mode: FunctionCallingConfigMode | undefined;
    const tc = params.tool_choice;
    if (tc === 'auto') mode = FunctionCallingConfigMode.AUTO;
    else if (tc === 'required') mode = FunctionCallingConfigMode.ANY;
    else if (tc === 'none') mode = FunctionCallingConfigMode.NONE;
    else if (typeof tc === 'object' && tc?.type === 'function') {
      // Force a specific function via ANY + allowedFunctionNames.
      return {
        tools,
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: [tc.function.name],
          },
        },
      };
    }

    return mode
      ? { tools, toolConfig: { functionCallingConfig: { mode } } }
      : { tools };
  }

  /**
   * Map a Gemini finishReason to the OpenAI-style finish_reason vocabulary.
   * When the response contained a functionCall, report 'tool_calls' (Gemini
   * still reports STOP in that case).
   */
  private mapFinishReason(finishReason: string | undefined, sawFunctionCall: boolean): string {
    if (sawFunctionCall) return 'tool_calls';
    switch (finishReason) {
      case 'STOP':
        return 'stop';
      case 'MAX_TOKENS':
        return 'length';
      case 'SAFETY':
      case 'RECITATION':
      case 'BLOCKLIST':
      case 'PROHIBITED_CONTENT':
      case 'SPII':
        return 'content_filter';
      case undefined:
        return 'stop';
      default:
        return finishReason.toLowerCase();
    }
  }

  /** A stable synthetic tool-call id for when Gemini omits one. */
  private synthToolId(index: number, name?: string): string {
    return `gemini-tool-${index}-${name || 'fn'}`;
  }

  /** Wrap a tool-result content value into a JSON object for functionResponse. */
  private toResponseObject(content: ChatMessage['content']): Record<string, unknown> {
    const text = this.contentToText(content);
    // If the tool already returned a JSON object, pass it through; else wrap it.
    const parsed = this.tryJsonObject(text);
    return parsed ?? { output: text };
  }

  /** Parse text as a JSON object, returning undefined for non-objects. */
  private tryJsonObject(raw: string): Record<string, unknown> | undefined {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  /** Flatten a string|array content value to plain text. */
  private contentToText(content: ChatMessage['content']): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((part: any) => part?.type === 'text')
        .map((part: any) => part.text || '')
        .join('');
    }
    return String(content ?? '');
  }

  /** Parse tool-call argument JSON, tolerating malformed/empty strings. */
  private safeJsonParse(raw: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(raw || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
}
