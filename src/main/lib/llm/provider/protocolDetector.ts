// src/main/lib/llm/provider/protocolDetector.ts
/**
 * Protocol Detector — auto-detect which LLM wire protocol a custom endpoint speaks.
 *
 * Used by the `custom-dynamic` provider so users can paste any endpoint + API key
 * without knowing whether it speaks the OpenAI, Anthropic, or Gemini protocol.
 *
 * Design notes:
 *   - This is a PURE module: no singletons, no class state. The same `detect()`
 *     function backs Verify/Test Connection and run-time self-heal, eliminating
 *     "works in Verify, breaks at run" divergence.
 *   - Each protocol wants a DIFFERENT base-URL shape (see normalizeBaseUrl). The
 *     detector resolves and returns the normalized URL per protocol, not just the
 *     protocol name — callers persist and reuse it verbatim.
 *   - Probing uses each protocol's model-listing endpoint: a successful list is
 *     proof of both connectivity AND protocol. We never send a chat completion
 *     during detection (cheaper, and avoids burning tokens / hitting quotas).
 */

import { createLogger } from '../../unifiedLogger';

const logger = createLogger();

/** The three wire protocols a custom endpoint may speak. */
export type CustomProtocol = 'openai' | 'anthropic' | 'gemini';

/** Anthropic API version header value required by the Messages API. */
const ANTHROPIC_VERSION = '2023-06-01';

/** Gemini API version path segment that exposes generateContent + model listing. */
const GEMINI_API_VERSION = 'v1beta';

/** Per-probe network timeout. Kept short so detection of 3 protocols stays snappy. */
const PROBE_TIMEOUT_MS = 8_000;

/** Successful detection: which protocol, the URL shape to persist, proof-of-life. */
export interface DetectionSuccess {
  protocol: CustomProtocol;
  /** Base URL normalized to the shape the chosen engine expects. Persist & reuse. */
  normalizedBaseUrl: string;
  /** Full model ids returned by the probe. */
  models: string[];
  /** Raw model records returned by the probe. */
  rawModels: unknown[];
  /** Total detection latency in milliseconds. */
  latencyMs: number;
}

/** Failed detection: no protocol matched, with a user-facing reason. */
export interface DetectionFailure {
  protocol: null;
  error: string;
  latencyMs: number;
}

export type DetectionResult = DetectionSuccess | DetectionFailure;

/**
 * Strip a trailing slash and an optional trailing version segment from a URL.
 * e.g. "https://h/v1/" → "https://h" when `version` is "v1".
 */
function stripTrailing(url: string, version?: string): string {
  let u = url.trim().replace(/\/+$/, '');
  if (version) {
    const re = new RegExp(`/${version}$`, 'i');
    u = u.replace(re, '');
  }
  return u;
}

/**
 * Resolve the base URL to the exact shape each protocol's engine expects:
 *   - openai:    base INCLUDES the version segment (engine appends `/models`,
 *                `/chat/completions`). If the host is api.openai.com and `/v1`
 *                is missing, add it; otherwise respect the user's path as-is.
 *   - anthropic: base EXCLUDES `/v1` (the SDK appends `/v1/...`).
 *   - gemini:    base is the host ROOT (the SDK appends `/v1beta`).
 */
export function normalizeBaseUrl(rawBaseUrl: string, protocol: CustomProtocol): string {
  const raw = rawBaseUrl.trim().replace(/\/+$/, '');
  switch (protocol) {
    case 'openai': {
      // Respect an explicit path (e.g. ".../v1", ".../openai/v1"). Only add a
      // default /v1 for the canonical OpenAI host when the user omitted it.
      if (/api\.openai\.com$/i.test(raw)) return `${raw}/v1`;
      return raw;
    }
    case 'anthropic':
      return stripTrailing(raw, 'v1');
    case 'gemini':
      return stripTrailing(raw, GEMINI_API_VERSION);
    default:
      return raw;
  }
}

/**
 * Order the protocols to probe, prioritizing by URL/host heuristic so the most
 * likely protocol is tried first (saves round-trips in the common case). All
 * three are always included as fallbacks — the heuristic only reorders.
 */
function probeOrder(baseUrl: string): CustomProtocol[] {
  const host = baseUrl.toLowerCase();
  if (host.includes('anthropic')) return ['anthropic', 'openai', 'gemini'];
  if (host.includes('generativelanguage') || host.includes('googleapis') || host.includes('gemini')) {
    return ['gemini', 'openai', 'anthropic'];
  }
  // Default: OpenAI is the overwhelmingly most common custom protocol.
  return ['openai', 'anthropic', 'gemini'];
}

