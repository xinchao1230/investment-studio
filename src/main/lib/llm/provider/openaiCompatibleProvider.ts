// src/main/lib/llm/provider/openaiCompatibleProvider.ts
/**
 * OpenAI-Compatible LLM Provider
 *
 * Handles any API that follows the OpenAI /v1/chat/completions format:
 * - OpenAI (api.openai.com)
 * - DeepSeek (api.deepseek.com)
 * - Ollama (localhost:11434/v1)
 * - Any custom OpenAI-compatible endpoint
 *
 * This is the primary provider for users who bring their own API keys.
 */

import { createLogger } from '../../unifiedLogger';
import {
  ILlmProvider,
  ProviderInfo,
  ProviderConfig,
  ProviderModel,
  ChatCompletionParams,
  ChatCompletionResult,
  ProviderStreamChunk,
  ConnectionTestResult,
  ProviderId,
} from './types';

const logger = createLogger();

/** Known provider presets with default configurations */
const PROVIDER_PRESETS: Record<string, { displayName: string; baseUrl: string; description: string }> = {
  openai: {
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    description: 'GPT-4o, GPT-4.1, o3, o4-mini and more',
  },
  deepseek: {
    displayName: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    description: 'DeepSeek-V3, DeepSeek-R1',
  },
  ollama: {
    displayName: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434/v1',
    description: 'Local models via Ollama',
  },
  'custom-openai': {
    displayName: 'Custom (OpenAI-Compatible)',
    baseUrl: '',
    description: 'Any OpenAI-compatible API endpoint',
  },
};

export class OpenAICompatibleProvider implements ILlmProvider {
  readonly info: ProviderInfo;
  private config: ProviderConfig = { enabled: false };
  private modelsCache: ProviderModel[] = [];
  private modelsCacheTime = 0;
  private readonly MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(providerId: ProviderId) {
    const preset = PROVIDER_PRESETS[providerId] || PROVIDER_PRESETS['custom-openai'];
    this.info = {
      id: providerId,
      displayName: preset.displayName,
      requiresGitHubAuth: false,
      requiresApiKey: providerId !== 'ollama', // Ollama doesn't need a key
      defaultBaseUrl: preset.baseUrl,
      description: preset.description,
    };
  }

  // ── Configuration ───────────────────────────────────────────────────

  configure(config: ProviderConfig): void {
    this.config = config;
    // Invalidate model cache on reconfigure
    this.modelsCache = [];
    this.modelsCacheTime = 0;
  }

  dispose(): void {
    this.modelsCache = [];
  }

  getCachedModels(): ProviderModel[] {
    return this.modelsCache;
  }

  /** Get the effective base URL (user override or provider default) */
  private getBaseUrl(): string {
    return this.config.baseUrl || this.info.defaultBaseUrl;
  }

  /** Get the API key from config */
  private getApiKey(): string {
    return this.config.apiKey || '';
  }

