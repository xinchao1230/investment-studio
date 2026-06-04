/**
 * SubAgentLLMClient — LLM transport layer for sub-agent conversations
 *
 * Extracted from SubAgentChat to isolate the API communication concerns:
 * - callLLM: builds the request, picks endpoint, fires fetch, parses response
 * - parseStreamingResponse: SSE reader loop with throttled streaming emission
 * - processSSELine: handles SSE delta formats (pure function)
 * - formatMessageForAPI: serializes a Message to API wire format
 *
 * File location: src/main/lib/subAgent/subAgentLLMClient.ts
 */

import type { Message, AssistantMessage, UnifiedContentPart, TextContentPart } from '@shared/types/chatTypes';
import { providerManager } from '../llm/provider';
import type { ChatCompletionParams, ChatMessage, ProviderStreamChunk } from '../llm/provider/types';
import type { SubAgentChatOptions } from './types';
import { createConsoleLogger } from '../unifiedLogger';
import { repairToolCallArguments } from './subAgentToolCallRepair';

// Lazy-init logger
let logger: any;
(async () => {
  logger = await createConsoleLogger();
})();

function getLogger() {
  return logger || console;
}

/** LLM output token limit — 16384 avoids argument truncation for complex tool calls */
const MAX_OUTPUT_TOKENS = 16384;

/**
 * LLM call response
 */
export interface LLMResponse {
  hasToolCalls: boolean;
  toolCalls: any[];
  textContent: string;
  /** LLM finish_reason: 'stop' | 'tool_calls' | 'length' | '' */
  finishReason: string;
  assistantMessage: AssistantMessage;
}

/**
 * Process a single SSE data line
 *
 * Pure function — no `this` dependency. Supports two endpoint formats:
 * - /chat/completions: delta.content + delta.tool_calls + choices[0].finish_reason
 * - /responses: response.output_text.delta + response.output_item.done (function_call)
 */
export function processSSELine(
  trimmed: string,
  endpoint: string,
  state: { fullContent: string; toolCalls: any[]; finishReason: string },
  setFullContent: (val: string) => void,
  setFinishReason: (val: string) => void,
): void {
  if (!trimmed.startsWith('data: ') || trimmed === 'data: [DONE]') return;

  try {
    const jsonStr = trimmed.slice(6);
    const data = JSON.parse(jsonStr);

    if (endpoint === '/responses') {
      // ── /responses format ──
      if (data.type === 'response.output_text.delta' && data.delta) {
        setFullContent(state.fullContent + data.delta);
      } else if (data.type === 'response.output_item.done' && data.item?.type === 'function_call') {
        const toolCallItem = data.item;
        const index = state.toolCalls.length;
        state.toolCalls[index] = {
          id: toolCallItem.call_id,
          type: 'function',
          function: {
            name: toolCallItem.name,
            arguments: toolCallItem.arguments,
          },
        };
      } else if (data.type === 'response.completed') {
        // On /responses completion, check output for function_call type to determine finish_reason
        const hasFC = data.response?.output?.some((o: any) => o.type === 'function_call');
        setFinishReason(hasFC ? 'tool_calls' : 'stop');
      }
    } else {
      // ── /chat/completions format ──
      if (data.choices && data.choices[0]) {
        const choice = data.choices[0];
        const delta = choice.delta;

        // Accumulate text
        if (delta?.content) {
          setFullContent(state.fullContent + delta.content);
        }

        // Accumulate tool calls (incremental assembly)
        if (delta?.tool_calls) {
          for (const toolCall of delta.tool_calls) {
            const index = toolCall.index || 0;
            if (!state.toolCalls[index]) {
              state.toolCalls[index] = {
                id: toolCall.id || '',
                type: 'function',
                function: { name: '', arguments: '' },
              };
            }
            if (toolCall.id) state.toolCalls[index].id = toolCall.id;
            if (toolCall.function?.name) state.toolCalls[index].function.name = toolCall.function.name;
            if (toolCall.function?.arguments) state.toolCalls[index].function.arguments += toolCall.function.arguments;
          }
        }

        // Record finish_reason
        if (choice.finish_reason) {
          setFinishReason(choice.finish_reason);
        }
      }
    }
  } catch (e) {
    getLogger().warn?.(
      `[SubAgentLLMClient] Failed to parse SSE chunk: ${trimmed.substring(0, 200)}. ` +
      `Error: ${e instanceof Error ? e.message : String(e)}`,
      'processSSELine'
    );
  }
}

