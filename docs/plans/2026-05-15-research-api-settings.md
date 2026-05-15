# Research API Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a new Settings → Research API panel that lets the user configure
Tushare and Eastmoney API tokens, persisted in `profile.json`, with a "Test
Connection" action and IPC accessors.

**Architecture:** New `researchApiTokens` field on `ProfileV2`; new
`updateResearchApiTokens` method on `ProfileCacheManager`; three new
`researchApi:*` IPC handlers in main; preload bridge under
`window.electronAPI.researchApi`; new `ResearchApiView` React component routed
at `/settings/research-api`; nav entry in `SettingsNavigation`; one
integration patch in `stockSuggest.ts` to honour the configured Eastmoney
token.

**Tech Stack:** Electron 35, React 18, TypeScript, Jest (ts-jest, node env),
React Router v6 (HashRouter), Tailwind 3.

**Design doc:** [docs/plans/2026-05-15-research-api-settings-design.md](2026-05-15-research-api-settings-design.md)

---

## Conventions

- Branch already in use: `feature/investment-studio` (do **not** branch off).
- Commit format: conventional commits, e.g.
  `feat(research-api): add profile schema field`.
- After every task: `npm test -- --testPathPattern=<new test>` must pass and
  `npm run lint` must show no new errors in changed files.
- Use absolute paths from repo root in this plan.

---

## Task 1: Add `researchApiTokens` to profile schema

**Files:**
- Modify: `src/main/lib/userDataADO/types/profile.ts` (around line 316)
- Test: `src/main/lib/userDataADO/types/profile.test.ts` (create if missing)

**Step 1: Write the failing test**

Append to `src/main/lib/userDataADO/types/profile.test.ts`:

```ts
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
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=profile.test.ts`
Expected: FAIL — "Property 'researchApiTokens' does not exist on type ProfileV2".

**Step 3: Write the minimal implementation**

In `src/main/lib/userDataADO/types/profile.ts`, inside the `ProfileV2`
interface (after the `lastActiveChatByTarget?` field, before the closing
brace), add:

```ts
  /**
   * Research workspace: per-provider API tokens (plain text, same security
   * level as mcp_servers[].env). Missing or empty string ⇒ not configured.
   */
  researchApiTokens?: {
    tushare?: string;
    eastmoney?: string;
  };
```

**Step 4: Run tests**

Run: `npm test -- --testPathPattern=profile.test.ts`
Expected: PASS (both new specs).

**Step 5: Commit**

```bash
git add src/main/lib/userDataADO/types/profile.ts src/main/lib/userDataADO/types/profile.test.ts
git commit -m "feat(research-api): add researchApiTokens field to ProfileV2"
```

---

## Task 2: Add `updateResearchApiTokens` to `ProfileCacheManager`

**Files:**
- Modify: `src/main/lib/userDataADO/profileCacheManager.ts` (add new method
  next to `updateVoiceInputSettings`, around line 2330)
- Test: `src/main/lib/userDataADO/profileCacheManager.researchApi.test.ts`
  (create)

**Step 1: Write the failing test**

Create `src/main/lib/userDataADO/profileCacheManager.researchApi.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { ProfileCacheManager } from './profileCacheManager';

// Note: lean on the existing test pattern in this directory; if you find a
// pre-existing helper that builds a temp-userData ProfileCacheManager,
// reuse it here. Otherwise inline the minimal setup mirroring
// profileCacheManager existing tests in the same folder.
describe('ProfileCacheManager.updateResearchApiTokens', () => {
  it('persists partial updates and clears via empty string', async () => {
    const mgr = ProfileCacheManager.getInstance();
    const alias = `tester-${Date.now()}`;
    // Seed an empty V2 profile through whatever bootstrap helper the
    // surrounding tests use (e.g. ensureProfile / createProfile). If no
    // helper exists, follow the pattern in the nearest sibling test file.
    await mgr.ensureProfile?.(alias);

    const ok = await mgr.updateResearchApiTokens(alias, { tushare: 'abc' });
    expect(ok).toBe(true);

    const p = await mgr.getProfile(alias);
    expect(p?.researchApiTokens?.tushare).toBe('abc');
    expect(p?.researchApiTokens?.eastmoney).toBeUndefined();

    await mgr.updateResearchApiTokens(alias, { tushare: '' });
    const p2 = await mgr.getProfile(alias);
    expect(p2?.researchApiTokens?.tushare).toBeUndefined();
  });
});
```

