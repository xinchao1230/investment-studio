import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { searchStocks, StockSuggestion } from './stockSuggest';

interface AddTargetSearchProps {
  busy: boolean;
  error: string | null;
  onSubmit: (code: string, name: string) => void;
  onCancel: () => void;
}

const MARKET_LABEL: Record<StockSuggestion['market'], string> = {
  SH: '沪',
  SZ: '深',
  BJ: '京',
  HK: '港',
  US: '美',
  OTHER: '',
};

const MARKET_COLOR: Record<StockSuggestion['market'], string> = {
  SH: 'bg-red-50 text-red-600',
  SZ: 'bg-blue-50 text-blue-600',
  BJ: 'bg-amber-50 text-amber-600',
  HK: 'bg-emerald-50 text-emerald-600',
  US: 'bg-indigo-50 text-indigo-600',
  OTHER: 'bg-gray-100 text-gray-500',
};

export const AddTargetSearch: React.FC<AddTargetSearchProps> = ({
  busy,
  error,
  onSubmit,
  onCancel,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqIdRef = useRef(0);

  // Debounced fetch on query change
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const myReq = ++reqIdRef.current;
    const t = setTimeout(async () => {
      try {
        const list = await searchStocks(q, { limit: 10 });
        if (myReq !== reqIdRef.current) return;
        setResults(list);
        setHighlight(0);
      } catch (e) {
        if (myReq !== reqIdRef.current) return;
        console.warn('[AddTargetSearch] suggest failed:', e);
        setResults([]);
      } finally {
        if (myReq === reqIdRef.current) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    // Try focusing on mount; if the renderer window doesn't currently hold
    // focus (common right after a native window.confirm dialog), the first
    // focus() call is silently ignored. Retry on the next frame and once more
    // shortly after so focus lands as soon as the webContents is focusable.
    const tryFocus = () => inputRef.current?.focus();
    tryFocus();
    const raf = requestAnimationFrame(tryFocus);
    const t = window.setTimeout(tryFocus, 120);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, []);

  const pick = useCallback((s: StockSuggestion) => {
    // Persist the stock_code with its market suffix (e.g. "09961.HK", "AAPL.US",
    // "603993.SH") so that downstream UI can render the fully-qualified ticker
    // and breadcrumbs like paiwork. Skip the suffix only for OTHER/unknown.
    const suffix = s.market && s.market !== 'OTHER' ? `.${s.market}` : '';
    const fullCode = s.code.includes('.') ? s.code : `${s.code}${suffix}`;
    onSubmit(fullCode, s.name);
  }, [onSubmit]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(0, results.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[highlight]) pick(results[highlight]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }, [results, highlight, pick, onCancel]);

  return (
    <div
      className="px-2 py-2 space-y-1.5 rw-divider"
      style={{ background: 'var(--rw-bg-soft)' }}
    >
      <div className="relative">
        <Search
          size={12}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--rw-text-3)]"
        />
        <input
          ref={inputRef}
          className="w-full pl-7 pr-7 py-1.5 text-[13px] border rounded outline-none focus:border-[var(--rw-accent)]"
          style={{ borderColor: 'var(--rw-border)', background: '#fff' }}
          placeholder="搜索代码或名称…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        {loading && (
          <Loader2
            size={12}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--rw-text-3)] animate-spin"
          />
        )}
      </div>

      {results.length > 0 && (
        <div
          className="rounded border max-h-64 overflow-y-auto"
          style={{ borderColor: 'var(--rw-border)', background: '#fff' }}
        >
          {results.map((s, i) => (
            <div
              key={`${s.market}-${s.code}`}
              role="button"
              onMouseDown={(e) => { e.preventDefault(); pick(s); }}
              onMouseEnter={() => setHighlight(i)}
              className={`flex items-center gap-2 px-2 py-1.5 text-[13px] cursor-pointer ${i === highlight ? 'bg-[var(--rw-accent-soft)]' : ''}`}
            >
              <span
                className={`text-[10px] px-1 rounded ${MARKET_COLOR[s.market]}`}
                style={{ minWidth: 16, textAlign: 'center' }}
              >
                {MARKET_LABEL[s.market]}
              </span>
              <span className="font-mono text-[12px] text-[var(--rw-text-2)]" style={{ minWidth: 60 }}>
                {s.code}
              </span>
              <span className="truncate flex-1 text-[var(--rw-text)]">{s.name}</span>
            </div>
          ))}
        </div>
      )}

      {!loading && query.trim() && results.length === 0 && (
        <div className="text-[11px] text-[var(--rw-text-3)] px-1">无匹配结果</div>
      )}

      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-[var(--rw-text-3)]">
          ↑↓ 选择 · Enter 添加 · Esc 取消
        </span>
        <button
          onClick={onCancel}
          disabled={busy}
          className="text-[11px] text-[var(--rw-text-3)] hover:text-[var(--rw-text)] disabled:opacity-50"
        >
          取消
        </button>
      </div>

      {busy && (
        <div className="text-[11px] text-[var(--rw-text-3)]">添加中…</div>
      )}
      {error && (
        <div className="text-[11px] text-red-600 break-words">{error}</div>
      )}
    </div>
  );
};
