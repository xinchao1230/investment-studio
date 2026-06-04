/**
 * Regression: verify that SubAgentContextCompactor compression LLM calls use
 * the sub-agent's runtime inheritedModel (= the user's selected provider/model)
 * rather than a hardcoded model name.
 *
 * History: prior to this regression, both compressToolResult and
 * compressEarlyMessages pinned 'claude-haiku-4.5'. Under non-Copilot providers
 * ghcModelApi.callModel would silently remap that through providerManager —
 * either to the user's main expensive model (wasteful) or to a small local
 * model that can't follow structured summarization prompts (returns empty →
 * triggers fallback truncation → degrades context). Both outcomes violated
 * the design principle "all LLM calls must honor the user's chosen model".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from '@shared/types/chatTypes';

const { callModelSpy } = vi.hoisted(() => ({ callModelSpy: vi.fn() }));

vi.mock('../../llm/ghcModelApi', () => ({
  ghcModelApi: { callModel: callModelSpy, callModelStrict: callModelSpy },
}));

vi.mock('../../unifiedLogger', async () => {
  const actual = await vi.importActual('../../unifiedLogger') as any;
  return {
    ...actual,
    createConsoleLogger: async () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

vi.mock('../../token/TokenCounter', () => ({
  TokenCounter: class {
    countTextTokens() { return 100; }
    countMessageTokens() { return 100; }
  },
}));

import { SubAgentContextCompactor } from '../subAgentContextCompactor';
import type { SubAgentChatOptions } from '../types';
import { TokenCounter } from '../../token/TokenCounter';

function makeOptions(overrides: Partial<{ inheritedModel: string }> = {}): SubAgentChatOptions {
  return {
    subAgent: {
      config: {
        name: 'test-subagent',
        description: 'test',
      } as any,
      inheritedModel: overrides.inheritedModel ?? 'parent-selected-model',
      parentChatId: 'parent-1',
      parentSessionId: 'session-1',
      userAlias: 'tester',
      resolvedMcpServers: [],
      resolvedSkills: [],
      taskId: 'task-1',
    },
    task: 'do a thing',
    cancellationToken: { isCancellationRequested: false } as any,
    currentUserAlias: 'tester',
  };
}

function buildCompactor(options?: SubAgentChatOptions) {
  return new SubAgentContextCompactor(
    [],
    options ?? makeOptions(),
    128_000,
    new TokenCounter({ enableCache: true } as any),
  );
}

describe('SubAgentContextCompactor — model routing (regression)', () => {
  beforeEach(() => {
    callModelSpy.mockReset();
  });

  describe('compressToolResult', () => {
    it("uses the sub-agent's inheritedModel (no hardcoded 'claude-haiku-4.5')", async () => {
      callModelSpy.mockResolvedValueOnce('compressed summary text');

      const compactor = buildCompactor(makeOptions({ inheritedModel: 'user-picked-llm-v9' }));
      const largeContent = 'a'.repeat(20_000);

      await compactor.compressToolResult(largeContent, 'web_search', largeContent.length);

      expect(callModelSpy).toHaveBeenCalledTimes(1);
      const [model] = callModelSpy.mock.calls[0];
      expect(model).toBe('user-picked-llm-v9');
      expect(model).not.toBe('claude-haiku-4.5');
    });

    it("falls back to truncation when inheritedModel is empty (no hidden LLM fallback)", async () => {
      const compactor = buildCompactor(makeOptions({ inheritedModel: '' }));
      const largeContent = 'a'.repeat(20_000);

      const result = await compactor.compressToolResult(largeContent, 'web_search', largeContent.length);

      expect(callModelSpy).not.toHaveBeenCalled();
      expect(result.length).toBeLessThan(largeContent.length + 200);
    });

    it("falls back to truncation when inheritedModel is whitespace-only", async () => {
      const compactor = buildCompactor(makeOptions({ inheritedModel: '   ' }));
      const largeContent = 'a'.repeat(20_000);

      await compactor.compressToolResult(largeContent, 'web_search', largeContent.length);

      expect(callModelSpy).not.toHaveBeenCalled();
    });
  });

  describe('compressEarlyMessages (Phase 0)', () => {
    function buildContextHistory(count: number): Message[] {
      const out: Message[] = [];
      for (let i = 0; i < count; i++) {
        out.push({
          id: `m${i}`,
          role: (i % 2 === 0 ? 'user' : 'assistant') as any,
          timestamp: Date.now(),
          content: [{ type: 'text', text: `Turn ${i} message content` }] as any,
        } as Message);
      }
      return out;
    }

    it("uses the sub-agent's inheritedModel for Phase 0 distillation", async () => {
      callModelSpy.mockResolvedValueOnce('chunk summary v1');

      const options = makeOptions({ inheritedModel: 'phase0-routing-model' });
      const compactor = new SubAgentContextCompactor(
        buildContextHistory(25),
        options,
        128_000,
        new TokenCounter({ enableCache: true } as any),
      );

      await compactor.compactContextIfNeeded([], []);

      expect(callModelSpy).toHaveBeenCalled();
      const [model] = callModelSpy.mock.calls[0];
      expect(model).toBe('phase0-routing-model');
      expect(model).not.toBe('claude-haiku-4.5');
    });

    it("skips LLM Phase 0 distillation when inheritedModel is empty", async () => {
      const options = makeOptions({ inheritedModel: '' });
      const compactor = new SubAgentContextCompactor(
        buildContextHistory(25),
        options,
        128_000,
        new TokenCounter({ enableCache: true } as any),
      );

      await compactor.compactContextIfNeeded([], []);

      expect(callModelSpy).not.toHaveBeenCalled();
    });
  });
});
