/**
 * Shared storage for user-provided research / data API tokens.
 *
 * Tokens live in `${userData}/research-api-tokens.json` with per-provider
 * verification metadata. Both the Investment Studio brand IPC handlers
 * (`researchApi:*`) and main-process tools read from this module so there is
 * exactly one source of truth.
 *
 * NEVER log the token value.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  RESEARCH_API_PROVIDERS,
  type ResearchApiProvider,
  type ResearchApiProviderStatus,
} from '@shared/types/researchApiTypes';

export { RESEARCH_API_PROVIDERS, type ResearchApiProvider } from '@shared/types/researchApiTypes';

const STORAGE_VERSION = 1;

interface StoredProviderConfig {
  apiKey: string;
  verified: boolean;
  verifiedAt: string | null;
  lastTestError: string | null;
}

interface StoredResearchApiConfig {
  version: typeof STORAGE_VERSION;
  providers: Partial<Record<ResearchApiProvider, StoredProviderConfig>>;
}

export function isResearchApiProvider(value: unknown): value is ResearchApiProvider {
  return typeof value === 'string'
    && (RESEARCH_API_PROVIDERS as readonly string[]).includes(value);
}

function getTokenFilePath(): string {
  return path.join(app.getPath('userData'), 'research-api-tokens.json');
}

export function getResearchApiTokenFilePath(): string {
  return getTokenFilePath();
}

function emptyConfig(): StoredResearchApiConfig {
  return { version: STORAGE_VERSION, providers: {} };
}

function normalizeProviderConfig(value: unknown): StoredProviderConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Partial<StoredProviderConfig>;
  if (typeof raw.apiKey !== 'string') return undefined;
  const apiKey = raw.apiKey.trim();
  if (!apiKey) return undefined;
  const verified = raw.verified === true;
  return {
    apiKey,
    verified,
    verifiedAt: verified && typeof raw.verifiedAt === 'string' ? raw.verifiedAt : null,
    lastTestError: typeof raw.lastTestError === 'string' && raw.lastTestError.trim().length > 0
      ? raw.lastTestError
      : null,
  };
}

function readConfig(options?: { resetInvalid?: boolean }): StoredResearchApiConfig {
  const tokenFile = getTokenFilePath();
  if (!fs.existsSync(tokenFile)) {
    return emptyConfig();
  }

  try {
    const content = fs.readFileSync(tokenFile, 'utf-8');
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid research API token config: expected object');
    }

    const raw = parsed as { version?: unknown; providers?: unknown };
    if (raw.version !== STORAGE_VERSION || !raw.providers || typeof raw.providers !== 'object') {
      throw new Error('Invalid research API token config schema');
    }

    const providers: StoredResearchApiConfig['providers'] = {};
    const rawProviders = raw.providers as Record<string, unknown>;
    for (const provider of RESEARCH_API_PROVIDERS) {
      const normalized = normalizeProviderConfig(rawProviders[provider]);
      if (normalized) {
        providers[provider] = normalized;
      }
    }
    return { version: STORAGE_VERSION, providers };
  } catch (error) {
    if (options?.resetInvalid) {
      return emptyConfig();
    }
    throw error;
  }
}

function writeConfig(config: StoredResearchApiConfig): void {
  const tokenFile = getTokenFilePath();
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  fs.writeFileSync(tokenFile, JSON.stringify(config, null, 2), 'utf-8');
}

export function ensureResearchApiTokenFile(): string {
  const tokenFile = getTokenFilePath();
  if (!fs.existsSync(tokenFile)) {
    writeConfig(emptyConfig());
  }
  return tokenFile;
}

function toStatus(
  provider: ResearchApiProvider,
  entry: StoredProviderConfig | undefined,
): ResearchApiProviderStatus {
  if (!entry) {
    return {
      provider,
      hasApiKey: false,
      verified: false,
      verifiedAt: null,
      lastTestError: null,
    };
  }

  return {
    provider,
    hasApiKey: true,
    verified: entry.verified,
    verifiedAt: entry.verifiedAt,
    lastTestError: entry.lastTestError,
  };
}

/**
 * Returns the trimmed token for the given provider, or `undefined`
 * if not configured.
 */
export function getResearchApiToken(provider: ResearchApiProvider): string | undefined {
  const config = readConfig();
  return config.providers[provider]?.apiKey;
}

/**
 * Returns a token only after the provider has passed Test connection.
 */
export function getVerifiedResearchApiToken(provider: ResearchApiProvider): string | undefined {
  const config = readConfig();
  const entry = config.providers[provider];
  if (!entry?.verified) return undefined;
  return entry.apiKey;
}

export function getResearchApiStatus(provider: ResearchApiProvider): ResearchApiProviderStatus {
  const config = readConfig();
  return toStatus(provider, config.providers[provider]);
}

export function getAllResearchApiStatuses(): Record<ResearchApiProvider, ResearchApiProviderStatus> {
  const config = readConfig();
  return RESEARCH_API_PROVIDERS.reduce((acc, provider) => {
    acc[provider] = toStatus(provider, config.providers[provider]);
    return acc;
  }, {} as Record<ResearchApiProvider, ResearchApiProviderStatus>);
}

/**
 * Persist a token for the given provider. Passing `null` or an empty
 * string clears the entry. Saving a changed token resets verification.
 */
export function setResearchApiToken(
  provider: ResearchApiProvider,
  token: string | null,
): ResearchApiProviderStatus {
  const config = readConfig({ resetInvalid: true });
  const normalized = token?.trim() ?? '';
  if (normalized.length > 0) {
    const existing = config.providers[provider];
    config.providers[provider] = existing?.apiKey === normalized
      ? existing
      : {
          apiKey: normalized,
          verified: false,
          verifiedAt: null,
          lastTestError: null,
        };
  } else {
    delete config.providers[provider];
  }
  writeConfig(config);
  return toStatus(provider, config.providers[provider]);
}

export function recordResearchApiTestResult(
  provider: ResearchApiProvider,
  result: { ok: boolean; error?: string },
): ResearchApiProviderStatus {
  const config = readConfig();
  const existing = config.providers[provider];
  if (!existing) {
    return toStatus(provider, undefined);
  }

  config.providers[provider] = {
    ...existing,
    verified: result.ok,
    verifiedAt: result.ok ? new Date().toISOString() : null,
    lastTestError: result.ok ? null : (result.error ?? 'Connection test failed'),
  };
  writeConfig(config);
  return toStatus(provider, config.providers[provider]);
}
