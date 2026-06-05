// src/main/lib/llm/provider/__tests__/customDynamicProvider.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../unifiedLogger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { CustomDynamicProvider } from '../customDynamicProvider';

describe('CustomDynamicProvider', () => {
  let provider: CustomDynamicProvider;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new CustomDynamicProvider();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

  describe('info', () => {
    it('identifies as custom-dynamic and requires an API key', () => {
      expect(provider.info.id).toBe('custom-dynamic');
      expect(provider.info.requiresApiKey).toBe(true);
      expect(provider.info.requiresGitHubAuth).toBe(false);
    });
  });

  describe('configure', () => {
    it('defaults to the openai protocol when detectedProtocol is unset (legacy)', () => {
      provider.configure({ enabled: true, apiKey: 'k', baseUrl: 'https://x/v1' });
      expect(provider.getDetectedProtocol()).toBe('openai');
    });

    it('honors a persisted detectedProtocol verdict', () => {
      provider.configure({ enabled: true, apiKey: 'k', baseUrl: 'https://x', detectedProtocol: 'anthropic' });
      expect(provider.getDetectedProtocol()).toBe('anthropic');
    });
  });

  describe('detect', () => {
    it('resolves the protocol, applies it, and invokes the persist callback', async () => {
      const persist = vi.fn();
      const p = new CustomDynamicProvider(persist);
      p.configure({ enabled: true, apiKey: 'k', baseUrl: 'https://api.openai.com' });

      fetchSpy.mockReturnValueOnce(ok({ data: [{ id: 'gpt-4o' }] }));
      const r = await p.detect();

      expect(r.protocol).toBe('openai');
      expect(p.getDetectedProtocol()).toBe('openai');
      expect(persist).toHaveBeenCalledWith('openai');
    });
  });

  describe('testConnection', () => {
    it('fails fast without an endpoint URL', async () => {
      provider.configure({ enabled: true, apiKey: 'k' });
      const r = await provider.testConnection();
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/endpoint/i);
    });

    it('returns success with model metadata on a clean detection', async () => {
      provider.configure({ enabled: true, apiKey: 'k', baseUrl: 'https://api.openai.com' });
      fetchSpy.mockReturnValueOnce(ok({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4.1' }] }));
      const r = await provider.testConnection();
      expect(r.success).toBe(true);
      expect(r.models).toEqual(['gpt-4o', 'gpt-4.1']);
      expect(r.rawModels).toEqual([{ id: 'gpt-4o' }, { id: 'gpt-4.1' }]);
    });
  });

  describe('self-heal decision (shouldSelfHeal)', () => {
    // Access the private predicate via an index cast — we want to assert the exact
    // allowlist boundaries because over-triggering wastes a real chat turn.
    const should = (err: unknown) => (provider as unknown as { shouldSelfHeal(e: unknown): boolean }).shouldSelfHeal(err);

    it('re-detects on 404 / 405 (wrong endpoint shape)', () => {
      expect(should({ status: 404 })).toBe(true);
      expect(should({ status: 405 })).toBe(true);
      expect(should(new Error('404 Not Found'))).toBe(true);
      expect(should(new Error('messages: required'))).toBe(true);
    });

    it('does NOT re-detect on auth / rate-limit / server / network errors', () => {
      expect(should({ status: 401 })).toBe(false);
      expect(should({ status: 403 })).toBe(false);
      expect(should({ status: 429 })).toBe(false);
      expect(should({ status: 500 })).toBe(false);
      expect(should(new Error('Rate limit exceeded'))).toBe(false);
      expect(should(new Error('connect ECONNREFUSED'))).toBe(false);
      expect(should(new Error('TimeoutError: timeout'))).toBe(false);
    });
  });

  describe('listModels', () => {
    it('rebrands inner-engine models under the custom-dynamic identity', async () => {
      provider.configure({ enabled: true, apiKey: 'k', baseUrl: 'https://api.openai.com/v1' });
      fetchSpy.mockReturnValueOnce(ok({ data: [{ id: 'gpt-4o' }] }));
      const models = await provider.listModels();
      expect(models.length).toBeGreaterThan(0);
      expect(models.every(m => m.providerId === 'custom-dynamic')).toBe(true);
    });
  });

  describe('cache invalidation on endpoint change', () => {
    // These guard the defense-in-depth purge: each inner engine already clears
    // its own cache on configure(), so the ACTIVE engine is always fresh. The
    // router-level dispose-all matters for the SIBLING engines, so no prior
    // endpoint's models can resurface if a later protocol flip routes back to
    // one of them. (The user-visible stale-list regression is fixed upstream in
    // ProviderManager by clearing the stale detectedProtocol — see its test.)
    it('purges the cached model list when the endpoint is reconfigured', async () => {
      // 1. Configure endpoint A (OpenAI box) and warm its model cache.
      provider.configure({ enabled: true, apiKey: 'k1', baseUrl: 'https://box-a/v1' });
      fetchSpy.mockReturnValueOnce(ok({ data: [{ id: 'box-a-model' }] }));
      const first = await provider.listModels();
      expect(first.map(m => m.id)).toContain('box-a-model');
      // Cached synchronously now.
      expect(provider.getCachedModels().map(m => m.id)).toContain('box-a-model');

      // 2. Change ONLY the endpoint/key (same protocol). The old cache must NOT
      //    survive — this is the research-dropdown stale-list bug.
      provider.configure({ enabled: true, apiKey: 'k2', baseUrl: 'https://box-b/v1' });
      expect(provider.getCachedModels()).toEqual([]);

      // 3. The next fetch reflects endpoint B, never box-a-model.
      fetchSpy.mockReturnValueOnce(ok({ data: [{ id: 'box-b-model' }] }));
      const second = await provider.listModels();
      expect(second.map(m => m.id)).toContain('box-b-model');
      expect(second.map(m => m.id)).not.toContain('box-a-model');
    });

    it('purges sibling-engine caches when detection flips the protocol', async () => {
      // 1. Endpoint resolves to OpenAI; warm that engine's cache.
      provider.configure({ enabled: true, apiKey: 'k', baseUrl: 'https://box/v1', detectedProtocol: 'openai' });
      fetchSpy.mockReturnValueOnce(ok({ data: [{ id: 'old-openai-model' }] }));
      await provider.listModels();
      expect(provider.getCachedModels().map(m => m.id)).toContain('old-openai-model');

      // 2. Re-detect; the box now answers the Anthropic listing, not the OpenAI
      //    one. The detector probes OpenAI first (404 → miss), then Anthropic
      //    (hit). The OpenAI engine's stale cache must be gone afterwards.
      const notFound = { ok: false, status: 404, json: () => Promise.resolve({}) } as Response;
      fetchSpy.mockReturnValueOnce(Promise.resolve(notFound));          // openai probe miss
      fetchSpy.mockReturnValueOnce(ok({ data: [{ id: 'claude-sonnet-4.6' }] })); // anthropic probe hit
      const r = await provider.detect();
      expect(r.protocol).toBe('anthropic');
      // Active engine is Anthropic now; nothing from the OpenAI box lingers.
      expect(provider.getCachedModels().map(m => m.id)).not.toContain('old-openai-model');
    });
  });
});
