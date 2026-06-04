/**
 * Regression test for the W1 finding: the FullModeCompressor used to
 * hard-code `o200k_base` as its tiktoken family. Under non-OpenAI
 * providers (Anthropic / Gemini / custom-dynamic) that tokenizer
 * under-counts real tokens, mis-sizing chunks and the
 * summaryPromptTokenBudget calculation.
 *
 * The fix:
 *   - default constructor encoding is now `cl100k_base` (the safer
 *     overestimate matching PROVIDER_TOKENIZER's fallback)
 *   - compressMessages accepts `{ encoding }` so the caller can route the
 *     active provider's tokenizer end-to-end
 *   - TokenCounters are cached per-encoding inside the compressor, so a
 *     single compressor instance shared by all sessions stays cheap across
 *     mixed-provider calls
 *
 * These tests pin the TokenCounter construction calls so any regression
 * that re-hard-codes the encoding will fail loudly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const tokenCounterCtorSpy = vi.hoisted(() => vi.fn());

vi.mock('../../token', async () => {
  const actual = await vi.importActual<typeof import('../../token')>('../../token');
  class SpyTokenCounter {
    constructor(config: any) {
      tokenCounterCtorSpy(config);
    }
    countTextTokens(text: string): number { return Math.ceil((text || '').length / 4); }
    countMessageTokens(): number { return 0; }
    getCacheStats() { return { hits: 0, misses: 0, size: 0, hitRate: 0 }; }
  }
  return { ...actual, TokenCounter: SpyTokenCounter };
});

vi.mock('../../llm/contextCompressionLlmSummarizer', async () => {
  const actual = await vi.importActual<typeof import('../../llm/contextCompressionLlmSummarizer')>('../../llm/contextCompressionLlmSummarizer');
  return {
    ...actual,
    contextCompressionLlmSummarizer: {
      ...actual.contextCompressionLlmSummarizer,
      summarize: vi.fn().mockResolvedValue({ success: true, summary: '<summary>x</summary>', attempts: 1 }),
      buildPrompt: vi.fn((t: string) => t),
      estimateRequestTokens: vi.fn(() => 1000),
      getPromptOverheadTokens: vi.fn(() => 1500),
    },
  };
});

import { FullModeCompressor, createFullModeCompressor } from '../fullModeCompressor';

function tinyHistory() {
  return [
    { id: 'm1', role: 'user' as const, timestamp: 1, content: [{ type: 'text' as const, text: 'hello' }] },
    { id: 'm2', role: 'assistant' as const, timestamp: 2, content: [{ type: 'text' as const, text: 'hi' }] },
  ];
}

describe('FullModeCompressor — tokenizer encoding selection', () => {
  beforeEach(() => {
    tokenCounterCtorSpy.mockClear();
  });

  it('defaults to cl100k_base (the conservative overestimate) when no encoding is supplied', () => {
    new FullModeCompressor();
    expect(tokenCounterCtorSpy).toHaveBeenCalledTimes(1);
    expect(tokenCounterCtorSpy.mock.calls[0][0]).toMatchObject({ encoding: 'cl100k_base', enableCache: true });
  });

  it('honors a constructor-supplied defaultEncoding (Copilot/OpenAI opt-in)', () => {
    createFullModeCompressor(undefined, { defaultEncoding: 'o200k_base' });
    expect(tokenCounterCtorSpy.mock.calls[0][0]).toMatchObject({ encoding: 'o200k_base' });
  });

  it('lazily creates a new TokenCounter when compressMessages is called with a different encoding', async () => {
    const c = new FullModeCompressor({ summaryPromptTokenBudget: 100000 });
    // Constructor pre-created cl100k_base.
    expect(tokenCounterCtorSpy).toHaveBeenCalledTimes(1);

    await c.compressMessages(tinyHistory(), 'model-x', { encoding: 'o200k_base' });
    // Now we should have lazily allocated a second counter for o200k_base.
    const encodings = tokenCounterCtorSpy.mock.calls.map(args => args[0].encoding);
    expect(encodings).toContain('cl100k_base');
    expect(encodings).toContain('o200k_base');
  });

  it('reuses the cached TokenCounter for the same encoding across calls', async () => {
    const c = new FullModeCompressor({ summaryPromptTokenBudget: 100000 });
    tokenCounterCtorSpy.mockClear();

    await c.compressMessages(tinyHistory(), 'model-x', { encoding: 'o200k_base' });
    await c.compressMessages(tinyHistory(), 'model-x', { encoding: 'o200k_base' });
    await c.compressMessages(tinyHistory(), 'model-y', { encoding: 'o200k_base' });
    // Only one *new* TokenCounter for o200k_base, regardless of how many calls.
    const o200Ctors = tokenCounterCtorSpy.mock.calls.filter(c => c[0].encoding === 'o200k_base');
    expect(o200Ctors).toHaveLength(1);
  });

  it('falls back to the compressor default when compressMessages omits options', async () => {
    const c = new FullModeCompressor({ summaryPromptTokenBudget: 100000 });
    tokenCounterCtorSpy.mockClear();

    await c.compressMessages(tinyHistory(), 'model-x');
    // No new TokenCounter was needed — the default was pre-created at construction.
    expect(tokenCounterCtorSpy).toHaveBeenCalledTimes(0);
  });
});
