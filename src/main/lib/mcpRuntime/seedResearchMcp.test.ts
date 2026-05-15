import { buildResearchMcpConfig, RESEARCH_MCP_SERVER_NAME, seedResearchMcpIfMissing } from './seedResearchMcp';
import { KosmosPlaceholder } from '../userDataADO/kosmosPlaceholders';

describe('buildResearchMcpConfig', () => {
  it('produces stdio config with placeholder values + correct uv path', () => {
    const cfg = buildResearchMcpConfig('/path/to/uv');
    expect(cfg.name).toBe(RESEARCH_MCP_SERVER_NAME);
    expect(cfg.transport).toBe('stdio');
    expect(cfg.command).toBe('/path/to/uv');
    expect(cfg.args).toEqual([
      '--directory', KosmosPlaceholder.RESEARCH_RESOURCES_DIR,
      'run', '-m', 'research_mcp',
    ]);
    expect(cfg.env.TUSHARE_TOKEN).toBe(KosmosPlaceholder.RESEARCH_TUSHARE_TOKEN);
    expect(cfg.env.RESEARCH_MCP_RUNTIME_DIR).toBe(KosmosPlaceholder.RESEARCH_RUNTIME_DIR);
    expect(cfg.env.RESEARCH_MCP_USER_DATA).toBe(KosmosPlaceholder.RESEARCH_USER_DATA_DIR);
    expect(cfg.in_use).toBe(true);
    expect(cfg.url).toBe('');
    expect(cfg.source).toBe('ON-DEVICE');
  });

  it('uses literal @KOSMOS_ tokens (verifying enum values, not bare names)', () => {
    const cfg = buildResearchMcpConfig('uv');
    expect(cfg.env.TUSHARE_TOKEN).toBe('@KOSMOS_RESEARCH_TUSHARE_TOKEN');
    expect(cfg.args).toContain('@KOSMOS_RESEARCH_RESOURCES_DIR');
  });
});

describe('seedResearchMcpIfMissing', () => {
  it('skips for non investment-studio brands', async () => {
    const r = await seedResearchMcpIfMissing({
      alias: 'anyone',
      brandName: 'openkosmos',
      uvPath: '/uv',
    });
    expect(r.seeded).toBe(false);
    expect(r.reason).toBe('brand-mismatch');
  });
});
