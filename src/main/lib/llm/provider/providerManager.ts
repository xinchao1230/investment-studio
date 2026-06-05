// src/main/lib/llm/provider/providerManager.ts
/**
 * ProviderManager — Singleton router for all LLM calls.
 *
 * Responsibilities:
 *   1. Manage provider instances (create, configure, switch)
 *   2. Persist provider configuration to disk (encrypted API keys)
 *   3. Route all chatCompletion / chatCompletionStream calls to the active provider
 *   4. Provide model lists aggregated from the active provider
 *
 * The entire app uses ONE active provider at a time. Switching providers
 * atomically updates the active provider and notifies the renderer.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app, safeStorage, BrowserWindow } from 'electron';
import { createLogger } from '../../unifiedLogger';
import {
  ILlmProvider,
  ProviderId,
  ProviderConfig,
  AllProvidersConfig,
  ProviderModel,
  ProviderInfo,
  ChatCompletionParams,
  ChatCompletionResult,
  ProviderStreamChunk,
  ConnectionTestResult,
  SKIP_LOGIN_ALIAS,
} from './types';
import { CopilotProvider } from './copilotProvider';
import { OpenAICompatibleProvider } from './openaiCompatibleProvider';
import { AnthropicProvider } from './anthropicProvider';
import { GeminiProvider } from './geminiProvider';
import { CustomDynamicProvider } from './customDynamicProvider';
import type { CustomProtocol } from './protocolDetector';
import { PROFILE_DIR_NAME } from '../../userDataADO/pathUtils';

const logger = createLogger();

/** Config file name stored per user profile */
const CONFIG_FILE_NAME = 'provider-config.json';
const CONFIG_VERSION = '1.0.0';
type ProviderConfigWithLegacyCount = ProviderConfig & { lastModelCount?: unknown };

/**
 * Provider factories for the fixed-config providers. `custom-dynamic` is created
 * separately in the constructor because it needs a persistence callback bound to
 * the manager instance (to write back its detected protocol).
 */
const PROVIDER_FACTORIES: Record<Exclude<ProviderId, 'custom-dynamic'>, () => ILlmProvider> = {
  copilot: () => new CopilotProvider(),
  openai: () => new OpenAICompatibleProvider('openai'),
  anthropic: () => new AnthropicProvider(),
  gemini: () => new GeminiProvider(),
};

export class ProviderManager {
  private static instance: ProviderManager;

  /** Map of instantiated providers */
  private providers: Map<ProviderId, ILlmProvider> = new Map();

  /** Current active provider ID */
  private activeProviderId: ProviderId = 'copilot';

  /** Current user alias (for locating config file) */
  private currentAlias: string | null = null;

  /** Loaded config */
  private config: AllProvidersConfig | null = null;

  /**
   * Ready gate — resolves when initialize() completes.
   * LLM call paths await this before reading activeProviderId,
   * preventing the race where calls arrive before config is loaded.
   */
  private readyPromise: Promise<void> | null = null;
  private initializationChain: Promise<void> = Promise.resolve();

  private constructor() {
    // Pre-instantiate the fixed-config providers so they're ready to configure.
    for (const [id, factory] of Object.entries(PROVIDER_FACTORIES)) {
      this.providers.set(id as ProviderId, factory());
    }
    // custom-dynamic gets a persistence callback so its protocol detection can
    // write `detectedProtocol` back to provider-config.json without the provider
    // itself touching disk. The callback captures the current alias at call time.
    this.providers.set(
      'custom-dynamic',
      new CustomDynamicProvider((protocol) => {
        void this.persistDetectedProtocol(protocol);
      }),
    );
  }

