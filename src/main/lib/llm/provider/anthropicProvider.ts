// src/main/lib/llm/provider/anthropicProvider.ts
/**
 * Anthropic (Claude) LLM Provider
 *
 * Talks to Anthropic's Messages API (POST /v1/messages) via the official
 * @anthropic-ai/sdk. Unlike the OpenAI-compatible providers, Anthropic uses a
 * different wire format:
 *   - `system` is a top-level request field, not a message in the array
 *   - content is block-based (text / image / tool_use / tool_result)
 *   - streaming emits named events (content_block_delta, message_delta, ...)
 *   - auth is x-api-key + anthropic-version (handled by the SDK)
 *
 * This class translates between the app's internal OpenAI-shaped types
 * (ChatMessage / ChatTool / ProviderStreamChunk) and the Anthropic SDK so the
 * rest of the app (agentChatStreamingService, providerManager) stays unchanged.
 */

import Anthropic from '@anthropic-ai/sdk';
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

const logger = createLogger();

/** Default base URL for Anthropic's API (the SDK's own default). */
const DEFAULT_BASE_URL = 'https://api.anthropic.com';

/**
 * anthropic-version header value sent on the raw /v1/models fallback. The SDK
 * sets this itself; the fallback issues a hand-rolled fetch, so it must supply
 * the header explicitly. Matches the version used by the protocol detector.
 */
const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Fallback max_tokens when neither the request nor the model metadata supplies
 * one. Anthropic requires max_tokens on every request (unlike OpenAI, where it's
 * optional), so we must always send a finite value.
 */
const DEFAULT_MAX_TOKENS = 4096;

export class AnthropicProvider implements ILlmProvider {
  readonly info: ProviderInfo = {
    id: 'anthropic',
    displayName: 'Anthropic (Claude)',
    requiresGitHubAuth: false,
    requiresApiKey: true,
    defaultBaseUrl: DEFAULT_BASE_URL,
    description: 'Claude Opus, Sonnet, Haiku via your Anthropic API key',
  };

  private config: ProviderConfig = { enabled: false };
  private client: Anthropic | null = null;
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
  private getClient(): Anthropic {
    if (!this.client) {
      const baseURL = this.config.baseUrl || DEFAULT_BASE_URL;
      this.client = new Anthropic({
        apiKey: this.config.apiKey || '',
        baseURL,
        // Anthropic-COMPATIBLE gateways (e.g. Zhipu/GLM's bigmodel /api/anthropic,
        // designed for Claude Code) authenticate chat with Authorization: Bearer
        // <key> — the ANTHROPIC_AUTH_TOKEN scheme — NOT Anthropic's native
        // x-api-key. Their /v1/models often accepts either, which is why listing
        // worked while chat returned 401 "令牌已过期或验证不正确" (a Zhipu-shaped
        // error, not Anthropic's authentication_error). The official SDK only
        // sends x-api-key, so for a CUSTOM baseURL we additionally inject the
        // Bearer header; gateways that want x-api-key ignore the extra header,
        // and real api.anthropic.com is never given one (default path untouched).
        ...(this.isCustomBaseUrl(baseURL)
          ? { defaultHeaders: { Authorization: `Bearer ${this.config.apiKey || ''}` } }
          : {}),
      });
    }
    return this.client;
  }

  /** True when pointed at a third-party gateway rather than api.anthropic.com. */
  private isCustomBaseUrl(baseURL: string): boolean {
    return !/(^|\/\/)([^/]*\.)?anthropic\.com(\/|$)/i.test(baseURL);
  }

  // ── Model Management ──────────────────────────────────────────────────

