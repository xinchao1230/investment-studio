import React, { useEffect, useState, useCallback } from 'react';
import { Eye, EyeOff, Check, AlertCircle, Loader2, Cpu, LogOut } from 'lucide-react';
import { PROVIDER_ICONS, GitHubIcon } from '../ui/icons/ProviderIcons';
import { Badge } from '../ui/badge';
import { useAuthContext } from '../auth/AuthProvider';
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

/**
 * The single user-configurable provider slot. Backed by the main process'
 * `custom-dynamic` provider, which auto-detects whether the endpoint speaks the
 * OpenAI, Anthropic, or Gemini wire protocol and routes accordingly. The UI
 * presents it as one "My LLM Provider" card — the user only supplies a base URL
 * and API key; everything else (protocol, model list, activation) is automatic.
 */
const MY_PROVIDER_ID = 'custom-dynamic' as const;
type ProviderId = typeof MY_PROVIDER_ID;

/**
 * Preset endpoints surfaced as a dropdown on the Base URL field. The field stays
 * free-text (any custom endpoint is allowed) — these are only suggestions, wired
 * via a native <datalist> so picking one fills the input without locking it.
 */
const BASE_URL_PRESETS: { label: string; url: string }[] = [
  { label: 'OpenAI', url: 'https://api.openai.com/v1' },
  { label: 'Claude', url: 'https://api.anthropic.com' },
  { label: 'Gemini', url: 'https://generativelanguage.googleapis.com' },
];

interface CardState {
  /** Mirrors the persisted `enabled` flag. There is no UI toggle anymore — a
   *  successful "Save and Connect" forces this true so the backend's switch and
   *  workspace-unlock gates (which require `enabled`) are satisfied. */
  enabled: boolean;
  apiKey: string;
  apiKeyHasValue: boolean; // true if main process has a stored key (masked)
  baseUrl: string;
  showKey: boolean;
  saving: boolean;
  testing: boolean;
  status: { ok: boolean; error?: string; latencyMs?: number; models?: string[] } | null;
  /** The auto-detected wire protocol for this endpoint, once known. */
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

/** Display metadata for the auto-detected protocol badge. */
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
  const [card, setCard] = useState<CardState>(emptyCard());
  const [activeProvider, setActiveProvider] = useState<string>('copilot');
  /** True when the user is signed in with a real GitHub account (not skip-login) */
  const [isCopilotAvailable, setIsCopilotAvailable] = useState(false);
  const [copilotUser, setCopilotUser] = useState<{ login: string; name?: string; email?: string; avatarUrl?: string; copilotPlan?: string } | null>(null);

