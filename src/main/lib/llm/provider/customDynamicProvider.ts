// src/main/lib/llm/provider/customDynamicProvider.ts
/**
 * Custom Dynamic Provider — one custom endpoint, auto-detected protocol.
 *
 * Wraps the three existing wire-format engines (OpenAI-compatible, Anthropic,
 * Gemini) and routes each call to whichever one matches the endpoint's detected
 * protocol. The user pastes an endpoint + API key without knowing the protocol;
 * this provider detects it at Test/Save time, persists the verdict (via the
 * manager), and reuses it at run time with zero detection overhead.
 *
 * Responsibilities:
 *   - configure(): pick the active inner engine from config.detectedProtocol
 *     (defaulting to 'openai' for legacy/unset configs) and hand it a
 *     protocol-normalized base URL.
 *   - chatCompletion / chatCompletionStream / listModels: delegate to the active
 *     engine, remapping each ProviderModel's providerId to 'custom-dynamic' so the
 *     rest of the app sees one coherent provider identity.
 *   - testConnection(): run detection, apply the result in memory, and report it.
 *   - run-time self-heal (Option C): if a call fails with a protocol-shaped error
 *     AND nothing has been emitted yet, re-detect once, persist, and retry.
 *
 * This class contains NO wire-format translation — that all lives in the three
 * inner engines. It is purely a router + detection coordinator.
 */

import { createLogger } from '../../unifiedLogger';
import { OpenAICompatibleProvider } from './openaiCompatibleProvider';
import { AnthropicProvider } from './anthropicProvider';
import { GeminiProvider } from './geminiProvider';
import {
  detectProtocol,
  normalizeBaseUrl,
  type CustomProtocol,
  type DetectionResult,
} from './protocolDetector';
import {
  ILlmProvider,
  ProviderInfo,
  ProviderConfig,
  ProviderModel,
  ChatCompletionParams,
  ChatCompletionResult,
  ProviderStreamChunk,
  ConnectionTestResult,
} from './types';

const logger = createLogger();

/** Default protocol for configs that predate detection (legacy custom-openai). */
const DEFAULT_PROTOCOL: CustomProtocol = 'openai';

/**
 * Called whenever detection resolves a protocol (Test, Save self-heal). The
 * manager wires this to persist `detectedProtocol` to provider-config.json, so
 * the provider itself stays free of disk access.
 */
export type ProtocolPersistFn = (protocol: CustomProtocol) => void;

export class CustomDynamicProvider implements ILlmProvider {
  readonly info: ProviderInfo = {
    id: 'custom-dynamic',
    displayName: 'Custom (Auto-Detected)',
    requiresGitHubAuth: false,
    requiresApiKey: true,
    defaultBaseUrl: '',
    description: 'Any OpenAI-, Anthropic-, or Gemini-compatible endpoint — protocol auto-detected',
  };

  private config: ProviderConfig = { enabled: false };
  private activeProtocol: CustomProtocol = DEFAULT_PROTOCOL;

  /** One persistent instance of each engine; only the active one is configured. */
  private readonly engines: Record<CustomProtocol, ILlmProvider> = {
    openai: new OpenAICompatibleProvider('custom-dynamic'),
    anthropic: new AnthropicProvider(),
    gemini: new GeminiProvider(),
  };

  constructor(private readonly onProtocolDetected?: ProtocolPersistFn) {}

  // ── Configuration ───────────────────────────────────────────────────

  configure(config: ProviderConfig): void {
    this.config = config;
    this.activeProtocol = config.detectedProtocol ?? DEFAULT_PROTOCOL;
    // Endpoint identity (baseUrl / apiKey) may have just changed. This router
    // holds THREE engine instances, each with its own model-list cache; if we
    // only reconfigured the active one, a sibling engine could still hold the
    // PREVIOUS endpoint's models and resurface them later (synchronously via
    // getCachedModels(), or after a protocol flip routes back to it). The bug
    // this prevents: switching the custom endpoint from an OpenAI box to an
    // Anthropic box left the research model dropdown showing the old box's list.
    // Each engine already wipes its cache on configure(); mirror that here by
    // disposing EVERY engine so no stale provider data survives an endpoint
    // change. Only the active engine is then reconfigured; the siblings are
    // (re)configured lazily if a protocol flip (detect()) later routes to them.
    for (const engine of Object.values(this.engines)) engine.dispose();
    this.applyToEngine(this.activeProtocol);
  }

  /** Configure the engine for `protocol` with a protocol-normalized base URL. */
  private applyToEngine(protocol: CustomProtocol): void {
    const rawBaseUrl = this.config.baseUrl || '';
    const engineConfig: ProviderConfig = {
      ...this.config,
      baseUrl: rawBaseUrl ? normalizeBaseUrl(rawBaseUrl, protocol) : rawBaseUrl,
    };
    this.engines[protocol].configure(engineConfig);
  }

  /** The currently active inner engine. */
  private get engine(): ILlmProvider {
    return this.engines[this.activeProtocol];
  }

  dispose(): void {
    for (const engine of Object.values(this.engines)) engine.dispose();
  }

  /** Expose the resolved protocol so the manager can persist it. */
  getDetectedProtocol(): CustomProtocol {
    return this.activeProtocol;
  }

  // ── Detection ─────────────────────────────────────────────────────────

