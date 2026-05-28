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
    expect(ids).toContain('deepseek');
    expect(ids).toContain('ollama');
    expect(ids).toContain('custom-openai');
  });

  it('should reject switching to a disabled provider', async () => {
    const result = await manager.switchProvider('openai');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not enabled');
  });

  it('should indicate no API key provider by default', () => {
    expect(manager.hasApiKeyProvider()).toBe(false);
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

    const ollama = infos.find(i => i.id === 'ollama');
    expect(ollama).toBeDefined();
    expect(ollama!.requiresApiKey).toBe(false);
  });

  it('should return undefined config for unconfigured provider', () => {
    const config = manager.getProviderConfig('openai');
    expect(config).toBeUndefined();
  });
});
