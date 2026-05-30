import {
  DEFAULT_APP_CONFIG,
  isAppConfig,
} from '../types/app';

describe('app-level config defaults', () => {
  it('rejects app config with invalid runtimeEnvironment shape', () => {
    expect(isAppConfig({
      runtimeEnvironment: {
        mode: 42,
      },
    })).toBe(false);
  });

  it('accepts a minimal valid AppConfig', () => {
    expect(isAppConfig(DEFAULT_APP_CONFIG)).toBe(true);
  });

  it('defaults tintColor to "default"', () => {
    expect(DEFAULT_APP_CONFIG.tintColor).toBe('default');
  });

  it('accepts a known tintColor literal', () => {
    expect(isAppConfig({ tintColor: 'blue' })).toBe(true);
  });

  it('rejects a non-string tintColor', () => {
    expect(isAppConfig({ tintColor: 42 })).toBe(false);
  });
});