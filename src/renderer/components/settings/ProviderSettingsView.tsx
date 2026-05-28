import React, { useEffect, useState, useCallback } from 'react';
import { Eye, EyeOff, Check, AlertCircle, Loader2 } from 'lucide-react';
import { PROVIDER_ICONS } from '../ui/icons/ProviderIcons';

type ProviderId = 'openai' | 'deepseek' | 'ollama' | 'custom-openai';

interface ProviderSpec {
  id: ProviderId;
  title: string;
  description: string;
  requiresApiKey: boolean;
  showBaseUrl: boolean;
  defaultBaseUrl: string;
}

const PROVIDERS: ProviderSpec[] = [
  {
    id: 'openai',
    title: 'OpenAI',
    description: 'GPT-4o, GPT-4.1, o3, o4-mini and more',
    requiresApiKey: true,
    showBaseUrl: false,
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'deepseek',
    title: 'DeepSeek',
    description: 'DeepSeek-V3, DeepSeek-R1',
    requiresApiKey: true,
    showBaseUrl: false,
    defaultBaseUrl: 'https://api.deepseek.com/v1',
  },
  {
    id: 'ollama',
    title: 'Ollama (Local)',
    description: 'Run open-source models locally',
    requiresApiKey: false,
    showBaseUrl: true,
    defaultBaseUrl: 'http://localhost:11434/v1',
  },
  {
    id: 'custom-openai',
    title: 'Custom (OpenAI-Compatible)',
    description: 'Any OpenAI-compatible API endpoint',
    requiresApiKey: true,
    showBaseUrl: true,
    defaultBaseUrl: '',
  },
];

interface CardState {
  enabled: boolean;
  apiKey: string;
  apiKeyHasValue: boolean; // true if main process has a stored key (masked)
  baseUrl: string;
  showKey: boolean;
  saving: boolean;
  testing: boolean;
  status: { ok: boolean; error?: string; latencyMs?: number; models?: string[] } | null;
}

const emptyCard = (): CardState => ({
  enabled: false,
  apiKey: '',
  apiKeyHasValue: false,
  baseUrl: '',
  showKey: false,
  saving: false,
  testing: false,
  status: null,
});

