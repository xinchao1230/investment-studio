/**
 * Fan-out tests for BingWebSearchTool.executeViaWebIQ (the Web IQ-backed
 * path).
 *
 * The Web IQ client (`searchWebIQ`) is designed to never throw — it
 * funnels every failure mode into a `WebIQSingleSearchOutcome.error`
 * field so the tool can do clean per-query fan-out. These tests cover:
 *
 *   (a) all-success — per-query results aggregate, errors[] is undefined
 *   (b) one-query error — top-level success stays true, the failing query
 *       is surfaced in errors[] with the legacy phrasing
 *   (c) defensive Promise.allSettled.rejected branch — if some future bug
 *       breaks the never-throw contract, fan-out isolation still holds
 *       (other queries' results survive, the rejected one lands in errors[]).
 *
 * Entry point is the public BingWebSearchTool.execute() so we exercise
 * the token-presence branch that routes to executeViaWebIQ.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../unifiedLogger', () => ({
  getUnifiedLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const searchWebIQMock = vi.hoisted(() => vi.fn());
vi.mock('../webIQSearchClient', async () => {
  // Keep the real `mapLocaleToWebIQ` so the locale defaulting still runs.
  const actual = await vi.importActual<typeof import('../webIQSearchClient')>('../webIQSearchClient');
  return { ...actual, searchWebIQ: searchWebIQMock };
});

const getResearchApiTokenMock = vi.hoisted(() => vi.fn());
vi.mock('../../../researchApi/tokenStorage', () => ({
  getResearchApiToken: getResearchApiTokenMock,
}));

// Defensive: ensure that even if a code path slips through, the
// Playwright fallback can't actually launch a browser in unit tests.
vi.mock('../../../playwright', () => ({
  PlaywrightManager: {
    getInstance: () => ({
      ensureBrowserInstalled: vi.fn().mockResolvedValue({ installed: false, error: 'mocked out' }),
    }),
  },
}));

import { BingWebSearchTool, type BingWebSearchToolArgs } from '../bingWebSearchTool';

const baseArgs: BingWebSearchToolArgs = {
  description: 'test search',
  queries: ['alpha', 'beta', 'gamma'],
  maxResults: 5,
  lang: 'en',
  locale: 'us',
};

describe('BingWebSearchTool.executeViaWebIQ — fan-out semantics', () => {
  beforeEach(() => {
    searchWebIQMock.mockReset();
    getResearchApiTokenMock.mockReset();
    getResearchApiTokenMock.mockReturnValue('test-webiq-key');
  });

  it('(a) all-success: aggregates per-query results, omits errors[]', async () => {
    searchWebIQMock.mockImplementation(async (_key: string, params: { query: string }) => ({
      query: params.query,
      results: [
        { title: `${params.query}#1`, url: `https://x/${params.query}/1`, snippet: 's1', index: 1, query: params.query },
        { title: `${params.query}#2`, url: `https://x/${params.query}/2`, snippet: 's2', index: 2, query: params.query },
      ],
      error: null,
    }));

    const out = await BingWebSearchTool.execute(baseArgs);

    expect(out.success).toBe(true);
    expect(out.totalQueries).toBe(3);
    expect(out.totalResults).toBe(6);
    expect(out.errors).toBeUndefined();
    // Results from all three queries should be present, in fan-out order.
    expect(out.results.map(r => r.query)).toEqual(['alpha', 'alpha', 'beta', 'beta', 'gamma', 'gamma']);
    // searchWebIQ was called once per query with our API key.
    expect(searchWebIQMock).toHaveBeenCalledTimes(3);
    expect(searchWebIQMock.mock.calls[0][0]).toBe('test-webiq-key');
  });

  it('(b) one-query soft error: success still true, failing query surfaced in errors[]', async () => {
    searchWebIQMock.mockImplementation(async (_key: string, params: { query: string }) => {
      if (params.query === 'beta') {
        return { query: 'beta', results: [], error: 'rate_limited' };
      }
      return {
        query: params.query,
        results: [{ title: `${params.query}#1`, url: `https://x/${params.query}/1`, snippet: 's', index: 1, query: params.query }],
        error: null,
      };
    });

    const out = await BingWebSearchTool.execute(baseArgs);

    expect(out.success).toBe(true);
    expect(out.totalQueries).toBe(3);
    // alpha + gamma succeeded; beta produced no results.
    expect(out.totalResults).toBe(2);
    expect(out.results.map(r => r.query)).toEqual(['alpha', 'gamma']);
    expect(out.errors).toEqual(['Search query "beta" failed: rate_limited']);
  });

  it('(c) defensive: Promise.allSettled.rejected branch keeps other queries and reports the thrown one', async () => {
    searchWebIQMock.mockImplementation(async (_key: string, params: { query: string }) => {
      // searchWebIQ is contractually never-throw, but this defends against
      // future regressions — the executeViaWebIQ fan-out must still isolate.
      if (params.query === 'beta') {
        throw new Error('boom');
      }
      return {
        query: params.query,
        results: [{ title: `${params.query}#1`, url: `https://x/${params.query}/1`, snippet: 's', index: 1, query: params.query }],
        error: null,
      };
    });

    const out = await BingWebSearchTool.execute(baseArgs);

    expect(out.success).toBe(true);
    expect(out.totalQueries).toBe(3);
    expect(out.totalResults).toBe(2);
    expect(out.results.map(r => r.query)).toEqual(['alpha', 'gamma']);
    expect(out.errors).toEqual(['Search query "beta" failed: boom']);
  });

  it('rejects when no valid queries are provided', async () => {
    const out = await BingWebSearchTool.execute({ ...baseArgs, queries: ['', '   '] });
    expect(out.success).toBe(false);
    expect(out.totalQueries).toBe(0);
    expect(out.errors).toEqual(['No valid queries provided']);
    expect(searchWebIQMock).not.toHaveBeenCalled();
  });
});
