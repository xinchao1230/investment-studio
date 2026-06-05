import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEndpointForModel: vi.fn(),
  getModelCapabilities: vi.fn(),
  buildMaxTokensParam: vi.fn((modelId: string, maxTokens: number) => (
    /^gpt-5/.test(modelId) || /^o\d/.test(modelId)
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens }
  )),
  buildReasoningParams: vi.fn((opts: {
    endpoint: string;
    supportedEfforts?: string[];
    reasoningEffort?: string;
    defaultEffort?: string;
  }) => {
    const effort = (opts.reasoningEffort ?? opts.defaultEffort)?.toLowerCase();
    if (!effort || !opts.supportedEfforts?.includes(effort)) return {};
    return opts.endpoint === '/responses'
      ? { reasoning: { effort } }
      : { reasoning_effort: effort };
  }),
  getDefaultReasoningEffort: vi.fn((_modelId: string, supportedEfforts: string[]) => (
    supportedEfforts.includes('medium') ? 'medium' : supportedEfforts[0]
  )),
}));

vi.mock('../../../unifiedLogger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../auth/ghcConfig', () => ({
  GHC_CONFIG: {
    API_ENDPOINT: 'https://api.githubcopilot.com',
    USER_AGENT: 'test-user-agent',
    EDITOR_VERSION: 'test-editor',
    EDITOR_PLUGIN_VERSION: 'test-plugin',
    INTEGRATION_ID: 'test-integration',
  },
}));

vi.mock('../../../auth/authManager', () => ({
  MainAuthManager: {
    getInstance: () => ({
      getCopilotAccessToken: () => 'copilot-token',
    }),
  },
}));

vi.mock('../../ghcModelApi', () => ({
  getEndpointForModel: mocks.getEndpointForModel,
}));

vi.mock('../../ghcModelsManager', () => ({
  ghcModelsManager: {
    getAllOpenKosmosUsedModels: vi.fn(() => []),
    validateModelId: vi.fn(() => true),
    getModelCapabilities: mocks.getModelCapabilities,
  },
  buildMaxTokensParam: mocks.buildMaxTokensParam,
  buildReasoningParams: mocks.buildReasoningParams,
  getDefaultReasoningEffort: mocks.getDefaultReasoningEffort,
}));

import { CopilotProvider } from '../copilotProvider';
import type { ProviderStreamChunk } from '../types';

function createReader(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;

  return {
    releaseLock: vi.fn(),
    async read() {
      if (index >= chunks.length) {
        return { done: true, value: undefined };
      }
      const value = encoder.encode(chunks[index]);
      index += 1;
      return { done: false, value };
    },
  };
}

async function collectStream(stream: AsyncIterable<ProviderStreamChunk>): Promise<ProviderStreamChunk[]> {
  const chunks: ProviderStreamChunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

function mockStreamingFetch(chunks: string[]) {
  return vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
    ok: true,
    body: { getReader: () => createReader(chunks) },
    text: async () => '',
  } as any);
}

function mockJsonFetch(data: unknown) {
  return vi.spyOn(globalThis, 'fetch' as any).mockResolvedValue({
    ok: true,
    json: async () => data,
    text: async () => '',
  } as any);
}

function getLastRequestBody(fetchSpy: ReturnType<typeof vi.spyOn>): any {
  const body = fetchSpy.mock.calls.at(-1)?.[1]?.body;
  expect(typeof body).toBe('string');
  return JSON.parse(body as string);
}