  /**
   * Detect the endpoint's protocol, apply it in memory, and (on success) notify
   * the persistence callback. Returns the raw DetectionResult for the caller to
   * surface. Used by testConnection() and run-time self-heal.
   */
  async detect(signal?: AbortSignal): Promise<DetectionResult> {
    const result = await detectProtocol(this.config.baseUrl || '', this.config.apiKey || '', signal);
    if (result.protocol) {
      const changed = result.protocol !== this.activeProtocol;
      this.activeProtocol = result.protocol;
      // Purge every engine's cache before re-applying the resolved one. detect()
      // can run standalone (Test button, runtime self-heal) without a preceding
      // configure(), so the sibling engines may still hold a prior endpoint's
      // model list. Disposing all of them keeps the "no stale provider data"
      // invariant regardless of which path triggered detection.
      for (const engine of Object.values(this.engines)) engine.dispose();
      // Persist the user's raw URL but configure the engine with the normalized
      // shape the detector resolved.
      this.engines[result.protocol].configure({
        ...this.config,
        baseUrl: result.normalizedBaseUrl,
      });
      this.config.detectedProtocol = result.protocol;
      this.onProtocolDetected?.(result.protocol);
      if (changed) {
        logger.debug(`[customDynamicProvider] Protocol resolved to '${result.protocol}'`);
      }
    }
    return result;
  }

  // ── Model Management ──────────────────────────────────────────────────

  async listModels(): Promise<ProviderModel[]> {
    const models = await this.engine.listModels();
    return models.map(m => this.remap(m));
  }

  async validateModel(modelId: string): Promise<boolean> {
    return this.engine.validateModel(modelId);
  }

  getCachedModels(): ProviderModel[] {
    return this.engine.getCachedModels().map(m => this.remap(m));
  }

  /** Rebrand an inner-engine model under the custom-dynamic identity. */
  private remap(model: ProviderModel): ProviderModel {
    return model.providerId === 'custom-dynamic' ? model : { ...model, providerId: 'custom-dynamic' };
  }

  // ── Chat Completion ───────────────────────────────────────────────────

  async chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult> {
    try {
      return await this.engine.chatCompletion(params);
    } catch (error) {
      if (this.shouldSelfHeal(error)) {
        const healed = await this.selfHeal(params.signal);
        if (healed) return await this.engine.chatCompletion(params);
      }
      throw error;
    }
  }

  async *chatCompletionStream(params: ChatCompletionParams): AsyncIterable<ProviderStreamChunk> {
    // Self-heal is only safe BEFORE any chunk is emitted — retrying mid-stream
    // would duplicate already-forwarded content. We track first-yield state and
    // re-detect only if the failure happens before the first chunk.
    let emitted = false;
    try {
      for await (const chunk of this.engine.chatCompletionStream(params)) {
        emitted = true;
        yield chunk;
      }
    } catch (error) {
      if (!emitted && this.shouldSelfHeal(error)) {
        const healed = await this.selfHeal(params.signal);
        if (healed) {
          for await (const chunk of this.engine.chatCompletionStream(params)) yield chunk;
          return;
        }
      }
      throw error;
    }
  }

  /**
   * Re-detect once and report whether the protocol changed. Guarded so a genuinely
   * dead endpoint can't loop: a single call site per request, no internal retry.
   */
  private async selfHeal(signal?: AbortSignal): Promise<boolean> {
    const before = this.activeProtocol;
    logger.warn(`[customDynamicProvider] Protocol-shaped failure on '${before}' — re-detecting`);
    const result = await this.detect(signal);
    const changed = result.protocol != null && result.protocol !== before;
    if (changed) {
      logger.info(`[customDynamicProvider] Self-heal switched protocol '${before}' → '${result.protocol}'`);
    }
    return changed;
  }

  /**
   * Decide whether an error looks like a WRONG-PROTOCOL signature (404/405 on the
   * endpoint path, "messages required" / "model not found" shape errors) versus a
   * normal failure (401 auth, 429 rate-limit, 5xx, timeout) that re-detection
   * would not fix. Narrow allowlist by design — over-triggering wastes a turn.
   */
  private shouldSelfHeal(error: unknown): boolean {
    const status = this.extractStatus(error);
    if (status === 401 || status === 403 || status === 429) return false; // auth / rate — not protocol
    if (status === 404 || status === 405) return true;                     // wrong endpoint shape
    if (status != null && status >= 500) return false;                     // server-side, not protocol

    const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
    if (msg.includes('rate limit') || msg.includes('timeout') || msg.includes('econnrefused') || msg.includes('enotfound')) {
      return false;
    }
    // Shape mismatches that survive without an HTTP status on the error object.
    return msg.includes('404') || msg.includes('405')
      || msg.includes('not found') || msg.includes('messages: required')
      || msg.includes('invalid response format') || msg.includes('unexpected');
  }

  /** Best-effort HTTP status extraction across fetch errors and SDK error types. */
  private extractStatus(error: unknown): number | null {
    if (error && typeof error === 'object') {
      const s = (error as { status?: unknown }).status;
      if (typeof s === 'number') return s;
    }
    const m = (error instanceof Error ? error.message : '').match(/\b(4\d\d|5\d\d)\b/);
    return m ? Number(m[1]) : null;
  }

  // ── Connection Test ───────────────────────────────────────────────────

  async testConnection(): Promise<ConnectionTestResult> {
    const startTime = Date.now();

    if (!this.config.baseUrl) {
      return { success: false, error: 'No endpoint URL configured. Enter your custom endpoint first.' };
    }
    if (!this.config.apiKey) {
      return { success: false, error: 'No API key configured. Add your API key first.' };
    }

    const result = await this.detect();
    const latencyMs = Date.now() - startTime;

    if (!result.protocol) {
      return { success: false, latencyMs, error: result.error };
    }

    return {
      success: true,
      latencyMs: result.latencyMs ?? latencyMs,
      sampleModels: result.sampleModels,
      detectedProtocol: result.protocol,
    };
  }
}