  /**
   * Persist the protocol detected for `custom-dynamic` into provider-config.json.
   * Called by the CustomDynamicProvider's detection callback (Test / Save / run-
   * time self-heal). Fire-and-forget; failure to persist is non-fatal (the verdict
   * still lives in memory for the session).
   */
  private async persistDetectedProtocol(protocol: CustomProtocol): Promise<void> {
    try {
      if (!this.config) this.config = this.getDefaultConfig();
      const existing = this.config.providers['custom-dynamic'] || { enabled: false };
      if (existing.detectedProtocol === protocol) return; // no-op if unchanged
      const nextConfig: AllProvidersConfig = {
        ...this.config,
        providers: {
          ...this.config.providers,
          'custom-dynamic': { ...existing, detectedProtocol: protocol },
        },
      };
      await this.saveConfig(nextConfig);
      this.config = nextConfig;
      logger.debug(`[ProviderManager] Persisted custom-dynamic protocol: ${protocol}`);
    } catch (error) {
      logger.warn(`[ProviderManager] Failed to persist detected protocol: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  static getInstance(): ProviderManager {
    if (!ProviderManager.instance) {
      ProviderManager.instance = new ProviderManager();
    }
    return ProviderManager.instance;
  }

  // ── Initialization ────────────────────────────────────────────────────

  /**
   * Initialize the provider manager for a user session.
   * Loads provider-config.json and configures all providers.
   */
  async initialize(alias?: string): Promise<void> {
    const run = this.initializationChain.then(() => this.initializeInternal(alias));
    this.readyPromise = run.catch(() => {});
    this.initializationChain = this.readyPromise;
    return run;
  }

  private async initializeInternal(alias?: string): Promise<void> {
    if (alias) {
      this.currentAlias = alias;
    }

    // Load config from disk
    this.config = await this.loadConfig();

    // Apply config to all providers
    this.activeProviderId = this.config.activeProvider;

    for (const [id, providerConfig] of Object.entries(this.config.providers)) {
      const provider = this.providers.get(id as ProviderId);
      if (provider && providerConfig) {
        // Decrypt API key before passing to provider
        const decryptedConfig = { ...providerConfig };
        if (decryptedConfig.apiKey) {
          decryptedConfig.apiKey = this.decryptApiKey(decryptedConfig.apiKey);
        }
        provider.configure(decryptedConfig);
      }
    }

    if (this.currentAlias === SKIP_LOGIN_ALIAS && this.activeProviderId === 'copilot') {
      const fallbackProvider = this.getFirstConfiguredNonCopilotProvider();
      if (fallbackProvider) {
        const nextConfig: AllProvidersConfig = { ...this.config, activeProvider: fallbackProvider };
        await this.saveConfig(nextConfig);
        this.config = nextConfig;
        this.activeProviderId = fallbackProvider;
      } else {
        // No non-Copilot provider configured yet. A skip-login (_local) user can
        // NOT use Copilot (it needs GitHub auth), so leaving the active pointer
        // at 'copilot' would make the UI advertise an unusable provider — e.g.
        // the model selector showing the GitHub/Copilot icon next to
        // "No models found". Point the active provider at the 'custom-dynamic'
        // slot instead (the "My LLM Provider" endpoint this user will configure):
        // its instance is always registered, so getActiveProvider() is safe, and
        // getActive() now reports a provider that matches what the user can
        // actually use. This is an IN-MEMORY redirect only — we deliberately do
        // NOT persist it (config.activeProvider stays 'copilot'), so the next
        // init re-evaluates from a clean slate. Chat remains gated by
        // hasApiKeyProvider() downstream, so no LLM call fires before a key exists.
        this.activeProviderId = 'custom-dynamic';
        logger.warn('[ProviderManager] Skip-login has no non-Copilot provider; defaulting active pointer to custom-dynamic (user must configure it in Settings)');
      }
    }

    // When a Copilot user signs in, auto-switch to the copilot provider.
    // This mirrors the skip-login → non-copilot fallback above: users who
    // previously used skip-login may have a non-copilot activeProvider saved
    // to disk, but once they authenticate with GitHub Copilot they should
    // default to the copilot provider.  Users can still switch providers
    // manually within a session via Settings; this only applies at sign-in.
    if (this.currentAlias && this.currentAlias !== SKIP_LOGIN_ALIAS && this.activeProviderId !== 'copilot') {
      logger.debug(`[ProviderManager] Copilot user detected, auto-switching from ${this.activeProviderId} to copilot`);
      const nextConfig: AllProvidersConfig = { ...this.config, activeProvider: 'copilot' };
      await this.saveConfig(nextConfig);
      this.config = nextConfig;
      this.activeProviderId = 'copilot';
      this.notifyRenderer('provider:switched', { activeProvider: 'copilot' });
    }

    // Warm the model cache for a USABLE non-Copilot active provider, so that
    // subsequent IPC calls (getModelById, getModelCapabilities, etc.) hit cache
    // instead of each firing a separate HTTP request to the provider.
    //
    // Gate on isActiveProviderUsable() (non-Copilot + enabled + credentialed) so
    // we NEVER warm an unconfigured endpoint. A skip-login user with no provider
    // configured has the active pointer redirected to an empty 'custom-dynamic'
    // (above); warming it would fire listModels() against a blank base URL on
    // every init — a guaranteed failed HTTP request plus log noise. The
    // models:updated push is gated too: with no usable provider there are no
    // models to surface, and the renderer reads its (empty) cache to show
    // "No models found" without needing a push.
    if (this.isActiveProviderUsable()) {
      this.getActiveProvider().listModels().catch((err) => {
        logger.warn(`[ProviderManager] Model cache warm failed: ${err instanceof Error ? err.message : String(err)}`);
      });

      // Push models:updated so the renderer loads models.
      // (GhcModelsManager only fires this event for Copilot models.)
      setTimeout(() => {
        this.notifyRenderer('models:updated', {
          count: 0,
          timestamp: Date.now(),
          source: 'provider-init',
        });
      }, 500);
    }

    logger.debug(`[ProviderManager] Initialized for ${alias || 'default'}, active provider: ${this.activeProviderId}`);
  }

  // ── Provider Access ───────────────────────────────────────────────────

  /**
   * Wait until initialize() has completed.
   * If initialize() was never called (normal Copilot login where no provider
   * config exists yet), resolves immediately — the default 'copilot' is correct.
   */
  async waitUntilReady(): Promise<void> {
    if (this.readyPromise) {
      await this.readyPromise;
    }
  }

  /** Get the currently active provider */
  getActiveProvider(): ILlmProvider {
    const provider = this.providers.get(this.activeProviderId);
    if (!provider) {
      throw new Error(`Active provider '${this.activeProviderId}' not found`);
    }
    return provider;
  }

  /** Get the active provider's ID */
  getActiveProviderId(): ProviderId {
    return this.activeProviderId;
  }

  /** Get a specific provider by ID */
  getProvider(id: ProviderId): ILlmProvider | undefined {
    return this.providers.get(id);
  }

  /** Get info for all registered providers */
  getAllProviderInfos(): ProviderInfo[] {
    return Array.from(this.providers.values()).map(p => p.info);
  }

  /** Get the current config for a specific provider */
  getProviderConfig(id: ProviderId): ProviderConfig | undefined {
    return this.config?.providers[id];
  }

  // ── Provider Switching ────────────────────────────────────────────────

  /**
   * Switch the active provider.
   * Validates that the target provider is enabled and has necessary credentials.
   */
  async switchProvider(targetId: ProviderId): Promise<{ success: boolean; error?: string }> {
    const provider = this.providers.get(targetId);
    if (!provider) {
      return { success: false, error: `Unknown provider: ${targetId}` };
    }

    // Copilot is authenticated by the GitHub session, not provider-config.json.
    // It intentionally has no persisted provider block.
    if (targetId === 'copilot') {
      if (this.currentAlias === SKIP_LOGIN_ALIAS) {
        return { success: false, error: 'Copilot requires GitHub sign-in.' };
      }
      if (!this.config) this.config = this.getDefaultConfig();
      const nextConfig: AllProvidersConfig = { ...this.config, activeProvider: targetId };
      await this.saveConfig(nextConfig);
      this.config = nextConfig;
      this.activeProviderId = targetId;
      this.notifyRenderer('provider:switched', { activeProvider: targetId });
      this.notifyRenderer('models:updated', {
        count: 0,
        timestamp: Date.now(),
        source: 'provider-switch',
      });
      logger.info(`[ProviderManager] Switched active provider to: ${targetId}`);
      return { success: true };
    }

    const config = this.config?.providers[targetId];
    if (!config?.enabled) {
      return { success: false, error: `Provider ${targetId} is not enabled. Configure it in Settings first.` };
    }

    // For API-key providers, check that a key is configured
    if (provider.info.requiresApiKey && !config.apiKey) {
      return { success: false, error: `Provider ${targetId} requires an API key. Add one in Settings.` };
    }

    if (provider.info.requiresApiKey && config.verified !== true) {
      return { success: false, error: `Provider ${targetId} has not been verified. Click Verify in Settings first.` };
    }

    if (this.config) {
      const nextConfig: AllProvidersConfig = { ...this.config, activeProvider: targetId };
      await this.saveConfig(nextConfig);
      this.config = nextConfig;
    }

    // Atomic switch after persistence succeeds.
    this.activeProviderId = targetId;

    // Notify renderer of provider switch
    this.notifyRenderer('provider:switched', { activeProvider: targetId });

    // Warm model cache then notify renderer so it fetches the new model list.
    // The notification must wait until the cache is warm; otherwise the renderer's
    // syncFromBackend() races with the cache-warm fetch and may get an empty list.
    provider.listModels()
      .catch((err) => {
        logger.warn(`[ProviderManager] Model cache warm on switch failed: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        this.notifyRenderer('models:updated', {
          count: 0,
          timestamp: Date.now(),
          source: 'provider-switch',
        });
      });

    logger.info(`[ProviderManager] Switched active provider to: ${targetId}`);
    return { success: true };
  }

