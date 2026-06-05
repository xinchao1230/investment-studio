import React, { useEffect, useState, useCallback } from 'react';
import { Eye, EyeOff, Key } from 'lucide-react';
import type {
  ResearchApiConnectionResult,
  ResearchApiOpenTokenFileResult,
  ResearchApiProvider,
  ResearchApiProviderStatus,
  ResearchApiSaveResult,
} from '@shared/types/researchApiTypes';
import '../../styles/Header.css';
import '../../styles/ContentView.css';
import '../../styles/RuntimeSettings.css';

type Provider = ResearchApiProvider;

interface ResearchApiClient {
  getToken: (provider: Provider) => Promise<string | undefined>;
  getStatus: (provider: Provider) => Promise<ResearchApiProviderStatus>;
  openTokenFile: () => Promise<ResearchApiOpenTokenFileResult>;
  setToken: (provider: Provider, token: string | null) => Promise<ResearchApiSaveResult>;
  testConnection: (provider: Provider) => Promise<ResearchApiConnectionResult>;
}

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
    id: 'webiq',
    title: 'Microsoft Web IQ',
    helper: (
      <>API key for <a href="https://webiq.microsoft.ai/" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Microsoft Web IQ</a>. When verified, the built-in web search tool calls Web IQ directly.</>
    ),
  },
];

interface CardState {
  initial: string;
  draft: string;
  show: boolean;
  saving: boolean;
  testing: boolean;
  status: { ok: boolean; error?: string } | null;
  hasApiKey: boolean;
  verified: boolean;
  verifiedAt: string | null;
  lastTestError: string | null;
}

const getResearchApiClient = (): ResearchApiClient | undefined =>
  (window as any).electronAPI?.researchApi as ResearchApiClient | undefined;

const emptyState = (provider: Provider, initial: string, savedStatus?: ResearchApiProviderStatus): CardState => ({
  initial: initial.trim(),
  draft: initial.trim(),
  show: false,
  saving: false,
  testing: false,
  status: null,
  hasApiKey: savedStatus?.hasApiKey ?? initial.trim().length > 0,
  verified: savedStatus?.verified ?? false,
  verifiedAt: savedStatus?.verifiedAt ?? null,
  lastTestError: savedStatus?.lastTestError ?? null,
});

const applySavedStatus = (
  patch: Partial<CardState>,
  savedStatus?: ResearchApiProviderStatus,
): Partial<CardState> => {
  if (!savedStatus) return patch;
  return {
    ...patch,
    hasApiKey: savedStatus.hasApiKey,
    verified: savedStatus.verified,
    verifiedAt: savedStatus.verifiedAt,
    lastTestError: savedStatus.lastTestError,
  };
};

const getStatusDot = (card: CardState) => {
  const dirty = card.draft.trim() !== card.initial;
  if (dirty) {
    return card.draft.trim().length > 0
      ? { color: 'bg-amber-400', label: 'Unsaved changes' }
      : { color: 'bg-gray-400', label: 'Will remove API key' };
  }
  if (!card.hasApiKey) {
    return { color: 'bg-gray-400', label: 'No API key saved' };
  }
  if (card.verified) {
    return { color: 'bg-green-500', label: 'Verified' };
  }
  return { color: 'bg-amber-400', label: 'Saved, not verified' };
};

