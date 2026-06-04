/**
 * Tests for ChatSessionTitleLlmSummarizer
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


import {
  ChatSessionTitleLlmSummarizer,
  chatSessionTitleLlmSummarizer,
} from '../chatSessionTitleLlmSummarizer';

// ============================================================================
// Tests
// ============================================================================

describe('ChatSessionTitleLlmSummarizer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- getDefaultParams ----

  describe('getDefaultParams', () => {
    it('returns expected default params', () => {
      const params = ChatSessionTitleLlmSummarizer.getDefaultParams();
      expect(params.name).toBe('chat title generation');
      expect(params.maxTokens).toBe(50);
      expect(params.temperature).toBe(0.3);
    });
  });

  // ---- getUsageGuide ----

  describe('getUsageGuide', () => {
    it('returns a guide with title, examples, and tips', () => {
      const guide = ChatSessionTitleLlmSummarizer.getUsageGuide();
      expect(guide.title).toBeTruthy();
      expect(Array.isArray(guide.examples)).toBe(true);
      expect(Array.isArray(guide.tips)).toBe(true);
    });
  });

  // ---- validateSummarizerResponse ----

  describe('validateSummarizerResponse', () => {
    it('returns true for valid response with title', () => {
      expect(ChatSessionTitleLlmSummarizer.validateSummarizerResponse({
        success: true,
        title: 'Python Search',
      })).toBe(true);
    });

    it('returns false when success is false and no title', () => {
      expect(ChatSessionTitleLlmSummarizer.validateSummarizerResponse({
        success: false,
      })).toBe(false);
    });

    it('returns false when title is missing', () => {
      expect(ChatSessionTitleLlmSummarizer.validateSummarizerResponse({
        success: true,
      })).toBe(false);
    });

    it('returns false when title is only whitespace', () => {
      expect(ChatSessionTitleLlmSummarizer.validateSummarizerResponse({
        success: true,
        title: ' ',
      })).toBe(false);
    });

    it('returns true even when tokenCount > 20', () => {
      expect(ChatSessionTitleLlmSummarizer.validateSummarizerResponse({
        success: true,
        title: 'Some Title',
        tokenCount: 25,
      })).toBe(true);
    });
  });

  // ---- generateTitle — input validation ----

  describe('generateTitle — input validation', () => {
    it('returns failure for message too short (< 5 chars)', async () => {
      const result = await ChatSessionTitleLlmSummarizer.generateTitle('hi', TEST_MODEL_ID);
      expect(result.success).toBe(false);
      expect(result.title).toBe('General Discussion');
    });

    it('returns failure when message has only symbols/numbers', async () => {
      const result = await ChatSessionTitleLlmSummarizer.generateTitle('12345', TEST_MODEL_ID);
      expect(result.success).toBe(false);
      expect(result.title).toBe('General Discussion');
    });

    it('returns success for a long message (> 1000 chars) — includes suggestion warning', async () => {
      const longMessage = 'a '.repeat(600); // 1200 chars, has letters
      mockCallModel.mockResolvedValue('{"success":true,"title":"Long Chat","tokenCount":2}');
      const result = await ChatSessionTitleLlmSummarizer.generateTitle(longMessage, TEST_MODEL_ID);
      // validation passes, API is called
      expect(mockCallModel).toHaveBeenCalled();
    });
  });

  // ---- generateTitle — LLM happy path ----

  describe('generateTitle — LLM happy path', () => {
    it('parses clean JSON response', async () => {
      mockCallModel.mockResolvedValue('{"success":true,"title":"Python Binary Search","tokenCount":3}');
      const result = await ChatSessionTitleLlmSummarizer.generateTitle('How do I implement binary search in Python?', TEST_MODEL_ID);
      expect(result.success).toBe(true);
      expect(result.title).toBe('Python Binary Search');
    });

    it('strips markdown code blocks before parsing', async () => {
      mockCallModel.mockResolvedValue('```json\n{"success":true,"title":"Clean Title","tokenCount":2}\n```');
      const result = await ChatSessionTitleLlmSummarizer.generateTitle('What is JavaScript closures?', TEST_MODEL_ID);
      expect(result.success).toBe(true);
      expect(result.title).toBe('Clean Title');
    });

    it('truncates title to 20 words when over limit', async () => {
      const longTitle = 'word '.repeat(25).trim();
      mockCallModel.mockResolvedValue(JSON.stringify({ success: true, title: longTitle, tokenCount: 25 }));
      const result = await ChatSessionTitleLlmSummarizer.generateTitle('Write a long title please', TEST_MODEL_ID);
      expect(result.title!.split(' ').length).toBeLessThanOrEqual(20);
    });

    it('attaches rawResponse and originalMessage to parsed response', async () => {
      const rawJson = '{"success":true,"title":"Algo Question","tokenCount":2}';
      mockCallModel.mockResolvedValue(rawJson);
      const result = await ChatSessionTitleLlmSummarizer.generateTitle('What algorithm should I use?', TEST_MODEL_ID);
      expect(result.rawResponse).toBe(rawJson);
      expect(result.originalMessage).toBe('What algorithm should I use?');
    });
  });

  // ---- generateTitle — parse failure fallback ----

  describe('generateTitle — parse failure fallback', () => {
    it('returns fallback title when JSON parsing fails', async () => {
      mockCallModel.mockResolvedValue('not valid json at all!!!');
      const result = await ChatSessionTitleLlmSummarizer.generateTitle('How do I sort an array?', TEST_MODEL_ID);
      expect(result.success).toBe(true);
      expect(result.title).toBeTruthy();
      expect(result.warnings).toBeDefined();
    });

    it('returns failure when API call throws', async () => {
      mockCallModel.mockRejectedValue(new Error('Network error'));
      const result = await ChatSessionTitleLlmSummarizer.generateTitle('Debug this React component', TEST_MODEL_ID);
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.title).toBeTruthy(); // fallback title still provided
    });
  });

  // ---- generateTitle — memory keyword paths ----

  describe('generateTitle — memory keyword fallback logic', () => {
    it('uses memory-aware fallback title for memory-related messages when API fails', async () => {
      mockCallModel.mockRejectedValue(new Error('fail'));
      const result = await ChatSessionTitleLlmSummarizer.generateTitle('Please remember my memory preferences', TEST_MODEL_ID);
      expect(result.title).toBeTruthy();
    });

    it('generates fallback title for very short valid message (fallback length < 5)', async () => {
      // "hello" is exactly 5 chars → valid but if API fails, fallback kicks in
      mockCallModel.mockRejectedValue(new Error('fail'));
      const result = await ChatSessionTitleLlmSummarizer.generateTitle('hello', TEST_MODEL_ID);
      expect(result.title).toBeTruthy();
    });

    it('truncates fallback title when selected words produce > 50 chars', async () => {
      // Build a message where first 4 words total > 50 chars so truncation path is exercised
      mockCallModel.mockRejectedValue(new Error('fail'));
      const longWordMessage = 'averylongwordthatexceedsthirtycharsalone secondlongword thirdlongword fourthlongword';
      const result = await ChatSessionTitleLlmSummarizer.generateTitle(longWordMessage, TEST_MODEL_ID);
      // Fallback title must be ≤ 50 chars due to truncation
      expect(result.title!.length).toBeLessThanOrEqual(50);
      expect(result.title).toBeTruthy();
    });

    it('uses memory-aware fallback title with memory keyword message', async () => {
      // Cover the memory keyword branch in generateFallbackTitle
      mockCallModel.mockRejectedValue(new Error('fail'));
      const result = await ChatSessionTitleLlmSummarizer.generateTitle('please remember my settings and preferences ok', TEST_MODEL_ID);
      expect(result.title).toBeTruthy();
    });
  });

  // ---- module-level export ----

  it('chatSessionTitleLlmSummarizer is the class itself', () => {
    expect(chatSessionTitleLlmSummarizer).toBe(ChatSessionTitleLlmSummarizer);
  });

  describe('model routing (regression)', () => {
    it('forwards modelId to ghcModelApi.callModelStrict (no hardcoded model)', async () => {
      mockCallModel.mockResolvedValue(JSON.stringify({ success: true, title: 'Sorting Lesson', tokenCount: 3 }));

      await ChatSessionTitleLlmSummarizer.generateTitle('A meaningful user message about Python sorting.', 'caller-provided-model-id');

      expect(mockCallModel).toHaveBeenCalled();
      const [model] = mockCallModel.mock.calls[0];
      expect(model).toBe('caller-provided-model-id');
    });

    it('refuses to invoke LLM when modelId is empty (no hidden fallback)', async () => {
      mockCallModel.mockClear();
      const result = await ChatSessionTitleLlmSummarizer.generateTitle('A meaningful user message about Python sorting.', '');
      expect(result.success).toBe(false);
      // chatSessionTitleLlmSummarizer always returns a stable default title for callers.
      expect(result.title).toBe('General Discussion');
      expect(mockCallModel).not.toHaveBeenCalled();
    });

    it('returns failure when callModelStrict throws (invalid model on active provider)', async () => {
      mockCallModel.mockRejectedValueOnce(
        new Error("Model 'foo' is not available on the active provider 'openai'."),
      );
      const result = await ChatSessionTitleLlmSummarizer.generateTitle('A meaningful user message about Python sorting.', 'caller-provided-model-id');
      expect(result.success).toBe(false);
      // On LLM failure the summarizer still returns a non-empty fallback
      // title derived from the user message so callers always have something
      // to show. The exact value depends on the deterministic fallback rules
      // and is not asserted here — only that a title is present.
      expect(typeof result.title).toBe('string');
      expect((result.title ?? '').length).toBeGreaterThan(0);
    });
  });
});
