import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../unifiedLogger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { OpenAICompatibleProvider } from '../openaiCompatibleProvider';

describe('OpenAICompatibleProvider', () => {
  let provider: OpenAICompatibleProvider;

  beforeEach(() => {
    provider = new OpenAICompatibleProvider('openai');
  });

  describe('info', () => {
    it('should have correct metadata for openai', () => {
      expect(provider.info.id).toBe('openai');
      expect(provider.info.displayName).toBe('OpenAI');
      expect(provider.info.requiresApiKey).toBe(true);
      expect(provider.info.requiresGitHubAuth).toBe(false);
      expect(provider.info.defaultBaseUrl).toBe('https://api.openai.com/v1');
    });

    it('should not require API key for ollama', () => {
      const ollamaProvider = new OpenAICompatibleProvider('ollama');
      expect(ollamaProvider.info.requiresApiKey).toBe(false);
      expect(ollamaProvider.info.defaultBaseUrl).toBe('http://localhost:11434/v1');
    });

    it('should handle custom-openai with empty base URL', () => {
      const custom = new OpenAICompatibleProvider('custom-openai');
      expect(custom.info.defaultBaseUrl).toBe('');
    });
  });

  describe('configure', () => {
    it('should invalidate model cache on reconfigure', async () => {
      provider.configure({ enabled: true, apiKey: 'test-key' });
      // After configure, cache should be empty (no network call made)
      // listModels would need to fetch fresh
    });
  });

  describe('testConnection', () => {
    it('should handle ECONNREFUSED gracefully', async () => {
      provider.configure({ enabled: true, baseUrl: 'http://localhost:99999/v1' });
      const result = await provider.testConnection();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('chatCompletion', () => {
    it('should throw when no base URL configured', async () => {
      const custom = new OpenAICompatibleProvider('custom-openai');
      custom.configure({ enabled: true, apiKey: 'test' });
      // custom-openai has empty default base URL, so fetch will fail
      await expect(
        custom.chatCompletion({
          model: 'test',
          messages: [{ role: 'user', content: 'hello' }],
        })
      ).rejects.toThrow();
    });

    // Regression: Azure's OpenAI-v1 sample URL ends in `/`, e.g.
    //   https://<resource>.cognitiveservices.azure.com/openai/v1/
    // The naive `${baseUrl}/chat/completions` concat produced a double
    // slash and Azure's gateway routed it into the legacy deployment
    // handler, returning `DeploymentNotFound`. getBaseUrl() must strip
    // trailing slashes before path joining.
    it('should strip trailing slashes from baseUrl', () => {
      const cases: Array<[string, string]> = [
        ['https://example.com/openai/v1/', 'https://example.com/openai/v1'],
        ['https://example.com/openai/v1///', 'https://example.com/openai/v1'],
        ['https://example.com/openai/v1', 'https://example.com/openai/v1'],
        ['http://localhost:11434/v1/', 'http://localhost:11434/v1'],
      ];
      for (const [input, expected] of cases) {
        const p = new OpenAICompatibleProvider('custom-openai');
        p.configure({ enabled: true, apiKey: 'k', baseUrl: input });
        expect((p as any).getBaseUrl()).toBe(expected);
      }
    });
  });

  describe('SSE chunk parsing', () => {
    const parseAll = (json: any) => {
      const gen = (provider as any).parseStreamChunks.bind(provider);
      return Array.from(gen(json));
    };

    it('should parse content delta', () => {
      const chunks = parseAll({
        choices: [{ delta: { content: 'hello' }, finish_reason: null }],
      });
      expect(chunks.length).toBeGreaterThan(0);
      const content = chunks.find((c: any) => c.contentDelta) as any;
      expect(content?.contentDelta).toBe('hello');
    });

    it('should parse tool call delta', () => {
      const chunks = parseAll({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_123',
              type: 'function',
              function: { name: 'search', arguments: '{"q":' },
            }],
          },
          finish_reason: null,
        }],
      }) as any[];
      const tc = chunks.find((c) => c.toolCallDelta);
      expect(tc).toBeTruthy();
      expect(tc.toolCallDelta.id).toBe('call_123');
      expect(tc.toolCallDelta.function.name).toBe('search');
    });

    it('should split multiple parallel tool calls', () => {
      const chunks = parseAll({
        choices: [{
          delta: {
            tool_calls: [
              { index: 0, id: 'a', type: 'function', function: { name: 'fn_a', arguments: '' } },
              { index: 1, id: 'b', type: 'function', function: { name: 'fn_b', arguments: '' } },
            ],
          },
          finish_reason: null,
        }],
      }) as any[];
      const tcs = chunks.filter((c) => c.toolCallDelta);
      expect(tcs).toHaveLength(2);
      expect(tcs[0].toolCallDelta.id).toBe('a');
      expect(tcs[1].toolCallDelta.id).toBe('b');
    });

    it('should parse finish reason', () => {
      const chunks = parseAll({
        choices: [{ delta: {}, finish_reason: 'stop' }],
      }) as any[];
      const trailer = chunks.find((c) => c.finishReason);
      expect(trailer?.finishReason).toBe('stop');
    });

    it('should parse usage data', () => {
      const chunks = parseAll({
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }) as any[];
      const trailer = chunks.find((c) => c.usage);
      expect(trailer?.usage).toEqual({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      });
    });

    it('should yield no chunks for empty events', () => {
      const chunks = parseAll({ choices: [{ delta: {} }] });
      expect(chunks).toHaveLength(0);
    });
  });

  describe('buildRequestBody', () => {
    it('should use max_tokens for standard models', () => {
      const builder = (provider as any).buildRequestBody.bind(provider);
      const body = builder(
        { model: 'gpt-4o', messages: [], maxTokens: 1000 },
        false
      );
      expect(body.max_tokens).toBe(1000);
      expect(body.max_completion_tokens).toBeUndefined();
    });

    it('should use max_completion_tokens for o-series models', () => {
      const builder = (provider as any).buildRequestBody.bind(provider);
      const body = builder(
        { model: 'o3-mini', messages: [], maxTokens: 1000 },
        false
      );
      expect(body.max_completion_tokens).toBe(1000);
      expect(body.max_tokens).toBeUndefined();
    });

    it('should include tools when provided', () => {
      const builder = (provider as any).buildRequestBody.bind(provider);
      const tools = [{ type: 'function' as const, function: { name: 'test' } }];
      const body = builder(
        { model: 'gpt-4o', messages: [], tools, tool_choice: 'auto' },
        false
      );
      expect(body.tools).toEqual(tools);
      expect(body.tool_choice).toBe('auto');
    });

    it('should add stream_options for streaming requests', () => {
      const builder = (provider as any).buildRequestBody.bind(provider);
      const body = builder(
        { model: 'gpt-4o', messages: [] },
        true
      );
      expect(body.stream).toBe(true);
      expect(body.stream_options).toEqual({ include_usage: true });
    });
  });
});
