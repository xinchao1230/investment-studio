// @ts-nocheck
/**
 * SubAgentLLMClient unit tests
 *
 * Covers the post-refactor path that routes through `providerManager.chatCompletionStream`:
 * - callLLM: happy path, content + tool_call accumulation, finish reason propagation,
 *   tool definitions shape, signal forwarding, error from provider, cancellation mid-stream
 * - parseStreamingResponse (legacy method, still wrapped by SubAgentChat for tests):
 *   throttled emit skip, force emit, cancellation mid-stream, buffer flush on done
 */

// ─── Mock dependencies ───

vi.mock('electron', async () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}));

vi.mock('../../unifiedLogger', async () => ({
  createConsoleLogger: vi.fn(async () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock the providerManager surface that SubAgentLLMClient now depends on.
const { mockChatCompletionStream, mockWaitUntilReady, mockGetActiveProviderId } = vi.hoisted(() => ({
  mockChatCompletionStream: vi.fn(),
  mockWaitUntilReady: vi.fn().mockResolvedValue(undefined),
  mockGetActiveProviderId: vi.fn(() => 'custom-dynamic'),
}));

vi.mock('../../llm/provider', async () => ({
  providerManager: {
    chatCompletionStream: mockChatCompletionStream,
    waitUntilReady: mockWaitUntilReady,
    getActiveProviderId: mockGetActiveProviderId,
  },
}));

vi.mock('../subAgentToolCallRepair', async () => ({
  repairToolCallArguments: vi.fn((tc: any) => ({
    ...tc,
    function: { ...tc.function, arguments: '{}' },
  })),
}));

// ─── Helpers ───

import { SubAgentLLMClient } from '../subAgentLLMClient';
import type { CancellationToken } from '../../cancellation/CancellationToken';

function makeCancellationToken(cancelled = false): CancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as CancellationToken;
}

function makeOptions(overrides: any = {}): any {
  return {
    subAgent: {
      inheritedModel: 'gpt-4o',
      parentSessionId: 'session-1',
      parentChatId: 'chat-1',
      userAlias: 'testUser',
      resolvedMcpServers: [],
      config: { mcp_servers: [] },
      taskId: 'sa-1',
    },
    task: 'test task',
    cancellationToken: makeCancellationToken(),
    currentUserAlias: 'testUser',
    onStepUpdate: vi.fn(),
    ...overrides,
  };
}

function makeClient(options?: any, overrides: any = {}) {
  const opts = options ?? makeOptions();
  return new SubAgentLLMClient(
    opts,
    overrides.getTurnCount ?? (() => 0),
    overrides.sanitizeOrphanedToolResults ?? ((msgs: any[]) => msgs),
    overrides.createAbortSignal ?? (() => new AbortController().signal),
  );
}

/** Build an async iterable from a fixed array of ProviderStreamChunks. */
function makeChunkStream(chunks: any[]): AsyncIterable<any> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c;
    },
  };
}

// ─── Tests ───

