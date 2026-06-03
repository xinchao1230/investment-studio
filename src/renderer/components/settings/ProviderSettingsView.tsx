import React, { useEffect, useState, useCallback } from 'react';
import { Eye, EyeOff, Check, AlertCircle, Loader2, Cpu, LogOut } from 'lucide-react';
import { PROVIDER_ICONS, GitHubIcon } from '../ui/icons/ProviderIcons';
import { Badge } from '../ui/badge';
import { useAuthContext } from '../auth/AuthProvider';
import { SKIP_LOGIN_ALIAS } from '@shared/constants/auth';
import '../../styles/Header.css';
import '../../styles/ContentView.css';
import '../../styles/RuntimeSettings.css';

/** Active provider pill tint — brand accent, distinct from the neutral enabled pills.
 *  Uses the --si-* design tokens so it follows the app theme (CSS vars are valid
 *  inside React inline-style string values; the browser resolves them). */
const ACTIVE_PILL_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--si-accent-soft)',
  color: 'var(--si-gold)',
};

/** Non-active pill tint — neutral grey, so only the active provider carries the
 *  brand accent. Uses --si-* neutral tokens to follow the app theme. Overrides
 *  the default unified-badge-normal fill, which is itself a soft brand tint. */
const INACTIVE_PILL_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--si-code-bg)',
  color: 'var(--si-muted)',
};

type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'custom-dynamic';

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
    description: 'GPT-5.5, GPT-5.4, o-series reasoning models',
    requiresApiKey: true,
    showBaseUrl: false,
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  {
    id: 'anthropic',
    title: 'Anthropic (Claude)',
    description: 'Claude Opus 4.8, Sonnet 4.6, Haiku 4.5',
    requiresApiKey: true,
    showBaseUrl: false,
    defaultBaseUrl: 'https://api.anthropic.com',
  },
  {
    id: 'gemini',
    title: 'Google (Gemini)',
    description: 'Gemini 3.1 Pro, 3.5 Flash, 2.5 Pro',
    requiresApiKey: true,
    showBaseUrl: false,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
  },
  {
    id: 'custom-dynamic',
    title: 'Custom (Auto-Detected)',
    description: 'Any OpenAI-, Anthropic-, or Gemini-compatible endpoint — protocol auto-detected',
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
  /** custom-dynamic only: the auto-detected wire protocol, if known. */
  detectedProtocol?: 'openai' | 'anthropic' | 'gemini';
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
  detectedProtocol: undefined,
});

/** Display metadata for the auto-detected protocol badge (custom-dynamic). */
const PROTOCOL_BADGE: Record<'openai' | 'anthropic' | 'gemini', { label: string; Icon: React.FC<{ size?: number }> }> = {
  openai: { label: 'OAI Compatible', Icon: PROVIDER_ICONS['openai'] },
  anthropic: { label: 'Claude Compatible', Icon: PROVIDER_ICONS['anthropic'] },
  gemini: { label: 'Gemini Compatible', Icon: PROVIDER_ICONS['gemini'] },
};

/**
 * Format a model list for the one-line "Connected" status row. When an endpoint
 * returns many models, the full comma-joined list overflows the card width
 * (e.g. http://localhost:4141/ returning dozens of claude-* variants). Show the
 * first few names in full, then summarize the remainder as "+X more".
 *
 * @param models  Full list of model IDs from the connection test.
 * @param maxShown  How many leading models to render in full (default 3).
 * @returns  A single human-readable string for inline display.
 */
const formatModelList = (models: string[], maxShown = 3): string => {
  if (models.length <= maxShown) return models.join(', ');
  const shown = models.slice(0, maxShown).join(', ');
  return `${shown} +${models.length - maxShown} more`;
};

