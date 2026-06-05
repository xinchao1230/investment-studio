// src/main/lib/llm/provider/modelLimitsUtil.ts
/**
 * Shared helpers for extracting a model's real context-window / output-token
 * limits from a provider's heterogeneous /models response.
 *
 * Different OpenAI-compatible and Anthropic-compatible gateways advertise the
 * same number under different field names (and sometimes nested objects, and
 * sometimes as numeric strings). These helpers probe a prioritized list of
 * candidate keys and report BOTH the value and which key produced it, so the
 * caller can log the provenance (real API field vs. family heuristic).
 *
 * Pure module - no singletons, no logger. Callers own their own logging.
 */

/** A resolved numeric limit plus the key/path that produced it (for logging). */
export interface ResolvedLimit {
  /** The top-level key or dotted nested path that matched. */
  key: string;
  /** The finite, positive value found. */
  value: number;
}

/** Context-window and max-output defaults used when provider metadata is absent. */
export interface ModelLimitDefaults {
  context: number;
  output: number;
}

const GENERIC_FALLBACK_LIMITS: ModelLimitDefaults = { context: 128_000, output: 4_096 };

/**
 * Coerce an unknown into a finite, positive number, or undefined.
 * Accepts numeric strings (some gateways return limits as `"128000"`).
 */