export const ProviderSettingsView: React.FC = () => {
  const [cards, setCards] = useState<Record<ProviderId, CardState>>({
    openai: emptyCard(),
    deepseek: emptyCard(),
    ollama: emptyCard(),
    'custom-openai': emptyCard(),
  });
  const [activeProvider, setActiveProvider] = useState<string>('copilot');
  /** True when the user is signed in with a real GitHub account (not skip-login) */
  const [isCopilotAvailable, setIsCopilotAvailable] = useState(false);

  // Load current config from main process
  useEffect(() => {
    let alive = true;
    const api = window.electronAPI.provider;
    if (!api) return;

    (async () => {
      const [activeResult, ...configResults] = await Promise.all([
        api.getActive(),
        ...PROVIDERS.map((p) => api.getConfig(p.id)),
      ]);

      if (!alive) return;

      if (activeResult.success && activeResult.data) {
        setActiveProvider(activeResult.data);
      }

      // Check if the user is signed in with a real GitHub/Copilot account
      try {
        const sessionResult = await window.electronAPI.auth.getCurrentSession();
        if (sessionResult?.success && sessionResult.data) {
          const login = sessionResult.data?.ghcAuth?.user?.login;
          setIsCopilotAvailable(!!login && login !== '_local');
        }
      } catch {
        // Ignore — defaults to false
      }

      const newCards = { ...cards };
      PROVIDERS.forEach((p, i) => {
        const cfg = configResults[i];
        if (cfg.success && cfg.data) {
          newCards[p.id] = {
            ...emptyCard(),
            enabled: cfg.data.enabled || false,
            apiKeyHasValue: cfg.data.apiKey === '••••••••',
            baseUrl: cfg.data.baseUrl || '',
          };
        }
      });
      setCards(newCards);
    })();

    // Listen for provider switch events
    const unsub = api.onProviderSwitched?.((data: { activeProvider: string }) => {
      setActiveProvider(data.activeProvider);
      // Re-check auth status — Copilot may no longer be available after sign-out
      window.electronAPI.auth.getCurrentSession().then((res: any) => {
        if (res?.success && res.data) {
          const login = res.data?.ghcAuth?.user?.login;
          setIsCopilotAvailable(!!login && login !== '_local');
        } else {
          setIsCopilotAvailable(false);
        }
      }).catch(() => setIsCopilotAvailable(false));
    });

    return () => {
      alive = false;
      unsub?.();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateCard = useCallback((id: ProviderId, patch: Partial<CardState>) => {
    setCards((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const handleSave = useCallback(async (id: ProviderId) => {
    const api = window.electronAPI.provider;
    if (!api) return;

    const c = cards[id];
    updateCard(id, { saving: true, status: null });

    const spec = PROVIDERS.find((p) => p.id === id)!;
    const updates: Record<string, unknown> = { enabled: c.enabled };

    // Only send API key if user typed a new one (not blank)
    if (c.apiKey.length > 0) {
      updates.apiKey = c.apiKey;
    }

    if (spec.showBaseUrl && c.baseUrl.length > 0) {
      updates.baseUrl = c.baseUrl;
    }

    const result = await api.updateConfig(id, updates);
    updateCard(id, {
      saving: false,
      apiKeyHasValue: c.apiKey.length > 0 || c.apiKeyHasValue,
      status: result.success ? null : { ok: false, error: result.error || 'Save failed' },
    });
  }, [cards, updateCard]);

  const handleTest = useCallback(async (id: ProviderId) => {
    const api = window.electronAPI.provider;
    if (!api) return;

    // Auto-save if there are unsaved changes
    const c = cards[id];
    if (c.apiKey.length > 0 || c.baseUrl.length > 0) {
      await handleSave(id);
    }

    updateCard(id, { testing: true, status: null });

    const result = await api.testConnection(id);
    if (result.success && result.data) {
      const testResult = result.data;
      updateCard(id, {
        testing: false,
        status: {
          ok: testResult.success,
          error: testResult.error,
          latencyMs: testResult.latencyMs,
          models: testResult.sampleModels,
        },
      });
    } else {
      updateCard(id, {
        testing: false,
        status: { ok: false, error: result.error || 'Test failed' },
      });
    }
  }, [cards, handleSave, updateCard]);

  const handleSetActive = useCallback(async (id: ProviderId) => {
    const api = window.electronAPI.provider;
    if (!api) return;

    const result = await api.switch(id);
    if (result.success) {
      setActiveProvider(id);
    }
  }, []);

  const handleToggleEnabled = useCallback(async (id: ProviderId) => {
    const newEnabled = !cards[id].enabled;
    updateCard(id, { enabled: newEnabled });

    // Persist the toggle immediately
    const api = window.electronAPI.provider;
    if (api) {
      await api.updateConfig(id, { enabled: newEnabled });
    }
  }, [cards, updateCard]);

  return (
    <div className="p-4">
      <h1 className="text-base font-semibold mb-1">LLM Providers</h1>
      <p className="text-xs text-gray-500 mb-4">
        Configure API keys for LLM providers. The active provider is used for all chat and agent interactions.
      </p>

      {/* Active provider indicator */}
      <div className="mb-4 p-2 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-700">
        Active provider: <strong>{activeProvider === 'copilot' ? 'GitHub Copilot' : PROVIDERS.find(p => p.id === activeProvider)?.title || activeProvider}</strong>
      </div>

      <div className="space-y-3">
        {/* GitHub Copilot card — shown when user is signed in with a real GitHub account */}
        {isCopilotAvailable && (
          <div
            className={`border rounded-md p-3 bg-white ${activeProvider === 'copilot' ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {PROVIDER_ICONS.copilot && React.createElement(PROVIDER_ICONS.copilot, { size: 18 })}
                <h2 className="text-sm font-medium">GitHub Copilot</h2>
                {activeProvider === 'copilot' && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded">
                    ACTIVE
                  </span>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-2">
              Use models from your GitHub Copilot subscription
            </p>
            {activeProvider !== 'copilot' && (
              <button
                onClick={async () => {
                  const api = window.electronAPI.provider;
                  if (!api) return;
                  const result = await api.switch('copilot' as any);
                  if (result.success) setActiveProvider('copilot');
                }}
                className="px-3 py-1.5 text-sm rounded border border-blue-300 text-blue-600 hover:bg-blue-50"
              >
                Set as Active
              </button>
            )}
          </div>
        )}

        {PROVIDERS.map((spec) => {
          const c = cards[spec.id];
          const isActive = activeProvider === spec.id;

          return (
            <div
              key={spec.id}
              className={`border rounded-md p-3 bg-white ${isActive ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'}`}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {PROVIDER_ICONS[spec.id] && React.createElement(PROVIDER_ICONS[spec.id], { size: 18 })}
                  <h2 className="text-sm font-medium">{spec.title}</h2>
                  {isActive && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded">
                      ACTIVE
                    </span>
                  )}
                </div>
                <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    onChange={() => handleToggleEnabled(spec.id)}
                    className="rounded"
                  />
                  Enabled
                </label>
              </div>

              <p className="text-xs text-gray-500 mb-2">{spec.description}</p>

              {c.enabled && (
                <div className="space-y-2">
                  {/* API Key input */}
                  {spec.requiresApiKey && (
                    <div className="flex gap-2 items-center">
                      <div className="flex-1 relative">
                        <input
                          type={c.showKey ? 'text' : 'password'}
                          value={c.apiKey}
                          onChange={(e) => updateCard(spec.id, { apiKey: e.target.value, status: null })}
                          placeholder={c.apiKeyHasValue ? 'Key saved (enter new to replace)' : 'Paste your API key'}
                          className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm pr-10 focus:outline-none focus:border-blue-500"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => updateCard(spec.id, { showKey: !c.showKey })}
                          aria-label={c.showKey ? 'hide key' : 'show key'}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                        >
                          {c.showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Base URL input */}
                  {spec.showBaseUrl && (
                    <div>
                      <label className="text-xs text-gray-500 mb-0.5 block">Base URL</label>
                      <input
                        type="text"
                        value={c.baseUrl}
                        onChange={(e) => updateCard(spec.id, { baseUrl: e.target.value, status: null })}
                        placeholder={spec.defaultBaseUrl || 'https://your-api.example.com/v1'}
                        className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                        autoComplete="off"
                      />
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      disabled={c.saving}
                      onClick={() => handleSave(spec.id)}
                      className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white disabled:bg-gray-300 disabled:cursor-not-allowed hover:bg-blue-700"
                    >
                      {c.saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      disabled={c.testing || (!c.apiKeyHasValue && !c.apiKey && spec.requiresApiKey)}
                      onClick={() => handleTest(spec.id)}
                      className="px-3 py-1.5 text-sm rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      {c.testing ? (
                        <span className="flex items-center gap-1">
                          <Loader2 size={12} className="animate-spin" /> Testing...
                        </span>
                      ) : (
                        'Test Connection'
                      )}
                    </button>
                    {!isActive && c.enabled && (c.apiKeyHasValue || c.apiKey || !spec.requiresApiKey) && (
                      <button
                        onClick={() => handleSetActive(spec.id)}
                        className="px-3 py-1.5 text-sm rounded border border-blue-300 text-blue-600 hover:bg-blue-50"
                      >
                        Set as Active
                      </button>
                    )}
                  </div>

                  {/* Status */}
                  {c.status && (
                    <div className={`mt-1 text-xs flex items-start gap-1 ${c.status.ok ? 'text-green-600' : 'text-red-600'}`}>
                      {c.status.ok ? <Check size={12} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />}
                      <div>
                        {c.status.ok ? (
                          <>
                            Connected ({c.status.latencyMs}ms)
                            {c.status.models && c.status.models.length > 0 && (
                              <span className="text-gray-500"> — Models: {c.status.models.join(', ')}</span>
                            )}
                          </>
                        ) : (
                          c.status.error || 'Connection failed'
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ProviderSettingsView;
