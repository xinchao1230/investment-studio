/**
 * Shared storage for user-provided research / data API tokens.
 *
 * Tokens live in `${userData}/research-api-tokens.json` as a flat
 * `{ provider: token }` map. Both the Investment Studio brand IPC handlers
 * (`researchApi:*`) and main-process tools (e.g. the web search builtin)
 * read from this module so there is exactly one source of truth.
 *
 * NEVER log the token value.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type ResearchApiProvider = 'tushare' | 'eastmoney' | 'webiq';

export const RESEARCH_API_PROVIDERS: readonly ResearchApiProvider[] = [
  'tushare',
  'eastmoney',
  'webiq',
] as const;

export function isResearchApiProvider(value: unknown): value is ResearchApiProvider {
  return typeof value === 'string'
    && (RESEARCH_API_PROVIDERS as readonly string[]).includes(value);
}

function getTokenFilePath(): string {
  return path.join(app.getPath('userData'), 'research-api-tokens.json');
}

function readAllTokens(): Record<string, string> {
  try {
    const content = fs.readFileSync(getTokenFilePath(), 'utf-8');
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

function writeAllTokens(tokens: Record<string, string>): void {
  fs.writeFileSync(getTokenFilePath(), JSON.stringify(tokens, null, 2), 'utf-8');
}

/**
 * Returns the trimmed token for the given provider, or `undefined`
 * if not configured. Always safe to call — never throws.
 */
export function getResearchApiToken(provider: ResearchApiProvider): string | undefined {
  try {
    const tokens = readAllTokens();
    const raw = tokens[provider];
    if (typeof raw !== 'string') return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Persist a token for the given provider. Passing `null` or an empty
 * string clears the entry.
 */
export function setResearchApiToken(provider: ResearchApiProvider, token: string | null): void {
  const tokens = readAllTokens();
  if (token && token.trim().length > 0) {
    tokens[provider] = token.trim();
  } else {
    delete tokens[provider];
  }
  writeAllTokens(tokens);
}