describe('SubAgentLLMClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWaitUntilReady.mockResolvedValue(undefined);
    mockGetActiveProviderId.mockReturnValue('custom-dynamic');
  });

  describe('callLLM — routing through providerManager', () => {
    it('waits for provider readiness before calling the stream', async () => {
      let resolveReady: () => void = () => {};
      const readyPromise = new Promise<void>((r) => { resolveReady = r; });
      mockWaitUntilReady.mockReturnValueOnce(readyPromise);
      mockChatCompletionStream.mockResolvedValue(
        makeChunkStream([{ finishReason: 'stop' }]),
      );

      const client = makeClient();
      const callPromise = client.callLLM([], [], []);

      // chatCompletionStream must NOT be called until waitUntilReady resolves
      await new Promise((r) => setTimeout(r, 5));
      expect(mockChatCompletionStream).not.toHaveBeenCalled();

      resolveReady();
      await callPromise;
      expect(mockChatCompletionStream).toHaveBeenCalledOnce();
    });

    it('forwards model, messages, and abort signal into ChatCompletionParams', async () => {
      const signal = new AbortController().signal;
      mockChatCompletionStream.mockResolvedValue(
        makeChunkStream([{ finishReason: 'stop' }]),
      );

      const client = makeClient(
        makeOptions({
          subAgent: {
            inheritedModel: 'claude-opus-4',
            resolvedMcpServers: [],
            config: { mcp_servers: [] },
          },
        }),
        { createAbortSignal: () => signal },
      );

      await client.callLLM(
        [{ role: 'system', content: [{ type: 'text', text: 'sys' }] }],
        [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        [],
      );

      const params = mockChatCompletionStream.mock.calls[0][0];
      expect(params.model).toBe('claude-opus-4');
      expect(params.stream).toBe(true);
      expect(params.signal).toBe(signal);
      expect(params.messages).toHaveLength(2);
      expect(params.messages[0]).toMatchObject({ role: 'system', content: 'sys' });
      expect(params.messages[1]).toMatchObject({ role: 'user', content: 'hi' });
    });

    it('passes tools using the OpenAI nested format', async () => {
      mockChatCompletionStream.mockResolvedValue(
        makeChunkStream([{ finishReason: 'stop' }]),
      );

      const tools = [
        { name: 'web_search', description: 'search the web', inputSchema: { type: 'object', properties: {} } },
      ];
      const client = makeClient();
      await client.callLLM([], [], tools);

      const params = mockChatCompletionStream.mock.calls[0][0];
      expect(params.tools).toHaveLength(1);
      expect(params.tools[0]).toMatchObject({
        type: 'function',
        function: { name: 'web_search', description: 'search the web' },
      });
    });

    it('omits the tools field when no tools are supplied', async () => {
      mockChatCompletionStream.mockResolvedValue(
        makeChunkStream([{ finishReason: 'stop' }]),
      );
      const client = makeClient();
      await client.callLLM([], [], []);

      const params = mockChatCompletionStream.mock.calls[0][0];
      expect(params.tools).toBeUndefined();
    });
  });

  describe('callLLM — stream consumption', () => {
    it('accumulates content deltas into textContent', async () => {
      mockChatCompletionStream.mockResolvedValue(
        makeChunkStream([
          { contentDelta: 'Hello, ' },
          { contentDelta: 'world!' },
          { finishReason: 'stop' },
        ]),
      );

      const client = makeClient();
      const result = await client.callLLM([], [], []);

      expect(result.textContent).toBe('Hello, world!');
      expect(result.finishReason).toBe('stop');
      expect(result.hasToolCalls).toBe(false);
      expect(result.assistantMessage.content).toEqual([{ type: 'text', text: 'Hello, world!' }]);
    });

    it('accumulates tool_call deltas across chunks', async () => {
      mockChatCompletionStream.mockResolvedValue(
        makeChunkStream([
          { toolCallDelta: { index: 0, id: 'call_1', function: { name: 'web_search' } } },
          { toolCallDelta: { index: 0, function: { arguments: '{"q":"' } } },
          { toolCallDelta: { index: 0, function: { arguments: 'hi"}' } } },
          { finishReason: 'tool_calls' },
        ]),
      );

      const client = makeClient();
      const result = await client.callLLM([], [], []);

      expect(result.hasToolCalls).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toMatchObject({
        id: 'call_1',
        type: 'function',
        function: { name: 'web_search', arguments: '{"q":"hi"}' },
      });
      expect(result.finishReason).toBe('tool_calls');
    });

    it('drops tool_call entries without an id (incomplete)', async () => {
      mockChatCompletionStream.mockResolvedValue(
        makeChunkStream([
          { toolCallDelta: { index: 0, function: { name: 'no_id_call' } } },
          { finishReason: 'stop' },
        ]),
      );

      const client = makeClient();
      const result = await client.callLLM([], [], []);

      expect(result.hasToolCalls).toBe(false);
      expect(result.toolCalls).toHaveLength(0);
    });

    it('throws "cancelled" when cancellation is requested mid-stream', async () => {
      const token = makeCancellationToken(false);
      // Flip cancellation after the first chunk arrives.
      const stream: AsyncIterable<any> = {
        async *[Symbol.asyncIterator]() {
          yield { contentDelta: 'partial' };
          (token as any).isCancellationRequested = true;
          yield { contentDelta: 'should not be consumed' };
        },
      };
      mockChatCompletionStream.mockResolvedValue(stream);

      const client = makeClient(makeOptions({ cancellationToken: token }));
      await expect(client.callLLM([], [], [])).rejects.toThrow(/cancelled/);
    });
  });

  describe('callLLM — error handling', () => {
    it('propagates provider errors raised before streaming starts', async () => {
      mockChatCompletionStream.mockRejectedValueOnce(
        new Error('bad request: Authorization header is badly formatted'),
      );

      const client = makeClient();
      await expect(client.callLLM([], [], []))
        .rejects.toThrow(/Authorization header is badly formatted/);
    });

    it('propagates provider errors raised during streaming', async () => {
      const stream: AsyncIterable<any> = {
        async *[Symbol.asyncIterator]() {
          yield { contentDelta: 'partial' };
          throw new Error('upstream stream broken');
        },
      };
      mockChatCompletionStream.mockResolvedValue(stream);

      const client = makeClient();
      await expect(client.callLLM([], [], []))
        .rejects.toThrow(/upstream stream broken/);
    });
  });

  describe('callLLM — onStepUpdate streaming text emission', () => {
    it('emits a final llm_streaming update with the full text', async () => {
      const onStepUpdate = vi.fn();
      mockChatCompletionStream.mockResolvedValue(
        makeChunkStream([
          { contentDelta: 'A'.repeat(50) },
          { contentDelta: 'B'.repeat(20) },
          { finishReason: 'stop' },
        ]),
      );

      const client = makeClient(makeOptions({ onStepUpdate }));
      await client.callLLM([], [], []);

      const streamingEmits = onStepUpdate.mock.calls
        .map(([u]) => u)
        .filter((u) => u.type === 'llm_streaming');
      expect(streamingEmits.length).toBeGreaterThanOrEqual(1);
      const last = streamingEmits[streamingEmits.length - 1];
      expect(last.streamingText).toBe('A'.repeat(50) + 'B'.repeat(20));
    });
  });

  // ── parseStreamingResponse — legacy method, still exposed via SubAgentChat ──

  /** Build a minimal streaming ReadableStream from an array of SSE data strings */
  function makeSseStream(lines: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    const text = lines.join('\n') + '\n';
    return new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    });
  }

  describe('parseStreamingResponse — streaming emit throttle', () => {
    it('skips emit when interval not elapsed AND delta < 100 chars', async () => {
      const onStepUpdate = vi.fn();
      const options = makeOptions({ onStepUpdate });
      const client = makeClient(options);

      const encoder = new TextEncoder();
      const sseChunk1 = `data: ${JSON.stringify({ choices: [{ delta: { content: 'A'.repeat(50) }, finish_reason: null }] })}\n`;
      const sseChunk2 = `data: ${JSON.stringify({ choices: [{ delta: { content: 'B'.repeat(20) }, finish_reason: null }] })}\n`;
      const sseDone = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\ndata: [DONE]\n`;

      let chunkIndex = 0;
      const chunks = [encoder.encode(sseChunk1), encoder.encode(sseChunk2), encoder.encode(sseDone)];

      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (chunkIndex < chunks.length) {
            return { done: false, value: chunks[chunkIndex++] };
          }
          return { done: true, value: undefined };
        }),
        cancel: vi.fn(),
        releaseLock: vi.fn(),
      };

      const fixedTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(fixedTime);

      const mockResponse = { body: { getReader: () => mockReader } } as any;
      await client.parseStreamingResponse(mockResponse, '/chat/completions');

      const llmStreamingCalls = onStepUpdate.mock.calls.filter(([u]) => u.type === 'llm_streaming');
      expect(llmStreamingCalls.length).toBeGreaterThanOrEqual(1);
      const lastCall = llmStreamingCalls[llmStreamingCalls.length - 1];
      expect(lastCall[0].streamingText).toContain('A');

      vi.restoreAllMocks();
    });

    it('emits when delta >= 100 chars even within throttle interval', async () => {
      const onStepUpdate = vi.fn();
      const options = makeOptions({ onStepUpdate });
      const client = makeClient(options);

      const encoder = new TextEncoder();
      const bigContent = 'X'.repeat(150);
      const sseChunk = `data: ${JSON.stringify({ choices: [{ delta: { content: bigContent }, finish_reason: 'stop' }] })}\ndata: [DONE]\n`;

      let called = false;
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          if (!called) { called = true; return { done: false, value: encoder.encode(sseChunk) }; }
          return { done: true, value: undefined };
        }),
        cancel: vi.fn(),
        releaseLock: vi.fn(),
      };

      const fixedTime = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(fixedTime);

      const mockResponse = { body: { getReader: () => mockReader } } as any;
      await client.parseStreamingResponse(mockResponse, '/chat/completions');

      const llmStreamingCalls = onStepUpdate.mock.calls.filter(([u]) => u.type === 'llm_streaming');
      expect(llmStreamingCalls.length).toBeGreaterThanOrEqual(1);

      vi.restoreAllMocks();
    });
  });

  describe('parseStreamingResponse — cancellation mid-stream', () => {
    it('cancels reader and throws when cancellation is requested', async () => {
      const cancelToken = makeCancellationToken(false);
      const options = makeOptions({ cancellationToken: cancelToken });
      const client = makeClient(options);

      const encoder = new TextEncoder();
      let readCount = 0;

      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          readCount++;
          if (readCount === 1) {
            (cancelToken as any).isCancellationRequested = true;
            const chunk = `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' }, finish_reason: null }] })}\n`;
            return { done: false, value: encoder.encode(chunk) };
          }
          return { done: false, value: encoder.encode('more data\n') };
        }),
        cancel: vi.fn(),
        releaseLock: vi.fn(),
      };

      const mockResponse = { body: { getReader: () => mockReader } } as any;
      await expect(client.parseStreamingResponse(mockResponse, '/chat/completions'))
        .rejects.toThrow('Sub-agent task cancelled during streaming');

      expect(mockReader.cancel).toHaveBeenCalledOnce();
    });
  });

  describe('parseStreamingResponse — buffer flushed on done', () => {
    it('processes remaining buffer when done=true without trailing newline', async () => {
      const options = makeOptions();
      const client = makeClient(options);

      const encoder = new TextEncoder();
      // Last chunk has no trailing newline so the data stays in `buffer` when done=true.
      const sseChunk = `data: ${JSON.stringify({ choices: [{ delta: { content: 'tail' }, finish_reason: 'stop' }] })}`;

      let readCount = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(async () => {
          readCount++;
          if (readCount === 1) return { done: false, value: encoder.encode(sseChunk) };
          return { done: true, value: undefined };
        }),
        cancel: vi.fn(),
        releaseLock: vi.fn(),
      };

      const mockResponse = { body: { getReader: () => mockReader } } as any;
      const result = await client.parseStreamingResponse(mockResponse, '/chat/completions');

      expect(result.textContent).toBe('tail');
      expect(result.finishReason).toBe('stop');
    });
  });
});
