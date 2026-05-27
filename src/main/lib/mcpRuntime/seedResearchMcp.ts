/**
 * Auto-seed the `research-mcp` server config for the investment-studio brand.
 */

import { OpenKosmosPlaceholder } from '../userDataADO/openkosmosPlaceholders';
import type { McpServerConfig } from '../userDataADO/types/profile';

export const RESEARCH_MCP_SERVER_NAME = 'research-mcp';

export function buildResearchMcpConfig(uvPath: string): McpServerConfig {
  return {
    name: RESEARCH_MCP_SERVER_NAME,
    transport: 'stdio',
    command: uvPath,
    args: [
      '--directory', OpenKosmosPlaceholder.RESEARCH_RESOURCES_DIR,
      'run', 'python', '-m', 'research_mcp',
    ],
    env: {
      TUSHARE_TOKEN: OpenKosmosPlaceholder.RESEARCH_TUSHARE_TOKEN,
      RESEARCH_MCP_RUNTIME_DIR: OpenKosmosPlaceholder.RESEARCH_RUNTIME_DIR,
      RESEARCH_MCP_USER_DATA: OpenKosmosPlaceholder.RESEARCH_USER_DATA_DIR,
    },
    url: '',
    in_use: true,
    source: 'ON-DEVICE',
  } as McpServerConfig;
}

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
  const exists = profile?.mcp_servers?.some((s: any) => s.name === RESEARCH_MCP_SERVER_NAME);
  if (exists) {
    return { seeded: false, reason: 'already-present' };
  }
  const added = await pc.addMcpServerConfig(opts.alias, buildResearchMcpConfig(opts.uvPath));
  return { seeded: added, reason: added ? undefined : 'add-failed' };
}