  async listModels(): Promise<ProviderModel[]> {
    // Return cache if fresh
    if (this.modelsCache.length > 0 && Date.now() - this.modelsCacheTime < this.MODEL_CACHE_TTL_MS) {
      return this.modelsCache;
    }

    if (!this.config.apiKey) {
      logger.warn('[anthropicProvider] No API key configured');
      return this.modelsCache;
    }

    // PRIMARY: plain GET {baseUrl}/v1/models — the SAME request the protocol
    // detector already proved works for this endpoint. The official SDK's
    // models.list() is deliberately NOT the primary path: Anthropic-compatible
    // gateways (bigmodel /api/anthropic, other proxies) speak the Messages API
    // but return an empty / schema-divergent page through the SDK's paginator,
    // so it would yield zero models even though a raw GET returns the full
    // catalog. Real api.anthropic.com answers this exact request too, so one
    // code path serves both. (Historically we hit the SDK first and got 0
    // models on bigmodel — the research/chat dropdown showed nothing.)
    try {
      const raw = await this.listModelsViaRawFetch();
      if (raw.length > 0) {
        this.modelsCache = raw;
        this.modelsCacheTime = Date.now();
        logger.debug(`[anthropicProvider] Loaded ${raw.length} models via GET /v1/models`);
        return this.modelsCache;
      }
      logger.debug('[anthropicProvider] GET /v1/models returned no models; trying SDK paginator');
    } catch (error) {
      logger.debug(`[anthropicProvider] GET /v1/models failed (${error instanceof Error ? error.message : String(error)}); trying SDK paginator`);
    }

    // FALLBACK: the SDK paginator, for the rare endpoint where the raw GET is
    // unavailable but models.list() works.
    try {
      const client = this.getClient();
      const models: ProviderModel[] = [];
      for await (const m of client.models.list({ limit: 100 })) {
        models.push(this.toProviderModel(m));
      }
      models.sort((a, b) => a.id.localeCompare(b.id));

      this.modelsCache = models;
      this.modelsCacheTime = Date.now();
      logger.debug(`[anthropicProvider] Loaded ${models.length} models via SDK fallback`);
      return this.modelsCache;
    } catch (error) {
      logger.error(`[anthropicProvider] Model fetch error: ${error instanceof Error ? error.message : String(error)}`);
      return this.modelsCache; // Return stale cache on failure
    }
  }

  /**
   * Fetch the model catalog via a plain GET {baseUrl}/v1/models with Anthropic
   * auth headers — the exact shape the protocol detector uses. This is the
   * primary model-listing path: it works for both real api.anthropic.com and the
   * Anthropic-flavored gateways whose /v1/models the official SDK can't iterate.
   * Returns [] (not throwing) on a non-OK response or unparseable body, so the
   * caller can decide whether to try the SDK paginator.
   */
  private async listModelsViaRawFetch(): Promise<ProviderModel[]> {
    const base = (this.config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const url = `${base}/v1/models`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey || '',
        // Compatible gateways (Zhipu/GLM etc.) authenticate with Bearer rather
        // than x-api-key — send both so either scheme is satisfied. See getClient().
        'Authorization': `Bearer ${this.config.apiKey || ''}`,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      logger.debug(`[anthropicProvider] Raw /v1/models returned ${response.status}`);
      return [];
    }
    const data: unknown = await response.json();
    // Accept both `{ data: [...] }` (Anthropic + most gateways) and a bare array.
    const arr = Array.isArray(data)
      ? data
      : (data as { data?: Array<Record<string, unknown>> })?.data;
    if (!Array.isArray(arr)) return [];
    const models = arr
      .map((m) => {
        const id = typeof m?.id === 'string' ? m.id : undefined;
        if (!id) return null;
        // Reuse the SDK-shaped mapper; supply the fields it reads (id +
        // display_name), letting guessContextDefaults fill the rest.
        return this.toProviderModel({
          id,
          display_name: typeof m?.display_name === 'string' ? m.display_name : undefined,
        } as Anthropic.ModelInfo);
      })
      .filter((m): m is ProviderModel => m !== null);
    models.sort((a, b) => a.id.localeCompare(b.id));
    return models;
  }

  async validateModel(modelId: string): Promise<boolean> {
    const models = await this.listModels();
    return models.some(m => m.id === modelId);
  }

  /** Convert an Anthropic SDK ModelInfo to our ProviderModel format. */
  private toProviderModel(raw: Anthropic.ModelInfo): ProviderModel {
    const defaults = this.guessContextDefaults(raw.id);
    return {
      id: raw.id,
      name: raw.display_name || raw.id,
      providerId: 'anthropic',
      supportsStreaming: true, // All Claude chat models support streaming
      supportsTools: true,     // All current Claude models support tool use
      // Prefer real capability data from the API; fall back to a family heuristic.
      supportsImages: raw.capabilities?.image_input?.supported ?? this.guessImageSupport(raw.id),
      maxContextTokens: raw.max_input_tokens ?? defaults.context,
      maxOutputTokens: raw.max_tokens ?? defaults.output,
      raw,
    };
  }

