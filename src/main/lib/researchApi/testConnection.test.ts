/**
 * @jest-environment node
 */
import { testTushareToken, testEastmoneyToken } from './testConnection';

describe('testConnection helpers', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('tushare returns ok when api responds with code 0', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ code: 0, msg: '', data: { items: [] } }),
    } as any));
    const r = await testTushareToken('abc');
    expect(r.ok).toBe(true);
  });

  it('tushare returns ok=false when code != 0', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ code: 40001, msg: 'invalid token' }),
    } as any));
    const r = await testTushareToken('abc');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('invalid token');
  });

  it('eastmoney returns ok on 200', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ QuotationCodeTable: { Data: [] } }),
    } as any));
    const r = await testEastmoneyToken('xyz');
    expect(r.ok).toBe(true);
  });

  it('returns ok=false on network throw', async () => {
    global.fetch = jest.fn(async () => { throw new Error('boom'); });
    const r = await testTushareToken('abc');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('boom');
  });
});
