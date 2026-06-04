/**
 * Unit tests for the Web IQ HTTP client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { mapLocaleToWebIQ, searchWebIQ, WEB_IQ_ENDPOINT } from '../webIQSearchClient';

const successPayload = {
  webResults: [
    {
      title: 'Result one',
      url: 'https://example.com/a',
      content: 'A '.repeat(2000),
      crawledAt: '2026-06-04T00:00:00.0000000Z',
      language: 'en',
      isAdult: false,
    },
    {
      title: 'Result two',
      url: 'https://other.example.com/b?q=1',
      content: 'Short content',
      crawledAt: '2026-06-04T00:00:00.0000000Z',
      language: 'en',
      isAdult: false,
    },
  ],
  traceId: 'trace-abc',
};

function makeFetchOk(payload: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(payload),
  }) as unknown as typeof fetch;
}

function makeFetchErr(status: number, body: any): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: vi.fn().mockResolvedValue(body),
  }) as unknown as typeof fetch;
}

describe('mapLocaleToWebIQ', () => {
  it('uses defaults when args are missing', () => {
    expect(mapLocaleToWebIQ(undefined, undefined)).toEqual({ language: 'en', region: 'US' });
  });
  it('normalises case (language lower, region upper)', () => {
    expect(mapLocaleToWebIQ('EN', 'us')).toEqual({ language: 'en', region: 'US' });
    expect(mapLocaleToWebIQ('zh', 'cn')).toEqual({ language: 'zh', region: 'CN' });
  });
});

describe('searchWebIQ — happy path', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('POSTs to the documented endpoint with x-apikey + body', async () => {
    const f = makeFetchOk(successPayload);
    global.fetch = f;

    const out = await searchWebIQ('key-xyz', {
      query: 'hello world',
      maxResults: 5,
      language: 'en',
      region: 'US',
      contentFormat: 'text',
      maxLength: 1500,
    }, { timeoutMs: 1000 });

    expect(out.error).toBeNull();
    expect(out.query).toBe('hello world');
    expect(out.results).toHaveLength(2);

    const [call] = (f as any).mock.calls;
    expect(call[0]).toBe(WEB_IQ_ENDPOINT);
    expect(call[1].method).toBe('POST');
    expect(call[1].headers['x-apikey']).toBe('key-xyz');
    expect(call[1].headers['content-type']).toBe('application/json');
    const body = JSON.parse(call[1].body);
    expect(body).toMatchObject({
      query: 'hello world',
      maxResults: 5,
      language: 'en',
      region: 'US',
      contentFormat: 'text',
      maxLength: 1500,
    });
  });

  it('clamps content to maxLength', async () => {
    global.fetch = makeFetchOk(successPayload);
    const out = await searchWebIQ('k', {
      query: 'q',
      maxResults: 5,
      language: 'en',
      region: 'US',
      contentFormat: 'text',
      maxLength: 100,
    }, { timeoutMs: 1000 });
    expect(out.results[0].caption.length).toBeLessThanOrEqual(100);
  });

  it('extracts domain into the site field', async () => {
    global.fetch = makeFetchOk(successPayload);
    const out = await searchWebIQ('k', {
      query: 'q', maxResults: 5, language: 'en', region: 'US',
      contentFormat: 'text', maxLength: 1500,
    }, { timeoutMs: 1000 });
    expect(out.results[0].site).toBe('example.com');
    expect(out.results[1].site).toBe('other.example.com');
  });

  it('respects maxResults when API returns more', async () => {
    global.fetch = makeFetchOk(successPayload);
    const out = await searchWebIQ('k', {
      query: 'q', maxResults: 1, language: 'en', region: 'US',
      contentFormat: 'text', maxLength: 1500,
    }, { timeoutMs: 1000 });
    expect(out.results).toHaveLength(1);
    expect(out.results[0].index).toBe(1);
  });

  it('tolerates missing webResults', async () => {
    global.fetch = makeFetchOk({ traceId: 'x' });
    const out = await searchWebIQ('k', {
      query: 'q', maxResults: 5, language: 'en', region: 'US',
      contentFormat: 'text', maxLength: 1500,
    }, { timeoutMs: 1000 });
    expect(out.error).toBeNull();
    expect(out.results).toHaveLength(0);
  });
});

describe('searchWebIQ — error path', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('returns Web IQ userMessage on HTTP non-2xx', async () => {
    global.fetch = makeFetchErr(401, {
      errorCode: 'AuthTokenParse',
      userMessage: 'Invalid authentication token.',
    });
    const out = await searchWebIQ('bad', {
      query: 'q', maxResults: 5, language: 'en', region: 'US',
      contentFormat: 'text', maxLength: 1500,
    }, { timeoutMs: 1000 });
    expect(out.results).toHaveLength(0);
    expect(out.error).toContain('Invalid authentication token');
  });

  it('returns errorCode when userMessage missing', async () => {
    global.fetch = makeFetchErr(500, { errorCode: 'ServerBoom' });
    const out = await searchWebIQ('k', {
      query: 'q', maxResults: 5, language: 'en', region: 'US',
      contentFormat: 'text', maxLength: 1500,
    }, { timeoutMs: 1000 });
    expect(out.error).toContain('ServerBoom');
  });

  it('falls back to "HTTP <status>" when body unparseable', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockRejectedValue(new Error('not json')),
    }) as unknown as typeof fetch;
    const out = await searchWebIQ('k', {
      query: 'q', maxResults: 5, language: 'en', region: 'US',
      contentFormat: 'text', maxLength: 1500,
    }, { timeoutMs: 1000 });
    expect(out.error).toContain('HTTP 503');
  });

  it('returns network error from fetch rejection', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('econnreset')) as unknown as typeof fetch;
    const out = await searchWebIQ('k', {
      query: 'q', maxResults: 5, language: 'en', region: 'US',
      contentFormat: 'text', maxLength: 1500,
    }, { timeoutMs: 1000 });
    expect(out.error).toContain('econnreset');
  });
});

describe('searchWebIQ — cancellation', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = global.fetch; });
  afterEach(() => { global.fetch = originalFetch; });

  it('short-circuits when external signal is already aborted', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const ctrl = new AbortController();
    ctrl.abort();
    const out = await searchWebIQ('k', {
      query: 'q', maxResults: 5, language: 'en', region: 'US',
      contentFormat: 'text', maxLength: 1500,
    }, { timeoutMs: 1000, signal: ctrl.signal });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(out.error).toMatch(/aborted/i);
  });

  it('reports "aborted by caller" when signal fires mid-request', async () => {
    global.fetch = vi.fn().mockImplementation((_url: any, init: any) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 5);
    const out = await searchWebIQ('k', {
      query: 'q', maxResults: 5, language: 'en', region: 'US',
      contentFormat: 'text', maxLength: 1500,
    }, { timeoutMs: 5000, signal: ctrl.signal });
    expect(out.error).toMatch(/aborted by caller/);
  });

  it('reports timeout when request exceeds timeoutMs', async () => {
    global.fetch = vi.fn().mockImplementation((_url: any, init: any) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
    const out = await searchWebIQ('k', {
      query: 'q', maxResults: 5, language: 'en', region: 'US',
      contentFormat: 'text', maxLength: 1500,
    }, { timeoutMs: 5 });
    expect(out.error).toMatch(/timed out/);
  });
});