/**
 * LLM transport client for sub-agent conversations.
 *
 * Handles authentication, request building, endpoint selection, streaming parsing,
 * and message serialization. Stateless with respect to conversation history —
 * caller provides context via constructor dependencies.
 */
export class SubAgentLLMClient {
  constructor(
    private readonly options: SubAgentChatOptions,
    private readonly getTurnCount: () => number,
    private readonly sanitizeOrphanedToolResults: (messages: Message[]) => Message[],
    private readonly createAbortSignal: () => AbortSignal,
  ) {}

  /**
   * Call LLM — streaming mode
   *
   * Routes through `providerManager.chatCompletionStream(...)` so the request
   * goes to whichever provider the user has configured (Copilot, OpenAI,
   * Anthropic, Gemini, or a custom endpoint). Previously this method hard-coded
   * GitHub Copilot OAuth + endpoint, which broke skip-login users with an API
   * key (400 "Authorization header is badly formatted") and bypassed any
   * non-Copilot provider entirely.
   */
  async callLLM(
    systemMessages: Message[],
    contextHistory: Message[],
    tools: any[]
  ): Promise<LLMResponse> {
    // Wait for provider config to load before routing.
    await providerManager.waitUntilReady();

    // ── Build request messages ──
    // Safety net: remove orphaned tool_result messages (corresponding assistant tool_calls may have been compressed away)
    const sanitizedContext = this.sanitizeOrphanedToolResults(contextHistory);
    const allMessages = [...systemMessages, ...sanitizedContext];
    const formattedMessages = allMessages.map(m => this.formatMessageForAPI(m));

    const modelId = this.options.subAgent.inheritedModel;

    // Tools are always built in the OpenAI nested format. Each provider's
    // chatCompletionStream translates to its own wire protocol internally
    // (e.g., Anthropic flattens, Gemini reshapes).
    const toolDefinitions = tools.length > 0
      ? tools.map(t => ({
          type: 'function' as const,
          function: {
            name: t.name,
            description: t.description || '',
            parameters: t.inputSchema,
          },
        }))
      : undefined;

    const params: ChatCompletionParams = {
      model: modelId,
      messages: formattedMessages as unknown as ChatMessage[],
      maxTokens: MAX_OUTPUT_TOKENS,
      stream: true,
      signal: this.createAbortSignal(),
    };
    if (toolDefinitions && toolDefinitions.length > 0) {
      params.tools = toolDefinitions;
    }

    let stream: AsyncIterable<ProviderStreamChunk>;
    try {
      stream = await providerManager.chatCompletionStream(params);
    } catch (error) {
      this.logRequestError(error, modelId, formattedMessages, toolDefinitions);
      throw error;
    }

    try {
      return await this.consumeProviderStream(stream);
    } catch (error) {
      // Don't double-log cancellation: that's a normal control-flow exit.
      const msg = error instanceof Error ? error.message : String(error);
      if (!msg.includes('cancelled')) {
        this.logRequestError(error, modelId, formattedMessages, toolDefinitions);
      }
      throw error;
    }
  }

