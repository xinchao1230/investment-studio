import { kosmosPlaceholderManager, KosmosPlaceholder } from './kosmosPlaceholders';

describe('KosmosPlaceholder research-mcp values', () => {
  it('resolves @KOSMOS_RESEARCH_RUNTIME_DIR to userData/runtimes/research-mcp', () => {
    const out = kosmosPlaceholderManager.getPlaceholderValue(
      KosmosPlaceholder.RESEARCH_RUNTIME_DIR,
      { alias: 'tester' },
    );
    expect(out).toBeTruthy();
    expect(out).toContain('runtimes');
    expect(out).toContain('research-mcp');
  });

  it('resolves @KOSMOS_RESEARCH_RESOURCES_DIR to a path containing mcp/research', () => {
    const out = kosmosPlaceholderManager.getPlaceholderValue(
      KosmosPlaceholder.RESEARCH_RESOURCES_DIR,
      { alias: 'tester' },
    );
    expect(out).toContain('mcp');
    expect(out).toContain('research');
  });

  it('returns empty string for @KOSMOS_RESEARCH_TUSHARE_TOKEN when no token configured', () => {
    const out = kosmosPlaceholderManager.getPlaceholderValue(
      KosmosPlaceholder.RESEARCH_TUSHARE_TOKEN,
      { alias: 'tester' },
    );
    expect(out).toBe('');
  });

  it('resolves @KOSMOS_RESEARCH_USER_DATA_DIR to a non-empty path', () => {
    const out = kosmosPlaceholderManager.getPlaceholderValue(
      KosmosPlaceholder.RESEARCH_USER_DATA_DIR,
      { alias: 'tester' },
    );
    expect(out).toBeTruthy();
    expect(typeof out).toBe('string');
  });
});
