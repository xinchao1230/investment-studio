import type { ProfileV2 } from './profile';

describe('ProfileV2.researchApiTokens', () => {
  it('is optional and defaults to undefined', () => {
    const p: ProfileV2 = {
      version: 2,
      alias: 'tester',
      mcp_servers: [],
      chats: [],
    } as unknown as ProfileV2;
    expect(p.researchApiTokens).toBeUndefined();
  });

  it('accepts tushare and eastmoney string fields', () => {
    const p: ProfileV2 = {
      version: 2,
      alias: 'tester',
      mcp_servers: [],
      chats: [],
      researchApiTokens: { tushare: 'tk', eastmoney: 'em' },
    } as unknown as ProfileV2;
    expect(p.researchApiTokens?.tushare).toBe('tk');
    expect(p.researchApiTokens?.eastmoney).toBe('em');
  });
});
