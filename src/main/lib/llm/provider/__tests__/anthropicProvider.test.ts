import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../unifiedLogger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { AnthropicProvider } from '../anthropicProvider';
import type { ChatCompletionParams } from '../types';

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider();
  });

  describe('info', () => {
    it('should have correct metadata', () => {
      expect(provider.info.id).toBe('anthropic');
      expect(provider.info.displayName).toBe('Anthropic (Claude)');
      expect(provider.info.requiresApiKey).toBe(true);
      expect(provider.info.requiresGitHubAuth).toBe(false);
      expect(provider.info.defaultBaseUrl).toBe('https://api.anthropic.com');
    });
  });

  describe('configure', () => {
    it('should invalidate model cache and rebuild client on reconfigure', () => {
      provider.configure({ enabled: true, apiKey: 'test-key' });
      expect(provider.getCachedModels()).toEqual([]);
    });
  });

  describe('auth header scheme (custom gateway vs official)', () => {
    const isCustom = (url: string) => (provider as any).isCustomBaseUrl.bind(provider)(url);

    it('treats api.anthropic.com (and subdomains) as official — no Bearer injection', () => {
      expect(isCustom('https://api.anthropic.com')).toBe(false);
      expect(isCustom('https://api.anthropic.com/')).toBe(false);
    });

    it('treats third-party gateways as custom — Bearer injected', () => {
      expect(isCustom('https://open.bigmodel.cn/api/anthropic')).toBe(true);
      expect(isCustom('https://my-proxy.example.com/v1')).toBe(true);
    });

    it('injects an Authorization: Bearer default header for a custom baseURL', () => {
      provider.configure({ enabled: true, apiKey: 'zk-123', baseUrl: 'https://open.bigmodel.cn/api/anthropic' });
      const client = (provider as any).getClient();
      // The SDK exposes its resolved default headers; assert the Bearer token is present.
      const headers = client.defaultHeaders ?? client._options?.defaultHeaders;
      expect(headers).toMatchObject({ Authorization: 'Bearer zk-123' });
    });

    it('does NOT inject a Bearer header for the official endpoint', () => {
      provider.configure({ enabled: true, apiKey: 'sk-ant-real' }); // defaults to api.anthropic.com
      const client = (provider as any).getClient();
      const headers = client.defaultHeaders ?? client._options?.defaultHeaders ?? {};
      expect(headers.Authorization).toBeUndefined();
    });
  });

  describe('testConnection', () => {
    it('should fail fast with no API key', async () => {
      provider.configure({ enabled: true });
      const result = await provider.testConnection();
      expect(result.success).toBe(false);
      expect(result.error).toContain('No API key');
    });
  });

  describe('translateMessages', () => {
    const translate = (messages: any) =>
      (provider as any).translateMessages.bind(provider)(messages);

    it('should extract system messages into the top-level system field', () => {
      const { system, messages } = translate([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'hi' },
      ]);
      expect(system).toBe('You are helpful.');
      expect(messages).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('should concatenate multiple system messages', () => {
      const { system } = translate([
        { role: 'system', content: 'A.' },
        { role: 'system', content: 'B.' },
        { role: 'user', content: 'hi' },
      ]);
      expect(system).toBe('A.\n\nB.');
    });

    it('should leave system undefined when none present', () => {
      const { system } = translate([{ role: 'user', content: 'hi' }]);
      expect(system).toBeUndefined();
    });

    it('should convert tool messages into tool_result content blocks', () => {
      const { messages } = translate([
        { role: 'tool', tool_call_id: 'call_1', content: '42' },
      ]);
      expect(messages).toEqual([
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '42' }],
        },
      ]);
    });

    it('should convert assistant tool_calls into tool_use blocks', () => {
      const { messages } = translate([
        {
          role: 'assistant',
          content: 'let me check',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } },
          ],
        },
      ]);
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].content).toEqual([
        { type: 'text', text: 'let me check' },
        { type: 'tool_use', id: 'call_1', name: 'search', input: { q: 'x' } },
      ]);
    });

    it('should tolerate malformed tool-call argument JSON', () => {
      const { messages } = translate([
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'fn', arguments: 'not json' } },
          ],
        },
      ]);
      expect(messages[0].content).toEqual([
        { type: 'tool_use', id: 'call_1', name: 'fn', input: {} },
      ]);
    });

    it('should pass plain user messages through as string content', () => {
      const { messages } = translate([{ role: 'user', content: 'hello' }]);
      expect(messages).toEqual([{ role: 'user', content: 'hello' }]);
    });
  });

  describe('translateTools', () => {
    const translate = (params: Partial<ChatCompletionParams>) =>
      (provider as any).translateTools.bind(provider)(params);

    it('should return empty object when no tools', () => {
      expect(translate({})).toEqual({});
    });

    it('should map OpenAI tools to Anthropic input_schema shape', () => {
      const result = translate({
        tools: [
          {
            type: 'function',
            function: {
              name: 'search',
              description: 'search the web',
              parameters: { type: 'object', properties: { q: { type: 'string' } } },
            },
          },
        ],
      });
      expect(result.tools).toEqual([
        {
          name: 'search',
          description: 'search the web',
          input_schema: { type: 'object', properties: { q: { type: 'string' } } },
        },
      ]);
    });

    it('should map tool_choice auto -> auto', () => {
      const result = translate({
        tools: [{ type: 'function', function: { name: 'fn' } }],
        tool_choice: 'auto',
      });
      expect(result.tool_choice).toEqual({ type: 'auto' });
    });

    it('should map tool_choice required -> any', () => {
      const result = translate({
        tools: [{ type: 'function', function: { name: 'fn' } }],
        tool_choice: 'required',
      });
      expect(result.tool_choice).toEqual({ type: 'any' });
    });

    it('should map a forced function choice -> tool', () => {
      const result = translate({
        tools: [{ type: 'function', function: { name: 'fn' } }],
        tool_choice: { type: 'function', function: { name: 'fn' } },
      });
      expect(result.tool_choice).toEqual({ type: 'tool', name: 'fn' });
    });

    it('should omit tools entirely for tool_choice none', () => {
      // Anthropic has no per-request "tools present but forbidden" flag; the only
      // way to enforce 'none' is to drop the tools array. Sending tools without a
      // tool_choice would let Anthropic default to 'auto' and call a tool anyway.
      const result = translate({
        tools: [{ type: 'function', function: { name: 'fn' } }],
        tool_choice: 'none',
      });
      expect(result).toEqual({});
      expect(result.tools).toBeUndefined();
    });
  });

  describe('mapStopReason', () => {
    const map = (r: string | null) => (provider as any).mapStopReason.bind(provider)(r);

    it('should map end_turn and stop_sequence to stop', () => {
      expect(map('end_turn')).toBe('stop');
      expect(map('stop_sequence')).toBe('stop');
    });

    it('should map max_tokens to length', () => {
      expect(map('max_tokens')).toBe('length');
    });

    it('should map tool_use to tool_calls', () => {
      expect(map('tool_use')).toBe('tool_calls');
    });

    it('should fall back to stop for null', () => {
      expect(map(null)).toBe('stop');
    });
  });

  describe('toProviderModel', () => {
    const toModel = (raw: any) => (provider as any).toProviderModel.bind(provider)(raw);

    it('should derive image support from API capabilities when present', () => {
      const model = toModel({
        id: 'claude-test',
        display_name: 'Claude Test',
        max_input_tokens: 200000,
        max_tokens: 8192,
        capabilities: { image_input: { supported: true } },
      });
      expect(model.id).toBe('claude-test');
      expect(model.name).toBe('Claude Test');
      expect(model.providerId).toBe('anthropic');
      expect(model.supportsTools).toBe(true);
      expect(model.supportsImages).toBe(true);
      expect(model.maxContextTokens).toBe(200000);
      expect(model.maxOutputTokens).toBe(8192);
    });

    it('should fall back to family heuristic and defaults when metadata is absent', () => {
      const model = toModel({
        id: 'claude-opus-4-x',
        display_name: 'Claude Opus',
        max_input_tokens: null,
        max_tokens: null,
        capabilities: null,
      });
      expect(model.supportsImages).toBe(true);
      expect(model.maxContextTokens).toBe(200000);
      expect(model.maxOutputTokens).toBe(32000);
    });

    it('honors gateway context_window when max_input_tokens is absent', () => {
      // bigmodel/GLM-style gateways advertise context_window instead of max_input_tokens.
      const model = toModel({
        id: 'glm-4.6',
        display_name: 'GLM 4.6',
        context_window: 204800,
        max_tokens: 131072,
      });
      expect(model.maxContextTokens).toBe(204800);
      expect(model.maxOutputTokens).toBe(131072);
    });

    it('accepts numeric-string limits from gateways', () => {
      const model = toModel({
        id: 'claude-via-gateway',
        max_input_tokens: '200000',
      });
      expect(model.maxContextTokens).toBe(200000);
    });
  });

  describe('listModels — raw GET /v1/models is the primary path', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('lists models from a raw GET /v1/models without ever calling the SDK', async () => {
      provider.configure({ enabled: true, apiKey: 'k', baseUrl: 'https://open.bigmodel.cn/api/anthropic' });
      // If the SDK paginator were called it would yield nothing — proving the
      // raw path alone produced the list.
      const sdkList = vi.fn(() => ({ async *[Symbol.asyncIterator]() {} }));
      (provider as any).client = { models: { list: sdkList } };

      const fetchSpy = vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ data: [{ id: 'glm-4.6' }, { id: 'glm-5' }, { id: 'glm-4.5' }] }),
        } as Response),
      );
      vi.stubGlobal('fetch', fetchSpy);

      const models = await provider.listModels();

      expect(models.map((m) => m.id)).toEqual(['glm-4.5', 'glm-4.6', 'glm-5']);
      expect(models.every((m) => m.providerId === 'anthropic')).toBe(true);
      // Raw GET hit {baseUrl}/v1/models with anthropic auth headers …
      const [calledUrl, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      expect(calledUrl).toBe('https://open.bigmodel.cn/api/anthropic/v1/models');
      expect(init.headers).toMatchObject({ 'x-api-key': 'k' });
      // … and the SDK paginator was never consulted (raw succeeded).
      expect(sdkList).not.toHaveBeenCalled();
    });

    it('falls back to the SDK paginator only when the raw GET yields nothing', async () => {
      provider.configure({ enabled: true, apiKey: 'k', baseUrl: 'https://api.anthropic.com' });
      (provider as any).client = {
        models: {
          list: () => ({
            async *[Symbol.asyncIterator]() {
              yield { id: 'claude-sonnet-4.6', display_name: 'Claude Sonnet 4.6' } as any;
            },
          }),
        },
      };
      // Raw GET returns an empty catalog → triggers the SDK fallback.
      const fetchSpy = vi.fn(() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: [] }) } as Response),
      );
      vi.stubGlobal('fetch', fetchSpy);

      const models = await provider.listModels();

      expect(fetchSpy).toHaveBeenCalledTimes(1);        // raw GET was attempted first
      expect(models.map((m) => m.id)).toEqual(['claude-sonnet-4.6']); // SDK supplied the list
    });
  });
});
