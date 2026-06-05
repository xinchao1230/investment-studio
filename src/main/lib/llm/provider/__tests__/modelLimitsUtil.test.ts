import { describe, it, expect } from 'vitest';
import { guessModelLimitsById, pickModelLimit, toFinitePositiveNumber } from '../modelLimitsUtil';

describe('toFinitePositiveNumber', () => {
  it('accepts positive numbers', () => {
    expect(toFinitePositiveNumber(128000)).toBe(128000);
  });

  it('accepts positive numeric strings', () => {
    expect(toFinitePositiveNumber('200000')).toBe(200000);
  });

  it('rejects zero, negatives, NaN, non-numeric strings, null/undefined/objects', () => {
    expect(toFinitePositiveNumber(0)).toBeUndefined();
    expect(toFinitePositiveNumber(-5)).toBeUndefined();
    expect(toFinitePositiveNumber('abc')).toBeUndefined();
    expect(toFinitePositiveNumber('')).toBeUndefined();
    expect(toFinitePositiveNumber(null)).toBeUndefined();
    expect(toFinitePositiveNumber(undefined)).toBeUndefined();
    expect(toFinitePositiveNumber({})).toBeUndefined();
    expect(toFinitePositiveNumber(Infinity)).toBeUndefined();
  });
});

describe('pickModelLimit', () => {
  it('returns the first matching top-level key in priority order', () => {
    const result = pickModelLimit(
      { context_length: 64000, context_window: 128000 },
      ['context_window', 'context_length'],
    );
    expect(result).toEqual({ key: 'context_window', value: 128000 });
  });

  it('skips a present-but-invalid key and continues to the next', () => {
    const result = pickModelLimit(
      { context_window: 0, context_length: 64000 },
      ['context_window', 'context_length'],
    );
    expect(result).toEqual({ key: 'context_length', value: 64000 });
  });

  it('resolves dotted nested paths after top-level keys', () => {
    const result = pickModelLimit(
      { top_provider: { context_length: 256000 } },
      ['context_window'],
      ['top_provider.context_length'],
    );
    expect(result).toEqual({ key: 'top_provider.context_length', value: 256000 });
  });

  it('returns undefined when nothing matches', () => {
    expect(pickModelLimit({ id: 'x' }, ['context_window'], ['top_provider.context_length'])).toBeUndefined();
  });

  it('is safe on null / non-object input', () => {
    expect(pickModelLimit(null, ['context_window'])).toBeUndefined();
    expect(pickModelLimit('string', ['context_window'])).toBeUndefined();
    expect(pickModelLimit(undefined, ['context_window'])).toBeUndefined();
  });

  it('does not throw when a nested path traverses a non-object', () => {
    expect(pickModelLimit({ top_provider: 5 }, [], ['top_provider.context_length'])).toBeUndefined();
  });
});

describe('guessModelLimitsById', () => {
  it.each([
    ['gpt-5.5', 1_050_000, 128_000],
    ['gpt-5.4-mini', 400_000, 128_000],
    ['gpt-4.1', 1_047_576, 32_768],
    ['claude-opus-4-8', 1_000_000, 128_000],
    ['claude-sonnet-4-6', 1_000_000, 64_000],
    ['gemini-3.5-flash', 1_048_576, 65_536],
    ['gemini-3.1-flash-live-preview', 131_072, 65_536],
    ['deepseek-v4-pro', 1_000_000, 8_192],
    ['deepseek-reasoner', 64_000, 8_192],
    ['glm-5.1', 200_000, 128_000],
    ['glm-4.5', 128_000, 96_000],
    ['grok-4.3', 1_000_000, 1_000_000],
    ['grok-build-0.1', 256_000, 256_000],
    ['qwen3.5-plus', 1_000_000, 65_536],
    ['qwen3-max', 262_144, 65_536],
    ['qwen3-coder-plus', 1_000_000, 65_536],
    ['Qwen3-Coder-480B-A35B-Instruct', 262_144, 65_536],
    ['qwen-plus', 1_000_000, 32_768],
    ['qwen-max-latest', 131_072, 8_192],
    ['qwen-max', 32_768, 8_192],
    ['qwen-long', 10_000_000, 8_192],
    ['ernie-5.0', 128_000, 65_536],
    ['ernie-4.5-turbo-128k', 128_000, 12_288],
    ['ernie-x1-turbo-128k', 128_000, 4_096],
    ['hunyuan-a13b', 256_000, 32_000],
    ['hunyuan-t1-latest', 128_000, 64_000],
    ['hunyuan-turbos-latest', 128_000, 16_000],
    ['tencent-hy-2.0-think', 256_000, 16_000],
    ['doubao-seed-2.0-pro', 256_000, 128_000],
    ['doubao-seed-2-0-mini', 256_000, 32_000],
    ['doubao-seed-1-6-thinking-250615', 256_000, 16_384],
    ['doubao-1.5-pro-32k', 32_768, 4_096],
  ])('maps %s to %i context / %i output', (model, context, output) => {
    expect(guessModelLimitsById(model)).toEqual({ context, output });
  });

  it('uses the provided fallback for unknown models', () => {
    expect(guessModelLimitsById('unknown-model', { context: 42, output: 7 }))
      .toEqual({ context: 42, output: 7 });
  });
});
