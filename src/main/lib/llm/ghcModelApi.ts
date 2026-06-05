import { LlmApiSettings, Message, MessageHelper } from '@shared/types/chatTypes';
import {
  getModelById,
  buildMaxTokensParam,
  buildReasoningParams,
  getDefaultReasoningEffort,
  getModelCapabilities,
} from './ghcModelsManager';
import { GHC_CONFIG } from '../auth/ghcConfig';
import { MainAuthManager } from "../auth/authManager";
import { providerManager } from './provider';
import type { ChatMessage } from './provider';

/**
 * Determine the API endpoint to use based on the model configuration
 * @param modelId Model ID
 * @returns API endpoint path
 */
export function getEndpointForModel(modelId: string): string {
  const model = getModelById(modelId);

  if (model && model.supported_endpoints && model.supported_endpoints.length > 0) {
    // Prefer /chat/completions (OpenAI-compatible format); avoid /v1/messages (Anthropic native format requires a different tool_choice structure)
    if (model.supported_endpoints.includes('/chat/completions')) {
      return '/chat/completions';
    }
    // If /chat/completions is not supported (e.g., Codex series only has /responses), use the first available endpoint
    return model.supported_endpoints[0];
  }

  // Default to the /chat/completions endpoint
  return '/chat/completions';
}

/**
 * GitHub Copilot model API class
 * Specifically for single calls to GPT 4.1 model via GitHub Copilot
 * Does not support tools, streaming output, or message history management
 */
export class GhcModelApi {
  private config: LlmApiSettings;
  private currentModel: string;

  constructor() {
    this.currentModel = 'gpt-4.1';

    this.config = {
      apiKey: '', // Will be set from session token
      endpoint: GHC_CONFIG.API_ENDPOINT,
      deploymentName: this.currentModel,
      apiVersion: '2025-01-01-preview'
    };
  }