  /**
   * Accumulate ProviderStreamChunks into the LLMResponse shape the sub-agent
   * loop expects. Also forwards throttled `llm_streaming` updates to
   * `onStepUpdate` so the parent UI can show progress.
   */
  private async consumeProviderStream(
    stream: AsyncIterable<ProviderStreamChunk>,
  ): Promise<LLMResponse> {
    const messageId = `sa_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let fullContent = '';
    const toolCallAccumulator: Record<number, any> = {};
    let finishReason = '';

    let lastStreamingEmitTime = 0;
    let lastEmittedLength = 0;
    const STREAMING_EMIT_INTERVAL_MS = 300;

    const emitStreamingText = (text: string, force = false) => {
      const now = Date.now();
      if (!force && (now - lastStreamingEmitTime < STREAMING_EMIT_INTERVAL_MS) && text.length - lastEmittedLength < 100) {
        return;
      }
      if (text.length > lastEmittedLength) {
        lastStreamingEmitTime = now;
        lastEmittedLength = text.length;
        this.options.onStepUpdate?.({
          type: 'llm_streaming',
          turn: this.getTurnCount() + 1,
          streamingText: text,
        });
      }
    };

    for await (const chunk of stream) {
      if (this.options.cancellationToken.isCancellationRequested) {
        throw new Error('Sub-agent task cancelled during streaming');
      }

      if (chunk.contentDelta) {
        fullContent += chunk.contentDelta;
        emitStreamingText(fullContent);
      }

      if (chunk.toolCallDelta) {
        const tc = chunk.toolCallDelta;
        const idx = tc.index ?? 0;
        if (!toolCallAccumulator[idx]) {
          toolCallAccumulator[idx] = {
            id: tc.id || '',
            type: 'function',
            function: { name: '', arguments: '' },
          };
        }
        if (tc.id) toolCallAccumulator[idx].id = tc.id;
        if (tc.function?.name) toolCallAccumulator[idx].function.name += tc.function.name;
        if (tc.function?.arguments) toolCallAccumulator[idx].function.arguments += tc.function.arguments;
      }

      if (chunk.finishReason) {
        finishReason = chunk.finishReason;
      }
    }

    if (fullContent) {
      emitStreamingText(fullContent, true);
    }

    const validToolCalls = Object.values(toolCallAccumulator).filter(tc => tc && tc.id);

    if (validToolCalls.length > 0) {
      for (const tc of validToolCalls) {
        const argsStr = tc.function?.arguments || '';
        let argsValid = false;
        try {
          JSON.parse(argsStr);
          argsValid = true;
        } catch { /* invalid */ }
        getLogger().info?.(
          `[SubAgentLLMClient] Parsed tool call: id=${tc.id}, name=${tc.function?.name}, ` +
          `argsLength=${argsStr.length}, argsValidJson=${argsValid}` +
          (!argsValid ? `, argsPreview="${argsStr.substring(0, 200)}"` : ''),
          'consumeProviderStream'
        );
      }
    }

    const assistantMessage: AssistantMessage = {
      id: messageId,
      role: 'assistant',
      content: fullContent ? [{ type: 'text', text: fullContent }] : [],
      tool_calls: validToolCalls.length > 0 ? validToolCalls : undefined,
      timestamp: Date.now(),
    };

    return {
      hasToolCalls: validToolCalls.length > 0,
      toolCalls: validToolCalls,
      textContent: fullContent,
      finishReason,
      assistantMessage,
    };
  }

  private logRequestError(
    error: unknown,
    modelId: string,
    formattedMessages: Record<string, unknown>[],
    toolDefinitions: { type: 'function'; function: unknown }[] | undefined,
  ): void {
    const errMsg = error instanceof Error ? error.message : String(error);
    getLogger().error?.(
      `[SubAgentLLMClient] LLM call failed: ${errMsg.substring(0, 500)}`,
      'callLLM'
    );
    const lastRoles = formattedMessages.slice(-3).map((fm: any) => {
      const tcInfo = fm.tool_calls ? `(+tool_calls:${fm.tool_calls.length})` : '';
      return fm.role + tcInfo;
    }).join(', ');
    getLogger().error?.(
      `[SubAgentLLMClient] Request context: model=${modelId}, provider=${providerManager.getActiveProviderId()}, ` +
      `messageCount=${formattedMessages.length}, hasTools=${(toolDefinitions?.length || 0) > 0}. ` +
      `Last 3 messages roles: [${lastRoles}]`,
      'callLLM'
    );
    for (const fm of formattedMessages) {
      if ((fm as any).tool_calls) {
        for (const tc of (fm as any).tool_calls) {
          const args = tc?.function?.arguments || '';
          let validJson = false;
          try { JSON.parse(args); validJson = true; } catch { /* invalid */ }
          getLogger().error?.(
            `[SubAgentLLMClient] tool_call in request: name=${tc?.function?.name}, id=${tc?.id}, ` +
            `argsLen=${args.length}, validJson=${validJson}` +
            (!validJson ? `, argsPreview="${String(args).substring(0, 200)}"` : ''),
            'callLLM'
          );
        }
      }
    }
  }

  /**
   * Parse SSE streaming response
   *
   * Simplified version referencing AgentChat.makeStreamingApiCall():
   * - Accumulates fullContent (text) and toolCalls[] (tool calls)
   * - Records finishReason (for loop decision)
   * - Does not send StreamingChunk to frontend (sub-agent doesn't need real-time display)
   * - Supports both /chat/completions and /responses formats
   */
  async parseStreamingResponse(response: Response, endpoint: string): Promise<LLMResponse> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Failed to get response stream reader');
    }

    let fullContent = '';
    const toolCalls: any[] = [];
    let finishReason = '';
    const decoder = new TextDecoder();
    let buffer = '';
    const messageId = `sa_msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // LLM streaming text real-time push (throttled at 300ms)
    let lastStreamingEmitTime = 0;
    let lastEmittedLength = 0;
    const STREAMING_EMIT_INTERVAL_MS = 300;

    const emitStreamingText = (text: string, force = false) => {
      const now = Date.now();
      if (!force && (now - lastStreamingEmitTime < STREAMING_EMIT_INTERVAL_MS) && text.length - lastEmittedLength < 100) {
        return;
      }
      if (text.length > lastEmittedLength) {
        lastStreamingEmitTime = now;
        lastEmittedLength = text.length;
        this.options.onStepUpdate?.({
          type: 'llm_streaming',
          turn: this.getTurnCount() + 1,
          streamingText: text,
        });
      }
    };

    try {
      while (true) {
        // Check cancellation
        if (this.options.cancellationToken.isCancellationRequested) {
          reader.cancel();
          throw new Error('Sub-agent task cancelled during streaming');
        }

        const { done, value } = await reader.read();
        if (done) {
          // Process remaining data in the buffer
          if (buffer.trim()) {
            processSSELine(buffer.trim(), endpoint, { fullContent, toolCalls, finishReason },
              (fc) => { fullContent = fc; },
              (fr) => { finishReason = fr; }
            );
          }
          // Streaming ended, send final text
          if (fullContent) {
            emitStreamingText(fullContent, true);
          }
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === '' || trimmed === 'data: [DONE]') continue;

          processSSELine(trimmed, endpoint, { fullContent, toolCalls, finishReason },
            (fc) => { fullContent = fc; },
            (fr) => { finishReason = fr; }
          );
        }

        // Push streaming text in real-time (throttled)
        if (fullContent) {
          emitStreamingText(fullContent);
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Filter valid tool calls (must have id)
    const validToolCalls = toolCalls.filter(tc => tc && tc.id);

    // Log detailed tool call info for debugging invalid_tool_call_format errors
    if (validToolCalls.length > 0) {
      for (const tc of validToolCalls) {
        const argsStr = tc.function?.arguments || '';
        let argsValid = false;
        try {
          JSON.parse(argsStr);
          argsValid = true;
        } catch { /* invalid */ }
        getLogger().info?.(
          `[SubAgentLLMClient] Parsed tool call: id=${tc.id}, name=${tc.function?.name}, ` +
          `argsLength=${argsStr.length}, argsValidJson=${argsValid}` +
          (!argsValid ? `, argsPreview="${argsStr.substring(0, 200)}"` : ''),
          'parseStreamingResponse'
        );
      }
    }

    const assistantMessage: AssistantMessage = {
      id: messageId,
      role: 'assistant',
      content: fullContent ? [{ type: 'text', text: fullContent }] : [],
      tool_calls: validToolCalls.length > 0 ? validToolCalls : undefined,
      timestamp: Date.now(),
    };

    return {
      hasToolCalls: validToolCalls.length > 0,
      toolCalls: validToolCalls,
      textContent: fullContent,
      finishReason,
      assistantMessage,
    };
  }

  /**
   * Format messages for API request format
   *
   * Key fix: ensure arguments in tool_calls are valid JSON strings
   * Reason: API strictly validates that tool_calls[].function.arguments must be valid JSON,
   *         if streaming-accumulated arguments have any issues, it causes 400 errors
   */
  formatMessageForAPI(m: Message): Record<string, unknown> {
    const formatted: Record<string, unknown> = { role: m.role };

    // content formatting
    if (Array.isArray(m.content)) {
      const textParts = m.content
        .filter((p: UnifiedContentPart): p is TextContentPart => p.type === 'text')
        .map((p) => p.text);
      formatted.content = textParts.join('');
    } else {
      formatted.content = String(m.content);
    }

    if (m.role === 'tool') {
      formatted.tool_call_id = m.tool_call_id;
      formatted.name = m.name;
    }
    if (m.role === 'assistant' && m.tool_calls) {
      // Ensure each tool_call's arguments is a valid JSON string
      formatted.tool_calls = m.tool_calls.map((tc: any) => {
        if (tc?.function?.arguments == null) return tc;

        const args = tc.function.arguments;
        // Validate if arguments is valid JSON
        try {
          JSON.parse(args);
          return tc; // Valid JSON, use as-is
        } catch {
          // Arguments not valid JSON — attempt repair
          getLogger().warn?.(
            `[SubAgentLLMClient] Invalid JSON in tool_call arguments for '${tc.function?.name}', ` +
            `attempting repair. Raw: "${String(args).substring(0, 300)}"`,
            'formatMessageForAPI'
          );
          return repairToolCallArguments(tc);
        }
      });
    }

    return formatted;
  }
}
