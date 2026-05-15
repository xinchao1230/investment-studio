/**
 * Auto-seed the `research-mcp` server config for the investment-studio brand.
 *
 * On every successful login, this seeds the user's MCP server list with a
 * stdio entry pointing at the bundled Python `research_mcp` package, run via
 * `uv`. The actual command path, working directory, token, and runtime dir
 * are all `@KOSMOS_*` placeholders resolved by `KosmosPlaceholderManager`
 * inside `MCPClientManager` at connect time.
 */

import { KosmosPlaceholder } from '../userDataADO/kosmosPlaceholders';
import type { McpServerConfig } from '../userDataADO/types/profile';

export const RESEARCH_MCP_SERVER_NAME = 'research-mcp';

/**
 * Build the placeholder-templated `McpServerConfig` for `research-mcp`.
 * `uvPath` is the absolute path to the `uv` binary (resolved at call time
 * via `runtimeManager.getBinaryPath('uv')` so it matches the user's actual
 * managed-runtime location).
 */
export function buildResearchMcpConfig(uvPath: string): McpServerConfig {
  return {
    name: RESEARCH_MCP_SERVER_NAME,
    transport: 'stdio',
    command: uvPath,
    args: [
      '--directory', KosmosPlaceholder.RESEARCH_RESOURCES_DIR,
      'run', '-m', 'research_mcp',
    ],
    env: {
      TUSHARE_TOKEN: KosmosPlaceholder.RESEARCH_TUSHARE_TOKEN,
      RESEARCH_MCP_RUNTIME_DIR: KosmosPlaceholder.RESEARCH_RUNTIME_DIR,
      RESEARCH_MCP_USER_DATA: KosmosPlaceholder.RESEARCH_USER_DATA_DIR,
    },
    url: '',
    in_use: true,
    source: 'ON-DEVICE',
  };
}

/**
 * Idempotently add `research-mcp` to the given user's MCP server list.
 * No-op for any brand other than `investment-studio`.
 */
export async function seedResearchMcpIfMissing(opts: {
  alias: string;
  brandName: string;
  uvPath: string;
}): Promise<{ seeded: boolean; reason?: string }> {
  if (opts.brandName !== 'investment-studio') {
    return { seeded: false, reason: 'brand-mismatch' };
  }
  const { ProfileCacheManager } = await import('../userDataADO/profileCacheManager');
  const pc = ProfileCacheManager.getInstance();
  const profile = pc.getCachedProfile(opts.alias);
  const exists = profile?.mcp_servers?.some(s => s.name === RESEARCH_MCP_SERVER_NAME);
  if (exists) {
    return { seeded: false, reason: 'already-present' };
  }
  const added = await pc.addMcpServerConfig(opts.alias, buildResearchMcpConfig(opts.uvPath));
  return { seeded: added, reason: added ? undefined : 'add-failed' };
}