/** Extract model ids from a protocol-specific listing payload. */
function extractModelIds(protocol: CustomProtocol, data: unknown): string[] {
  const ids: string[] = [];
  const pushId = (v: unknown) => {
    if (typeof v === 'string' && v) ids.push(v);
  };

  if (protocol === 'gemini') {
    // { models: [{ name: "models/gemini-2.5-pro", ... }] }
    const models = (data as { models?: Array<{ name?: string }> })?.models;
    if (Array.isArray(models)) {
      for (const m of models) pushId(m?.name?.replace(/^models\//, ''));
    }
  } else {
    // OpenAI & Anthropic: { data: [{ id }] } (or a bare array for some gateways)
    const arr = Array.isArray(data)
      ? data
      : (data as { data?: Array<{ id?: string }> })?.data;
    if (Array.isArray(arr)) {
      for (const m of arr) pushId((m as { id?: string })?.id);
    }
  }
  return ids;
}

/** Extract raw model records from a protocol-specific listing payload. */
function extractRawModels(protocol: CustomProtocol, data: unknown): unknown[] {
  if (protocol === 'gemini') {
    const models = (data as { models?: unknown[] })?.models;
    return Array.isArray(models) ? models : [];
  }
  if (Array.isArray(data)) return data;
  const arr = (data as { data?: unknown[] })?.data;
  return Array.isArray(arr) ? arr : [];
}

/**
 * Probe a single protocol's model-listing endpoint.
 * Returns model ids and raw model records on success, or null if this protocol doesn't match.
 * Throws only on auth failures we want to surface verbatim (401/403), so the
 * caller can stop early instead of misreporting "no protocol matched".
 */
async function probeProtocol(
  protocol: CustomProtocol,
  rawBaseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<{ models: string[]; rawModels: unknown[]; normalizedBaseUrl: string } | null> {
  const normalizedBaseUrl = normalizeBaseUrl(rawBaseUrl, protocol);

  let url: string;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  switch (protocol) {
    case 'openai':
      url = `${normalizedBaseUrl}/models`;
      headers['Authorization'] = `Bearer ${apiKey}`;
      break;
    case 'anthropic':
      url = `${normalizedBaseUrl}/v1/models`;
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = ANTHROPIC_VERSION;
      break;
    case 'gemini':
      // Gemini accepts the key as a query param OR x-goog-api-key header; the
      // header avoids leaking the key in URL logs.
      url = `${normalizedBaseUrl}/${GEMINI_API_VERSION}/models`;
      headers['x-goog-api-key'] = apiKey;
      break;
  }

  // Compose the caller's abort signal with a per-probe timeout.
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  const composed = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', headers, signal: composed });
  } catch (err) {
    // Network-level failure (DNS, refused, timeout) — this protocol's URL shape
    // didn't resolve. Return null so the next protocol is tried.
    logger.debug(`[protocolDetector] ${protocol} probe network error: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  // 401/403 means we reached a real server of THIS protocol but the key is bad.
  // Surface it: trying other protocols would just produce the same auth error
  // and mask the real problem.
  if (response.status === 401 || response.status === 403) {
    throw new AuthProbeError(protocol, response.status);
  }

  if (!response.ok) {
    // 404/405/400 etc. — wrong endpoint shape for this protocol. Try the next.
    logger.debug(`[protocolDetector] ${protocol} probe non-OK: ${response.status}`);
    return null;
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return null; // Not JSON — not a match.
  }

  const models = extractModelIds(protocol, data);
  const rawModels = extractRawModels(protocol, data);
  // A protocol matches only if its listing shape parsed into at least one model.
  if (models.length === 0) return null;

  return { models, rawModels, normalizedBaseUrl };
}

/** Internal: an auth failure against a positively-identified protocol server. */
class AuthProbeError extends Error {
  constructor(public readonly protocol: CustomProtocol, public readonly status: number) {
    super(`Authentication failed (${status}) against the ${protocol} endpoint.`);
    this.name = 'AuthProbeError';
  }
}

/**
 * Detect which protocol the endpoint speaks by probing each model-listing API
 * in heuristic-prioritized order. Returns the first match.
 *
 * @param rawBaseUrl  The endpoint URL exactly as the user entered it.
 * @param apiKey      Plaintext API key.
 * @param signal      Optional caller abort signal (composed with per-probe timeout).
 */
export async function detectProtocol(
  rawBaseUrl: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<DetectionResult> {
  const startTime = Date.now();

  const trimmed = rawBaseUrl.trim();
  if (!trimmed) {
    return { protocol: null, error: 'No endpoint URL provided.', latencyMs: 0 };
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return { protocol: null, error: 'Endpoint must start with http:// or https://', latencyMs: Date.now() - startTime };
  }
  if (!apiKey) {
    return { protocol: null, error: 'No API key provided.', latencyMs: Date.now() - startTime };
  }

  const order = probeOrder(trimmed);
  let authError: AuthProbeError | null = null;

  for (const protocol of order) {
    try {
      const hit = await probeProtocol(protocol, trimmed, apiKey, signal);
      if (hit) {
        logger.debug(`[protocolDetector] Detected '${protocol}' for ${trimmed} (${hit.models.length} models)`);
        return {
          protocol,
          normalizedBaseUrl: hit.normalizedBaseUrl,
          models: hit.models,
          rawModels: hit.rawModels,
          latencyMs: Date.now() - startTime,
        };
      }
    } catch (err) {
      if (err instanceof AuthProbeError) {
        // Remember the first auth error but keep probing: another protocol on
        // the same host might accept this key (e.g. a multi-protocol gateway).
        authError = authError ?? err;
        continue;
      }
      throw err;
    }
  }

  const latencyMs = Date.now() - startTime;
  if (authError) {
    return { protocol: null, error: 'Invalid API key for this endpoint. Please check and try again.', latencyMs };
  }
  return {
    protocol: null,
    error: 'Could not detect a supported protocol (OpenAI, Anthropic, or Gemini) at this endpoint. Verify the URL and that the API exposes a model-listing endpoint.',
    latencyMs,
  };
}
