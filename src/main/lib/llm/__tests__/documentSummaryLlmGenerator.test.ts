/**
 * Tests for DocumentSummaryLlmGenerator
 */

// ============================================================================
// Mocks
// ============================================================================

const mockCallModel = vi.fn();

vi.mock('../ghcModelApi', () => ({
  ghcModelApi: {
    callModel: (...args: any[]) => mockCallModel(...args),
    callModelStrict: (...args: any[]) => mockCallModel(...args),
  },
}));

const TEST_MODEL_ID = 'test-model-id';


vi.mock('../../unifiedLogger', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
  getGlobalLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  }),
}));

import {
  DocumentSummaryLlmGenerator,
  documentSummaryLlmGenerator,
} from '../documentSummaryLlmGenerator';

// ============================================================================
// Tests
// ============================================================================

describe('DocumentSummaryLlmGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- generateSummary — input validation ----

  describe('generateSummary — input validation', () => {
    it('returns failure when content is empty', async () => {
      const result = await DocumentSummaryLlmGenerator.generateSummary('doc.txt', '', false, TEST_MODEL_ID);
      expect(result.success).toBe(false);
      expect(result.fileName).toBe('doc.txt');
      expect(result.warnings).toBeDefined();
    });

    it('returns failure when content is only whitespace', async () => {
      const result = await DocumentSummaryLlmGenerator.generateSummary('doc.txt', '   ', false, TEST_MODEL_ID);
      expect(result.success).toBe(false);
    });

    it('returns failure when content is shorter than 20 chars', async () => {
      const result = await DocumentSummaryLlmGenerator.generateSummary('doc.txt', 'short', false, TEST_MODEL_ID);
      expect(result.success).toBe(false);
      expect(result.warnings).toBeDefined();
    });
  });

  // ---- generateSummary — success ----

  describe('generateSummary — success', () => {
    it('returns success with summary on valid response', async () => {
      mockCallModel.mockResolvedValue('This document explains sorting algorithms.');

      const result = await DocumentSummaryLlmGenerator.generateSummary(
        'algorithms.pdf',
        'This is a detailed document about sorting algorithms including quicksort and mergesort.',
        false,
        TEST_MODEL_ID,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toBe('This document explains sorting algorithms.');
      expect(result.fileName).toBe('algorithms.pdf');
    });

    it('passes truncated flag in user prompt', async () => {
      mockCallModel.mockResolvedValue('Summary here.');
      const content = 'A '.repeat(50); // > 20 chars

      await DocumentSummaryLlmGenerator.generateSummary('doc.txt', content, true, TEST_MODEL_ID);
      const promptArg = mockCallModel.mock.calls[0][1];
      expect(promptArg).toContain('truncated');
    });

    it('includes full in user prompt when not truncated', async () => {
      mockCallModel.mockResolvedValue('Summary here.');
      const content = 'A '.repeat(50);

      await DocumentSummaryLlmGenerator.generateSummary('doc.txt', content, false, TEST_MODEL_ID);
      const promptArg = mockCallModel.mock.calls[0][1];
      expect(promptArg).toContain('full');
    });
  });

  // ---- generateSummary — empty LLM response ----

  describe('generateSummary — empty LLM response', () => {
    it('returns failure when LLM returns empty string', async () => {
      mockCallModel.mockResolvedValue('   '); // whitespace → trim → empty
      const content = 'Content long enough to pass validation check at 20 chars';
      const result = await DocumentSummaryLlmGenerator.generateSummary('doc.txt', content, false, TEST_MODEL_ID);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
    });
  });

  // ---- generateSummary — error handling ----

  describe('generateSummary — error handling', () => {
    it('returns failure with error message when API throws', async () => {
      mockCallModel.mockRejectedValue(new Error('Network timeout'));
      const content = 'Content that is long enough for validation to pass here.';
      const result = await DocumentSummaryLlmGenerator.generateSummary('doc.txt', content, false, TEST_MODEL_ID);
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('Network timeout');
    });

    it('handles non-Error thrown value in catch (String branch)', async () => {
      // Covers: error instanceof Error ? ... : String(error) — false branch (line 115)
      mockCallModel.mockRejectedValue('plain string thrown, not an Error');
      const content = 'Content that is long enough for validation to pass here.';
      const result = await DocumentSummaryLlmGenerator.generateSummary('doc.txt', content, false, TEST_MODEL_ID);
      expect(result.success).toBe(false);
      expect(result.errors![0]).toContain('plain string thrown');
    });

    it('logs summary with ellipsis when summary is longer than 150 chars', async () => {
      // Covers: summary.length > 150 ? '...' : '' — true branch
      const longSummary = 'word '.repeat(40).trim(); // > 150 chars
      mockCallModel.mockResolvedValue(longSummary);

      const result = await DocumentSummaryLlmGenerator.generateSummary(
        'long.pdf',
        'Content that is long enough for validation to pass here.',
        false,
        TEST_MODEL_ID,
      );
      expect(result.success).toBe(true);
      expect(result.summary).toBe(longSummary);
    });
  });

  // ---- module-level export ----

  it('documentSummaryLlmGenerator is the class itself', () => {
    expect(documentSummaryLlmGenerator).toBe(DocumentSummaryLlmGenerator);
  });

  describe('model routing (regression)', () => {
    it('forwards modelId to ghcModelApi.callModelStrict (no hardcoded model)', async () => {
      mockCallModel.mockResolvedValue('A clean summary line.');

      await DocumentSummaryLlmGenerator.generateSummary('doc.txt', 'This document is long enough to summarize meaningfully.', false, 'caller-provided-model-id');

      expect(mockCallModel).toHaveBeenCalled();
      const [model] = mockCallModel.mock.calls[0];
      expect(model).toBe('caller-provided-model-id');
    });

    it('refuses to invoke LLM when modelId is empty (no hidden fallback)', async () => {
      mockCallModel.mockClear();
      const result = await DocumentSummaryLlmGenerator.generateSummary('doc.txt', 'This document is long enough to summarize meaningfully.', false, '');
      expect(result.success).toBe(false);
      expect(mockCallModel).not.toHaveBeenCalled();
    });

    it('returns failure when callModelStrict throws (invalid model on active provider)', async () => {
      mockCallModel.mockRejectedValueOnce(
        new Error("Model 'foo' is not available on the active provider 'openai'."),
      );
      const result = await DocumentSummaryLlmGenerator.generateSummary('doc.txt', 'This document is long enough to summarize meaningfully.', false, 'caller-provided-model-id');
      expect(result.success).toBe(false);
    });
  });
});
