// src/main/lib/llm/provider/types.ts
/**
 * Multi-Provider LLM Abstraction — Type Definitions
 *
 * Defines the unified interface that all LLM providers must implement.
 * This allows the app to route calls to GitHub Copilot, OpenAI, DeepSeek,
 * Ollama, or any OpenAI-compatible API through a single abstraction.
 */

// =============================================================================
// Constants
// =============================================================================

// Re-export the single source of truth for skip-login alias
export { SKIP_LOGIN_ALIAS } from '@shared/constants/auth';

/**
 * Map provider IDs to the tokenizer family used for token estimation.
 * Falls back to 'cl100k_base' (GPT-3.5/4 family) for unknown providers,
 * which is a safer overestimate than 'o200k_base' for non-OpenAI models.
 */
export const PROVIDER_TOKENIZER: Record<string, string> = {
  copilot: 'o200k_base',
  openai: 'o200k_base',
  deepseek: 'cl100k_base',
  ollama: 'cl100k_base',
  'custom-openai': 'cl100k_base',
};

// =============================================================================
// Provider Identity
// =============================================================================

/** Supported provider identifiers */
export type ProviderId = 'copilot' | 'openai' | 'deepseek' | 'ollama' | 'custom-openai';

/** Display metadata for a provider */
export interface ProviderInfo {
  id: ProviderId;
  displayName: string;
  /** Whether this provider requires GitHub OAuth (true for Copilot, false for API-key providers) */
  requiresGitHubAuth: boolean;
  /** Whether this provider requires an API key */
  requiresApiKey: boolean;
  /** Default base URL for the provider's API */
  defaultBaseUrl: string;
  /** Optional description shown in settings */
  description?: string;
}

// =============================================================================
// Provider Configuration (persisted)
// =============================================================================

/** Per-provider configuration stored in provider-config.json */
export interface ProviderConfig {
  enabled: boolean;
  /** API key — stored encrypted via safeStorage, this field holds the encrypted blob */
  apiKey?: string;
  /** Base URL for the API (e.g., https://api.openai.com/v1) */
  baseUrl?: string;
  /** Default model to use with this provider */
  defaultModel?: string;
  /** Custom display name override */
  displayName?: string;
}

/** Root configuration for all providers */
export interface AllProvidersConfig {
  /** Which provider is currently active */
  activeProvider: ProviderId;
  /** Per-provider settings */
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  /** Config format version for future migration */
  version: string;
}

// =============================================================================
// Model Types (provider-neutral)
// =============================================================================

/** Unified model descriptor that works across all providers */
export interface ProviderModel {
  /** Model ID as used in API calls (e.g., 'gpt-4o', 'claude-sonnet-4.6') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Which provider owns this model */
  providerId: ProviderId;
  /** Whether the model supports streaming */
  supportsStreaming: boolean;
  /** Whether the model supports tool/function calling */
  supportsTools: boolean;
  /** Whether the model supports image inputs */
  supportsImages: boolean;
  /** Maximum context window (prompt tokens) */
  maxContextTokens?: number;
  /** Maximum output tokens */
  maxOutputTokens?: number;
  /** Whether this model uses max_completion_tokens instead of max_tokens */
  usesMaxCompletionTokens?: boolean;
  /** Raw provider-specific metadata (e.g., the full GhcCopilotModel for Copilot) */
  raw?: unknown;
}

// =============================================================================
// Chat Completion Types
// =============================================================================

/** Message format for chat completion requests */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; [key: string]: unknown }>;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

/** Tool definition in OpenAI function-calling format */
export interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

/** Parameters for a chat completion request */
export interface ChatCompletionParams {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  /** Reasoning effort for models that support it */
  reasoningEffort?: string;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

/** A single streaming chunk from the provider */
export interface ProviderStreamChunk {
  /** Incremental text content */
  contentDelta?: string;
  /** Tool call deltas */
  toolCallDelta?: {
    index: number;
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  };
  /** Usage stats (typically in the final chunk) */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Finish reason when generation completes */
  finishReason?: string;
  /** Model ID as reported by the API */
  model?: string;
}

/** Non-streaming chat completion result */
export interface ChatCompletionResult {
  content: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  finishReason: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model?: string;
}

/** Connection test result */
export interface ConnectionTestResult {
  success: boolean;
  /** Latency in milliseconds */
  latencyMs?: number;
  /** Error message if failed */
  error?: string;
  /** Models available (first few) as proof of connectivity */
  sampleModels?: string[];
}

// =============================================================================
// Provider Interface
// =============================================================================

/**
 * The core interface that every LLM provider must implement.
 *
 * Providers handle:
 * - Authentication (API key or token-based)
 * - Model listing and validation
 * - Chat completions (streaming and non-streaming)
 * - Connection testing
 */
export interface ILlmProvider {
  /** Provider identity */
  readonly info: ProviderInfo;

  // ── Model Management ──────────────────────────────────────────────────

  /** Fetch the list of available models from this provider */
  listModels(): Promise<ProviderModel[]>;

  /** Check if a specific model ID is valid for this provider */
  validateModel(modelId: string): Promise<boolean>;

  // ── Chat Completion ───────────────────────────────────────────────────

  /** Non-streaming chat completion */
  chatCompletion(params: ChatCompletionParams): Promise<ChatCompletionResult>;

  /**
   * Streaming chat completion.
   * Returns an async iterable of chunks. The caller consumes these
   * and forwards them to the renderer via IPC.
   */
  chatCompletionStream(params: ChatCompletionParams): AsyncIterable<ProviderStreamChunk>;

  // ── Lifecycle ─────────────────────────────────────────────────────────

  /** Test the connection (validates API key, checks endpoint reachability) */
  testConnection(): Promise<ConnectionTestResult>;

  /** Initialize the provider with its configuration */
  configure(config: ProviderConfig): void;

  /**
   * Return the last-known model list without awaiting.
   * Returns [] if models haven't been fetched yet.
   * Used by synchronous code paths that need model metadata.
   */
  getCachedModels(): ProviderModel[];

  /** Clean up resources */
  dispose(): void;
}