  /** Heuristic image-support fallback when capability data is absent. */
  private guessImageSupport(modelId: string): boolean {
    const id = modelId.toLowerCase();
    // Claude 3 and later are multimodal. Claude 2.x and instant are text-only.
    return id.includes('claude-3') || id.includes('claude-sonnet') || id.includes('claude-opus')
      || id.includes('claude-haiku') || /claude-[4-9]/.test(id);
  }

  /**
   * Best-effort context-window / output-token defaults by model family, used
   * only when the API omits explicit limits. Keeps the renderer's token-budget
   * code working with finite numbers instead of NaN.
   */
  private guessContextDefaults(modelId: string): { context: number; output: number } {
    const id = modelId.toLowerCase();
    if (id.includes('claude-opus') || id.includes('claude-sonnet')) return { context: 200_000, output: 8_192 };
    if (id.includes('claude-haiku')) return { context: 200_000, output: 8_192 };
    if (id.includes('claude-3')) return { context: 200_000, output: 4_096 };
    // Conservative default — finite, not NaN
    return { context: 200_000, output: 4_096 };
  }

  // ── Chat Completion (non-streaming) ───────────────────────────────────

  async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    const client = this.getClient();
    const { system, messages } = this.translateMessages(params.messages);

    const result = await client.messages.create(
      {
        model: params.model,
        max_tokens: params.maxTokens || DEFAULT_MAX_TOKENS,
        messages,
        ...(system ? { system } : {}),
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        ...this.translateTools(params),
      },
      { signal: params.signal },
    );