  /**
   * Single call to GitHub Copilot GPT 4.1 model
   * @param userPrompt User input prompt
   * @param systemPrompt System prompt for setting context (optional)
   * @param maxTokens Maximum token count, default 4000
   * @param temperature Temperature parameter, default 0.7
   * @returns Model response content
   */
  async callGPT41(
    userPrompt: string,
    systemPrompt?: string,
    maxTokens: number = 4000,
    temperature: number = 0.7
  ): Promise<string> {
    // Route through ProviderManager for non-Copilot providers
    await providerManager.waitUntilReady();
    if (providerManager.getActiveProviderId() !== 'copilot') {
      return this.callViaProvider(userPrompt, systemPrompt, maxTokens, temperature);
    }

    try {
      // Get session from auth manager
      const session = await this.getSessionFromAuthManager();
      if (!session) {
        throw new Error('GitHub Copilot authentication required');
      }

      // Build request messages
      const messages: Message[] = [];

      // Add system message if provided
      if (systemPrompt) {
        const systemMessage = MessageHelper.createTextMessage(
          systemPrompt,
          'system',
          (Date.now() - 1).toString()
        );
        messages.push(systemMessage);
      }

      // Add user message
      const userMessage = MessageHelper.createTextMessage(
        userPrompt,
        'user',
        Date.now().toString()
      );
      messages.push(userMessage);

      // Format messages for API
      const formattedMessages = this.formatMessagesForApi(messages);

      // Build request body
      const requestBody = {
        model: this.currentModel,
        messages: formattedMessages,
        ...buildMaxTokensParam(this.currentModel, maxTokens),
        temperature: temperature,
        stream: false
      };

      // Build API URL
      const url = `${GHC_CONFIG.API_ENDPOINT}/chat/completions`;

      // Make API request with GitHub Copilot headers
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.ghcAuth.copilotTokens.token}`,
          'Content-Type': 'application/json',
          'User-Agent': GHC_CONFIG.USER_AGENT,
          'Editor-Version': GHC_CONFIG.EDITOR_VERSION,
          'Editor-Plugin-Version': GHC_CONFIG.EDITOR_PLUGIN_VERSION
        },
        body: JSON.stringify(requestBody)
      });

      // Check response status
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub Copilot API error: ${response.status} - ${errorText}`);
      }

      // Parse response
      const result = await response.json();

      // Extract response content
      const message = result.choices?.[0]?.message;
      if (!message || !message.content) {
        throw new Error('API response format invalid or no content');
      }

      // Handle content format (string or array)
      let responseContent: string;
      if (Array.isArray(message.content)) {
        // Extract text content from array format
        const textParts = message.content.filter((part: any) => part && typeof part === 'object' && part.type === 'text');
        responseContent = textParts.map((part: any) => part.text || '').join('');
      } else {
        responseContent = String(message.content || '');
      }

      return responseContent;

    } catch (error) {
      throw error;
    }
  }

  /**
   * Generic GitHub Copilot API call method
   * @param modelId Model ID (e.g., 'gpt-4.1', 'claude-3.5-sonnet', etc.)
   * @param userPrompt User input prompt
   * @param systemPrompt System prompt (optional)
   * @param maxTokens Maximum token count, default 4000
   * @param temperature Temperature parameter, default 0.7
   * @returns Model response content
   */
  async callModel(
    modelId: string,
    userPrompt: string,
    systemPrompt?: string,
    maxTokens: number = 4000,
    temperature: number = 0.7
  ): Promise<string> {
    // Route through ProviderManager for non-Copilot providers
    await providerManager.waitUntilReady();
    if (providerManager.getActiveProviderId() !== 'copilot') {
      return this.callViaProvider(userPrompt, systemPrompt, maxTokens, temperature, modelId);
    }

    try {
      // Get session authentication info
      const session = await this.getSessionFromAuthManager();
      if (!session) {
        throw new Error('GitHub Copilot authentication required');
      }

      // Build request messages
      const messages: Message[] = [];

      // Add system message (if provided)
      if (systemPrompt) {
        const systemMessage = MessageHelper.createTextMessage(
          systemPrompt,
          'system',
          (Date.now() - 1).toString()
        );
        messages.push(systemMessage);
      }

      // Add user message
      const userMessage = MessageHelper.createTextMessage(
        userPrompt,
        'user',
        Date.now().toString()
      );
      messages.push(userMessage);

      // Format messages for API
      const formattedMessages = this.formatMessagesForApi(messages);

      // Determine endpoint based on model
      const endpoint = getEndpointForModel(modelId);

      // Build request body
      const requestBody = this.buildCopilotRequestBody(
        modelId,
        formattedMessages,
        endpoint,
        maxTokens,
        temperature,
      );

      // Build API URL
      const url = `${this.config.endpoint}${endpoint}`;

      // Make API request with GitHub Copilot headers
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.ghcAuth.copilotTokens.token}`,
          'Content-Type': 'application/json',
          'User-Agent': GHC_CONFIG.USER_AGENT,
          'Editor-Version': GHC_CONFIG.EDITOR_VERSION,
          'Editor-Plugin-Version': GHC_CONFIG.EDITOR_PLUGIN_VERSION
        },
        body: JSON.stringify(requestBody)
      });

      // Check response status
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitHub Copilot API error: ${response.status} - ${errorText}`);
      }

      // Parse response
      const result = await response.json();

      return this.extractResponseContent(result, endpoint);

    } catch (error) {
      throw error;
    }
  }

  /**
   * Strict variant of {@link callModel} that refuses any silent model fallback.
   *
   * `callModel` (and `callWithMessages`) routes non-Copilot requests through
   * `providerManager.resolveModelId(modelId)`, which falls back to the
   * provider's configured default, then to a `PREFERENCE_BY_PROVIDER` family
   * match, then to the first chat-capable model whenever the supplied modelId
   * isn't valid for the active provider. That fallback is invisible to the
   * caller and violates the project rule that every LLM call must run on
   * exactly the model the user picked. For utility helpers (file naming, MCP
   * config formatting, system prompt polishing, title generation, document
   * summarization) and for context compression we never want that behavior —
   * if the user-selected model isn't available on the active provider, the
   * call must surface a clear error so the caller can fall back to a
   * deterministic non-LLM path (or report failure to the user) instead of
   * quietly running on a different model.
   *
   * Contract:
   * - Throws when `modelId` is empty or whitespace-only.
   * - For non-Copilot providers: throws when the active provider's
   *   `validateModel(modelId)` returns false, before issuing any request.
   * - For the Copilot provider: throws when `modelId` is not registered in
   *   the local Copilot model registry (`getModelById`).
   * - Otherwise behaves like {@link callModel}: single non-streaming call,
   *   returns the assistant's text content.
   */
  async callModelStrict(
    modelId: string,
    userPrompt: string,
    systemPrompt?: string,
    maxTokens: number = 4000,
    temperature: number = 0.7,
  ): Promise<string> {
    const trimmed = typeof modelId === 'string' ? modelId.trim() : '';
    if (!trimmed) {
      throw new Error('callModelStrict requires a non-empty modelId; received empty or whitespace value');
    }

    await providerManager.waitUntilReady();
    const activeProviderId = providerManager.getActiveProviderId();

    if (activeProviderId !== 'copilot') {
      const provider = providerManager.getActiveProvider();
      const valid = await provider.validateModel(trimmed);
      if (!valid) {
        throw new Error(
          `Model '${trimmed}' is not available on the active provider '${activeProviderId}'. ` +
          `callModelStrict refuses to silently fall back to a different model. ` +
          `Pick a model that the active provider supports.`,
        );
      }
      const messages: ChatMessage[] = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: userPrompt });
      const result = await providerManager.chatCompletion({
        model: trimmed,
        messages,
        maxTokens,
        temperature,
      });
      return result.content;
    }

    // Copilot path — validate against the local registry before delegating to
    // callModel, whose Copilot branch does not perform any fallback itself.
    const model = getModelById(trimmed);
    if (!model) {
      throw new Error(
        `Model '${trimmed}' is not registered in the GitHub Copilot model list. ` +
        `callModelStrict refuses to silently fall back to a different model.`,
      );
    }
    return this.callModel(trimmed, userPrompt, systemPrompt, maxTokens, temperature);
  }

  /**
   * Call an LLM model with a pre-built messages array.
   * Unlike callModel(), this accepts arbitrary multi-message conversations
   * without constructing Message objects — the caller provides { role, content } directly.
   * Used by the eval harness's judge handler.
   */
  async callWithMessages(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    maxTokens: number = 4000,
    temperature: number = 0.7
  ): Promise<string> {
    // Route through ProviderManager for non-Copilot providers
    await providerManager.waitUntilReady();
    if (providerManager.getActiveProviderId() !== 'copilot') {
      const resolvedModel = await providerManager.resolveModelId(modelId);
      const result = await providerManager.chatCompletion({
        model: resolvedModel,
        messages: messages as ChatMessage[],
        maxTokens,
        temperature,
      });
      return result.content;
    }

    const session = await this.getSessionFromAuthManager();
    if (!session) {
      throw new Error('GitHub Copilot authentication required');
    }

    const endpoint = getEndpointForModel(modelId);

    const requestBody = this.buildCopilotRequestBody(
      modelId,
      messages,
      endpoint,
      maxTokens,
      temperature,
    );

    const url = `${this.config.endpoint}${endpoint}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.ghcAuth.copilotTokens.token}`,
        'Content-Type': 'application/json',
        'User-Agent': GHC_CONFIG.USER_AGENT,
        'Editor-Version': GHC_CONFIG.EDITOR_VERSION,
        'Editor-Plugin-Version': GHC_CONFIG.EDITOR_PLUGIN_VERSION
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GitHub Copilot API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    return this.extractResponseContent(result, endpoint);
  }

  /**
   * Get session from auth manager - direct token usage, validity managed by token monitor
   */
  private async getSessionFromAuthManager(): Promise<any | null> {
    try {
      const authManager = MainAuthManager.getInstance();

      // ✅ Per user requirement: directly retrieve session without deciding to refresh ourselves
      // Token validity is monitored by TokenMonitor and guaranteed by AuthManager
      const currentSession = await authManager.getCurrentAuth();

      if (currentSession && currentSession.authProvider === 'ghc') {
        return currentSession;
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  }

  /**
   * Format messages for API (simplified version from agentChat.ts)
   */
  private formatMessagesForApi(messages: Message[]): any[] {
    const formattedMessages = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      if (!msg.content && msg.role !== 'system') {
        continue;
      }

      // Extract text content using MessageHelper
      const messageContent = MessageHelper.getText(msg);

      const apiMessage: any = {
        role: msg.role,
        content: messageContent
      };

      formattedMessages.push(apiMessage);
    }

    return formattedMessages;
  }

  private buildCopilotRequestBody(
    modelId: string,
    messages: Array<{ role: string; content: string; tool_call_id?: string }>,
    endpoint: string,
    maxTokens: number,
    temperature: number,
  ): Record<string, unknown> {
    if (endpoint === '/responses') {
      const body: Record<string, unknown> = {
        model: modelId,
        input: this.convertMessagesToResponsesInput(messages),
        ...buildMaxTokensParam(modelId, maxTokens),
        ...this.buildReasoningFragment(modelId, endpoint),
        stream: false,
        include: ['reasoning.encrypted_content'],
      };
      this.addTemperatureIfSupported(body, modelId, temperature);
      return body;
    }

    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      ...buildMaxTokensParam(modelId, maxTokens),
      ...this.buildReasoningFragment(modelId, endpoint),
      stream: false,
    };
    this.addTemperatureIfSupported(body, modelId, temperature);
    return body;
  }

  private addTemperatureIfSupported(
    body: Record<string, unknown>,
    modelId: string,
    temperature: number,
  ): void {
    if (this.modelSupportsTemperature(modelId)) {
      body.temperature = temperature;
    }
  }

  private modelSupportsTemperature(modelId: string): boolean {
    return getModelCapabilities(modelId)?.supportsTemperature ?? true;
  }

  private buildReasoningFragment(modelId: string, endpoint: string): Record<string, unknown> {
    const supportedEfforts = getModelCapabilities(modelId)?.reasoningEfforts ?? [];
    return buildReasoningParams({
      endpoint,
      supportedEfforts,
      defaultEffort: getDefaultReasoningEffort(modelId, supportedEfforts),
    });
  }

  private convertMessagesToResponsesInput(
    messages: Array<{ role: string; content: string; tool_call_id?: string }>,
  ): Array<Record<string, unknown>> {
    return messages.map((message) => {
      if (message.role === 'system' || message.role === 'user' || message.role === 'assistant') {
        return {
          type: 'message',
          role: message.role,
          content: message.content,
        };
      }

      if (message.role === 'tool') {
        return {
          type: 'function_call_output',
          call_id: message.tool_call_id || '',
          output: message.content,
        };
      }

      throw new Error(`Unsupported message role '${message.role}' for GitHub Copilot /responses format`);
    });
  }

  private extractResponseContent(result: any, endpoint: string): string {
    if (endpoint === '/responses') {
      const responseText = this.extractResponsesContent(result);
      if (!responseText) {
        throw new Error('API response format invalid or no content');
      }
      return responseText;
    }

    const message = result.choices?.[0]?.message;
    if (!message || !message.content) {
      throw new Error('API response format invalid or no content');
    }

    return this.extractChatMessageContent(message.content);
  }

  private extractChatMessageContent(content: unknown): string {
    if (Array.isArray(content)) {
      const textParts = content.filter((part: any) => part && typeof part === 'object' && part.type === 'text');
      return textParts.map((part: any) => part.text || '').join('');
    }
    return String(content || '');
  }

  private extractResponsesContent(result: any): string {
    if (typeof result.output_text === 'string') {
      return result.output_text;
    }

    const outputItems = Array.isArray(result.output) ? result.output : [];
    return outputItems
      .filter((item: any) => item?.type === 'message')
      .flatMap((item: any) => Array.isArray(item.content) ? item.content : [])
      .filter((part: any) => part?.type === 'output_text' || part?.type === 'text')
      .map((part: any) => part.text || '')
      .join('');
  }

  /**
   * Route a utility LLM call through ProviderManager.
   * Used by callGPT41 and callModel when a non-Copilot provider is active.
   */
  private async callViaProvider(
    userPrompt: string,
    systemPrompt?: string,
    maxTokens: number = 4000,
    temperature: number = 0.7,
    modelId?: string,
  ): Promise<string> {
    const resolvedModel = await providerManager.resolveModelId(modelId);
    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: userPrompt });

    const result = await providerManager.chatCompletion({
      model: resolvedModel,
      messages,
      maxTokens,
      temperature,
    });
    return result.content;
  }
}

// Create and export singleton instance
export const ghcModelApi = new GhcModelApi();
export default ghcModelApi;