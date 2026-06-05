import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'research-api-token-storage-'));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => testUserDataDir),
  },
}));

import {
  ensureResearchApiTokenFile,
  getResearchApiStatus,
  getResearchApiToken,
  getVerifiedResearchApiToken,
  recordResearchApiTestResult,
  setResearchApiToken,
} from '../tokenStorage';

const tokenFilePath = () => path.join(testUserDataDir, 'research-api-tokens.json');

describe('research API token storage', () => {
  beforeEach(() => {
    fs.rmSync(testUserDataDir, { recursive: true, force: true });
    fs.mkdirSync(testUserDataDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testUserDataDir, { recursive: true, force: true });
  });

  it('stores a saved API key as unverified until a connection test succeeds', () => {
    const status = setResearchApiToken('webiq', '  test-key  ');

    expect(status).toMatchObject({
      provider: 'webiq',
      hasApiKey: true,
      verified: false,
      verifiedAt: null,
      lastTestError: null,
    });
    expect(getResearchApiToken('webiq')).toBe('test-key');
    expect(getVerifiedResearchApiToken('webiq')).toBeUndefined();

    const stored = JSON.parse(fs.readFileSync(tokenFilePath(), 'utf-8'));
    expect(stored).toEqual({
      version: 1,
      providers: {
        webiq: {
          apiKey: 'test-key',
          verified: false,
          verifiedAt: null,
          lastTestError: null,
        },
      },
    });
  });

  it('marks a provider verified only after a successful connection test', () => {
    setResearchApiToken('webiq', 'test-key');

    const status = recordResearchApiTestResult('webiq', { ok: true });

    expect(status.hasApiKey).toBe(true);
    expect(status.verified).toBe(true);
    expect(status.verifiedAt).toEqual(expect.any(String));
    expect(status.lastTestError).toBeNull();
    expect(getVerifiedResearchApiToken('webiq')).toBe('test-key');
  });

  it('keeps the API key but clears verification after a failed connection test', () => {
    setResearchApiToken('tushare', 'test-key');

    const status = recordResearchApiTestResult('tushare', {
      ok: false,
      error: 'invalid token',
    });

    expect(status).toMatchObject({
      provider: 'tushare',
      hasApiKey: true,
      verified: false,
      verifiedAt: null,
      lastTestError: 'invalid token',
    });
    expect(getResearchApiToken('tushare')).toBe('test-key');
    expect(getVerifiedResearchApiToken('tushare')).toBeUndefined();
  });

  it('allows saving over an invalid old-format file without preserving it', () => {
    fs.writeFileSync(tokenFilePath(), JSON.stringify({ webiq: 'old-key' }), 'utf-8');
    expect(() => getResearchApiStatus('webiq')).toThrow('Invalid research API token config schema');

    const status = setResearchApiToken('webiq', 'new-key');

    expect(status).toMatchObject({
      provider: 'webiq',
      hasApiKey: true,
      verified: false,
    });
    expect(getResearchApiToken('webiq')).toBe('new-key');
  });

  it('creates an empty token file for manual inspection when missing', () => {
    const filePath = ensureResearchApiTokenFile();

    expect(filePath).toBe(tokenFilePath());
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual({
      version: 1,
      providers: {},
    });
  });
});
