export interface TestResult {
  ok: boolean;
  error?: string;
}

const TIMEOUT_MS = 5000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); },
           (e) => { clearTimeout(t); reject(e); });
  });
}

export async function testTushareToken(token: string): Promise<TestResult> {
  if (!token) return { ok: false, error: 'token is empty' };
  try {
    const res = await withTimeout(fetch('https://api.tushare.pro', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_name: 'stock_basic',
        token,
        params: { list_status: 'L' },
        fields: 'ts_code',
      }),
    }), TIMEOUT_MS);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body: any = await res.json();
    if (body?.code === 0) return { ok: true };
    return { ok: false, error: String(body?.msg ?? `code=${body?.code}`) };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export async function testEastmoneyToken(token: string): Promise<TestResult> {
  if (!token) return { ok: false, error: 'token is empty' };
  try {
    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=test&type=14&token=${encodeURIComponent(token)}`;
    const res = await withTimeout(fetch(url), TIMEOUT_MS);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    await res.json();
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