  // ── Provider Configuration ────────────────────────────────────────────

  /**
   * Update configuration for a specific provider.
   * Encrypts the API key before persisting.
   */
  async updateProviderConfig(
    id: ProviderId,
    updates: Partial<ProviderConfig>
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.config) {
      this.config = this.getDefaultConfig();
    }

    const existing = this.config.providers[id] || { enabled: false };

    // Decrypt the stored API key before merging so we work with plaintext
    const decryptedExisting = { ...existing };
    if (decryptedExisting.apiKey) {
      decryptedExisting.apiKey = this.decryptApiKey(decryptedExisting.apiKey);
    }

    const merged: ProviderConfig = { ...decryptedExisting, ...updates };

    // Endpoint identity change → drop the stale detected-protocol verdict.
    //
    // For custom-dynamic, `detectedProtocol` is CACHED provider data: it records
    // which wire protocol the PREVIOUS endpoint spoke. Settings' Save only sends
    // {enabled, apiKey?, baseUrl?} — never the protocol — so without this, the old
    // verdict survives in `merged` and `provider.configure()` would momentarily
    // route the NEW endpoint through the OLD protocol's engine. detect() (below)
    // re-resolves it, but if that probe ever fails the wrong verdict would linger
    // and the chat/research model list would keep showing the previous endpoint's
    // models. Clearing it here guarantees a changed endpoint starts from a clean
    // slate and is re-detected from scratch — no cached protocol data carried over.
    if (id === 'custom-dynamic') {
      const endpointChanged =
        (updates.baseUrl !== undefined && updates.baseUrl !== decryptedExisting.baseUrl) ||
        (updates.apiKey !== undefined && updates.apiKey !== decryptedExisting.apiKey);
      if (endpointChanged) {
        delete merged.detectedProtocol;
        merged.verified = false;
        merged.verifiedAt = null;
        merged.lastConnectionError = null;
        merged.lastConnectionLatencyMs = null;
        merged.models = [];
        merged.rawModels = [];
        const mergedWithLegacyCount: ProviderConfigWithLegacyCount = merged;
        delete mergedWithLegacyCount.lastModelCount;
      }
    }