  /** Build standard headers for this provider */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const key = this.getApiKey();
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }
    return headers;
  }

  // ── Model Management ──────────────────────────────────────────────────

  async listModels(): Promise<ProviderModel[]> {
    // Return cache if fresh
    if (this.modelsCache.length > 0 && Date.now() - this.modelsCacheTime < this.MODEL_CACHE_TTL_MS) {
      return this.modelsCache;
    }

    const baseUrl = this.getBaseUrl();
    if (!baseUrl) {
      logger.warn(`[${this.info.id}Provider] No base URL configured`);
      return [];
    }

    try {
      // Normalize: strip trailing /v1 for the models endpoint if needed
      const modelsUrl = `${baseUrl}/models`;
      logger.debug(`[${this.info.id}Provider] Fetching models from ${modelsUrl}`);

      const response = await fetch(modelsUrl, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(10_000), // 10s timeout for model listing
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        logger.warn(`[${this.info.id}Provider] Model fetch failed: ${response.status} ${errorText.slice(0, 200)}`);
        return this.modelsCache; // Return stale cache on failure
      }

      const data = await response.json();
      let rawModels: any[] = [];

      // OpenAI format: { data: [...] } or bare array
      if (Array.isArray(data)) {
        rawModels = data;
      } else if (data && Array.isArray(data.data)) {
        rawModels = data.data;
      }

      // Convert to ProviderModel format
      this.modelsCache = rawModels
        .filter((m: any) => m.id && typeof m.id === 'string')
        .map((m: any) => this.toProviderModel(m))
        // Sort by ID for consistent display
        .sort((a, b) => a.id.localeCompare(b.id));

      this.modelsCacheTime = Date.now();
      logger.debug(`[${this.info.id}Provider] Loaded ${this.modelsCache.length} models`);

      return this.modelsCache;
    } catch (error) {
      logger.error(`[${this.info.id}Provider] Model fetch error: ${error instanceof Error ? error.message : String(error)}`);
      return this.modelsCache; // Return stale cache
    }
  }

  async validateModel(modelId: string): Promise<boolean> {
    const models = await this.listModels();
    return models.some(m => m.id === modelId);
  }

  /** Convert a raw OpenAI model object to our ProviderModel format */
  private toProviderModel(raw: any): ProviderModel {
    const defaults = this.guessContextDefaults(raw.id);
    return {
      id: raw.id,
      name: raw.id, // OpenAI /models doesn't return display names
      providerId: this.info.id,
      supportsStreaming: true, // Assume all OpenAI-compatible models support streaming
      supportsTools: !this.isEmbeddingOrAudio(raw.id), // Embeddings/audio models can't do tool calls
      supportsImages: this.guessImageSupport(raw.id),
      maxContextTokens: raw.context_window || defaults.context,
      maxOutputTokens: raw.max_output_tokens || defaults.output,
      usesMaxCompletionTokens: this.guessUsesMaxCompletionTokens(raw.id),
      raw,
    };
  }

  /** Heuristic: does this model likely support images? */
  private guessImageSupport(modelId: string): boolean {
    const id = modelId.toLowerCase();
    // gpt-4o-mini-realtime / audio are audio-only despite the "gpt-4o" prefix
    if (id.includes('realtime') || id.includes('audio') || id.includes('tts') || id.includes('whisper')) {
      return false;
    }
    return id.includes('vision') || id.includes('gpt-4o') || id.includes('gpt-4-turbo')
      || id.includes('gpt-4.1') || id.includes('gpt-5') || id.includes('claude-3')
      || id.includes('claude-sonnet') || id.includes('claude-opus') || id.includes('claude-haiku')
      || id.includes('gemini');
  }

  /** Heuristic: is this a non-chat model (embeddings, audio, image gen)? */
  private isEmbeddingOrAudio(modelId: string): boolean {
    const id = modelId.toLowerCase();
    return id.includes('embedding') || id.includes('whisper') || id.includes('tts')
      || id.includes('dall-e') || id.includes('davinci') || id.includes('babbage')
      || id.includes('moderation');
  }

  /**
   * Best-effort context-window / output-token defaults by model family.
   * Used only when the /v1/models response omits explicit limits. Falls back
   * to a conservative 128K/4K so the renderer's token-budget code has finite
   * numbers to work with instead of NaN.
   */
  private guessContextDefaults(modelId: string): { context: number; output: number } {
    const id = modelId.toLowerCase();
    // OpenAI families
    if (/^gpt-5/.test(id)) return { context: 400_000, output: 128_000 };
    if (/^gpt-4\.1/.test(id)) return { context: 1_000_000, output: 32_768 };
    if (/^gpt-4o/.test(id)) return { context: 128_000, output: 16_384 };
    if (/^o4-mini/.test(id) || /^o3-mini/.test(id)) return { context: 200_000, output: 100_000 };
    if (/^o3/.test(id) || /^o1/.test(id)) return { context: 200_000, output: 100_000 };
    if (/^gpt-4-turbo/.test(id)) return { context: 128_000, output: 4_096 };
    if (/^gpt-3\.5/.test(id)) return { context: 16_385, output: 4_096 };
    // DeepSeek
    if (id.includes('deepseek-r1') || id.includes('reasoner')) return { context: 64_000, output: 8_192 };
    if (id.includes('deepseek')) return { context: 64_000, output: 8_192 };
    // Claude
    if (id.includes('claude-opus') || id.includes('claude-sonnet')) return { context: 200_000, output: 8_192 };
    if (id.includes('claude-haiku')) return { context: 200_000, output: 8_192 };
    // Gemini
    if (id.includes('gemini-2') || id.includes('gemini-1.5')) return { context: 1_000_000, output: 8_192 };
    // Llama / Mistral / Qwen via Ollama — conservative
    if (id.includes('llama') || id.includes('mistral') || id.includes('qwen') || id.includes('gemma')) {
      return { context: 32_768, output: 4_096 };
    }
    // Conservative default — finite, not NaN
    return { context: 128_000, output: 4_096 };
  }

  /** Heuristic: does this model use max_completion_tokens instead of max_tokens? */
  private guessUsesMaxCompletionTokens(modelId: string): boolean {
    const id = modelId.toLowerCase();
    return /^gpt-5/.test(id) || /^o\d/.test(id);
  }

  // ── Chat Completion (non-streaming) ───────────────────────────────────

  async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/chat/completions`;

    const body = this.buildRequestBody(params, false);

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`${this.info.displayName} API error: ${response.status} - ${errorText.slice(0, 500)}`);
    }

    const result = await response.json();
    const choice = result.choices?.[0];

    if (!choice?.message) {
      throw new Error(`${this.info.displayName}: Invalid response format`);
    }

    return {
      content: this.extractContent(choice.message.content),
      toolCalls: choice.message.tool_calls,
      finishReason: choice.finish_reason || 'stop',
      usage: result.usage ? {
        promptTokens: result.usage.prompt_tokens || 0,
        completionTokens: result.usage.completion_tokens || 0,
        totalTokens: result.usage.total_tokens || 0,
      } : undefined,
      model: result.model,
    };
  }

  // ── Chat Completion (streaming) ───────────────────────────────────────

  async *chatCompletionStream(params: ChatCompletionParams): AsyncIterable<ProviderStreamChunk> {
    const baseUrl = this.getBaseUrl();
    const url = `${baseUrl}/chat/completions`;

    const body = this.buildRequestBody(params, true);

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`${this.info.displayName} API error: ${response.status} - ${errorText.slice(0, 500)}`);
    }

    if (!response.body) {
      throw new Error(`${this.info.displayName}: No response body for streaming`);
    }

    // Parse SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            for (const c of this.parseStreamChunks(json)) yield c;
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim() && buffer.trim() !== 'data: [DONE]' && buffer.trim().startsWith('data: ')) {
        try {
          const json = JSON.parse(buffer.trim().slice(6));
          for (const c of this.parseStreamChunks(json)) yield c;
        } catch {
          // Ignore
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── Connection Test ───────────────────────────────────────────────────

  async testConnection(): Promise<ConnectionTestResult> {
    const startTime = Date.now();

    try {
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
      const message = error instanceof Error ? error.message : String(error);

      // Provide user-friendly error messages
      if (message.includes('401') || message.includes('Unauthorized')) {
        return { success: false, latencyMs, error: 'Invalid API key. Please check and try again.' };
      }
      if (message.includes('403') || message.includes('Forbidden')) {
        return { success: false, latencyMs, error: 'API key does not have permission to access this endpoint.' };
      }
      if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
        return { success: false, latencyMs, error: `Cannot connect to ${this.getBaseUrl()}. Check the URL and network.` };
      }
      if (message.includes('timeout') || message.includes('TimeoutError')) {
        return { success: false, latencyMs, error: 'Connection timed out. The server may be unreachable.' };
      }

      return { success: false, latencyMs, error: message };
    }
  }

  // ── Internal Helpers ──────────────────────────────────────────────────

  /** Build the request body for /chat/completions */
  private buildRequestBody(params: ChatCompletionParams, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      stream,
    };

    // Max tokens — use the correct field name
    if (params.maxTokens) {
      if (this.guessUsesMaxCompletionTokens(params.model)) {
        body.max_completion_tokens = params.maxTokens;
      } else {
        body.max_tokens = params.maxTokens;
      }
    }

    if (params.temperature !== undefined) {
      body.temperature = params.temperature;
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
      if (params.tool_choice) {
        body.tool_choice = params.tool_choice;
      }
    }

    if (stream) {
      body.stream_options = { include_usage: true };
    }

    return body;
  }

  /**
   * Yield one or more ProviderStreamChunks from a single SSE JSON event.
   * Splits multi-tool-call deltas (parallel function calls) into one chunk per
   * tool_call entry so downstream consumers can forward them all to the UI.
   */
  private *parseStreamChunks(json: any): IterableIterator<ProviderStreamChunk> {
    const choice = json.choices?.[0];

    if (choice?.delta?.content) {
      yield { contentDelta: choice.delta.content };
    }

    if (Array.isArray(choice?.delta?.tool_calls)) {
      for (const tc of choice.delta.tool_calls) {
        if (!tc) continue;
        yield {
          toolCallDelta: {
            index: tc.index ?? 0,
            id: tc.id,
            type: tc.type,
            function: tc.function,
          },
        };
      }
    }

    // Finish + usage + model — emit as a trailing chunk so accounting lands
    // after content/tool deltas in the consumer.
    const trailer: ProviderStreamChunk = {};
    if (choice?.finish_reason) trailer.finishReason = choice.finish_reason;
    if (json.usage) {
      trailer.usage = {
        promptTokens: json.usage.prompt_tokens || 0,
        completionTokens: json.usage.completion_tokens || 0,
        totalTokens: json.usage.total_tokens || 0,
      };
    }
    if (json.model) trailer.model = json.model;
    if (trailer.finishReason || trailer.usage || trailer.model) {
      yield trailer;
    }
  }

  /** Parse a single SSE chunk from the streaming response */
  /** Extract text content from OpenAI response content (string or array) */
  private extractContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((part: any) => part?.type === 'text')
        .map((part: any) => part.text || '')
        .join('');
    }
    return String(content || '');
  }
}
