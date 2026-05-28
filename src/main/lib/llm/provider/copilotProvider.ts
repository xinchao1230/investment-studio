// src/main/lib/llm/provider/copilotProvider.ts
/**
 * GitHub Copilot LLM Provider
 *
 * Wraps the existing GHC authentication and API logic into the ILlmProvider
 * interface. This is the default provider when the user is logged in with
 * GitHub Copilot.
 *
 * All API calls go through api.githubcopilot.com, which proxies to the
 * underlying model providers (OpenAI, Anthropic, Google).
 */

import { createLogger } from '../../unifiedLogger';
import { GHC_CONFIG } from '../../auth/ghcConfig';
import { MainAuthManager } from '../../auth/authManager';
import { ghcModelsManager, buildMaxTokensParam } from '../ghcModelsManager';
import { getEndpointForModel } from '../ghcModelApi';
import {
  ILlmProvider,
  ProviderInfo,
  ProviderConfig,
  ProviderModel,
  ChatCompletionParams,
  ChatCompletionResult,
  ProviderStreamChunk,
  ConnectionTestResult,
} from './types';

const logger = createLogger();

export class CopilotProvider implements ILlmProvider {
  readonly info: ProviderInfo = {
    id: 'copilot',
    displayName: 'GitHub Copilot',
    requiresGitHubAuth: true,
    requiresApiKey: false,
    defaultBaseUrl: GHC_CONFIG.API_ENDPOINT,
    description: 'Access Claude, GPT, Gemini via your GitHub Copilot subscription',
  };

  private config: ProviderConfig = { enabled: true };

  configure(config: ProviderConfig): void {
    this.config = config;
  }

  dispose(): void {
    // No cleanup needed — token lifecycle managed by MainAuthManager
  }

  getCachedModels(): ProviderModel[] {
    // Copilot models are managed by ghcModelsManager, not cached here
    return [];
  }

  // ── Auth Helpers ──────────────────────────────────────────────────────

  /** Get the current Copilot JWT token */
  private getCopilotToken(): string | null {
    return MainAuthManager.getInstance().getCopilotAccessToken();
  }

  /** Build standard Copilot API headers */
  private buildHeaders(token: string): Record<string, string> {
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': GHC_CONFIG.USER_AGENT,
      'Editor-Version': GHC_CONFIG.EDITOR_VERSION,
      'Editor-Plugin-Version': GHC_CONFIG.EDITOR_PLUGIN_VERSION,
      'Copilot-Integration-Id': GHC_CONFIG.INTEGRATION_ID,
    };
  }

  // ── Model Management ──────────────────────────────────────────────────

  async listModels(): Promise<ProviderModel[]> {
    // Use GhcModelsManager's already-cached and filtered model list
    const models = ghcModelsManager.getAllOpenKosmosUsedModels();
    return models.map(m => ({
      id: m.id,
      name: m.name || m.id,
      providerId: 'copilot' as const,
      supportsStreaming: m.capabilities?.supports?.streaming ?? true,
      supportsTools: m.capabilities?.supports?.tool_calls ?? true,
      supportsImages: m.capabilities?.supports?.vision ?? false,
      maxContextTokens: m.capabilities?.limits?.max_prompt_tokens || m.capabilities?.limits?.max_context_window_tokens,
      maxOutputTokens: m.capabilities?.limits?.max_output_tokens,
      usesMaxCompletionTokens: /^gpt-5/.test(m.id) || /^o\d/.test(m.id),
      raw: m,
    }));
  }

  async validateModel(modelId: string): Promise<boolean> {
    return ghcModelsManager.validateModelId(modelId);
  }

  // ── Chat Completion (non-streaming) ───────────────────────────────────

  async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    const token = this.getCopilotToken();
    if (!token) {
      throw new Error('GitHub Copilot authentication required. Please sign in first.');
    }

    const endpoint = getEndpointForModel(params.model);
    const url = `${GHC_CONFIG.API_ENDPOINT}${endpoint}`;

    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      ...buildMaxTokensParam(params.model, params.maxTokens || 4000),
      stream: false,
    };

    if (params.temperature !== undefined) {
      body.temperature = params.temperature;
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
      if (params.tool_choice) {
        body.tool_choice = params.tool_choice;
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(token),
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`GitHub Copilot API error: ${response.status} - ${errorText.slice(0, 500)}`);
    }

    const result = await response.json();
    const choice = result.choices?.[0];

    if (!choice?.message) {
      throw new Error('GitHub Copilot: Invalid response format');
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
    const token = this.getCopilotToken();
    if (!token) {
      throw new Error('GitHub Copilot authentication required. Please sign in first.');
    }

    const endpoint = getEndpointForModel(params.model);
    const url = `${GHC_CONFIG.API_ENDPOINT}${endpoint}`;

    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      ...buildMaxTokensParam(params.model, params.maxTokens || 4000),
      stream: true,
      stream_options: { include_usage: true },
    };

    if (params.temperature !== undefined) {
      body.temperature = params.temperature;
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
      if (params.tool_choice) {
        body.tool_choice = params.tool_choice;
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this.buildHeaders(token),
      body: JSON.stringify(body),
      signal: params.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`GitHub Copilot API error: ${response.status} - ${errorText.slice(0, 500)}`);
    }

    if (!response.body) {
      throw new Error('GitHub Copilot: No response body for streaming');
    }

    // Parse SSE stream — same logic as agentChatStreamingService
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            for (const c of this.parseStreamChunks(json)) yield c;
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── Connection Test ───────────────────────────────────────────────────

  async testConnection(): Promise<ConnectionTestResult> {
    const startTime = Date.now();
    const token = this.getCopilotToken();

    if (!token) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        error: 'Not logged in to GitHub Copilot. Please sign in first.',
      };
    }

    try {
      const response = await fetch(`${GHC_CONFIG.API_ENDPOINT}/models`, {
        method: 'GET',
        headers: this.buildHeaders(token),
        signal: AbortSignal.timeout(10_000),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        return {
          success: false,
          latencyMs,
          error: `Copilot API returned ${response.status}. Your token may need refreshing.`,
        };
      }

      const data = await response.json();
      const models = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];

      return {
        success: true,
        latencyMs,
        sampleModels: models.slice(0, 5).map((m: any) => m.id),
      };
    } catch (error) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /**
   * Yield one or more ProviderStreamChunks from a single SSE JSON event.
   * Splits multi-tool-call deltas (parallel function calls) into one chunk per
   * tool_call entry.
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