> If the project has no `ensureProfile` helper or test fixtures, copy the
> setup block from `profileCacheManager.*.test.ts` siblings. Do **not**
> invent new fixtures — match what exists.

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=profileCacheManager.researchApi`
Expected: FAIL — "updateResearchApiTokens is not a function".

**Step 3: Write the minimal implementation**

Insert the following method in
`src/main/lib/userDataADO/profileCacheManager.ts` immediately after
`updateVoiceInputSettings`:

```ts
  /**
   * Merge-update the user's research-API tokens. Empty string clears the
   * provider (treated as undefined). Returns true on success.
   */
  async updateResearchApiTokens(
    alias: string,
    patch: { tushare?: string; eastmoney?: string },
  ): Promise<boolean> {
    try {
      let profile = this.cache.get(alias);
      if (!profile) {
        const fileProfile = await this.readProfileFromFile(alias);
        if (!fileProfile) return false;
        profile = fileProfile;
      }
      if (!isProfileV2(profile)) return false;

      const current = profile.researchApiTokens ?? {};
      const next: { tushare?: string; eastmoney?: string } = { ...current };
      for (const key of ['tushare', 'eastmoney'] as const) {
        if (key in patch) {
          const value = patch[key];
          if (typeof value === 'string' && value.length > 0) {
            next[key] = value;
          } else {
            delete next[key];
          }
        }
      }

      // Normalize: drop the field entirely if no tokens remain.
      if (Object.keys(next).length === 0) {
        delete profile.researchApiTokens;
      } else {
        profile.researchApiTokens = next;
      }

      this.cache.set(alias, profile);
      await this.notifyProfileDataManager(alias, true);
      const success = await this.writeProfileToFile(alias, profile);
      return success;
    } catch {
      return false;
    }
  }
```

**Step 4: Run tests**

Run: `npm test -- --testPathPattern=profileCacheManager.researchApi`
Expected: PASS.

Then run a quick lint:
Run: `npm run lint -- src/main/lib/userDataADO/profileCacheManager.ts`
Expected: no new errors.

**Step 5: Commit**

```bash
git add src/main/lib/userDataADO/profileCacheManager.ts src/main/lib/userDataADO/profileCacheManager.researchApi.test.ts
git commit -m "feat(research-api): add updateResearchApiTokens to ProfileCacheManager"
```

---

## Task 3: Main-process `testConnection` helpers

**Files:**
- Create: `src/main/lib/researchApi/testConnection.ts`
- Test: `src/main/lib/researchApi/testConnection.test.ts`

**Step 1: Write the failing test**

Create `src/main/lib/researchApi/testConnection.test.ts`:

```ts
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
```

**Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern=researchApi/testConnection`
Expected: FAIL — module not found.

**Step 3: Write the minimal implementation**

Create `src/main/lib/researchApi/testConnection.ts`:

```ts
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
```

**Step 4: Run tests**

Run: `npm test -- --testPathPattern=researchApi/testConnection`
Expected: PASS (4 tests).

**Step 5: Commit**

```bash
git add src/main/lib/researchApi/
git commit -m "feat(research-api): add Tushare/Eastmoney testConnection helpers"
```

---

## Task 4: Wire IPC handlers in main process

**Files:**
- Modify: `src/main/main.ts` (add three handlers near other `ipcMain.handle`
  blocks for fs/profile)

**Step 1: Locate insertion site**

Open `src/main/main.ts`. Find the `'fs:readFile'` handler (around line 2976)
and add the new handlers right above or below it — anywhere inside the
`ipcMain.handle` registration sweep is fine; keep them grouped.

**Step 2: Add handlers**

