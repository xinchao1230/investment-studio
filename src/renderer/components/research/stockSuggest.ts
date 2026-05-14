/**
 * Stock-code autocomplete via Eastmoney's public suggest endpoint.
 *
 * Endpoint (returns JSONP wrapped JSON, but we strip the wrapper manually):
 *   https://searchapi.eastmoney.com/api/suggest/get
 *     ?input=<query>
 *     &type=14
 *     &token=D43BF722C8E33BDC906FB84D85E326E8
 *     &count=20
 *     &cb=<cb>
 *
 * Response body shape (after unwrap):
 *   { QuotationCodeTable: { Data: [{ Code, Name, MktNum, SecurityType, ... }] } }
 *
 * MktNum legend (subset):
 *   '0'   Shenzhen A
 *   '1'   Shanghai A
 *   '81'  Beijing
 *   '116' Hong Kong (main board)
 *   '128' Hong Kong (GEM)
 *   '105'/'106' US
 *
 * Uses fetch() — works in this Electron renderer because webSecurity is
 * disabled (CORS bypassed). Renderer CSP forbids injecting a remote
 * <script>, which is why JSONP is not used.
 */

export interface StockSuggestion {
  code: string;        // e.g. "603993"
  name: string;        // e.g. "海底捞"
  market: 'SH' | 'SZ' | 'BJ' | 'HK' | 'US' | 'OTHER';
  /** Original mktnum from eastmoney for debugging */
  mktnum: string;
  /** SecurityType, kept for filtering (1/2 = stocks) */
  securityType?: string;
}

const ENDPOINT = 'https://searchapi.eastmoney.com/api/suggest/get';
const TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';
const REQUEST_TIMEOUT_MS = 5000;

function mapMarket(mktnum: string): StockSuggestion['market'] {
  switch (mktnum) {
    case '1': return 'SH';
    case '0': return 'SZ';
    case '81': return 'BJ';
    case '116':
    case '128': return 'HK';
    case '105':
    case '106':
    case '107': return 'US';
    default: return 'OTHER';
  }
}

let jsonpSeq = 0;

async function fetchSuggest(query: string): Promise<any> {
  // The endpoint requires a `cb` parameter — without it the response body is
  // empty. We pass a unique callback name and strip the JSONP wrapper.
  const cb = `__rwStockSuggest_${Date.now()}_${++jsonpSeq}`;
  const url =
    `${ENDPOINT}?input=${encodeURIComponent(query)}` +
    `&type=14&token=${TOKEN}&count=20&cb=${cb}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let text: string;
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      // Eastmoney does not require credentials; omit them to avoid CORS quirks.
      credentials: 'omit',
      // Some renderers need an explicit referrer policy for cross-origin GETs.
      referrerPolicy: 'no-referrer',
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    text = await res.text();
  } finally {
    clearTimeout(timer);
  }

  // Strip JSONP wrapper: `cb({...});`
  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start < 0 || end <= start) {
    // Maybe the server returned plain JSON
    try { return JSON.parse(text); } catch { /* fall through */ }
    throw new Error('unrecognized suggest response');
  }
  const jsonStr = text.slice(start + 1, end);
  return JSON.parse(jsonStr);
}

/**
 * Query stock suggestions.
 * Returns A-share (SH/SZ/BJ) + HK results by default, capped at 10.
 */
export async function searchStocks(
  query: string,
  opts?: { markets?: Array<StockSuggestion['market']>; limit?: number },
): Promise<StockSuggestion[]> {
  const q = query.trim();
  if (!q) return [];
  const allowed = new Set(opts?.markets ?? ['SH', 'SZ', 'BJ', 'HK']);
  const limit = opts?.limit ?? 10;

  const data = await fetchSuggest(q);
  // Endpoint may also nest as `Result` — accept either.
  const rows: any[] = data?.QuotationCodeTable?.Data ?? data?.Data ?? [];

  const out: StockSuggestion[] = [];
  for (const r of rows) {
    const market = mapMarket(String(r.MktNum ?? ''));
    if (!allowed.has(market)) continue;
    // SecurityType '1' (沪深A股), '2' (深A) etc; for HK '6'/'7'/'8'. Skip indexes/futures.
    const st = String(r.SecurityType ?? '');
    if (st && !['1', '2', '3', '4', '6', '7', '8', '11', '13'].includes(st)) continue;
    out.push({
      code: String(r.Code ?? ''),
      name: String(r.Name ?? ''),
      market,
      mktnum: String(r.MktNum ?? ''),
      securityType: st,
    });
    if (out.length >= limit) break;
  }
  return out;
}