describe('CopilotProvider', () => {
  let provider: CopilotProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CopilotProvider();
    mocks.getEndpointForModel.mockReturnValue('/responses');
    mocks.getModelCapabilities.mockReturnValue({
      reasoningEfforts: ['low', 'medium', 'high'],
      supportsTemperature: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds /responses streaming requests with input items instead of chat messages', async () => {
    const fetchSpy = mockStreamingFetch([
      'data: {"type":"response.completed","response":{"output":[]}}\n',
      'data: [DONE]\n',
    ]);

    await collectStream(provider.chatCompletionStream({
      model: 'gpt-5.5',
      messages: [
        { role: 'system', content: 'system prompt' },
        {
          role: 'assistant',
          content: 'I will search.',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"q":"AAPL"}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
        { role: 'user', content: 'continue' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'search',
            description: 'Search market data',
            parameters: { type: 'object', properties: { q: { type: 'string' } } },
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'search' } },
      maxTokens: 123,
      reasoningEffort: 'high',
      temperature: 0.2,
    }));

    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.githubcopilot.com/responses');
    const body = getLastRequestBody(fetchSpy);

    expect(body.messages).toBeUndefined();
    expect(body.stream_options).toBeUndefined();
    expect(body.input).toEqual([
      { type: 'message', role: 'system', content: 'system prompt' },
      { type: 'message', role: 'assistant', content: 'I will search.' },
      { type: 'function_call', call_id: 'call_1', name: 'search', arguments: '{"q":"AAPL"}' },
      { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' },
      { type: 'message', role: 'user', content: 'continue' },
    ]);
    expect(body.tools).toEqual([
      {
        type: 'function',
        name: 'search',
        description: 'Search market data',
        parameters: { type: 'object', properties: { q: { type: 'string' } } },
        strict: false,
      },
    ]);
    expect(body.tool_choice).toEqual({ type: 'function', name: 'search' });
    expect(body.max_completion_tokens).toBe(123);
    expect(body.reasoning).toEqual({ effort: 'high' });
    expect(body.include).toEqual(['reasoning.encrypted_content']);
    expect(body.stream).toBe(true);
    expect(body.temperature).toBeUndefined();
  });

  it('keeps /chat/completions requests in chat message format', async () => {
    mocks.getEndpointForModel.mockReturnValue('/chat/completions');
    const fetchSpy = mockStreamingFetch([
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n',
      'data: [DONE]\n',
    ]);
    const tools = [{ type: 'function' as const, function: { name: 'search', description: 'Search' } }];

    await collectStream(provider.chatCompletionStream({
      model: 'gpt-4.1',
      messages: [{ role: 'user', content: 'hello' }],
      tools,
      tool_choice: 'auto',
      maxTokens: 100,
      reasoningEffort: 'medium',
    }));

    expect(fetchSpy.mock.calls[0][0]).toBe('https://api.githubcopilot.com/chat/completions');
    const body = getLastRequestBody(fetchSpy);
    expect(body.input).toBeUndefined();
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(body.tools).toEqual(tools);
    expect(body.tool_choice).toBe('auto');
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.reasoning_effort).toBe('medium');
  });

  it('parses /responses SSE events into provider-neutral stream chunks', async () => {
    mockStreamingFetch([
      'data: {"type":"response.output_text.delta","delta":"Hello "}\n',
      'data: {"type":"response.output_text.delta","delta":"world"}\n',
      'data: {"type":"response.output_item.done","output_index":1,"item":{"type":"function_call","call_id":"call_1","name":"fetch_quote","arguments":"{\\"ticker\\":\\"MSFT\\"}"}}\n',
      'data: {"type":"response.completed","response":{"model":"gpt-5.5","output":[{"type":"function_call"}],"usage":{"input_tokens":11,"output_tokens":22,"total_tokens":33}}}\n',
      'data: [DONE]\n',
    ]);

    const chunks = await collectStream(provider.chatCompletionStream({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'quote MSFT' }],
    }));

    expect(chunks).toEqual([
      { contentDelta: 'Hello ' },
      { contentDelta: 'world' },
      {
        toolCallDelta: {
          index: 1,
          id: 'call_1',
          type: 'function',
          function: { name: 'fetch_quote', arguments: '{"ticker":"MSFT"}' },
        },
      },
      {
        finishReason: 'tool_calls',
        usage: { promptTokens: 11, completionTokens: 22, totalTokens: 33 },
        model: 'gpt-5.5',
      },
    ]);
  });

  it('omits empty assistant messages when converting /responses tool-call history', async () => {
    const fetchSpy = mockStreamingFetch([
      'data: {"type":"response.completed","response":{"output":[{"type":"function_call"}]}}\n',
      'data: [DONE]\n',
    ]);

    await collectStream(provider.chatCompletionStream({
      model: 'gpt-5.5',
      messages: [
        {
          role: 'assistant',
          content: [],
          tool_calls: [
            { id: 'call_empty', type: 'function', function: { name: 'lookup', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call_empty', content: [{ type: 'text', text: 'ok' }] },
      ],
    }));

    const body = getLastRequestBody(fetchSpy);
    expect(body.input).toEqual([
      { type: 'function_call', call_id: 'call_empty', name: 'lookup', arguments: '{}' },
      { type: 'function_call_output', call_id: 'call_empty', output: 'ok' },
    ]);
  });

  it('parses non-streaming /responses results', async () => {
    const fetchSpy = mockJsonFetch({
      model: 'gpt-5.5',
      output_text: 'Done',
      output: [
        { type: 'function_call', call_id: 'call_2', name: 'screen', arguments: '{"sector":"AI"}' },
      ],
      usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 },
    });

    const result = await provider.chatCompletion({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'screen AI stocks' }],
      maxTokens: 50,
    });

    const body = getLastRequestBody(fetchSpy);
    expect(body.input).toEqual([{ type: 'message', role: 'user', content: 'screen AI stocks' }]);
    expect(body.messages).toBeUndefined();
    expect(body.stream).toBe(false);
    expect(result).toEqual({
      content: 'Done',
      toolCalls: [
        { id: 'call_2', type: 'function', function: { name: 'screen', arguments: '{"sector":"AI"}' } },
      ],
      finishReason: 'tool_calls',
      usage: { promptTokens: 5, completionTokens: 7, totalTokens: 12 },
      model: 'gpt-5.5',
    });
  });
});