```ts
ipcMain.handle('researchApi:getToken', async (_event, provider: string) => {
  try {
    if (provider !== 'tushare' && provider !== 'eastmoney') return undefined;
    const profile = await this.profileCacheManager.getProfile(this.currentUserAlias);
    return profile?.researchApiTokens?.[provider as 'tushare' | 'eastmoney'];
  } catch {
    return undefined;
  }
});

ipcMain.handle('researchApi:setToken',
  async (_event, provider: string, token: string | null) => {
    try {
      if (provider !== 'tushare' && provider !== 'eastmoney') {
        return { ok: false, error: 'unknown provider' };
      }
      const value = token ?? '';
      const ok = await this.profileCacheManager.updateResearchApiTokens(
        this.currentUserAlias,
        { [provider]: value } as any,
      );
      return { ok };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

ipcMain.handle('researchApi:testConnection',
  async (_event, provider: string) => {
    try {
      if (provider !== 'tushare' && provider !== 'eastmoney') {
        return { ok: false, error: 'unknown provider' };
      }
      const profile = await this.profileCacheManager.getProfile(this.currentUserAlias);
      const token = profile?.researchApiTokens?.[provider as 'tushare' | 'eastmoney'];
      if (!token) return { ok: false, error: 'token not configured' };
      const { testTushareToken, testEastmoneyToken } =
        await import('./lib/researchApi/testConnection');
      return provider === 'tushare'
        ? await testTushareToken(token)
        : await testEastmoneyToken(token);
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
```

> If `this.profileCacheManager` is not the local accessor (some handlers use
> a lazy getter pattern), copy the pattern from the nearest existing
> profile-related handler in this file.

**Step 3: Verify it compiles**

Run: `npx tsc -p tsconfig.main.json --noEmit`
Expected: no errors.

**Step 4: Commit**

```bash
git add src/main/main.ts
git commit -m "feat(research-api): add researchApi:* IPC handlers"
```

---

## Task 5: Expose `researchApi` on preload bridge

**Files:**
- Modify: `src/main/preload.ts` (add a `researchApi` namespace next to `fs:`,
  around line 1975)

**Step 1: Add bridge**

```ts
  researchApi: {
    getToken: (provider: 'tushare' | 'eastmoney') =>
      ipcRenderer.invoke('researchApi:getToken', provider) as Promise<string | undefined>,
    setToken: (provider: 'tushare' | 'eastmoney', token: string | null) =>
      ipcRenderer.invoke('researchApi:setToken', provider, token) as Promise<{ ok: boolean; error?: string }>,
    testConnection: (provider: 'tushare' | 'eastmoney') =>
      ipcRenderer.invoke('researchApi:testConnection', provider) as Promise<{ ok: boolean; error?: string }>,
  },
```

**Step 2: Update typings**

If `src/shared/types/electron-api.d.ts` (or equivalent) declares
`window.electronAPI`, add a matching `researchApi` shape there. If the
project relies on `as any` for the bridge (grep for `electronAPI.fs`), no
typing change is needed — match the surrounding pattern.

**Step 3: Verify it compiles**

Run: `npx tsc -p tsconfig.main.json --noEmit`
Run: `npx tsc -p tsconfig.renderer.json --noEmit`
Expected: no errors in either.

**Step 4: Commit**

```bash
git add src/main/preload.ts src/shared/types
git commit -m "feat(research-api): expose researchApi on preload bridge"
```

---

## Task 6: ResearchApiView component

**Files:**
- Create: `src/renderer/components/settings/ResearchApiView.tsx`

**Step 1: Implementation**