    // Encrypt API key for persistence
    const persistConfig = { ...merged };
    if (persistConfig.apiKey) {
      persistConfig.apiKey = this.encryptApiKey(persistConfig.apiKey);
    }

    const nextConfig: AllProvidersConfig = {
      ...this.config,
      providers: {
        ...this.config.providers,
        [id]: persistConfig,
      },
    };

    await this.saveConfig(nextConfig);
    this.config = nextConfig;

    // Apply to the live provider instance only after persistence succeeds so a
    // failed save does not create a misleading in-memory-only provider state.
    const provider = this.providers.get(id);
    if (provider) {
      provider.configure(merged);
    }

    // If we just reconfigured the ACTIVE provider, its model list may have changed
    // (new endpoint/key, or — for custom-dynamic — a different detected protocol
    // entirely). `provider.configure()` already invalidated the provider's internal
    // model cache; re-sync the renderer so downstream consumers (ModelSelector,
    // research chat) drop the stale list from init/last switch.
    this.notifyActiveModelsUpdated(id, 'provider-config-update');

    logger.debug(`[ProviderManager] Updated config for ${id}`);
    return { success: true };
  }

  /**
   * Warm the active provider's model cache and push `models:updated` so the
   * renderer's modelCacheManager re-syncs. Call this after any operation that can
   * change the active provider's model list (Save, Test/Connect — both run
   * custom-dynamic protocol detection, which can swap the entire upstream model
   * set). No-op unless `id` is the active provider; Copilot is skipped because
   * GhcModelsManager fires its own `models:updated`. The cache-warm is
   * fire-and-forget so callers (including UI-gating IPC handlers) never block.
   */
  private notifyActiveModelsUpdated(id: ProviderId, source: string): void {
    if (id !== this.activeProviderId || id === 'copilot') return;
    if (!this.isActiveProviderUsable()) {
      this.notifyRenderer('models:updated', {
        count: 0,
        timestamp: Date.now(),
        source,
      });
      return;
    }
    const provider = this.providers.get(id);
    if (!provider) return;
    provider.listModels()
      .catch((err) => {
        logger.warn(`[ProviderManager] Model cache warm (${source}) failed: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => {
        this.notifyRenderer('models:updated', {
          count: 0,
          timestamp: Date.now(),
          source,
        });
      });
  }

  // ── Delegated LLM Calls ──────────────────────────────────────────────

  /** Non-streaming chat completion through the active provider */
  async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    await this.waitUntilReady();
    return this.getActiveProvider().chatCompletion(params);
  }

  /** Streaming chat completion through the active provider */
  async chatCompletionStream(params: ChatCompletionParams): Promise<AsyncIterable<ProviderStreamChunk>> {
    await this.waitUntilReady();
    return this.getActiveProvider().chatCompletionStream(params);
  }

  /** List models from the active provider */
  async listModels(): Promise<ProviderModel[]> {
    await this.waitUntilReady();
    if (this.activeProviderId !== 'copilot' && !this.isActiveProviderUsable()) {
      return [];
    }
    return this.getActiveProvider().listModels();
  }

  /**
   * Look up a single model by ID from the active provider's cached model list.
   * Returns undefined if not found. Uses the provider's internal cache (5-min TTL).
   */
  async findModel(modelId: string): Promise<ProviderModel | undefined> {
    const models = await this.listModels();
    return models.find(m => m.id === modelId);
  }

  /**
   * Resolve the effective model ID for a provider call.
   *
   * Selection order:
   *   1. Caller-supplied modelId, if it validates against the active provider.
   *      (When the active provider is non-Copilot but the modelId is a Copilot
   *      model name carried by a stale agent/chat config, validation fails and
   *      we fall through to picker logic.)
   *   2. The provider's configured `defaultModel`.
   *   3. A "best-known" chat-capable model picked by family heuristic
   *      (gpt-4o, gpt-4.1, deepseek-chat, etc.). Avoids the previous
   *      alphabetical-first-model fallback which could pick embeddings or
   *      legacy completion-only models.
   *   4. Any remaining chat-capable model in the cache.
   *
   * Throws only if the provider has zero models available at all.
   */
  async resolveModelId(modelId?: string): Promise<string> {
    const provider = this.getActiveProvider();
    if (modelId && modelId !== 'default' && await provider.validateModel(modelId)) {
      return modelId;
    }

    // Try configured default
    const config = this.config?.providers[this.activeProviderId];
    if (config?.defaultModel && await provider.validateModel(config.defaultModel)) {
      return config.defaultModel;
    }

    const models = await this.listModels();
    if (models.length === 0) {
      throw new Error(`No models available from provider '${this.activeProviderId}'. Check your API key and provider settings.`);
    }

    // Prefer a known-good chat model by family, in descending preference order.
    // This keeps utility LLM calls (title generation, file naming, document
    // summary) on a sensible model when the user has not picked one explicitly.
    const PREFERENCE_BY_PROVIDER: Record<string, RegExp[]> = {
      openai: [
        /^gpt-4\.1$/i, /^gpt-4o(-2|$)/i, /^gpt-4o-mini/i,
        /^gpt-4-turbo/i, /^gpt-4($|-)/i, /^gpt-3\.5-turbo/i,
      ],
      anthropic: [/claude-opus/i, /claude-sonnet/i, /claude-haiku/i],
      gemini: [/gemini-.*pro/i, /gemini-.*flash/i, /gemini/i],
      'custom-dynamic': [/^gpt-4/i, /claude/i, /gemini/i, /^llama/i],
    };
    const preferences = PREFERENCE_BY_PROVIDER[this.activeProviderId] || [];
    for (const pattern of preferences) {
      const match = models.find(m => pattern.test(m.id) && m.supportsTools);
      if (match) return match.id;
    }
    // Any chat-capable model
    const chatModel = models.find(m => m.supportsTools);
    if (chatModel) return chatModel.id;

    // Last resort: whatever's first
    return models[0].id;
  }

  /**
   * Get the last-known model list synchronously (no await).
   * Returns [] if models haven't been fetched yet.
   * Used by synchronous code paths (e.g., getCurrentModelConfig) that need model metadata.
   */
  getCachedModels(): ProviderModel[] {
    if (this.activeProviderId !== 'copilot' && !this.isActiveProviderUsable()) {
      return [];
    }
    const provider = this.providers.get(this.activeProviderId);
    return provider?.getCachedModels() ?? [];
  }

  /** Test connection for a specific provider */
  async testConnection(id?: ProviderId): Promise<ConnectionTestResult> {
    const targetId = id ?? this.activeProviderId;
    const provider = this.providers.get(targetId);
    if (!provider) {
      return { success: false, error: `Provider ${targetId} not found` };
    }
    const result = await provider.testConnection();
    await this.recordConnectionTestResult(targetId, result);
    // Test/Connect runs detection for custom-dynamic, which can resolve a new
    // protocol and thus a new model set. If this is the active provider and the
    // connection succeeded, re-sync the renderer's model list (same as Save).
    if (result.success) {
      this.notifyActiveModelsUpdated(targetId, 'provider-test-connection');
    }
    return result;
  }

  private async recordConnectionTestResult(
    id: ProviderId,
    result: ConnectionTestResult,
  ): Promise<void> {
    if (id === 'copilot') return;
    if (!this.config) this.config = this.getDefaultConfig();

    const existing = this.config.providers[id] || { enabled: false };
    const models = result.success ? (result.models ?? []) : [];
    const rawModels = result.success ? (result.rawModels ?? []) : [];
    const existingWithoutLegacyCount: ProviderConfigWithLegacyCount = { ...existing };
    delete existingWithoutLegacyCount.lastModelCount;

    const nextProviderConfig = {
      ...existingWithoutLegacyCount,
      ...(result.detectedProtocol ? { detectedProtocol: result.detectedProtocol } : {}),
      verified: result.success,
      verifiedAt: result.success ? new Date().toISOString() : null,
      lastConnectionError: result.success ? null : (result.error ?? 'Connection test failed'),
      lastConnectionLatencyMs: typeof result.latencyMs === 'number' ? result.latencyMs : null,
      models,
      rawModels,
    };

    const nextConfig: AllProvidersConfig = {
      ...this.config,
      providers: {
        ...this.config.providers,
        [id]: nextProviderConfig,
      },
    };

    await this.saveConfig(nextConfig);
    this.config = nextConfig;
  }

  // ── Config Persistence ────────────────────────────────────────────────

  /** Get the config file path for the current user */
  private getConfigFilePath(): string | null {
    if (!this.currentAlias) return null;
    try {
      const appPath = app.getPath('userData');
      return path.join(appPath, 'profiles', PROFILE_DIR_NAME, CONFIG_FILE_NAME);
    } catch {
      return null;
    }
  }

  async ensureConfigFile(): Promise<string> {
    if (!this.config) this.config = this.getDefaultConfig();
    const filePath = this.getConfigFilePath();
    if (!filePath) {
      throw new Error('Provider config file is not available until a user profile is active.');
    }
    await this.saveConfig(this.config);
    if (!fs.existsSync(filePath)) {
      throw new Error('Provider config file could not be created.');
    }
    return filePath;
  }

  /** Load provider config from disk */
  private async loadConfig(): Promise<AllProvidersConfig> {
    const filePath = this.getConfigFilePath();
    if (!filePath) return this.getDefaultConfig();

    try {
      if (!fs.existsSync(filePath)) {
        return this.getDefaultConfig();
      }

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content) as AllProvidersConfig;

      // Validate structure
      if (!parsed.activeProvider || !parsed.providers) {
        return this.getDefaultConfig();
      }

      const migrated = this.migrateLegacyCustomOpenAI(parsed);
      const providers = migrated.providers as Record<string, ProviderConfig | undefined>;
      const hadCopilotBlock = providers.copilot !== undefined;
      delete providers.copilot;
      if (hadCopilotBlock) {
        await this.saveConfig(migrated);
      }
      return migrated;
    } catch (error) {
      logger.warn(`[ProviderManager] Failed to load config: ${error instanceof Error ? error.message : String(error)}`);
      return this.getDefaultConfig();
    }
  }

  /**
   * Migrate legacy `custom-openai` configs to `custom-dynamic`.
   *
   * Pre-detection builds used a fixed OpenAI-only custom slot keyed `custom-openai`.
   * We rename it to `custom-dynamic` and seed `detectedProtocol: 'openai'` so the
   * endpoint keeps its exact previous behavior with zero re-detection. Purely
   * additive/renaming — no fields are dropped. If both keys somehow exist, the
   * existing `custom-dynamic` wins and the legacy block is discarded.
   */
  private migrateLegacyCustomOpenAI(config: AllProvidersConfig): AllProvidersConfig {
    const legacyKey = 'custom-openai' as ProviderId;
    const legacy = (config.providers as Record<string, ProviderConfig | undefined>)[legacyKey];
    if (!legacy) return config;

    if (!config.providers['custom-dynamic']) {
      config.providers['custom-dynamic'] = {
        ...legacy,
        detectedProtocol: legacy.detectedProtocol ?? 'openai',
      };
    }
    delete (config.providers as Record<string, ProviderConfig | undefined>)[legacyKey];

    // Repoint the active provider if it referenced the old key.
    if ((config.activeProvider as string) === legacyKey) {
      config.activeProvider = 'custom-dynamic';
    }

    logger.info('[ProviderManager] Migrated legacy custom-openai config to custom-dynamic (protocol: openai)');
    return config;
  }

  /** Save provider config to disk */
  private async saveConfig(config: AllProvidersConfig): Promise<void> {
    const filePath = this.getConfigFilePath();
    if (!filePath) {
      throw new Error('Provider config file is not available until a user profile is active.');
    }

    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }
      await fs.promises.writeFile(filePath, JSON.stringify(this.toPersistedConfig(config), null, 2), 'utf-8');
      logger.debug(`[ProviderManager] Config saved to ${filePath}`);
    } catch (error) {
      logger.error(`[ProviderManager] Failed to save config: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  private toPersistedConfig(config: AllProvidersConfig): AllProvidersConfig {
    const providers: Partial<Record<ProviderId, ProviderConfig>> = {};
    for (const [id, providerConfig] of Object.entries(config.providers)) {
      if (id === 'copilot' || !providerConfig) continue;
      const sanitizedProviderConfig: ProviderConfigWithLegacyCount = { ...providerConfig };
      delete sanitizedProviderConfig.lastModelCount;
      providers[id as ProviderId] = sanitizedProviderConfig;
    }
    return { ...config, providers };
  }

  /** Get the default config (Copilot as active, nothing else configured) */
  private getDefaultConfig(): AllProvidersConfig {
    return {
      version: CONFIG_VERSION,
      activeProvider: 'copilot',
      providers: {},
    };
  }

  // ── API Key Encryption ────────────────────────────────────────────────

  /**
   * Encrypt an API key using Electron's safeStorage.
   * Falls back to base64 encoding if safeStorage is unavailable.
   */
  private encryptApiKey(plainKey: string): string {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        const encrypted = safeStorage.encryptString(plainKey);
        // Store as base64 with a prefix so we know it's encrypted
        return `enc:${encrypted.toString('base64')}`;
      }
    } catch (error) {
      logger.warn(`[ProviderManager] safeStorage unavailable, falling back to base64: ${error instanceof Error ? error.message : String(error)}`);
    }
    // Fallback: base64 (not secure, but functional)
    return `b64:${Buffer.from(plainKey).toString('base64')}`;
  }

  /**
   * Decrypt an API key.
   */
  private decryptApiKey(storedKey: string): string {
    try {
      if (storedKey.startsWith('enc:')) {
        const buffer = Buffer.from(storedKey.slice(4), 'base64');
        return safeStorage.decryptString(buffer);
      }
      if (storedKey.startsWith('b64:')) {
        return Buffer.from(storedKey.slice(4), 'base64').toString('utf-8');
      }
    } catch (error) {
      logger.error(`[ProviderManager] Failed to decrypt API key: ${error instanceof Error ? error.message : String(error)}`);
    }
    // If no prefix, return as-is (migration from plaintext)
    return storedKey;
  }

  // ── Renderer Notification ─────────────────────────────────────────────

  private notifyRenderer(channel: string, data: unknown): void {
    try {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed() && win.webContents) {
          win.webContents.send(channel, data);
        }
      }
    } catch (error) {
      logger.warn(`[ProviderManager] Failed to notify renderer: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ── Skip Login Support ────────────────────────────────────────────────

  /**
   * Check if the user can skip GitHub login.
   * Returns true if at least one non-Copilot provider is enabled and has required credentials.
   */
  hasApiKeyProvider(): boolean {
    if (!this.config) return false;

    for (const [id, providerConfig] of Object.entries(this.config.providers)) {
      if (id === 'copilot') continue; // Skip Copilot — it needs GitHub auth
      const provider = this.providers.get(id as ProviderId);
      if (this.isProviderUsableForApiKeyMode(id as ProviderId, providerConfig, provider)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Authoritative "is the workspace usable right now" check for the active
   * provider. Returns true only when the ACTIVE provider is a non-Copilot
   * provider that is itself enabled and credential-ready.
   *
   * This is stricter than hasApiKeyProvider(): that one answers "does ANY
   * provider have a key" (used by the sign-in skip gate), whereas this answers
   * "is the provider we'd actually route to usable". They diverge in exactly the
   * bug case this guards against — a stale `activeProvider` pointer left aimed at
   * a provider the user has since DISABLED (e.g. activeProvider 'custom-dynamic'
   * with custom-dynamic.enabled === false). hasApiKeyProvider() would say false
   * there too, but the old UI gate combined `active !== 'copilot'` (true, from
   * the stale pointer) with hasApiKeyProvider() as separate signals; collapsing
   * both into this single active-scoped check removes that gap.
   *
   * Never throws — it backs a UI enable/disable gate.
   */
  isActiveProviderUsable(): boolean {
    if (!this.config) return false;
    const activeId = this.activeProviderId;
    if (activeId === 'copilot') return false; // Copilot needs GitHub auth, not a key
    const activeConfig = this.config.providers[activeId];
    const provider = this.providers.get(activeId);
    return this.isProviderUsableForApiKeyMode(activeId, activeConfig, provider);
  }

  private isProviderUsableForApiKeyMode(
    id: ProviderId,
    providerConfig: ProviderConfig | undefined,
    provider: ILlmProvider | undefined,
  ): boolean {
    if (!providerConfig?.enabled) return false;
    if (provider?.info.requiresApiKey && !providerConfig.apiKey) return false;
    if (id !== 'copilot' && provider?.info.requiresApiKey && providerConfig.verified !== true) return false;
    return true;
  }

  private getFirstConfiguredNonCopilotProvider(): ProviderId | undefined {
    if (!this.config) return undefined;

    for (const [id, providerConfig] of Object.entries(this.config.providers)) {
      if (id === 'copilot') continue;
      const providerId = id as ProviderId;
      const provider = this.providers.get(providerId);
      if (this.isProviderUsableForApiKeyMode(providerId, providerConfig, provider)) {
        return providerId;
      }
    }
    return undefined;
  }

  /**
   * Initialize for "Skip Login" mode — load config without a user alias.
   * Uses a shared config directory for unauthenticated users.
   */
  async initializeForSkipLogin(): Promise<void> {
    this.currentAlias = SKIP_LOGIN_ALIAS;

    // Ensure the skip-login profile directory exists
    try {
      const appPath = app.getPath('userData');
      const localDir = path.join(appPath, 'profiles', PROFILE_DIR_NAME);
      if (!fs.existsSync(localDir)) {
        await fs.promises.mkdir(localDir, { recursive: true });
      }
    } catch {
      // Ignore — loadConfig will return defaults
    }

    await this.initialize(SKIP_LOGIN_ALIAS);
  }

  /**
   * Load the _local profile config WITHOUT applying the skip-login validation
   * (which would throw when no non-Copilot provider is configured). This is a
   * read-only probe used by the sign-in screen to decide whether to show the
   * "Skip Login" button. Safe to call before any session is active.
   */
  async loadConfigForProbe(): Promise<void> {
    if (!this.currentAlias) {
      this.currentAlias = SKIP_LOGIN_ALIAS;
    }
    this.config = await this.loadConfig();
    // Apply config to provider instances so hasApiKeyProvider() can see them,
    // but do NOT change activeProviderId and do NOT throw on missing fallback.
    for (const [id, providerConfig] of Object.entries(this.config.providers)) {
      const provider = this.providers.get(id as ProviderId);
      if (provider && providerConfig) {
        const decrypted = { ...providerConfig };
        if (decrypted.apiKey) {
          decrypted.apiKey = this.decryptApiKey(decrypted.apiKey);
        }
        provider.configure(decrypted);
      }
    }
  }
}

/** Singleton export */
export const providerManager = ProviderManager.getInstance();
