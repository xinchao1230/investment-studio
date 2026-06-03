import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron modules before any imports
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-userdata'),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn(),
    decryptString: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));

vi.mock('../../../unifiedLogger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the GHC dependencies that CopilotProvider needs
vi.mock('../../../auth/ghcConfig', () => ({
  GHC_CONFIG: {
    API_ENDPOINT: 'https://api.githubcopilot.com',
    USER_AGENT: 'test',
    EDITOR_VERSION: 'test',
    EDITOR_PLUGIN_VERSION: 'test',
    INTEGRATION_ID: 'test',
  },
}));

vi.mock('../../../auth/authManager', () => ({
  MainAuthManager: {
    getInstance: () => ({
      getCopilotAccessToken: () => null,
    }),
  },
}));

vi.mock('../../ghcModelsManager', () => ({
  ghcModelsManager: {
    getAllOpenKosmosUsedModels: () => [],
    validateModelId: () => false,
  },
  getEndpointForModel: () => '/chat/completions',
  buildMaxTokensParam: () => ({}),
}));

import { ProviderManager } from '../providerManager';

describe('ProviderManager', () => {
  let manager: ProviderManager;

  beforeEach(() => {
    // Reset the singleton for each test
    (ProviderManager as any).instance = undefined;
    manager = ProviderManager.getInstance();
  });

  it('should be a singleton', () => {
    const m2 = ProviderManager.getInstance();
    expect(m2).toBe(manager);
  });

  it('should default to copilot as active provider', () => {
    expect(manager.getActiveProviderId()).toBe('copilot');
  });

  it('should have all expected providers registered', () => {
    const infos = manager.getAllProviderInfos();
    const ids = infos.map(i => i.id);
    expect(ids).toContain('copilot');
    expect(ids).toContain('openai');
    expect(ids).toContain('anthropic');
    expect(ids).toContain('gemini');
    expect(ids).toContain('custom-dynamic');
  });

  it('should reject switching to a disabled provider', async () => {
    const result = await manager.switchProvider('openai');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not enabled');
  });

  it('should indicate no API key provider by default', () => {
    expect(manager.hasApiKeyProvider()).toBe(false);
  });

  it('redirects the active pointer to custom-dynamic for a skip-login user with no configured provider', async () => {
    // A _local (skip-login) user cannot use Copilot. With no non-Copilot
    // provider configured yet, the active pointer must NOT stay at 'copilot'
    // (which would make the UI show the Copilot icon next to "No models found").
    // It should default to the 'custom-dynamic' slot the user will configure.
    //
    // It must ALSO NOT warm the model cache for that empty slot: warming an
    // unconfigured endpoint fires listModels() against a blank base URL on every
    // init (a guaranteed failed HTTP request + log noise). Spy on the slot's
    // listModels to assert it is never called.
    const customDynamic = manager.getProvider('custom-dynamic');
    const listModelsSpy = vi.spyOn(customDynamic!, 'listModels');

    await manager.initialize('_local');

    expect(manager.getActiveProviderId()).toBe('custom-dynamic');
    // In-memory only — the on-disk default must remain 'copilot' so the next
    // init re-evaluates from a clean slate.
    expect((manager as any).config.activeProvider).toBe('copilot');
    // No credentials → not usable → must NOT warm the cache.
    expect(listModelsSpy).not.toHaveBeenCalled();
  });

  describe('isActiveProviderUsable', () => {
    it('returns false when the active provider is copilot (needs GitHub auth, not a key)', () => {
      (manager as any).config = {
        version: '1.0.0',
        activeProvider: 'copilot',
        providers: { copilot: { enabled: true } },
      };
      (manager as any).activeProviderId = 'copilot';
      expect(manager.isActiveProviderUsable()).toBe(false);
    });

    it('returns false when the active pointer aims at a DISABLED provider (stale-pointer bug)', () => {
      // Reproduces the real bug: activeProvider was left pointing at custom-dynamic
      // after the user disabled it. The old gate combined `active !== copilot`
      // (true here) with a separate key check and let the workspace button stay
      // clickable; this verdict must be false.
      (manager as any).config = {
        version: '1.0.0',
        activeProvider: 'custom-dynamic',
        providers: {
          copilot: { enabled: true },
          'custom-dynamic': { enabled: false, apiKey: 'enc:stale', baseUrl: 'http://localhost:4141/', detectedProtocol: 'openai' },
        },
      };
      (manager as any).activeProviderId = 'custom-dynamic';
      expect(manager.isActiveProviderUsable()).toBe(false);
    });

    it('returns false when the active provider is enabled but has no API key', () => {
      (manager as any).config = {
        version: '1.0.0',
        activeProvider: 'anthropic',
        providers: { anthropic: { enabled: true } },
      };
      (manager as any).activeProviderId = 'anthropic';
      expect(manager.isActiveProviderUsable()).toBe(false);
    });

    it('returns true when the active provider is non-copilot, enabled, and has a key', () => {
      (manager as any).config = {
        version: '1.0.0',
        activeProvider: 'anthropic',
        providers: { anthropic: { enabled: true, apiKey: 'enc:real' } },
      };
      (manager as any).activeProviderId = 'anthropic';
      expect(manager.isActiveProviderUsable()).toBe(true);
    });
  });

  it('should return provider info with correct metadata', () => {
    const infos = manager.getAllProviderInfos();
    const openai = infos.find(i => i.id === 'openai');
    expect(openai).toBeDefined();
    expect(openai!.requiresApiKey).toBe(true);
    expect(openai!.requiresGitHubAuth).toBe(false);

    const copilot = infos.find(i => i.id === 'copilot');
    expect(copilot).toBeDefined();
    expect(copilot!.requiresApiKey).toBe(false);
    expect(copilot!.requiresGitHubAuth).toBe(true);

    const anthropic = infos.find(i => i.id === 'anthropic');
    expect(anthropic).toBeDefined();
    expect(anthropic!.requiresApiKey).toBe(true);
    expect(anthropic!.requiresGitHubAuth).toBe(false);

    const gemini = infos.find(i => i.id === 'gemini');
    expect(gemini).toBeDefined();
    expect(gemini!.requiresApiKey).toBe(true);
    expect(gemini!.requiresGitHubAuth).toBe(false);
  });

  it('should return undefined config for unconfigured provider', () => {
    const config = manager.getProviderConfig('openai');
    expect(config).toBeUndefined();
  });

  it('notifies the renderer with models:updated after updating the ACTIVE provider config', async () => {
    // Capture webContents.send calls by injecting a fake window.
    const sent: Array<{ channel: string; data: unknown }> = [];
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send: (channel: string, data: unknown) => sent.push({ channel, data }) },
    };
    const electron = await import('electron');
    (electron.BrowserWindow.getAllWindows as unknown as ReturnType<typeof vi.fn>).mockReturnValue([fakeWindow]);

    // Stub fetch so the post-save cache-warm (provider.listModels) resolves fast.
    // The models:updated notification fires in the warm's .finally(), so we must
    // let that detached promise settle before asserting.
    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: [{ id: 'gpt-4o' }] }) } as Response),
    );
    vi.stubGlobal('fetch', fetchSpy);

    // Make custom-dynamic the active provider, then update its config (the Save path).
    (manager as any).activeProviderId = 'custom-dynamic';
    await manager.updateProviderConfig('custom-dynamic', {
      enabled: true,
      apiKey: 'k',
      baseUrl: 'https://example.com',
      detectedProtocol: 'openai',
    });

    // Flush the detached warm-then-notify promise chain.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    vi.unstubAllGlobals();

    const modelsUpdated = sent.filter((s) => s.channel === 'models:updated');
    expect(modelsUpdated.length).toBeGreaterThan(0);
  });

  it('does NOT notify models:updated when updating a NON-active provider config', async () => {
    const sent: Array<{ channel: string; data: unknown }> = [];
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send: (channel: string, data: unknown) => sent.push({ channel, data }) },
    };
    const electron = await import('electron');
    (electron.BrowserWindow.getAllWindows as unknown as ReturnType<typeof vi.fn>).mockReturnValue([fakeWindow]);

    // Active stays 'copilot'; updating 'openai' must not disturb the active model list.
    await manager.updateProviderConfig('openai', { enabled: true, apiKey: 'k' });

    const modelsUpdated = sent.filter((s) => s.channel === 'models:updated');
    expect(modelsUpdated.length).toBe(0);
  });

  it('notifies models:updated after a successful Test/Connect on the ACTIVE provider', async () => {
    const sent: Array<{ channel: string; data: unknown }> = [];
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send: (channel: string, data: unknown) => sent.push({ channel, data }) },
    };
    const electron = await import('electron');
    (electron.BrowserWindow.getAllWindows as unknown as ReturnType<typeof vi.fn>).mockReturnValue([fakeWindow]);

    // fetch returns a valid model listing so detection + listModels both succeed.
    const fetchSpy = vi.fn(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data: [{ id: 'gpt-4o' }] }) } as Response),
    );
    vi.stubGlobal('fetch', fetchSpy);

    (manager as any).activeProviderId = 'custom-dynamic';
    // Seed enough config for the provider to attempt a connection.
    await manager.updateProviderConfig('custom-dynamic', {
      enabled: true, apiKey: 'k', baseUrl: 'https://example.com', detectedProtocol: 'openai',
    });
    sent.length = 0; // ignore the save-path notification; assert only the test path

    const result = await manager.testConnection('custom-dynamic');
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    vi.unstubAllGlobals();

    expect(result.success).toBe(true);
    expect(sent.filter((s) => s.channel === 'models:updated').length).toBeGreaterThan(0);
  });

  it('does NOT notify models:updated on a FAILED Test/Connect', async () => {
    const sent: Array<{ channel: string; data: unknown }> = [];
    const fakeWindow = {
      isDestroyed: () => false,
      webContents: { send: (channel: string, data: unknown) => sent.push({ channel, data }) },
    };
    const electron = await import('electron');
    (electron.BrowserWindow.getAllWindows as unknown as ReturnType<typeof vi.fn>).mockReturnValue([fakeWindow]);

    // No endpoint configured → custom-dynamic testConnection fails fast.
    (manager as any).activeProviderId = 'custom-dynamic';
    const result = await manager.testConnection('custom-dynamic');
    await new Promise((r) => setTimeout(r, 0));

    expect(result.success).toBe(false);
    expect(sent.filter((s) => s.channel === 'models:updated').length).toBe(0);
  });

  it('clears the stale detectedProtocol when a custom-dynamic endpoint changes', async () => {
    const okJson = (body: unknown) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
    const notFound = () =>
      Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // First save → the OLD box genuinely speaks Anthropic. Detection probes
    // OpenAI first (404 miss), then Anthropic (hit), and persists 'anthropic'.
    fetchSpy.mockReturnValueOnce(notFound());                               // openai probe miss
    fetchSpy.mockReturnValueOnce(okJson({ data: [{ id: 'claude-sonnet-4.6' }] })); // anthropic hit
    await manager.updateProviderConfig('custom-dynamic', {
      enabled: true, apiKey: 'old-key', baseUrl: 'https://old-box',
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(manager.getProviderConfig('custom-dynamic')?.detectedProtocol).toBe('anthropic');

    // User changes ONLY the base URL. This time the new box is unreachable, so
    // re-detection FAILS (every probe misses). The stale 'anthropic' verdict
    // must NOT survive: clearing it on endpoint change means a failed re-detect
    // leaves NO protocol cached, rather than silently keeping the previous one
    // and routing the new endpoint through the wrong engine. Without the clear,
    // detectedProtocol would still read 'anthropic' here.
    fetchSpy.mockReturnValue(notFound());                                   // all probes miss
    await manager.updateProviderConfig('custom-dynamic', { enabled: true, baseUrl: 'https://new-box/v1' });
    await new Promise((r) => setTimeout(r, 0));
    vi.unstubAllGlobals();

    expect(manager.getProviderConfig('custom-dynamic')?.detectedProtocol).toBeUndefined();
  });
});