```tsx
import React, { useEffect, useState, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type Provider = 'tushare' | 'eastmoney';

interface ProviderSpec {
  id: Provider;
  title: string;
  helper: React.ReactNode;
}

const PROVIDERS: ProviderSpec[] = [
  {
    id: 'tushare',
    title: 'Tushare',
    helper: (
      <>前往 <a href="https://tushare.pro/register" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">tushare.pro</a> 注册并复制你的 token。</>
    ),
  },
  {
    id: 'eastmoney',
    title: 'Eastmoney',
    helper: <>留空将使用应用内置 token；自定义 token 用于高频调用配额。</>,
  },
];

interface CardState {
  initial: string;
  draft: string;
  show: boolean;
  saving: boolean;
  testing: boolean;
  status: { ok: boolean; error?: string } | null;
}

const emptyState = (initial: string): CardState => ({
  initial,
  draft: initial,
  show: false,
  saving: false,
  testing: false,
  status: null,
});

export const ResearchApiView: React.FC = () => {
  const [cards, setCards] = useState<Record<Provider, CardState>>({
    tushare: emptyState(''),
    eastmoney: emptyState(''),
  });

  // Initial load
  useEffect(() => {
    let alive = true;
    (async () => {
      const api = (window as any).electronAPI?.researchApi;
      if (!api) return;
      const [t, e] = await Promise.all([api.getToken('tushare'), api.getToken('eastmoney')]);
      if (!alive) return;
      setCards({
        tushare: emptyState(t ?? ''),
        eastmoney: emptyState(e ?? ''),
      });
    })();
    return () => { alive = false; };
  }, []);

  const updateCard = useCallback((id: Provider, patch: Partial<CardState>) => {
    setCards((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const handleSave = useCallback(async (id: Provider) => {
    const api = (window as any).electronAPI?.researchApi;
    if (!api) return;
    updateCard(id, { saving: true, status: null });
    const value = cards[id].draft;
    const result = await api.setToken(id, value.length > 0 ? value : null);
    updateCard(id, {
      saving: false,
      initial: result.ok ? value : cards[id].initial,
      status: result.ok ? null : { ok: false, error: result.error ?? '保存失败' },
    });
  }, [cards, updateCard]);

  const handleTest = useCallback(async (id: Provider) => {
    const api = (window as any).electronAPI?.researchApi;
    if (!api) return;
    // Save first if dirty so the test uses the value the user just typed.
    if (cards[id].draft !== cards[id].initial) {
      await handleSave(id);
    }
    updateCard(id, { testing: true, status: null });
    const r = await api.testConnection(id);
    updateCard(id, { testing: false, status: r });
  }, [cards, handleSave, updateCard]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-1">Research API</h1>
      <p className="text-sm text-gray-500 mb-6">
        投研工作流使用的数据源 API token 配置。Token 以明文形式与 profile.json 一同保存。
      </p>

      <div className="space-y-4">
        {PROVIDERS.map((p) => {
          const c = cards[p.id];
          const dirty = c.draft !== c.initial;
          return (
            <div key={p.id} className="border border-gray-200 rounded-lg p-5 bg-white">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-medium">{p.title}</h2>
              </div>

              <div className="flex gap-2 items-center">
                <div className="flex-1 relative">
                  <input
                    type={c.show ? 'text' : 'password'}
                    value={c.draft}
                    onChange={(e) => updateCard(p.id, { draft: e.target.value, status: null })}
                    placeholder="paste your token here"
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm pr-10 focus:outline-none focus:border-blue-500"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => updateCard(p.id, { show: !c.show })}
                    aria-label={c.show ? 'hide' : 'show'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {c.show ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <button
                  disabled={!dirty || c.saving}
                  onClick={() => handleSave(p.id)}
                  className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {c.saving ? '保存中…' : '保存'}
                </button>
                <button
                  disabled={c.testing || !c.initial}
                  onClick={() => handleTest(p.id)}
                  className="px-3 py-1.5 text-sm rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {c.testing ? '测试中…' : '测试连接'}
                </button>
              </div>

              {c.status && (
                <div className={`mt-2 text-xs ${c.status.ok ? 'text-green-600' : 'text-red-600'}`}>
                  {c.status.ok ? '✓ 连接成功' : `✗ ${c.status.error ?? '失败'}`}
                </div>
              )}

              <p className="mt-3 text-xs text-gray-500">{p.helper}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ResearchApiView;
```

**Step 2: Verify it compiles**

Run: `npx tsc -p tsconfig.renderer.json --noEmit`
Expected: no errors.

**Step 3: Commit**

```bash
git add src/renderer/components/settings/ResearchApiView.tsx
git commit -m "feat(research-api): add ResearchApiView component"
```

---

## Task 7: Route + nav entry

**Files:**
- Modify: `src/renderer/routes/AppRoutes.tsx` (around line 159 settings block)
- Modify: `src/renderer/components/settings/SettingsNavigation.tsx`

**Step 1: Add route**

Add the import:
```ts
import ResearchApiView from '../components/settings/ResearchApiView';
```

