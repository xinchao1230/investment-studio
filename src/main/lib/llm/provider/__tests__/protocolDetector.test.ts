// src/main/lib/llm/provider/__tests__/protocolDetector.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../unifiedLogger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { detectProtocol, normalizeBaseUrl } from '../protocolDetector';

describe('normalizeBaseUrl', () => {
  it('adds /v1 to the canonical OpenAI host when missing', () => {
    expect(normalizeBaseUrl('https://api.openai.com', 'openai')).toBe('https://api.openai.com/v1');
  });

  it('respects an explicit OpenAI path verbatim', () => {
    expect(normalizeBaseUrl('https://gw.example.com/openai/v1', 'openai')).toBe('https://gw.example.com/openai/v1');
  });

  it('strips a trailing /v1 for anthropic (SDK re-adds it)', () => {
    expect(normalizeBaseUrl('https://proxy.example.com/v1/', 'anthropic')).toBe('https://proxy.example.com');
  });

  it('strips a trailing /v1beta for gemini (SDK re-adds it)', () => {
    expect(normalizeBaseUrl('https://proxy.example.com/v1beta', 'gemini')).toBe('https://proxy.example.com');
  });
});

describe('detectProtocol', () => {
  const KEY = 'sk-test';
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
  const notFound = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) } as Response);
  const unauthorized = () => Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({}) } as Response);

  it('rejects a non-http URL without probing', async () => {
    const r = await detectProtocol('ftp://x', KEY);
    expect(r.protocol).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('detects OpenAI from a { data: [{id}] } listing', async () => {
    fetchSpy.mockReturnValueOnce(ok({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4.1' }] }));
    const r = await detectProtocol('https://api.openai.com', KEY);
    expect(r.protocol).toBe('openai');
    expect(r.protocol && r.normalizedBaseUrl).toBe('https://api.openai.com/v1');
    expect(r.protocol && r.sampleModels).toContain('gpt-4o');
  });

  it('detects Anthropic when OpenAI probe 404s but anthropic lists models', async () => {
    // Default order is [openai, anthropic, gemini]; openai 404s, anthropic matches.
    fetchSpy
      .mockReturnValueOnce(notFound())
      .mockReturnValueOnce(ok({ data: [{ id: 'claude-sonnet-4' }] }));
    const r = await detectProtocol('https://my-proxy.example.com', KEY);
    expect(r.protocol).toBe('anthropic');
    expect(r.protocol && r.normalizedBaseUrl).toBe('https://my-proxy.example.com');
  });

  it('detects Gemini from a { models: [{name}] } listing and strips the models/ prefix', async () => {
    fetchSpy
      .mockReturnValueOnce(notFound())   // openai
      .mockReturnValueOnce(notFound())   // anthropic
      .mockReturnValueOnce(ok({ models: [{ name: 'models/gemini-2.5-pro' }] }));
    const r = await detectProtocol('https://host.example.com', KEY);
    expect(r.protocol).toBe('gemini');
    expect(r.protocol && r.sampleModels).toContain('gemini-2.5-pro');
  });

  it('prioritizes anthropic when the host name hints it', async () => {
    fetchSpy.mockReturnValueOnce(ok({ data: [{ id: 'claude-opus-4' }] }));
    const r = await detectProtocol('https://api.anthropic.com', KEY);
    expect(r.protocol).toBe('anthropic');
    // First (and only) call should target the anthropic /v1/models endpoint.
    expect(fetchSpy.mock.calls[0][0]).toContain('/v1/models');
  });

  it('reports an auth failure rather than "no protocol" when a probe 401s', async () => {
    fetchSpy
      .mockReturnValueOnce(unauthorized()) // openai 401
      .mockReturnValueOnce(notFound())     // anthropic
      .mockReturnValueOnce(notFound());    // gemini
    const r = await detectProtocol('https://host.example.com', KEY);
    expect(r.protocol).toBeNull();
    expect(r.protocol === null && r.error).toMatch(/api key/i);
  });

  it('returns a clear failure when nothing matches', async () => {
    fetchSpy.mockReturnValue(notFound());
    const r = await detectProtocol('https://host.example.com', KEY);
    expect(r.protocol).toBeNull();
    expect(r.protocol === null && r.error).toMatch(/could not detect/i);
  });
});