  // Sign in/out — same auth context, same three-state logic (spinner → sign-out
  // glyph → GitHub mark), rendered as a header action button on the right.
  const { signOut } = useAuthContext();
  const [isSigningOut, setIsSigningOut] = useState(false);

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
      const [activeResult, configResult] = await Promise.all([
        api.getActive(),
        api.getConfig(MY_PROVIDER_ID),
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

      if (configResult.success && configResult.data) {
        setCard({
          ...emptyCard(),
          enabled: configResult.data.enabled || false,
          apiKeyHasValue: configResult.data.apiKey === '••••••••',
          baseUrl: configResult.data.baseUrl || '',
          detectedProtocol: configResult.data.detectedProtocol,
        });
      }
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

  const updateCard = useCallback((patch: Partial<CardState>) => {
    setCard((prev) => ({ ...prev, ...patch }));
  }, []);

  /**
   * One atomic flow: persist the config (always `enabled: true`), test the
   * connection, and — on success — switch this provider to active. There is no
   * separate "Enable" toggle or "Set as Active" step; connecting IS activating.
   * Auto-activation fires `provider:switched` + `models:updated` in the main
   * process, which the Settings nav listens to and uses to unlock the workspace.
   */
  const handleSaveAndConnect = useCallback(async () => {
    const api = window.electronAPI.provider;
    if (!api) return;

    const c = card;
    updateCard({ saving: true, status: null });

    // Persist. enabled is forced true; only send the API key if the user typed a
    // fresh one (a blank field means "keep the stored key").
    const updates: Record<string, unknown> = { enabled: true };
    if (c.apiKey.length > 0) updates.apiKey = c.apiKey;
    if (c.baseUrl.length > 0) updates.baseUrl = c.baseUrl;

    const saveResult = await api.updateConfig(MY_PROVIDER_ID, updates);
    if (!saveResult.success) {
      updateCard({ saving: false, status: { ok: false, error: saveResult.error || 'Save failed' } });
      return;
    }

    updateCard({
      saving: false,
      enabled: true,
      apiKeyHasValue: c.apiKey.length > 0 || c.apiKeyHasValue,
      testing: true,
    });

    // Test connectivity (this also re-runs protocol auto-detection in the backend).
    const result = await api.testConnection(MY_PROVIDER_ID);
    if (result.success && result.data) {
      const t = result.data;
      updateCard({
        testing: false,
        ...(t.detectedProtocol ? { detectedProtocol: t.detectedProtocol } : {}),
        status: {
          ok: t.success,
          error: t.error,
          latencyMs: t.latencyMs,
          models: t.sampleModels,
        },
      });

      // Success → make this the active provider automatically.
      if (t.success) {
        const sw = await api.switch(MY_PROVIDER_ID);
        if (sw.success) setActiveProvider(MY_PROVIDER_ID);
      }
    } else {
      updateCard({ testing: false, status: { ok: false, error: result.error || 'Test failed' } });
    }
  }, [card, updateCard]);

  // When Copilot is available (signed in), the app defaults to Copilot only —
  // the My LLM Provider card is hidden and its slot is not offered.
  const showMyProvider = !isCopilotAvailable;

  // Status pills: only Copilot gets a header pill. The My LLM Provider slot is
  // the sole provider in its mode (always active when present), so a pill for it
  // would be redundant noise — omit it.
  const pillProviderIds: string[] = [];
  if (isCopilotAvailable) pillProviderIds.push('copilot');

  const providerLabel = useCallback((id: string): string => {
    if (id === 'copilot') return 'GitHub Copilot';
    return 'My LLM Provider';
  }, []);

  const MyProviderIcon = PROVIDER_ICONS[MY_PROVIDER_ID];

  return (
    <div className="runtime-settings-view">
      <div className="unified-header">
        <div className="header-title">
          <Cpu size={20} />
          <span className="header-name">LLM Providers</span>
          <div className="mcp-status-badges">
            {/* A badge means "this provider is usable". When nothing is usable
                we render nothing — an empty badge row is honest by absence. */}
            {pillProviderIds.map((id) => {
              const active = id === activeProvider;
              const statusWord = id === 'copilot' ? 'Signed in' : 'Connected';
              return (
                <Badge
                  key={id}
                  variant="normal"
                  className="text-xs"
                  style={active ? ACTIVE_PILL_STYLE : INACTIVE_PILL_STYLE}
                  title={active ? 'Active provider' : statusWord}
                >
                  {providerLabel(id)}
                </Badge>
              );
            })}
          </div>
        </div>
        {/* Right-aligned header action: GitHub Copilot Sign in — shown only when
            Copilot is unavailable (signed out), which is exactly when the
            My LLM Provider card is showing and the Copilot card is hidden. Once
            signed in, this disappears and the sign-out control lives inside the
            Copilot card. */}
        {!isCopilotAvailable && (
          <div className="header-actions">
            <button
              className="btn-action"
              onClick={handleSignOut}
              disabled={isSigningOut}
              title={isSigningOut ? 'Signing in…' : 'Sign in with GitHub Copilot'}
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
          <p className="text-xs text-[var(--si-muted)] mb-4">
            Connect your own LLM endpoint. Enter a base URL and API key, then click Save and Connect — once the test passes it becomes the active provider automatically.
          </p>

          <div className="space-y-3">
            {/* GitHub Copilot card — shown only when signed in (Copilot
                available). When signed out, the Copilot card is hidden and the
                My LLM Provider card takes over, with the Sign in button living
                in the page header's top-right corner. */}
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

            {/* My LLM Provider — hidden when Copilot is available (signed in),
                so a Copilot user defaults to Copilot only. Only a skip-login
                user (Copilot unavailable) sees and configures this endpoint. */}
            {showMyProvider && (
            <div className="relative border border-[var(--si-border)] rounded-md p-3 bg-[var(--si-card)]">
              {/* Header */}
              <div className="flex items-center gap-2 mb-2">
                {MyProviderIcon && React.createElement(MyProviderIcon, { size: 18 })}
                <h2 className="text-sm font-medium">My LLM Provider</h2>
              </div>

              <p className="text-xs text-[var(--si-muted)] mb-2">
                Any OpenAI-, Claude-, or Gemini-compatible endpoint — the protocol is auto-detected.
              </p>

              <div className="space-y-2">
                {/* Base URL input with preset suggestions */}
                <div>
                  <label className="text-xs text-[var(--si-muted)] mb-0.5 block">Base URL</label>
                  <input
                    type="text"
                    list="my-llm-base-url-presets"
                    value={card.baseUrl}
                    onChange={(e) => updateCard({ baseUrl: e.target.value, status: null, detectedProtocol: undefined })}
                    placeholder="Select a preset or paste your endpoint URL"
                    className="w-full border border-[var(--si-border)] rounded px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--si-ink)]"
                    autoComplete="off"
                  />
                  <datalist id="my-llm-base-url-presets">
                    {BASE_URL_PRESETS.map((p) => (
                      <option key={p.url} value={p.url}>
                        {p.label}
                      </option>
                    ))}
                  </datalist>
                </div>

                {/* API Key input */}
                <div>
                  <label className="text-xs text-[var(--si-muted)] mb-0.5 block">API Key</label>
                  <div className="relative">
                    <input
                      type={card.showKey ? 'text' : 'password'}
                      value={card.apiKey}
                      onChange={(e) => updateCard({ apiKey: e.target.value, status: null, detectedProtocol: undefined })}
                      placeholder={card.apiKeyHasValue ? 'Key saved (enter new to replace)' : 'Paste your API key'}
                      className="w-full border border-[var(--si-border)] rounded px-3 py-1.5 text-sm pr-10 focus:outline-none focus:border-[var(--si-ink)]"
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      onClick={() => updateCard({ showKey: !card.showKey })}
                      aria-label={card.showKey ? 'hide key' : 'show key'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--si-faint)] hover:text-[var(--si-muted)]"
                    >
                      {card.showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                {/* Action button */}
                <div className="flex gap-2">
                  <button
                    disabled={card.saving || card.testing || (!card.apiKeyHasValue && !card.apiKey)}
                    onClick={handleSaveAndConnect}
                    className="px-3 py-1.5 text-sm rounded bg-[var(--si-gold)] text-white disabled:bg-[var(--si-border)] disabled:cursor-not-allowed hover:bg-[var(--si-accent-strong)]"
                  >
                    {card.saving || card.testing ? (
                      <span className="flex items-center gap-1">
                        <Loader2 size={12} className="animate-spin" /> {card.saving ? 'Saving...' : 'Connecting...'}
                      </span>
                    ) : (
                      'Save and Connect'
                    )}
                  </button>
                </div>

                {/* Status */}
                {card.status && (
                  <div className={`mt-1 text-xs flex items-start gap-1 ${card.status.ok ? 'text-green-600' : 'text-red-600'}`}>
                    {card.status.ok ? <Check size={12} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={12} className="mt-0.5 flex-shrink-0" />}
                    <div className="min-w-0 truncate">
                      {card.status.ok ? (
                        <>
                          Connected ({card.status.latencyMs}ms)
                          {card.status.models && card.status.models.length > 0 && (
                            <span className="text-[var(--si-muted)]" title={card.status.models.join(', ')}> — Models: {formatModelList(card.status.models)}</span>
                          )}
                        </>
                      ) : (
                        card.status.error || 'Connection failed'
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Auto-detected protocol badge — bottom-right corner */}
              {card.detectedProtocol && (() => {
                const badge = PROTOCOL_BADGE[card.detectedProtocol];
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
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProviderSettingsView;
