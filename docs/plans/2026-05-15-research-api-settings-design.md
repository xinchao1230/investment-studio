# Research API Settings — Design

Date: 2026-05-15
Status: Approved (brainstorming)
Owner: feature/investment-studio

## Goal

Add a new **Settings → Research API** panel for managing API tokens used by
investment-research workflows. v1 supports **Tushare** and **Eastmoney**.
All other Settings sections are kept as-is.

## Non-Goals

- No skill-installation UI inside this panel (use existing Skills panel).
- No remote skills-catalog browsing.
- No encrypted storage in v1 — same security level as existing
  `mcp_servers[].env` plain-text persistence.
- No automatic env-var injection into MCP / Python subprocesses; consumers
  fetch tokens explicitly via IPC.

## Data Model

`profile.json` gains an optional field; missing means "no tokens configured":

```ts
researchApiTokens?: {
  tushare?: string;
  eastmoney?: string;
};
```

Read/write via `ProfileCacheManager`. No migration needed.

## IPC Surface

New channels under prefix `researchApi:` exposed on
`window.electronAPI.researchApi`:

| Method | Args | Returns |
|---|---|---|
| `getToken` | `provider: 'tushare' \| 'eastmoney'` | `string \| undefined` |
| `setToken` | `provider, token: string \| null` | `void` (null clears) |
| `testConnection` | `provider` | `{ ok: boolean; error?: string }` |

`testConnection` rules (5 s timeout, no retries):
- **Tushare** — POST `https://api.tushare.pro` with `api_name: 'stock_basic'`
  and `params: { list_status: 'L', limit: 1 }`. `ok` iff response `code === 0`.
- **Eastmoney** — GET `searchapi.eastmoney.com/api/suggest/get` with the user
  token. `ok` iff HTTP 200 and JSON body parseable.

All IPC handlers return `{ ok, error }` shapes (or undefined for getters);
they never throw across the boundary.

## UI

- New file: `src/renderer/components/settings/ResearchApiView.tsx`
- New route: `/settings/research-api`
- New nav entry in `SettingsNavigation.tsx` labelled **Research API**, no
  feature flag (visible in all brands).
- Layout: page header + two cards (Tushare, Eastmoney). Each card:
  - Password-style input with show/hide toggle
  - Save button (disabled when unchanged)
  - "测试连接" button → spinner → status line (✓ green / ✗ red + error)
  - Helper link: Tushare → `https://tushare.pro/register`; Eastmoney → short
    note that leaving blank uses the bundled fallback token

State management is local component state + IPC; no atom/global store needed.

## Integration With Existing Code

- `src/renderer/components/research/stockSuggest.ts`:
  before fetching, call `window.electronAPI.researchApi.getToken('eastmoney')`;
  fall back to the existing hard-coded token when undefined. Keeps current
  behaviour for users who never visit the new panel.
- Tushare has no existing renderer caller. Future Python skills /
  built-in tools that need it will fetch via the same IPC (or a thin
  main-process helper if invoked from main).

## Error Handling

- Empty token on Save → keep button disabled.
- `testConnection` network errors → return `{ ok: false, error: <msg> }` and
  display under the input. No toast.
- Profile write failures bubble up via existing `ProfileCacheManager` error
  surfaces; UI shows generic "保存失败" with the underlying message.

## Testing

- Unit: profile schema round-trips (set, clear, missing field).
- Unit: `testConnection` happy path + failure path with `fetch` mocked.
- Manual: configure both tokens, restart app, verify persistence; clear and
  verify `getToken` returns undefined.

## Out Of Scope (Future)

- Encrypt tokens at rest via `safeStorage`.
- Add provider entries (AkShare, Wind/Choice).
- "Install recommended skills" surface tied to provider.