export function toFinitePositiveNumber(input: unknown): number | undefined {
  const n =
    typeof input === 'string'
      ? Number(input)
      : typeof input === 'number'
        ? input
        : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Return the first finite, positive number found among the given top-level keys
 * and dotted nested paths (e.g. `top_provider.context_length`), along with the
 * key/path that matched. Returns undefined if none match.
 */
export function pickModelLimit(
  raw: unknown,
  keys: string[],
  nestedPaths: string[] = [],
): ResolvedLimit | undefined {
  if (raw == null || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;

  for (const key of keys) {
    const value = toFinitePositiveNumber(record[key]);
    if (value !== undefined) return { key, value };
  }

  for (const path of nestedPaths) {
    const resolved = path
      .split('.')
      .reduce<unknown>(
        (obj, seg) =>
          obj != null && typeof obj === 'object'
            ? (obj as Record<string, unknown>)[seg]
            : undefined,
        record,
      );
    const value = toFinitePositiveNumber(resolved);
    if (value !== undefined) return { key: path, value };
  }

  return undefined;
}

/**
 * Best-effort context-window / output-token defaults by model family.
 * Used only after provider metadata probing fails. Keep this intentionally
 * conservative for output caps when an upstream only documents context length.
 */
export function guessModelLimitsById(
  modelId: string,
  fallback: ModelLimitDefaults = GENERIC_FALLBACK_LIMITS,
): ModelLimitDefaults {
  const id = modelId.toLowerCase();

  // OpenAI GPT / reasoning families.
  if (/^gpt-5\.5(?:-|$)/.test(id)) return { context: 1_050_000, output: 128_000 };
  if (/^gpt-5\.4-(?:mini|nano)(?:-|$)/.test(id)) return { context: 400_000, output: 128_000 };
  if (/^gpt-5\.4(?:-|$)/.test(id)) return { context: 1_050_000, output: 128_000 };
  if (/^gpt-5/.test(id)) return { context: 400_000, output: 128_000 };
  if (/^gpt-4\.1/.test(id)) return { context: 1_047_576, output: 32_768 };
  if (/^gpt-4o/.test(id)) return { context: 128_000, output: 16_384 };
  if (/^o4-mini/.test(id) || /^o3-mini/.test(id)) return { context: 200_000, output: 100_000 };
  if (/^o3/.test(id) || /^o1/.test(id)) return { context: 200_000, output: 100_000 };
  if (/^gpt-4-turbo/.test(id)) return { context: 128_000, output: 4_096 };
  if (/^gpt-3\.5/.test(id)) return { context: 16_385, output: 4_096 };

  // Anthropic Claude families.
  if (/claude-opus-4[-.]?(?:8|7|6)(?:-|$)/.test(id)) {
    return { context: 1_000_000, output: 128_000 };
  }
  if (/claude-sonnet-4[-.]?6(?:-|$)/.test(id)) return { context: 1_000_000, output: 64_000 };
  if (/claude-haiku-4[-.]?5(?:-|$)/.test(id)) return { context: 200_000, output: 64_000 };
  if (/claude-sonnet-4[-.]?5(?:-|$)/.test(id)) return { context: 200_000, output: 64_000 };
  if (/claude-opus-4[-.]?5(?:-|$)/.test(id)) return { context: 200_000, output: 64_000 };
  if (/claude-opus-4[-.]?1(?:-|$)/.test(id) || id.includes('claude-opus-41')) {
    return { context: 200_000, output: 32_000 };
  }
  if (/claude-sonnet-4(?:-|$)/.test(id)) return { context: 200_000, output: 64_000 };
  if (/claude-opus-4(?:-|$)/.test(id)) return { context: 200_000, output: 32_000 };
  if (id.includes('claude-opus') || id.includes('claude-sonnet') || id.includes('claude-haiku') || id.includes('claude-3')) {
    return { context: 200_000, output: 8_192 };
  }

  // Google Gemini families.
  if (id.includes('gemini-3.1') && id.includes('live')) return { context: 131_072, output: 65_536 };
  if (id.includes('gemini-3.5')) return { context: 1_048_576, output: 65_536 };
  if (id.includes('gemini-3')) return { context: 1_048_576, output: 65_536 };
  if (id.includes('gemini-2.5')) return { context: 1_048_576, output: 65_536 };
  if (id.includes('gemini-1.5-pro')) return { context: 2_000_000, output: 8_192 };
  if (id.includes('gemini-1.5') || id.includes('gemini-2')) return { context: 1_048_576, output: 8_192 };
  if (id.includes('gemini') && id.includes('latest')) return { context: 1_048_576, output: 65_536 };

  // DeepSeek families. Official API aliases stay at 64K/8K; newer v4 previews
  // advertise 1M context, but output remains a conservative 8K fallback here.
  if (id.includes('deepseek-v4')) return { context: 1_000_000, output: 8_192 };
  if (id.includes('deepseek-reasoner') || id.includes('reasoner')) return { context: 64_000, output: 8_192 };
  if (id.includes('deepseek-r1-0528') || id.includes('deepseek-v3.1') || id.includes('deepseek-v3-1')) {
    return { context: 128_000, output: 32_768 };
  }
  if (id.includes('deepseek-r1')) return { context: 128_000, output: 32_768 };
  if (id.includes('deepseek')) return { context: 64_000, output: 8_192 };

  // xAI Grok families. xAI documents max_completion_tokens as bounded by the
  // model's maximum context length rather than a separate per-response cap.
  if (id.includes('grok-build')) return { context: 256_000, output: 256_000 };
  if (id.includes('grok-4.20') || id.includes('grok-4.3') || id.includes('grok-4-1-fast')) {
    return { context: 1_000_000, output: 1_000_000 };
  }
  if (id.includes('grok-4') || id.includes('grok-3') || id.includes('grok-latest')) {
    return { context: 1_000_000, output: 1_000_000 };
  }
  if (id.includes('grok')) return { context: 1_000_000, output: 1_000_000 };

  // Alibaba Qwen / DashScope families. The latest commercial Qwen aliases
  // generally publish explicit deployment limits; open-weight names use more
  // conservative defaults because deployment context can vary by host.
  if (id.includes('qwen-long')) return { context: 10_000_000, output: 8_192 };
  if (/qwen3\.5-(?:plus|flash|omni)(?:-|$)/.test(id)) return { context: 1_000_000, output: 65_536 };
  if (/qwen3-coder-(?:plus|flash)(?:-|$)/.test(id)) return { context: 1_000_000, output: 65_536 };
  if (id.includes('qwen3-coder')) return { context: 262_144, output: 65_536 };
  if (/qwen3-max(?:-|$)/.test(id)) return { context: 262_144, output: 65_536 };
  if (/qwen-(?:plus|flash)(?:-|$)/.test(id)) return { context: 1_000_000, output: 32_768 };
  if (/qwen-max-latest(?:-|$)/.test(id)) return { context: 131_072, output: 8_192 };
  if (/qwen-max(?:-|$)/.test(id) || id.includes('qwen2.5-max')) return { context: 32_768, output: 8_192 };
  if (id.includes('qwen2.5') || id.includes('qwen-2.5')) return { context: 131_072, output: 8_192 };
  if (id.includes('qwen3')) return { context: 131_072, output: 32_768 };
  if (id.includes('qwen')) return { context: 32_768, output: 4_096 };

  // Z.AI / Zhipu GLM families.
  if (/glm-5(?:\.1|-turbo)?(?:-|$)/.test(id)) return { context: 200_000, output: 128_000 };
  if (/glm-4\.7(?:-|$)/.test(id)) return { context: 200_000, output: 128_000 };
  if (/glm-4\.6(?:-|$)/.test(id)) return { context: 200_000, output: 128_000 };
  if (/glm-4\.5(?:-|$)/.test(id)) return { context: 128_000, output: 96_000 };
  if (id.includes('glm-4-32b') && id.includes('128k')) return { context: 128_000, output: 8_192 };
  if (id.includes('glm-4')) return { context: 128_000, output: 8_192 };

  // Baidu ERNIE / Qianfan families.
  if (/ernie-5(?:[.-][01])?(?:-|$)/.test(id)) return { context: 128_000, output: 65_536 };
  if (/ernie-4[.-]5/.test(id)) return { context: 128_000, output: 12_288 };
  if (id.includes('ernie-x1')) return { context: 128_000, output: 4_096 };
  if (id.includes('ernie') && id.includes('128k')) return { context: 128_000, output: 4_096 };
  if (id.includes('ernie')) return { context: 8_192, output: 4_096 };

  // Tencent Hunyuan families. Tencent's public API pages often publish maximum
  // input and output separately; these totals are conservative context budgets.
  if (id.includes('hunyuan-a13b')) return { context: 256_000, output: 32_000 };
  if (id.includes('hunyuan-t1') || id.includes('hunyuan-thinker')) {
    return { context: 128_000, output: 64_000 };
  }
  if (id.includes('hunyuan-turbos') || id.includes('hunyuan-turbo-s')) {
    return { context: 128_000, output: 16_000 };
  }
  if (id.includes('hunyuan-standard-256k')) return { context: 256_000, output: 32_000 };
  if (id.includes('hunyuan-large-role')) return { context: 32_000, output: 4_096 };
  if (id.includes('hunyuan-translation')) return { context: 4_096, output: 4_096 };
  if (id.includes('tencent-hy-2') && id.includes('think')) return { context: 256_000, output: 16_000 };
  if (id.includes('tencent-hy-2') || id.includes('hunyuan-2')) return { context: 128_000, output: 16_000 };
  if (id.includes('hunyuan')) return { context: 128_000, output: 8_192 };

  // ByteDance Doubao / Seed families served by Volcano Engine Ark and gateways.
  if (/doubao-seed-2[.-]0-pro/.test(id) || /^seed-2[.-]0-pro/.test(id)) {
    return { context: 256_000, output: 128_000 };
  }
  if (/doubao-seed-2[.-]0-mini/.test(id) || /^seed-2[.-]0-mini/.test(id)) {
    return { context: 256_000, output: 32_000 };
  }
  if (/doubao-seed-2[.-]0/.test(id) || /^seed-2[.-]0/.test(id)) {
    return { context: 256_000, output: 64_000 };
  }
  if (/doubao-seed-1[.-]6/.test(id) || /^seed-1[.-]6/.test(id)) {
    return { context: 256_000, output: 16_384 };
  }
  if (id.includes('doubao') && id.includes('256k')) return { context: 256_000, output: 16_384 };
  if (id.includes('doubao') && id.includes('128k')) return { context: 128_000, output: 16_384 };
  if (id.includes('doubao') && id.includes('32k')) return { context: 32_768, output: 4_096 };
  if (id.includes('doubao')) return { context: 128_000, output: 16_384 };

  // Common open-weight families served through OpenAI-compatible gateways.
  if (id.includes('llama') || id.includes('mistral') || id.includes('gemma')) {
    return { context: 32_768, output: 4_096 };
  }

  return fallback;
}