export const ProviderSettingsView: React.FC = () => {
  const [cards, setCards] = useState<Record<ProviderId, CardState>>({
    openai: emptyCard(),
    anthropic: emptyCard(),
    gemini: emptyCard(),
    'custom-dynamic': emptyCard(),
  });
  const [activeProvider, setActiveProvider] = useState<string>('copilot');
  /** True when the user is signed in with a real GitHub account (not skip-login) */
  const [isCopilotAvailable, setIsCopilotAvailable] = useState(false);
  const [copilotUser, setCopilotUser] = useState<{ login: string; name?: string; email?: string; avatarUrl?: string; copilotPlan?: string } | null>(null);

  // Sign in/out — moved here from the Settings side-pane footer. Same auth
  // context, same three-state logic (spinner → sign-out glyph → GitHub mark),
  // rendered as a header action button on the right (like MCP's "+").
  const { signOut, authData } = useAuthContext();
  const [isSigningOut, setIsSigningOut] = useState(false);
  // Gates the "enable a provider" guidance banner so it never flashes before the
  // initial provider config has loaded (we don't yet know if any are enabled).
  const [configLoaded, setConfigLoaded] = useState(false);
  const isCopilotUser = authData?.ghcAuth?.alias !== SKIP_LOGIN_ALIAS;

  const handleSignOut = useCallback(async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  }, [signOut, isSigningOut]);

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
          if (login && login !== '_local') {
            const u = sessionResult.data.ghcAuth.user;
            setCopilotUser({ login: u.login, name: u.name, email: u.email, avatarUrl: u.avatarUrl, copilotPlan: u.copilotPlan });
          }
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
            detectedProtocol: cfg.data.detectedProtocol,
          };
        }
      });
      setCards(newCards);
      setConfigLoaded(true);
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
        ...(testResult.detectedProtocol ? { detectedProtocol: testResult.detectedProtocol } : {}),
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

  // Resolve a provider id to a short pill label (covers Copilot, which isn't in
  // PROVIDERS). Strips any "(...)" qualifier so pills stay compact, e.g.
  // "Custom (OpenAI-Compatible)" -> "Custom". The custom endpoint reads "Custom LLM".
  const providerLabel = useCallback((id: string): string => {
    if (id === 'copilot') return 'GitHub Copilot';
    if (id === 'custom-dynamic') return 'Custom LLM';
    const title = PROVIDERS.find((p) => p.id === id)?.title || id;
    return title.replace(/\s*\(.*\)\s*$/, '').trim();
  }, []);

  // A provider is "eligible" when it could be set as the active provider right
  // now: enabled AND holding a usable credential (a saved API key, or none
  // required). This mirrors the "Set as Active" button gate below, but counts
  // only persisted keys (apiKeyHasValue) — a key typed but not yet saved does
  // not qualify. The header pills reflect this eligibility, not the raw toggle.
  const isEligibleToActivate = (id: string): boolean => {
    if (id === 'copilot') return isCopilotAvailable; // credential is the GitHub login
    const spec = PROVIDERS.find((p) => p.id === id);
    const c = cards[id as ProviderId];
    if (!spec || !c) return false;
    return c.enabled && (c.apiKeyHasValue || !spec.requiresApiKey);
  };

  // Status pills: one per eligible provider, plus the active provider even if it
  // is not currently eligible (so the header always reflects what is actually
  // serving requests).
  const eligibleProviderIds = PROVIDERS.filter((p) => isEligibleToActivate(p.id)).map((p) => p.id as string);
  if (isCopilotAvailable && !eligibleProviderIds.includes('copilot')) {
    // Copilot has no enable toggle; signed-in IS eligible.
    eligibleProviderIds.push('copilot');
  }

  // Guidance banner: a skip-login user has no usable model until a non-Copilot
  // provider is eligible (enabled AND has a saved key) AND set as the active
  // provider. This mirrors the "Back to workspace" button gate in
  // SettingsNavigation, so the banner disappears at the same instant that button
  // un-greys. Self-healing (no manual dismiss — its absence IS the confirmation
  // of success). Gated on configLoaded so it never flashes during the initial
  // async load.
  const showEnableProviderHint =
    configLoaded &&
    !isCopilotUser &&
    (activeProvider === 'copilot' || eligibleProviderIds.length === 0);
  // Include the active provider so its pill leads the row — but only when it is
  // actually usable right now. A persisted activeProvider ('copilot' by default)
  // must NOT surface a pill while signed out / without a credential, otherwise
  // the header advertises a provider that cannot serve requests (e.g. the
  // "GitHub Copilot" badge lingering after sign-out). When the active provider
  // is not eligible and not already in the list, the header falls back to the
  // "no active provider" empty state.
  const withActive = eligibleProviderIds.includes(activeProvider)
    ? eligibleProviderIds
    : isEligibleToActivate(activeProvider)
      ? [...eligibleProviderIds, activeProvider]
      : eligibleProviderIds;
  const pillProviderIds = [
    ...withActive.filter((id) => id === activeProvider),
    ...withActive.filter((id) => id !== activeProvider),
  ];

  return (
    <div className="runtime-settings-view">
      <div className="unified-header">
        <div className="header-title">
          <Cpu size={20} />
          <span className="header-name">LLM Providers</span>
          <div className="mcp-status-badges">
            {/* A badge means "this provider is usable". When nothing is usable
                we render nothing — an empty badge row is honest by absence, no
                "no active provider" placeholder noise. */}
            {pillProviderIds.map((id) => {
                const isActive = id === activeProvider;
                // Pills show only the provider name to avoid confusion. The
                // status word survives as a hover tooltip for discoverability.
                const statusWord = id === 'copilot' ? 'Signed in' : 'Enabled';
                return (
                  <Badge
                    key={id}
                    variant="normal"
                    className="text-xs"
                    style={isActive ? ACTIVE_PILL_STYLE : INACTIVE_PILL_STYLE}
                    title={isActive ? 'Active provider' : statusWord}
                  >
                    {providerLabel(id)}
                  </Badge>
                );
              })}
          </div>
        </div>
        {/* Right-aligned header action (like MCP's "+"): GitHub Copilot
            sign IN — only shown when signed out. Once signed in, the sign-out
            control moves into the GitHub Copilot card's top-right corner. */}
        {!isCopilotUser && (
          <div className="header-actions">
            <button
              className="btn-action"
              onClick={handleSignOut}
              disabled={isSigningOut}
              title={isSigningOut ? 'Signing out…' : 'Sign in with GitHub Copilot'}
              aria-label="Sign in with GitHub Copilot"
            >
              {isSigningOut ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <GitHubIcon size={20} />
              )}
            </button>
          </div>
        )}
      </div>

      <div className="content-view-container">
        <div className="settings-form-centered">
          {showEnableProviderHint && (
            <div
              className="flex items-start gap-2.5 rounded-md p-3 mb-4 text-xs"
              style={{
                backgroundColor: 'var(--si-accent-soft)',
                border: '1px solid var(--si-gold)',
                color: 'var(--si-ink)',
              }}
              role="status"
            >
              <AlertCircle
                size={16}
                style={{ color: 'var(--si-gold)', flexShrink: 0, marginTop: 1 }}
              />
              <div>
                <div className="font-medium" style={{ color: 'var(--si-gold)' }}>
                  Configure a LLM provider and then click left bottom button to start.
                </div>
              </div>
            </div>
          )}
          <p className="text-xs text-[var(--si-muted)] mb-4">
            Configure API keys for LLM providers. The active provider is used for all chat and agent interactions.
          </p>

          <div className="space-y-3">
        {/* GitHub Copilot card — shown when user is signed in with a real GitHub account */}
        {isCopilotAvailable && (
          <div
            className={`border rounded-md p-3 bg-[var(--si-card)] ${activeProvider === 'copilot' ? 'border-[var(--si-gold)] ring-1 ring-[var(--si-accent-soft)]' : 'border-[var(--si-border)]'}`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {PROVIDER_ICONS.copilot && React.createElement(PROVIDER_ICONS.copilot, { size: 18 })}
                <h2 className="text-sm font-medium">GitHub Copilot</h2>
                {activeProvider === 'copilot' && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium rounded" style={ACTIVE_PILL_STYLE}>
                    ACTIVE
                  </span>
                )}
              </div>
              {/* Sign out — top-right of the card (only present when signed in,
                  which is exactly when this card renders). */}
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                title={isSigningOut ? 'Signing out…' : 'Sign out of GitHub Copilot'}
                aria-label="Sign out of GitHub Copilot"
                className="flex items-center justify-center w-7 h-7 rounded text-[var(--si-muted)] hover:bg-[var(--si-code-bg)] hover:text-[var(--si-ink)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSigningOut ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <LogOut size={16} />
                )}
              </button>
            </div>
            <p className="text-xs text-[var(--si-muted)] mb-2">
              Use models from your GitHub Copilot subscription
            </p>
            {copilotUser && (
              <div className="flex items-center gap-1.5 mb-2">
                {copilotUser.avatarUrl && (
                  <img
                    src={copilotUser.avatarUrl}
                    alt={copilotUser.login}
                    style={{ width: 16, height: 16 }}
                    className="rounded-full"
                  />
                )}
                <span className="text-xs text-[var(--si-muted)]">
                  Signed in as <span className="font-medium text-[var(--si-ink)]">{copilotUser.login}</span>
                  {copilotUser.name ? ` (${copilotUser.name})` : ''}
                </span>
                {copilotUser.copilotPlan && copilotUser.copilotPlan !== 'none' && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-[var(--si-code-bg)] text-[var(--si-muted)] rounded">
                    {copilotUser.copilotPlan}
                  </span>
                )}
              </div>
            )}
            {activeProvider !== 'copilot' && (
              <button
                onClick={async () => {
                  const api = window.electronAPI.provider;
                  if (!api) return;
                  const result = await api.switch('copilot' as any);
                  if (result.success) setActiveProvider('copilot');
                }}
                className="px-3 py-1.5 text-sm rounded border border-[var(--si-border-strong)] text-[var(--si-ink)] hover:bg-[var(--si-code-bg)]"
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
              className={`relative border rounded-md p-3 bg-[var(--si-card)] ${isActive ? 'border-[var(--si-gold)] ring-1 ring-[var(--si-accent-soft)]' : 'border-[var(--si-border)]'}`}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {PROVIDER_ICONS[spec.id] && React.createElement(PROVIDER_ICONS[spec.id], { size: 18 })}
                  <h2 className="text-sm font-medium">{providerLabel(spec.id)}</h2>
                  {isActive && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded" style={ACTIVE_PILL_STYLE}>
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
                    style={{ accentColor: 'var(--si-gold)' }}
                  />
                  Enabled
                </label>
              </div>

              <p className="text-xs text-[var(--si-muted)] mb-2">{spec.description}</p>

              {c.enabled && (
                <div className="space-y-2">
                  {/* API Key input */}
                  {spec.requiresApiKey && (
                    <div className="flex gap-2 items-center">
                      <div className="flex-1 relative">
                        <input
                          type={c.showKey ? 'text' : 'password'}
                          value={c.apiKey}
                          onChange={(e) => updateCard(spec.id, { apiKey: e.target.value, status: null, detectedProtocol: undefined })}
                          placeholder={c.apiKeyHasValue ? 'Key saved (enter new to replace)' : 'Paste your API key'}
                          className="w-full border border-[var(--si-border)] rounded px-3 py-1.5 text-sm pr-10 focus:outline-none focus:border-[var(--si-ink)]"
                          autoComplete="off"
                        />
                        <button
                          type="button"
                          onClick={() => updateCard(spec.id, { showKey: !c.showKey })}
                          aria-label={c.showKey ? 'hide key' : 'show key'}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--si-faint)] hover:text-[var(--si-muted)]"
                        >
                          {c.showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Base URL input */}
                  {spec.showBaseUrl && (
                    <div>
                      <label className="text-xs text-[var(--si-muted)] mb-0.5 block">Base URL</label>
                      <input
                        type="text"
                        value={c.baseUrl}
                        onChange={(e) => updateCard(spec.id, { baseUrl: e.target.value, status: null, detectedProtocol: undefined })}
                        placeholder={spec.defaultBaseUrl || 'https://your-api.example.com/v1'}
                        className="w-full border border-[var(--si-border)] rounded px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--si-ink)]"
                        autoComplete="off"
                      />
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      disabled={c.saving || c.testing || (!c.apiKeyHasValue && !c.apiKey && spec.requiresApiKey)}
                      onClick={() => handleTest(spec.id)}
                      className="px-3 py-1.5 text-sm rounded bg-[var(--si-gold)] text-white disabled:bg-[var(--si-border)] disabled:cursor-not-allowed hover:bg-[var(--si-accent-strong)]"
                    >
                      {c.saving || c.testing ? (
                        <span className="flex items-center gap-1">
                          <Loader2 size={12} className="animate-spin" /> {c.saving ? 'Saving...' : 'Connecting...'}
                        </span>
                      ) : (
                        'Save and Connect'
                      )}
                    </button>
                    {!isActive && c.enabled && (c.apiKeyHasValue || c.apiKey || !spec.requiresApiKey) && (
                      <button
                        onClick={() => handleSetActive(spec.id)}
                        className="px-3 py-1.5 text-sm rounded border border-[var(--si-border-strong)] text-[var(--si-ink)] hover:bg-[var(--si-code-bg)]"
                      >
                        Set as Active
                      </button>
                    )}
                  </div>

                  {/* Status */}
                  {c.status && (
                    <div className={`mt-1 text-xs flex items-start gap-1 ${c.status.ok ? 'text-green-600' : 'text-red-600'}`}>
                      {c.status.ok ? <Check size={12} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />}
                      <div className="min-w-0 truncate">
                        {c.status.ok ? (
                          <>
                            Connected ({c.status.latencyMs}ms)
                            {c.status.models && c.status.models.length > 0 && (
                              <span className="text-[var(--si-muted)]" title={c.status.models.join(', ')}> — Models: {formatModelList(c.status.models)}</span>
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

              {/* Auto-detected protocol badge (custom-dynamic only) — bottom-right corner */}
              {spec.id === 'custom-dynamic' && c.detectedProtocol && (() => {
                const badge = PROTOCOL_BADGE[c.detectedProtocol];
                return (
                  <span
                    className="absolute bottom-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border"
                    style={{
                      backgroundColor: 'var(--si-accent-soft)',
                      color: 'var(--si-gold)',
                      borderColor: 'var(--si-accent-strong)',
                    }}
                    title={`Endpoint auto-detected as ${badge.label}`}
                  >
                    {badge.Icon && <badge.Icon size={11} />}
                    {badge.label}
                  </span>
                );
              })()}
            </div>
          );
        })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProviderSettingsView;
