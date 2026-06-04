/**
 * Regression tests for GhcModelApi.callModelStrict.
 *
 * callModelStrict is the no-silent-fallback variant of callModel. It must
 * throw — never delegate to providerManager.resolveModelId or run on a
 * different model — when the supplied modelId is empty, whitespace, or not
 * available on the currently-active provider.
 */

import type { Mock } from 'vitest';

vi.mock('../../unifiedLogger', async () => import('../../__mocks__/unifiedLogger'));

vi.mock('../../auth/authManager', () => ({
  MainAuthManager: {
    getInstance: () => ({
      getCurrentAuth: vi.fn(() => null),
    }),
  },
}));

vi.mock('../../auth/ghcConfig', () => ({
  GHC_CONFIG: {
    API_ENDPOINT: 'https://api.test.com',
    USER_AGENT: 'test',
    EDITOR_VERSION: 'test/1.0',
    EDITOR_PLUGIN_VERSION: 'test/1.0',
  },
}));

const { mockGetModelById } = vi.hoisted(() => ({ mockGetModelById: vi.fn() }));
vi.mock('../ghcModelsManager', async (importOriginal) => {
  const real = await importOriginal<typeof import('../ghcModelsManager')>();
  return {
    ...real,
    getModelById: (...args: unknown[]) => mockGetModelById(...args),
  };
});

// providerManager is the heart of the silent-fallback hole. Mock the surface
// that callModelStrict touches so we can drive each branch deterministically.
const {
  mockWaitUntilReady,
  mockGetActiveProviderId,
  mockValidateModel,
  mockChatCompletion,
  mockGetActiveProvider,
} = vi.hoisted(() => {
  const validate = vi.fn();
  return {
    mockWaitUntilReady: vi.fn().mockResolvedValue(undefined),
    mockGetActiveProviderId: vi.fn(),
    mockValidateModel: validate,
    mockChatCompletion: vi.fn(),
    mockGetActiveProvider: vi.fn(() => ({ validateModel: validate })),
  };
});
vi.mock('../provider', async (importOriginal) => {
  const real = await importOriginal<typeof import('../provider')>();
  return {
    ...real,
    providerManager: {
      waitUntilReady: mockWaitUntilReady,
      getActiveProviderId: mockGetActiveProviderId,
      getActiveProvider: mockGetActiveProvider,
      chatCompletion: mockChatCompletion,
      // resolveModelId would be the silent-fallback path; we intentionally
      // omit it and assert it is never called.
      resolveModelId: vi.fn(() => {
        throw new Error('resolveModelId must NOT be reached from callModelStrict');
      }),
    },
  };
});

import { ghcModelApi } from '../ghcModelApi';

beforeEach(() => {
  mockGetModelById.mockReset();
  mockGetActiveProviderId.mockReset();
  mockValidateModel.mockReset();
  mockChatCompletion.mockReset();
  mockWaitUntilReady.mockClear();
});

describe('callModelStrict — empty / whitespace modelId', () => {
  it('throws when modelId is empty', async () => {
    await expect(ghcModelApi.callModelStrict('', 'prompt')).rejects.toThrow(
      /non-empty modelId/,
    );
    expect(mockWaitUntilReady).not.toHaveBeenCalled();
  });

  it('throws when modelId is whitespace-only', async () => {
    await expect(ghcModelApi.callModelStrict('   ', 'prompt')).rejects.toThrow(
      /non-empty modelId/,
    );
  });

  it('throws when modelId is not a string', async () => {
    // Simulate undefined coming from a stale caller; the runtime guard must
    // still surface a clear error rather than dispatching to the LLM.
    await expect(
      ghcModelApi.callModelStrict(undefined as unknown as string, 'prompt'),
    ).rejects.toThrow(/non-empty modelId/);
  });
});

describe('callModelStrict — non-Copilot provider', () => {
  beforeEach(() => {
    mockGetActiveProviderId.mockReturnValue('openai');
  });

  it('throws when the active provider rejects the model (no silent fallback)', async () => {
    mockValidateModel.mockResolvedValue(false);

    await expect(
      ghcModelApi.callModelStrict('claude-haiku-4.5', 'hi'),
    ).rejects.toThrow(/not available on the active provider 'openai'/);

    expect(mockValidateModel).toHaveBeenCalledWith('claude-haiku-4.5');
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it('issues chatCompletion with the exact modelId when validation passes', async () => {
    mockValidateModel.mockResolvedValue(true);
    mockChatCompletion.mockResolvedValue({ content: 'ok' });

    const result = await ghcModelApi.callModelStrict(
      'gpt-4.1',
      'user prompt',
      'system prompt',
      1234,
      0.2,
    );

    expect(result).toBe('ok');
    expect(mockChatCompletion).toHaveBeenCalledTimes(1);
    const [arg] = (mockChatCompletion as Mock).mock.calls[0];
    expect(arg.model).toBe('gpt-4.1');
    expect(arg.maxTokens).toBe(1234);
    expect(arg.temperature).toBe(0.2);
    expect(arg.messages).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'user prompt' },
    ]);
  });

  it('omits the system message when systemPrompt is not provided', async () => {
    mockValidateModel.mockResolvedValue(true);
    mockChatCompletion.mockResolvedValue({ content: 'ok' });

    await ghcModelApi.callModelStrict('gpt-4.1', 'user only');
    const [arg] = (mockChatCompletion as Mock).mock.calls[0];
    expect(arg.messages).toEqual([{ role: 'user', content: 'user only' }]);
  });

  it('trims the modelId before validating and dispatching', async () => {
    mockValidateModel.mockResolvedValue(true);
    mockChatCompletion.mockResolvedValue({ content: 'ok' });

    await ghcModelApi.callModelStrict('  gpt-4.1  ', 'hi');
    expect(mockValidateModel).toHaveBeenCalledWith('gpt-4.1');
    const [arg] = (mockChatCompletion as Mock).mock.calls[0];
    expect(arg.model).toBe('gpt-4.1');
  });
});

describe('callModelStrict — Copilot provider', () => {
  beforeEach(() => {
    mockGetActiveProviderId.mockReturnValue('copilot');
  });

  it('throws when the model is not in the Copilot registry', async () => {
    mockGetModelById.mockReturnValue(undefined);

    await expect(
      ghcModelApi.callModelStrict('imaginary-model', 'hi'),
    ).rejects.toThrow(/not registered in the GitHub Copilot model list/);
  });
});