Inside `<Route path="/settings" …>`, alongside `path="runtime"`:
```tsx
<Route path="research-api" element={<ResearchApiView />} />
```

**Step 2: Add nav item**

In `SettingsNavigation.tsx`:

1. Inside `getActiveView()`, add (above the final `return 'mcp'`):
   ```ts
   if (path.includes('/settings/research-api')) return 'research-api';
   ```
2. Add a NavItem element between Runtime and the feature-flagged group
   (insert it right after the existing Runtime `<NavItem>`):
   ```tsx
   <NavItem
     icon={<McpIcon />}
     label="Research API"
     isActive={activeView === 'research-api'}
     onClick={() => navigate('/settings/research-api')}
     ariaLabel="Research API tokens"
   />
   ```
   > Use `<McpIcon />` as a placeholder. If a more appropriate lucide icon is
   > already imported in the file (e.g. `Key` from `lucide-react`), prefer
   > that and add the import. Do not introduce a new asset file.

**Step 3: Verify it compiles**

Run: `npx tsc -p tsconfig.renderer.json --noEmit`
Expected: no errors.

**Step 4: Manual smoke**

Run: `npm run dev:full`
- Open Settings → confirm "Research API" appears in the left nav.
- Click it → ResearchApiView renders.
- Type a token → press 保存 → reload window (Ctrl+R) → token still loaded.

**Step 5: Commit**

```bash
git add src/renderer/routes/AppRoutes.tsx src/renderer/components/settings/SettingsNavigation.tsx
git commit -m "feat(research-api): route and settings-nav entry"
```

---

## Task 8: Honour configured Eastmoney token in `stockSuggest.ts`

**Files:**
- Modify: `src/renderer/components/research/stockSuggest.ts`

**Step 1: Update the token lookup**

Locate the `const TOKEN = '...'` constant. Replace its single use site with
an async lookup at call time:

```ts
const FALLBACK_TOKEN = 'D43BF722C8E33BDC906FB84D85E326E8';

async function resolveToken(): Promise<string> {
  try {
    const api = (window as any).electronAPI?.researchApi;
    const t = await api?.getToken('eastmoney');
    return typeof t === 'string' && t.length > 0 ? t : FALLBACK_TOKEN;
  } catch {
    return FALLBACK_TOKEN;
  }
}
```

In the function that builds the URL (currently uses `TOKEN`), call
`await resolveToken()` to obtain the token. Keep the rest of the request
shape unchanged.

**Step 2: Verify it compiles**

Run: `npx tsc -p tsconfig.renderer.json --noEmit`
Expected: no errors.

**Step 3: Manual smoke**

Run: `npm run dev:full`
- Without configuring an Eastmoney token: stock suggest still works.
- Configure a clearly-bogus Eastmoney token in Settings → Research API and
  save → suggest stops returning results (expected — wrong token).
- Clear it → suggest works again via fallback.

**Step 4: Commit**

```bash
git add src/renderer/components/research/stockSuggest.ts
git commit -m "feat(research-api): honour configured Eastmoney token in stockSuggest"
```

---

## Task 9: Final verification

**Step 1: Full test pass**

Run: `npm test`
Expected: PASS (no regressions; new tests count up).

**Step 2: Lint**

Run: `npm run lint`
Expected: no new errors in changed files.

**Step 3: Type check both projects**

Run: `npx tsc -p tsconfig.main.json --noEmit`
Run: `npx tsc -p tsconfig.renderer.json --noEmit`
Expected: clean.

**Step 4: Smoke (manual)**

`npm run dev:full`, then in the app:
1. Open Settings → Research API.
2. Save a Tushare token → click 测试连接 → expect ✓ with a real token, ✗ with a junk one.
3. Save an Eastmoney token (junk) → click 测试连接 → expect a result line.
4. Clear both fields → save → reload window → both inputs empty on next visit.

If everything passes, the feature is done. No further commit needed; all
prior tasks already committed.

---

## Out of Scope (do not implement here)

- `safeStorage` encryption.
- A "skills recommendations" section.
- New providers beyond Tushare/Eastmoney.
- Auto-injection of tokens into MCP / Python subprocess env.
