import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { searchStocks, StockSuggestion } from './stockSuggest';
import type { Target } from './TargetListSidebar';

interface AddTargetSearchProps {
  busy: boolean;
  error: string | null;
  onSubmit: (code: string, name: string) => void;
  onCancel: () => void;
  /**
   * Optional pool of already-added targets. When supplied, the combobox
   * shows a "已有 Target" section above the API results so users can
   * pick an existing target without leaving the input — turning the same
   * widget into the unified "find or add" entry point.
   */
  existingTargets?: Target[];
  /**
   * Fired when the user picks a row from the "已有 Target" section.
   * Receives the target's stock_code. The component will close itself
   * (via onCancel) immediately after invoking this so the dropdown
   * dismisses just like a successful add.
   */
  onSelectExisting?: (code: string) => void;
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
  existingTargets,
  onSelectExisting,
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

  const submitUnlisted = useCallback(() => {
    const n = query.trim();
    if (!n) return;
    // Empty stock_code signals an unlisted/private company. ResearchPage will
    // pass that through to portfolio_init_target; portfolioTools handles the
    // listed=false branch and synthesizes a stock_code === name placeholder
    // so the renderer's stock_code-keyed maps stay unique.
    onSubmit('', n);
  }, [query, onSubmit]);

  // Filter the caller-supplied existing-target pool by the same query that
  // drives the Eastmoney API call. Matches case-insensitively on stock_code,
  // name and industry — same fields the legacy sidebar Search filter used.
  // Capped at 6 so the dropdown stays scan-able even with hundreds of targets.
  const filteredExisting = useMemo<Target[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q || !existingTargets || existingTargets.length === 0) return [];
    const matches = existingTargets.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.stock_code.toLowerCase().includes(q) ||
        (t.industry ?? '').toLowerCase().includes(q),
    );
    return matches.slice(0, 6);
  }, [query, existingTargets]);

  const pickExisting = useCallback((t: Target) => {
    onSelectExisting?.(t.stock_code);
    // Mirror the post-add behavior: dismiss the combobox once the parent
    // has been notified, so the unified "find or add" widget feels like a
    // command palette rather than a persistent filter.
    onCancel();
  }, [onSelectExisting, onCancel]);

  // Reset highlight to 0 whenever the visible row set changes — otherwise a
  // stale highlight from a longer dropdown can land on an out-of-range index
  // (visually nothing selected; Enter no-ops) after a query refinement.
  useEffect(() => {
    setHighlight(0);
  }, [filteredExisting.length, results.length]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Highlight indices are laid out as one flat list across both sections,
    // matching the visual top-to-bottom order: existing matches first, then
    // API results, then the unlisted CTA. Mapping a flat index → action
    // keeps ArrowUp/Down navigation linear and Enter-dispatch trivial.
    const ctaVisible = query.trim().length > 0;
    const existingCount = filteredExisting.length;
    const apiCount = results.length;
    const totalRows = existingCount + apiCount + (ctaVisible ? 1 : 0);
    if (totalRows === 0) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, totalRows - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlight < existingCount) {
        pickExisting(filteredExisting[highlight]);
      } else if (highlight < existingCount + apiCount) {
        pick(results[highlight - existingCount]);
      } else if (ctaVisible) {
        submitUnlisted();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  }, [results, highlight, pick, pickExisting, filteredExisting, onCancel, submitUnlisted, query]);

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
          placeholder="查找或添加（代码 / 名称）"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
        />
        {loading && (
          // The rotation transform from `animate-spin` overrides Tailwind's
          // `-translate-y-1/2` (both set `transform`), so the icon drifts off
          // center every frame. Split the concerns: outer span positions, inner
          // icon spins.
          <span className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex">
            <Loader2 size={12} className="text-[var(--rw-text-3)] animate-spin" />
          </span>
        )}
      </div>

      {(filteredExisting.length > 0 || results.length > 0 || (query.trim() && !loading)) && (
        <div
          className="rounded border max-h-64 overflow-y-auto"
          style={{ borderColor: 'var(--rw-border)', background: '#fff' }}
        >
          {/* Section 1 — already-added targets. Hidden when no query or no
              matches; section header rendered only when there is at least one
              match in this section AND the second section will also show
              content, so a single-section dropdown stays chrome-free. */}
          {filteredExisting.length > 0 && (
            <>
              {(results.length > 0 || query.trim()) && (
                <div
                  className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--rw-text-3)]"
                  style={{ background: 'var(--rw-bg-soft)' }}
                >
                  已有 Target
                </div>
              )}
              {filteredExisting.map((t, i) => {
                const idx = i;
                const isUnlisted = t.listed === false || t.stock_code === t.name;
                return (
                  <div
                    key={`existing-${t.stock_code}`}
                    role="button"
                    onMouseDown={(e) => { e.preventDefault(); pickExisting(t); }}
                    onMouseEnter={() => setHighlight(idx)}
                    className={`flex items-center gap-2 px-2 py-1.5 text-[13px] cursor-pointer ${idx === highlight ? 'bg-[var(--rw-accent-soft)]' : ''}`}
                  >
                    <span
                      className="text-[10px] px-1 rounded bg-emerald-50 text-emerald-700"
                      style={{ minWidth: 16, textAlign: 'center' }}
                      title="已添加"
                    >
                      ✓
                    </span>
                    <span className="font-mono text-[12px] text-[var(--rw-text-2)]" style={{ minWidth: 60 }}>
                      {isUnlisted ? '未上市' : t.stock_code}
                    </span>
                    <span className="truncate flex-1 text-[var(--rw-text)]">{t.name}</span>
                  </div>
                );
              })}
            </>
          )}

          {/* Section 2 — new targets (Eastmoney suggestions + unlisted CTA). */}
          {(results.length > 0 || query.trim()) && (
            <>
              {filteredExisting.length > 0 && (
                <div
                  className="px-2 py-1 text-[10px] uppercase tracking-wide text-[var(--rw-text-3)] border-t"
                  style={{ background: 'var(--rw-bg-soft)', borderTopColor: 'var(--rw-border)' }}
                >
                  添加新 Target
                </div>
              )}
              {results.map((s, i) => {
                const idx = filteredExisting.length + i;
                return (
                  <div
                    key={`${s.market}-${s.code}`}
                    role="button"
                    onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                    onMouseEnter={() => setHighlight(idx)}
                    className={`flex items-center gap-2 px-2 py-1.5 text-[13px] cursor-pointer ${idx === highlight ? 'bg-[var(--rw-accent-soft)]' : ''}`}
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
                );
              })}

              {/* CTA: add as unlisted/private company. Rendered whenever the user
                  has typed something — gives a path forward even when Eastmoney
                  returns zero suggestions (private startups, custom watch items). */}
              {query.trim() && (() => {
                const idx = filteredExisting.length + results.length;
                return (
                  <div
                    role="button"
                    onMouseDown={(e) => { e.preventDefault(); submitUnlisted(); }}
                    onMouseEnter={() => setHighlight(idx)}
                    className={`flex items-center gap-2 px-2 py-1.5 text-[13px] cursor-pointer ${results.length > 0 ? 'border-t' : ''} ${idx === highlight ? 'bg-[var(--rw-accent-soft)]' : ''}`}
                    style={{ borderTopColor: 'var(--rw-border)' }}
                  >
                    <span
                      className="text-[10px] px-1 rounded bg-gray-100 text-gray-600"
                      style={{ minWidth: 16, textAlign: 'center' }}
                    >
                      +
                    </span>
                    <span className="truncate flex-1 text-[var(--rw-text)]">
                      添加未上市公司:「<span className="font-medium">{query.trim()}</span>」
                    </span>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-[var(--rw-text-3)]">
          ↑↓ 选择 · Enter 确认 · Esc 取消
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
