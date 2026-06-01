import React, { useEffect, useState, useCallback } from 'react';
import { Eye, EyeOff, Key } from 'lucide-react';
import '../../styles/Header.css';
import '../../styles/ContentView.css';
import '../../styles/RuntimeSettings.css';

type Provider = 'tushare' | 'eastmoney';

interface ProviderSpec {
  id: Provider;
  title: string;
  helper: React.ReactNode;
}

const PROVIDERS: ProviderSpec[] = [
  {
    id: 'tushare',
    title: 'Tushare',
    helper: (
      <>Go to <a href="https://tushare.pro/register" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">tushare.pro</a> to register and copy your token.</>
    ),
  },
  {
    id: 'eastmoney',
    title: 'Eastmoney',
    helper: <>Leave empty to use the app's built-in token; a custom token is for higher-frequency call quotas.</>,
  },
];

interface CardState {
  initial: string;
  draft: string;
  show: boolean;
  saving: boolean;
  testing: boolean;
  status: { ok: boolean; error?: string } | null;
}

const emptyState = (initial: string): CardState => ({
  initial,
  draft: initial,
  show: false,
  saving: false,
  testing: false,
  status: null,
});

export const ResearchApiView: React.FC = () => {
  const [cards, setCards] = useState<Record<Provider, CardState>>({
    tushare: emptyState(''),
    eastmoney: emptyState(''),
  });

  // Initial load
  useEffect(() => {
    let alive = true;
    (async () => {
      const api = (window as any).electronAPI?.researchApi;
      if (!api) return;
      const [t, e] = await Promise.all([api.getToken('tushare'), api.getToken('eastmoney')]);
      if (!alive) return;
      setCards({
        tushare: emptyState(t ?? ''),
        eastmoney: emptyState(e ?? ''),
      });
    })();
    return () => { alive = false; };
  }, []);

  const updateCard = useCallback((id: Provider, patch: Partial<CardState>) => {
    setCards((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const handleSave = useCallback(async (id: Provider) => {
    const api = (window as any).electronAPI?.researchApi;
    if (!api) return;
    updateCard(id, { saving: true, status: null });
    const value = cards[id].draft;
    const result = await api.setToken(id, value.length > 0 ? value : null);
    updateCard(id, {
      saving: false,
      initial: result.ok ? value : cards[id].initial,
      status: result.ok ? null : { ok: false, error: result.error ?? 'Save failed' },
    });
  }, [cards, updateCard]);

  const handleTest = useCallback(async (id: Provider) => {
    const api = (window as any).electronAPI?.researchApi;
    if (!api) return;
    // Save first if dirty so the test uses the value the user just typed.
    if (cards[id].draft !== cards[id].initial) {
      await handleSave(id);
    }
    updateCard(id, { testing: true, status: null });
    const r = await api.testConnection(id);
    updateCard(id, { testing: false, status: r });
  }, [cards, handleSave, updateCard]);

  return (
    <div className="runtime-settings-view">
      <div className="unified-header">
        <div className="header-title">
          <Key size={18} />
          <span className="header-name">Financial Data API</span>
        </div>
      </div>

      <div className="content-view-container">
        <div className="settings-form-centered">
          <p className="text-xs text-[var(--si-muted)] mb-4">
            Configure data access APIs to integrate with financial information, market data, news, company filings, research reports, etc.
          </p>

          <div className="space-y-3">
        {PROVIDERS.map((p) => {
          const c = cards[p.id];
          const dirty = c.draft !== c.initial;
          return (
            <div key={p.id} className="border border-[var(--si-border)] rounded-md p-3 bg-[var(--si-card)]">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-medium">{p.title}</h2>
              </div>

              <div className="flex gap-2 items-center">
                <div className="flex-1 relative">
                  <input
                    type={c.show ? 'text' : 'password'}
                    value={c.draft}
                    onChange={(e) => updateCard(p.id, { draft: e.target.value, status: null })}
                    placeholder="paste your token here"
                    className="w-full border border-[var(--si-border)] rounded px-3 py-1.5 text-sm pr-10 focus:outline-none focus:border-[var(--si-ink)]"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => updateCard(p.id, { show: !c.show })}
                    aria-label={c.show ? 'hide' : 'show'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--si-faint)] hover:text-[var(--si-muted)]"
                  >
                    {c.show ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <button
                  disabled={!dirty || c.saving}
                  onClick={() => handleSave(p.id)}
                  className="px-3 py-1.5 text-sm rounded bg-[var(--si-gold)] text-white disabled:bg-[var(--si-border)] disabled:cursor-not-allowed hover:bg-[var(--si-accent-strong)]"
                >
                  {c.saving ? 'Saving…' : 'Save'}
                </button>
                <button
                  disabled={c.testing || (!c.initial && !c.draft)}
                  onClick={() => handleTest(p.id)}
                  className="px-3 py-1.5 text-sm rounded border border-[var(--si-border)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {c.testing ? 'Testing…' : 'Test connection'}
                </button>
              </div>

              {c.status && (
                <div className={`mt-1.5 text-xs ${c.status.ok ? 'text-green-600' : 'text-red-600'}`}>
                  {c.status.ok ? '✓ Connected' : `✗ ${c.status.error ?? 'Failed'}`}
                </div>
              )}

              <p className="mt-2 text-xs text-[var(--si-muted)]">{p.helper}</p>
            </div>
          );
        })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResearchApiView;