    // Collect text + tool_use blocks from the response content array.
    let content = '';
    const toolCalls: ChatCompletionResult['toolCalls'] = [];
    for (const block of result.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.mapStopReason(result.stop_reason),
      usage: result.usage ? {
        promptTokens: result.usage.input_tokens || 0,
        completionTokens: result.usage.output_tokens || 0,
        totalTokens: (result.usage.input_tokens || 0) + (result.usage.output_tokens || 0),
      } : undefined,
      model: result.model,
    };
  }

  // ── Chat Completion (streaming) ───────────────────────────────────────

  async *chatCompletionStream(params: ChatCompletionParams): AsyncIterable<ProviderStreamChunk> {
    const client = this.getClient();
    const { system, messages } = this.translateMessages(params.messages);

    const stream = client.messages.stream(
      {
        model: params.model,
        max_tokens: params.maxTokens || DEFAULT_MAX_TOKENS,
        messages,
        ...(system ? { system } : {}),
        ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        ...this.translateTools(params),
      },
      { signal: params.signal },
    );

    // Anthropic indexes content blocks per-response. The downstream tool-call
    // accumulator (agentChatStreamingService) keys on `index`, so we forward the
    // block index directly. We also remember the id/name emitted at block start
    // so input_json_delta chunks can be attributed to the right tool call.
    let promptTokens = 0;
    let model = params.model;

    for await (const event of stream) {
      switch (event.type) {
        case 'message_start':
          // Initial usage carries the prompt-token count; output accrues later.
          promptTokens = event.message.usage?.input_tokens || 0;
          model = event.message.model || model;
          break;

        case 'content_block_start':
          if (event.content_block.type === 'tool_use') {
            // Emit the tool-call header (id + name) so the accumulator can open a slot.
            yield {
              toolCallDelta: {
                index: event.index,
                id: event.content_block.id,
                type: 'function',
                function: { name: event.content_block.name, arguments: '' },
              },
            };
          }
          break;

        case 'content_block_delta':
          if (event.delta.type === 'text_delta') {
            yield { contentDelta: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            // Incremental JSON for the current tool_use block's arguments.
            yield {
              toolCallDelta: {
                index: event.index,
                function: { arguments: event.delta.partial_json },
              },
            };
          }
          break;

        case 'message_delta': {
          // Trailing chunk: finish reason + final usage. output_tokens here is the
          // cumulative total for the message.
          const trailer: ProviderStreamChunk = { model };
          if (event.delta.stop_reason) {
            trailer.finishReason = this.mapStopReason(event.delta.stop_reason);
          }
          if (event.usage) {
            const completionTokens = event.usage.output_tokens || 0;
            trailer.usage = {
              promptTokens,
              completionTokens,
              totalTokens: promptTokens + completionTokens,
            };
          }
          yield trailer;
          break;
        }

        default:
          // message_stop, content_block_stop, ping — nothing to forward.
          break;
      }
    }
  }

  // ── Connection Test ───────────────────────────────────────────────────

  async testConnection(): Promise<ConnectionTestResult> {
    const startTime = Date.now();

    if (!this.config.apiKey) {
      return { success: false, error: 'No API key configured. Add your Anthropic API key first.' };
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
        models: models.map(m => m.id),
        rawModels: models.map(m => m.raw).filter((raw) => raw !== undefined),
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      // Prefer the SDK's typed error classes over string matching.
      if (error instanceof Anthropic.AuthenticationError) {
        return { success: false, latencyMs, error: 'Invalid API key. Please check and try again.' };
      }
      if (error instanceof Anthropic.PermissionDeniedError) {
        return { success: false, latencyMs, error: 'API key does not have permission to access this endpoint.' };
      }
      if (error instanceof Anthropic.RateLimitError) {
        return { success: false, latencyMs, error: 'Rate limited. Please wait and try again.' };
      }
      if (error instanceof Anthropic.APIConnectionError) {
        return { success: false, latencyMs, error: `Cannot connect to ${this.config.baseUrl || DEFAULT_BASE_URL}. Check the URL and network.` };
      }

      return { success: false, latencyMs, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ── Internal Translation Helpers ──────────────────────────────────────

  /**
   * Translate the app's internal OpenAI-shaped messages into Anthropic's format:
   *   - `system` messages are concatenated into the top-level system string
   *   - `tool` messages become `tool_result` content blocks on a user turn
   *   - assistant `tool_calls` become `tool_use` content blocks
   *   - plain user/assistant text passes through as string content
   */
  private translateMessages(
    chatMessages: ChatMessage[],
  ): { system: string | undefined; messages: Anthropic.MessageParam[] } {
    const systemParts: string[] = [];
    const messages: Anthropic.MessageParam[] = [];

    for (const msg of chatMessages) {
      if (msg.role === 'system') {
        systemParts.push(this.contentToText(msg.content));
        continue;
      }

      if (msg.role === 'tool') {
        // Anthropic delivers tool results as a user turn carrying tool_result blocks.
        messages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.tool_call_id || '',
            content: this.contentToText(msg.content),
          }],
        });
        continue;
      }

      if (msg.role === 'assistant') {
        const blocks: Anthropic.ContentBlockParam[] = [];
        const text = this.contentToText(msg.content);
        if (text) blocks.push({ type: 'text', text });
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            blocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: this.safeJsonParse(tc.function.arguments),
            });
          }
        }
        messages.push({ role: 'assistant', content: blocks.length > 0 ? blocks : '' });
        continue;
      }

      // role === 'user'
      messages.push({ role: 'user', content: this.contentToText(msg.content) });
    }

    return { system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined, messages };
  }

  /**
   * Translate OpenAI-format tools + tool_choice to Anthropic's shape.
   * Returns a partial body so the caller can spread it conditionally.
   */
  private translateTools(params: ChatCompletionParams): {
    tools?: Anthropic.Tool[];
    tool_choice?: Anthropic.ToolChoice;
  } {
    if (!params.tools || params.tools.length === 0) return {};

    // tool_choice 'none' means "do not call any tool this turn". Anthropic has no
    // per-request "tools present but forbidden" flag, so the canonical enforcement
    // is to omit the tools array entirely — otherwise Anthropic defaults to 'auto'
    // and the model may still emit a tool_use block, silently ignoring 'none'.
    if (params.tool_choice === 'none') return {};

    const tools: Anthropic.Tool[] = params.tools.map((t: ChatTool) => ({
      name: t.function.name,
      description: t.function.description,
      // OpenAI's `parameters` JSON Schema maps directly to Anthropic's input_schema.
      input_schema: (t.function.parameters ?? { type: 'object', properties: {} }) as Anthropic.Tool.InputSchema,
    }));

    let tool_choice: Anthropic.ToolChoice | undefined;
    const tc = params.tool_choice;
    if (tc === 'auto') tool_choice = { type: 'auto' };
    else if (tc === 'required') tool_choice = { type: 'any' };
    else if (typeof tc === 'object' && tc?.type === 'function') {
      tool_choice = { type: 'tool', name: tc.function.name };
    }

    return tool_choice ? { tools, tool_choice } : { tools };
  }

  /** Map an Anthropic stop_reason to the OpenAI-style finish_reason vocabulary. */
  private mapStopReason(stopReason: string | null): string {
    switch (stopReason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return stopReason || 'stop';
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