export const ResearchApiView: React.FC = () => {
  const [cards, setCards] = useState<Record<Provider, CardState>>({
    tushare: emptyState('tushare', ''),
    eastmoney: emptyState('eastmoney', ''),
    webiq: emptyState('webiq', ''),
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fileOpenError, setFileOpenError] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    let alive = true;
    (async () => {
      const api = getResearchApiClient();
      if (!api) return;
      try {
        const entries = await Promise.all(PROVIDERS.map(async (provider) => {
          const [token, savedStatus] = await Promise.all([
            api.getToken(provider.id),
            api.getStatus(provider.id),
          ]);
          return [provider.id, emptyState(provider.id, token ?? '', savedStatus)] as const;
        }));
        if (!alive) return;
        setLoadError(null);
        setCards((prev) => ({
          ...prev,
          ...(Object.fromEntries(entries) as Partial<Record<Provider, CardState>>),
        }));
      } catch (err: any) {
        if (!alive) return;
        setLoadError(err?.message ?? String(err));
      }
    })();
    return () => { alive = false; };
  }, []);

  const updateCard = useCallback((id: Provider, patch: Partial<CardState>) => {
    setCards((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const saveCard = useCallback(async (id: Provider): Promise<boolean> => {
    const api = getResearchApiClient();
    if (!api) return false;
    const current = cards[id];
    const value = current.draft.trim();
    updateCard(id, { saving: true, status: null });
    const result = await api.setToken(id, value.length > 0 ? value : null);
    if (!result.ok) {
      updateCard(id, {
        saving: false,
        status: { ok: false, error: result.error ?? 'Save failed' },
      });
      return false;
    }
    updateCard(id, applySavedStatus({
      saving: false,
      initial: value,
      draft: value,
      status: null,
    }, result.status));
    return true;
  }, [cards, updateCard]);

  const handleSave = useCallback((id: Provider) => {
    void saveCard(id);
  }, [saveCard]);

  const handleTest = useCallback(async (id: Provider) => {
    const api = getResearchApiClient();
    if (!api) return;
    const current = cards[id];
    // Save first if dirty so the test uses the value the user just typed.
    if (current.draft.trim() !== current.initial) {
      const saved = await saveCard(id);
      if (!saved) return;
    }
    updateCard(id, { testing: true, status: null });
    const r = await api.testConnection(id);
    updateCard(id, applySavedStatus({
      testing: false,
      status: { ok: r.ok, error: r.error },
    }, r.status));
  }, [cards, saveCard, updateCard]);

  const handleOpenTokenFile = useCallback(async () => {
    const api = getResearchApiClient();
    if (!api) return;
    setFileOpenError(null);
    try {
      const result = await api.openTokenFile();
      if (!result.ok) {
        setFileOpenError(result.error ?? 'Failed to open token file');
      }
    } catch (err: any) {
      setFileOpenError(err?.message ?? String(err));
    }
  }, []);

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
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-xs text-[var(--si-muted)]">
              Configure data access APIs to integrate with financial information, market data, news, company filings, research reports, etc.
            </p>
            <button
              type="button"
              onClick={handleOpenTokenFile}
              className="shrink-0 text-xs text-blue-600 hover:underline"
            >
              Open raw token file
            </button>
          </div>
          {loadError && (
            <div className="mb-3 text-xs text-red-600">
              Failed to load saved API status: {loadError}
            </div>
          )}
          {fileOpenError && (
            <div className="mb-3 text-xs text-red-600">
              Failed to open token file: {fileOpenError}
            </div>
          )}

          <div className="space-y-3">
        {PROVIDERS.map((p) => {
          const c = cards[p.id];
          const dirty = c.draft.trim() !== c.initial;
          const statusDot = getStatusDot(c);
          return (
            <div key={p.id} className="border border-[var(--si-border)] rounded-md p-3 bg-[var(--si-card)]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${statusDot.color}`}
                    aria-hidden="true"
                  />
                  <h2 className="text-sm font-medium">{p.title}</h2>
                  <span className="text-xs text-[var(--si-muted)]">{statusDot.label}</span>
                </div>
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
                  disabled={c.testing || c.saving || c.draft.trim().length === 0}
                  onClick={() => handleTest(p.id)}
                  className="px-3 py-1.5 text-sm rounded border border-[var(--si-border)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {c.testing ? 'Connecting…' : 'Connect'}
                </button>
              </div>

              {c.status && (
                <div className={`mt-1.5 text-xs ${c.status.ok ? 'text-green-600' : 'text-red-600'}`}>
                  {c.status.ok ? '✓ Connected and verified' : `✗ ${c.status.error ?? 'Failed'}`}
                </div>
              )}
              {!c.status && dirty && (
                <div className="mt-1.5 text-xs text-amber-600">
                  Unsaved changes. Connect will save first.
                </div>
              )}
              {!c.status && !dirty && c.hasApiKey && !c.verified && (
                <div className="mt-1.5 text-xs text-amber-600">
                  {c.lastTestError ? `Last verification failed: ${c.lastTestError}` : 'Saved. Click Connect to confirm.'}
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
