/**
 * Web IQ search client - thin HTTP wrapper around Microsoft Web IQ
 * (https://api.microsoft.ai/v3/search/web).
 *
 * Activated when the user has configured a `webiq` token under
 * Settings → Financial Data API. When no token is configured, the
 * caller (`BingWebSearchTool`) falls back to the Playwright Bing scraper.
 *
 * Pure module: no Electron, no Playwright, no fs. Easy to test by
 * mocking `global.fetch`.
 */

import { getUnifiedLogger } from '../../unifiedLogger';
import { WebSearchResultItem } from '@shared/types/toolCallArgs';

const logger = getUnifiedLogger();

export const WEB_IQ_ENDPOINT = 'https://api.microsoft.ai/v3/search/web';

export interface WebIQSearchParams {
  query: string;
  maxResults: number;
  language: string;
  region: string;
  contentFormat: 'text' | 'html';
  maxLength: number;
}

interface WebIQRawResult {
  title?: string;
  url?: string;
  content?: string;
  crawledAt?: string;
  language?: string;
  isAdult?: boolean;
}

interface WebIQRawResponse {
  webResults?: WebIQRawResult[];
  traceId?: string;
  errorCode?: string;
  errorCategory?: string;
  userMessage?: string;
  technicalDetails?: string;
}

export interface WebIQSingleSearchOutcome {
  query: string;
  results: WebSearchResultItem[];
  error: string | null;
}

/** Map shorthand `lang` / `locale` from the legacy bing schema into Web IQ params. */
export function mapLocaleToWebIQ(lang: string | undefined, locale: string | undefined): {
  language: string;
  region: string;
} {
  const language = (lang || 'en').toLowerCase();
  const region = (locale || 'us').toUpperCase();
  return { language, region };
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function clampContent(text: string, maxLength: number): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

/**
 * POST a single search to Web IQ and map results into the unified
 * `WebSearchResultItem` shape.
 *
 * - Honors an external `AbortSignal` by abort-chaining it to the per-request
 *   timeout controller.
 * - Never throws — failures are returned as `error` so the caller can
 *   aggregate via Promise.allSettled-style fan-out.
 */
export async function searchWebIQ(
  apiKey: string,
  params: WebIQSearchParams,
  options: { timeoutMs: number; signal?: AbortSignal },
): Promise<WebIQSingleSearchOutcome> {
  const { query, maxResults, language, region, contentFormat, maxLength } = params;
  const { timeoutMs, signal: externalSignal } = options;

  if (externalSignal?.aborted) {
    return { query, results: [], error: 'aborted before start' };
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const res = await fetch(WEB_IQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-apikey': apiKey,
      },
      body: JSON.stringify({
        query,
        maxResults,
        language,
        region,
        contentFormat,
        maxLength,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      let body: WebIQRawResponse | null = null;
      try { body = await res.json() as WebIQRawResponse; } catch { /* ignore parse */ }
      const detail = body?.userMessage || body?.errorCode || `HTTP ${res.status}`;
      logger.warn(`[WebIQ] search failed for "${query}": ${detail}`);
      return { query, results: [], error: `Web IQ error: ${detail}` };
    }

    const body = await res.json() as WebIQRawResponse;
    const raw = Array.isArray(body.webResults) ? body.webResults : [];
    const results: WebSearchResultItem[] = raw.slice(0, maxResults).map((r, idx) => {
      const url = r.url || '';
      const content = clampContent(r.content || '', maxLength);
      return {
        index: idx + 1,
        title: r.title || '',
        url,
        caption: content,
        site: extractDomain(url),
        query,
      };
    });
    return { query, results, error: null };
  } catch (err: any) {
    const reason = externalSignal?.aborted
      ? 'aborted by caller'
      : (controller.signal.aborted ? `timed out after ${timeoutMs}ms` : (err?.message ?? String(err)));
    logger.warn(`[WebIQ] search threw for "${query}": ${reason}`);
    return { query, results: [], error: reason };
  } finally {
    clearTimeout(timeoutHandle);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}
