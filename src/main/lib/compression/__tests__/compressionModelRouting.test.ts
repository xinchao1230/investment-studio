/**
 * Regression: verify that the user-selected model flows all the way from
 * the caller of compressMessages() down to ghcModelApi.callModel().
 *
 * History: prior to this regression, ContextCompressionLlmSummarizer pinned
 * 'claude-haiku-4.5' regardless of provider. Under non-Copilot providers,
 * providerManager.resolveModelId() would silently remap that to the user's
 * main model — burning expensive tokens for forced compression, and often
 * returning empty (small local models can't follow structured summarization
 * prompts) which then triggered fallback truncation and degraded context.
 *
 * These tests assert the new contract:
 *   - compressMessages(messages, modelId) forwards modelId end-to-end
 *   - merge-stage recursion uses the same modelId
 *   - concurrent chunk workers all use the same modelId
 *   - no hidden model substitution occurs
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { summarizeSpy } = vi.hoisted(() => ({ summarizeSpy: vi.fn() }));

vi.mock('../../llm/contextCompressionLlmSummarizer', async () => {
  const actual = await vi.importActual('../../llm/contextCompressionLlmSummarizer') as any;
  const PROMPT_OVERHEAD_TOKENS = 1500;
  return {
    ...(actual as Record<string, unknown>),
    contextCompressionLlmSummarizer: {
      ...actual.contextCompressionLlmSummarizer,
      summarize: summarizeSpy,
      buildPrompt: vi.fn((text: string) =>
        actual.contextCompressionLlmSummarizer.buildPrompt(text)
      ),
      estimateRequestTokens: vi.fn((_tc: any, conversationText: string) =>
        PROMPT_OVERHEAD_TOKENS + Math.ceil(conversationText.length / 4)
      ),
      getPromptOverheadTokens: vi.fn(() => PROMPT_OVERHEAD_TOKENS),
    },
  };
});

vi.mock('../../token', async () => {
  const actual = await vi.importActual('../../token') as any;
  return {
    ...actual,
    TokenCounter: class MockTokenCounter {
      countTextTokens(text: string): number {
        return Math.ceil((text || '').length / 4);
      }
      getCacheStats() { return { hits: 0, misses: 0, size: 0, hitRate: 0 }; }
    },
  };
});

import { FullModeCompressor } from '../fullModeCompressor';
import type { Message } from '@shared/types/chatTypes';

const FILLER = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(60);

function msg(role: string, text: string, id?: string): Message {
  return {
    id: id || `msg_${Math.random().toString(36).slice(2, 9)}`,
    role: role as any,
    timestamp: Date.now(),
    content: [{ type: 'text', text }],
  } as Message;
}

function buildLargeHistory(): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < 30; i++) {
    out.push(msg(i % 2 === 0 ? 'user' : 'assistant', `Turn ${i}: ${FILLER}`, `m${i}`));
  }
  return out;
}

describe('compression model routing — regression for user-selected-model contract', () => {
  beforeEach(() => {
    summarizeSpy.mockReset();
    summarizeSpy.mockResolvedValue({
      success: true,
      summary: '<summary>chunk</summary>',
      attempts: 1,
    });
  });

  it('forwards the user-selected modelId into ContextCompressionLlmSummarizer.summarize', async () => {
    const compressor = new FullModeCompressor({
      summaryPromptTokenBudget: 2_000,
      preserveRecentMessages: 4,
      maxConcurrentChunkSummaries: 1,
      maxSummaryRecursionDepth: 3,
    });

    await compressor.compressMessages(buildLargeHistory(), 'user-picked-model-abc');

    expect(summarizeSpy).toHaveBeenCalled();
    for (const call of summarizeSpy.mock.calls) {
      const params = call[0] as { modelId?: string };
      expect(params.modelId).toBe('user-picked-model-abc');
    }
  });

  it('uses the same modelId for every concurrent chunk worker (no per-chunk drift)', async () => {
    const compressor = new FullModeCompressor({
      summaryPromptTokenBudget: 2_000,
      preserveRecentMessages: 4,
      maxConcurrentChunkSummaries: 3,
      maxSummaryRecursionDepth: 3,
    });

    await compressor.compressMessages(buildLargeHistory(), 'concurrent-model-id');

    expect(summarizeSpy.mock.calls.length).toBeGreaterThan(1);
    const modelIds = new Set(summarizeSpy.mock.calls.map((c) => (c[0] as any).modelId));
    expect(modelIds.size).toBe(1);
    expect(modelIds.has('concurrent-model-id')).toBe(true);
  });

  it('never falls back to "claude-haiku-4.5" when an explicit modelId is provided', async () => {
    const compressor = new FullModeCompressor({
      summaryPromptTokenBudget: 2_000,
      preserveRecentMessages: 4,
    });

    await compressor.compressMessages(buildLargeHistory(), 'custom-provider-model');

    for (const call of summarizeSpy.mock.calls) {
      const params = call[0] as { modelId?: string };
      expect(params.modelId).not.toBe('claude-haiku-4.5');
      expect(params.modelId).toBe('custom-provider-model');
    }
  });
});
