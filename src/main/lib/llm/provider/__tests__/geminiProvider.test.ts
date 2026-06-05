import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../unifiedLogger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the @google/genai SDK. We only need the symbols GeminiProvider imports
// at module-eval time (the enum + the class/error constructors). The translation
// helpers under test are pure and don't touch the client.
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {},
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  FunctionCallingConfigMode: {
    MODE_UNSPECIFIED: 'MODE_UNSPECIFIED',
    AUTO: 'AUTO',
    ANY: 'ANY',
    NONE: 'NONE',
    VALIDATED: 'VALIDATED',
  },
}));

import { GeminiProvider } from '../geminiProvider';
import type { ChatCompletionParams } from '../types';

describe('GeminiProvider', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    provider = new GeminiProvider();
  });

  describe('info', () => {
    it('should have correct metadata', () => {
      expect(provider.info.id).toBe('gemini');
      expect(provider.info.displayName).toBe('Google (Gemini)');
      expect(provider.info.requiresApiKey).toBe(true);
      expect(provider.info.requiresGitHubAuth).toBe(false);
      expect(provider.info.defaultBaseUrl).toBe('https://generativelanguage.googleapis.com');
    });
  });

  describe('configure', () => {
    it('should invalidate model cache and rebuild client on reconfigure', () => {
      provider.configure({ enabled: true, apiKey: 'test-key' });
      expect(provider.getCachedModels()).toEqual([]);
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

    it('should extract system messages into systemInstruction', () => {
      const { systemInstruction, contents } = translate([
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'hi' },
      ]);
      expect(systemInstruction).toBe('You are helpful.');
      expect(contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
    });

    it('should concatenate multiple system messages', () => {
      const { systemInstruction } = translate([
        { role: 'system', content: 'A.' },
        { role: 'system', content: 'B.' },
        { role: 'user', content: 'hi' },
      ]);
      expect(systemInstruction).toBe('A.\n\nB.');
    });

    it('should leave systemInstruction undefined when none present', () => {
      const { systemInstruction } = translate([{ role: 'user', content: 'hi' }]);
      expect(systemInstruction).toBeUndefined();
    });

    it('should map assistant role to model with a text part', () => {
      const { contents } = translate([
        { role: 'assistant', content: 'sure thing' },
      ]);
      expect(contents).toEqual([{ role: 'model', parts: [{ text: 'sure thing' }] }]);
    });

    it('should convert assistant tool_calls into functionCall parts', () => {
      const { contents } = translate([
        {
          role: 'assistant',
          content: 'let me check',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"q":"x"}' } },
          ],
        },
      ]);
      expect(contents[0].role).toBe('model');
      expect(contents[0].parts).toEqual([
        { text: 'let me check' },
        { functionCall: { id: 'call_1', name: 'search', args: { q: 'x' } } },
      ]);
    });

    it('should convert tool messages into functionResponse parts on a user turn', () => {
      const { contents } = translate([
        { role: 'tool', tool_call_id: 'call_1', content: '42' },
      ]);
      expect(contents).toEqual([
        {
          role: 'user',
          parts: [{
            functionResponse: { id: 'call_1', name: 'call_1', response: { output: '42' } },
          }],
        },
      ]);
    });

    it('should round-trip tool-call id -> name onto the functionResponse', () => {
      // The assistant call establishes the id->name mapping; the later tool
      // result must resolve `name` from that map (Gemini correlates by name).
      const { contents } = translate([
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_42', type: 'function', function: { name: 'get_weather', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'call_42', content: '{"temp":21}' },
      ]);
      const fnResponse = (contents[1].parts as any)[0].functionResponse;
      expect(fnResponse.id).toBe('call_42');
      expect(fnResponse.name).toBe('get_weather');
      // A JSON object result passes through (not wrapped under "output").
      expect(fnResponse.response).toEqual({ temp: 21 });
    });

    it('should tolerate malformed tool-call argument JSON', () => {
      const { contents } = translate([
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'fn', arguments: 'not json' } },
          ],
        },
      ]);
      expect(contents[0].parts).toEqual([
        { functionCall: { id: 'call_1', name: 'fn', args: {} } },
      ]);
    });

    it('should pass plain user messages through as a single text part', () => {
      const { contents } = translate([{ role: 'user', content: 'hello' }]);
      expect(contents).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }]);
    });
  });

  describe('translateTools', () => {
    const translate = (params: Partial<ChatCompletionParams>) =>
      (provider as any).translateTools.bind(provider)(params);

    it('should return empty object when no tools', () => {
      expect(translate({})).toEqual({});
    });

    it('should map OpenAI tools to functionDeclarations shape', () => {
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
          functionDeclarations: [
            {
              name: 'search',
              description: 'search the web',
              parametersJsonSchema: { type: 'object', properties: { q: { type: 'string' } } },
            },
          ],
        },
      ]);
    });

    it('should map tool_choice auto -> AUTO mode', () => {
      const result = translate({
        tools: [{ type: 'function', function: { name: 'fn' } }],
        tool_choice: 'auto',
      });
      expect(result.toolConfig).toEqual({ functionCallingConfig: { mode: 'AUTO' } });
    });

    it('should map tool_choice required -> ANY mode', () => {
      const result = translate({
        tools: [{ type: 'function', function: { name: 'fn' } }],
        tool_choice: 'required',
      });
      expect(result.toolConfig).toEqual({ functionCallingConfig: { mode: 'ANY' } });
    });

    it('should map tool_choice none -> NONE mode', () => {
      const result = translate({
        tools: [{ type: 'function', function: { name: 'fn' } }],
        tool_choice: 'none',
      });
      expect(result.toolConfig).toEqual({ functionCallingConfig: { mode: 'NONE' } });
    });

    it('should map a forced function choice -> ANY + allowedFunctionNames', () => {
      const result = translate({
        tools: [{ type: 'function', function: { name: 'fn' } }],
        tool_choice: { type: 'function', function: { name: 'fn' } },
      });
      expect(result.toolConfig).toEqual({
        functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['fn'] },
      });
    });

    it('should omit toolConfig when no tool_choice is given', () => {
      const result = translate({
        tools: [{ type: 'function', function: { name: 'fn' } }],
      });
      expect(result.tools).toBeDefined();
      expect(result.toolConfig).toBeUndefined();
    });
  });

  describe('mapFinishReason', () => {
    const map = (r: string | undefined, sawFn = false) =>
      (provider as any).mapFinishReason.bind(provider)(r, sawFn);

    it('should map STOP to stop', () => {
      expect(map('STOP')).toBe('stop');
    });

    it('should map MAX_TOKENS to length', () => {
      expect(map('MAX_TOKENS')).toBe('length');
    });

    it('should map safety-class reasons to content_filter', () => {
      expect(map('SAFETY')).toBe('content_filter');
      expect(map('PROHIBITED_CONTENT')).toBe('content_filter');
    });

    it('should report tool_calls when a function call was seen, overriding STOP', () => {
      expect(map('STOP', true)).toBe('tool_calls');
    });

    it('should fall back to stop for undefined', () => {
      expect(map(undefined)).toBe('stop');
    });
  });

  describe('toProviderModel', () => {
    const toModel = (raw: any) => (provider as any).toProviderModel.bind(provider)(raw);

    it('should strip the models/ prefix and map limits', () => {
      const model = toModel({
        name: 'models/gemini-2.5-pro',
        displayName: 'Gemini 2.5 Pro',
        inputTokenLimit: 2_000_000,
        outputTokenLimit: 8192,
        supportedActions: ['generateContent', 'countTokens'],
      });
      expect(model.id).toBe('gemini-2.5-pro');
      expect(model.name).toBe('Gemini 2.5 Pro');
      expect(model.providerId).toBe('gemini');
      expect(model.supportsTools).toBe(true);
      expect(model.supportsImages).toBe(true);
      expect(model.maxContextTokens).toBe(2_000_000);
      expect(model.maxOutputTokens).toBe(8192);
    });

    it('should filter out models that cannot generateContent', () => {
      const model = toModel({
        name: 'models/text-embedding-004',
        displayName: 'Embedding',
        supportedActions: ['embedContent'],
      });
      expect(model).toBeNull();
    });

    it('should fall back to defaults when token limits are absent', () => {
      const model = toModel({
        name: 'models/gemini-2.5-flash',
        displayName: 'Gemini 2.5 Flash',
        supportedActions: ['generateContent'],
      });
      expect(model.maxContextTokens).toBe(1_048_576);
      expect(model.maxOutputTokens).toBe(65_536);
    });
  });
});
