/**
 * Market up/down color convention.
 * CN (A-share / HK): up = red, down = green.
 * US (and unknown): up = green, down = red.
 * Convention is derived from the breadcrumb pathPrefix suffix
 * (e.g. "...SZ", "...HK", "...US", "NVDA").
 */
export type MarketConvention = 'cn' | 'us';
export type DeltaDirection = 'up' | 'down';

const CN_SUFFIXES = new Set(['SZ', 'SH', 'HK', 'BJ']);

export function resolveMarketConvention(pathPrefix?: string): MarketConvention {
  if (!pathPrefix) return 'us';
  const suffix = pathPrefix.split('.').pop()?.toUpperCase() ?? '';
  return CN_SUFFIXES.has(suffix) ? 'cn' : 'us';
}

// Recolor a cell only when it IS a delta token, not when it merely
// contains one — so prose like "margin 12%, up" or "12% of revenue" is
// left untouched. Anchored to the whole (trimmed) cell:
//   - optional sign: +, -, or unicode minus (U+2212)
//   - a number, optional decimals, optional space, percent
//   - an optional short unit annotation (e.g. "YoY", "QoQ"): up to 4
//     letters. Wide enough for the common suffixes, narrow enough that
//     trailing prose ("12% of revenue", "+16% YoY growth") fails to match.
const DELTA_RE = /^([+\-−])?\d+(?:\.\d+)?\s*%(?:\s*[A-Za-z]{1,4})?$/;

export function classifyDelta(text: string): DeltaDirection | null {
  const trimmed = text.trim();
  const m = DELTA_RE.exec(trimmed);
  if (!m) return null;
  const sign = m[1];
  if (sign === '-' || sign === '−') return 'down';
  return 'up';
}

export function deltaClassName(
  direction: DeltaDirection,
  convention: MarketConvention,
): string {
  if (convention === 'us') {
    return direction === 'up' ? 'rw-delta-up-us' : 'rw-delta-down-us';
  }
  return direction === 'up' ? 'rw-delta-up' : 'rw-delta-down';
}
