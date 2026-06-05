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
import {
  ghcModelsManager,
  buildMaxTokensParam,
  buildReasoningParams,
  getDefaultReasoningEffort,
} from '../ghcModelsManager';
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
  ChatMessage,
  ChatTool,
} from './types';

const logger = createLogger();

type ResponseInputContent =
  | string
  | Array<
    | { type: 'input_text'; text: string }
    | { type: 'input_image'; image_url?: string; file_id?: string; detail?: string }
  >;

type ResponseInputItem =
  | { type: 'message'; role: 'system' | 'user' | 'assistant'; content: ResponseInputContent }
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'function_call_output'; call_id: string; output: string };

interface StreamParseState {
  responseToolCallCount: number;
}

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

    const body = this.buildRequestBody(params, false, endpoint);

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
    if (endpoint === '/responses') {
      return this.parseResponsesResult(result);
    }

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

    const body = this.buildRequestBody(params, true, endpoint);

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

    // Parse SSE stream into the provider-neutral chunk format.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const parseState: StreamParseState = { responseToolCallCount: 0 };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            yield* this.parseSseBuffer(buffer, endpoint, parseState);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.slice(6));
            for (const c of this.parseStreamChunks(json, endpoint, parseState)) yield c;
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
        models: models.map((m: any) => m.id).filter((id: unknown): id is string => typeof id === 'string' && id.length > 0),
        rawModels: models,
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

  private buildRequestBody(
    params: ChatCompletionParams,
    stream: boolean,
    endpoint: string,
  ): Record<string, unknown> {
    if (endpoint === '/responses') {
      return this.buildResponsesRequestBody(params, stream, endpoint);
    }
    return this.buildChatCompletionsRequestBody(params, stream, endpoint);
  }

  private buildChatCompletionsRequestBody(
    params: ChatCompletionParams,
    stream: boolean,
    endpoint: string,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      ...buildMaxTokensParam(params.model, params.maxTokens || 4000),
      ...this.buildReasoningFragment(params, endpoint),
      stream,
    };

    if (params.temperature !== undefined && this.modelSupportsTemperature(params.model)) {
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

  private buildResponsesRequestBody(
    params: ChatCompletionParams,
    stream: boolean,
    endpoint: string,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: params.model,
      input: this.convertMessagesToResponsesInput(params.messages),
      ...buildMaxTokensParam(params.model, params.maxTokens || 4000),
      ...this.buildReasoningFragment(params, endpoint),
      stream,
      include: ['reasoning.encrypted_content'],
    };

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map(tool => this.convertToolToResponsesFormat(tool));
      if (params.tool_choice) {
        body.tool_choice = this.convertToolChoiceToResponsesFormat(params.tool_choice);
      }
    }

    return body;
  }

  private buildReasoningFragment(params: ChatCompletionParams, endpoint: string): Record<string, unknown> {
    const capabilities = ghcModelsManager.getModelCapabilities(params.model);
    const supportedEfforts = capabilities?.reasoningEfforts ?? [];
    return buildReasoningParams({
      endpoint,
      supportedEfforts,
      reasoningEffort: params.reasoningEffort,
      defaultEffort: getDefaultReasoningEffort(params.model, supportedEfforts),
    });
  }

  private modelSupportsTemperature(modelId: string): boolean {
    return ghcModelsManager.getModelCapabilities(modelId)?.supportsTemperature ?? true;
  }

  private convertMessagesToResponsesInput(messages: ChatMessage[]): ResponseInputItem[] {
    const inputItems: ResponseInputItem[] = [];

    for (const message of messages) {
      if (message.role === 'system' || message.role === 'user') {
        const content = this.convertResponseMessageContent(message.content);
        if (this.hasResponseMessageContent(content)) {
          inputItems.push({
            type: 'message',
            role: message.role,
            content,
          });
        }
        continue;
      }

      if (message.role === 'assistant') {
        const content = this.convertResponseMessageContent(message.content);
        const assistantMessage: ResponseInputItem = {
          type: 'message',
          role: 'assistant',
          content,
        };

        if (message.tool_calls && message.tool_calls.length > 0) {
          if (this.hasResponseMessageContent(content)) {
            inputItems.push(assistantMessage);
          }

          for (const toolCall of message.tool_calls) {
            inputItems.push({
              type: 'function_call',
              call_id: toolCall.id,
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            });
          }
        } else {
          if (this.hasResponseMessageContent(content)) {
            inputItems.push(assistantMessage);
          }
        }
        continue;
      }

      if (message.role === 'tool') {
        inputItems.push({
          type: 'function_call_output',
          call_id: message.tool_call_id || '',
          output: this.contentToString(message.content),
        });
      }
    }

    return inputItems;
  }

  private convertResponseMessageContent(content: ChatMessage['content']): ResponseInputContent {
    if (!Array.isArray(content)) {
      return content;
    }

    const converted: Exclude<ResponseInputContent, string> = [];
    for (const part of content) {
      if (part.type === 'text' && typeof part.text === 'string') {
        converted.push({ type: 'input_text', text: part.text });
      } else if (part.type === 'input_text' && typeof part.text === 'string') {
        converted.push({ type: 'input_text', text: part.text });
      } else if (part.type === 'image_url') {
        const imageUrl = this.getStringAtPath(part, ['image_url', 'url']);
        if (imageUrl) {
          const detail = this.getStringAtPath(part, ['image_url', 'detail']);
          converted.push({
            type: 'input_image',
            image_url: imageUrl,
            detail: this.normalizeImageDetail(detail),
          });
        }
      } else if (part.type === 'input_image') {
        const imageUrl = typeof part.image_url === 'string' ? part.image_url : undefined;
        const fileId = typeof part.file_id === 'string' ? part.file_id : undefined;
        if (imageUrl || fileId) {
          converted.push({
            type: 'input_image',
            image_url: imageUrl,
            file_id: fileId,
            detail: this.normalizeImageDetail(typeof part.detail === 'string' ? part.detail : undefined),
          });
        }
      }
    }

    return converted;
  }

  private hasResponseMessageContent(content: ResponseInputContent): boolean {
    if (typeof content === 'string') {
      return content.length > 0;
    }
    return content.length > 0;
  }

  private contentToString(content: ChatMessage['content']): string {
    if (typeof content === 'string') {
      return content;
    }
    return content
      .map((part) => {
        if (part.type === 'text' && typeof part.text === 'string') return part.text;
        if (part.type === 'input_text' && typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  private getStringAtPath(value: Record<string, unknown>, path: string[]): string | undefined {
    let current: unknown = value;
    for (const key of path) {
      if (!current || typeof current !== 'object' || !(key in current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[key];
    }
    return typeof current === 'string' ? current : undefined;
  }

  private normalizeImageDetail(detail: string | undefined): 'low' | 'high' | 'auto' | 'original' | undefined {
    if (detail === 'low' || detail === 'high' || detail === 'auto' || detail === 'original') {
      return detail;
    }
    return undefined;
  }

  private convertToolToResponsesFormat(tool: ChatTool): Record<string, unknown> {
    return {
      type: 'function',
      name: tool.function.name,
      description: tool.function.description || '',
      parameters: tool.function.parameters,
      strict: false,
    };
  }

  private convertToolChoiceToResponsesFormat(toolChoice: ChatCompletionParams['tool_choice']): unknown {
    if (toolChoice && typeof toolChoice === 'object') {
      const name = toolChoice.function?.name;
      if (!name) {
        return undefined;
      }
      return {
        type: 'function',
        name,
      };
    }
    return toolChoice;
  }

  private *parseSseBuffer(
    buffer: string,
    endpoint: string,
    state: StreamParseState,
  ): IterableIterator<ProviderStreamChunk> {
    const trimmed = buffer.trim();
    if (!trimmed || trimmed === 'data: [DONE]' || !trimmed.startsWith('data: ')) {
      return;
    }

    try {
      const json = JSON.parse(trimmed.slice(6));
      yield* this.parseStreamChunks(json, endpoint, state);
    } catch {
      // Skip malformed JSON
    }
  }

  /**
   * Yield one or more ProviderStreamChunks from a single SSE JSON event.
   * Splits multi-tool-call deltas (parallel function calls) into one chunk per
   * tool_call entry.
   */
  private *parseStreamChunks(
    json: any,
    endpoint = '/chat/completions',
    state: StreamParseState = { responseToolCallCount: 0 },
  ): IterableIterator<ProviderStreamChunk> {
    if (endpoint === '/responses') {
      yield* this.parseResponsesStreamChunks(json, state);
      return;
    }

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

  private *parseResponsesStreamChunks(
    json: any,
    state: StreamParseState,
  ): IterableIterator<ProviderStreamChunk> {
    if (json.type === 'response.output_text.delta' && typeof json.delta === 'string') {
      yield { contentDelta: json.delta };
      return;
    }

    if (json.type === 'response.output_item.done' && json.item?.type === 'function_call') {
      const item = json.item;
      const index = typeof json.output_index === 'number'
        ? json.output_index
        : state.responseToolCallCount;
      state.responseToolCallCount = Math.max(state.responseToolCallCount, index + 1);

      yield {
        toolCallDelta: {
          index,
          id: item.call_id || item.id,
          type: 'function',
          function: {
            name: item.name,
            arguments: item.arguments || '',
          },
        },
      };
      return;
    }

    if (json.type === 'response.completed') {
      const response = json.response || {};
      const hasFunctionCall = (
        Array.isArray(response.output)
        && response.output.some((item: any) => item?.type === 'function_call')
      ) || state.responseToolCallCount > 0;
      const trailer: ProviderStreamChunk = {
        finishReason: hasFunctionCall ? 'tool_calls' : 'stop',
      };

      const usage = this.normalizeUsage(response.usage ?? json.usage);
      if (usage) trailer.usage = usage;
      if (typeof response.model === 'string') {
        trailer.model = response.model;
      } else if (typeof json.model === 'string') {
        trailer.model = json.model;
      }
      yield trailer;
    }
  }

  private parseResponsesResult(result: any): ChatCompletionResult {
    const outputItems = Array.isArray(result.output) ? result.output : [];
    const toolCalls = outputItems
      .filter((item: any) => item?.type === 'function_call')
      .map((item: any) => ({
        id: item.call_id || item.id || '',
        type: 'function' as const,
        function: {
          name: item.name || '',
          arguments: item.arguments || '',
        },
      }))
      .filter((toolCall: any) => toolCall.id && toolCall.function.name);

    return {
      content: this.extractResponsesContent(result, outputItems),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      usage: this.normalizeUsage(result.usage),
      model: result.model,
    };
  }

  private extractResponsesContent(result: any, outputItems: any[]): string {
    if (typeof result.output_text === 'string') {
      return result.output_text;
    }

    const messageText = outputItems
      .filter((item: any) => item?.type === 'message')
      .flatMap((item: any) => Array.isArray(item.content) ? item.content : [])
      .filter((part: any) => part?.type === 'output_text' || part?.type === 'text')
      .map((part: any) => part.text || '')
      .join('');

    if (messageText) {
      return messageText;
    }

    return outputItems
      .filter((item: any) => item?.type === 'output_text' && typeof item.text === 'string')
      .map((item: any) => item.text)
      .join('');
  }

  private normalizeUsage(usage: any): ProviderStreamChunk['usage'] {
    if (!usage) return undefined;
    const promptTokens = usage.prompt_tokens ?? usage.promptTokens ?? usage.input_tokens ?? usage.inputTokens ?? 0;
    const completionTokens = usage.completion_tokens ?? usage.completionTokens ?? usage.output_tokens ?? usage.outputTokens ?? 0;
    return {
      promptTokens,
      completionTokens,
      totalTokens: usage.total_tokens ?? usage.totalTokens ?? promptTokens + completionTokens,
    };
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
