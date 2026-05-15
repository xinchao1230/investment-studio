# Stock-Analyze Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship `/stock-analyze <company>` skill that produces a deep stock-research report by invoking a bundled Python MCP server (`research-mcp`).

**Architecture:** Single Python MCP server packaged under `resources/mcp/research/`, exposing 13 atomic tools (data collect, compute, output). One new skill `skills/stock-analyze/` orchestrates 6 phases + reviewer self-loop using main LLM. Existing `KosmosPlaceholderManager` is extended to inject Tushare token + paths into the MCP env on spawn. First-launch install handled by a new `ResearchMcpInstallManager` mirroring the `NativeModuleManager` blocking-modal UX. `skills/deep-report` stays as a complementary "quick screening" skill.

**Tech Stack:** TypeScript (main + renderer), Python 3.11 + uv, MCP stdio, Tushare/akshare/yfinance/pdfplumber, Electron-builder asarUnpack, Jest (TS) + pytest (Python).

**Reference design:** `docs/plans/2026-05-15-stock-analyze-integration-design.md` — read this first.

**Key existing code:**
- Placeholders: `src/main/lib/userDataADO/kosmosPlaceholders.ts` (extend enum + switch)
- MCP env injection already wired: `src/main/lib/mcpRuntime/mcpClientManager.ts:1149-1155`
- Token IPC: `src/main/main.ts:3296-3351` (`researchApi:getToken/setToken/testConnection`)
- Token storage: `ProfileCacheManager.updateResearchApiTokens`
- uv binary: `RuntimeManager.getInternalToolPath('uv')`
- Reconnect MCP: `mcp:reconnectServer` IPC exists
- Native install pattern reference: `src/main/lib/nativeModules/nativeModuleManager.ts`
- Brand config: `brands/investment-studio/config.json`

**Hard rules:**
- DRY, YAGNI, TDD, frequent commits.
- Each task ends with a green test + a commit.
- All tools return `{ok, error?, retryable?, paths?, summary?}` — no exceptions thrown.
- No code-review or PR creation in this plan; that's a separate post-execution step.

---

## Milestone M1 — Placeholder extension + Python skeleton

### Task 1: Extend `KosmosPlaceholder` enum with research-mcp variables

**Files:**
- Modify: `src/main/lib/userDataADO/kosmosPlaceholders.ts`
- Test: `src/main/lib/userDataADO/kosmosPlaceholders.test.ts` (create if missing)

**Step 1: Write the failing test**

```ts
// kosmosPlaceholders.test.ts
import { kosmosPlaceholderManager, KosmosPlaceholder } from './kosmosPlaceholders';
import * as path from 'path';

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
    // Returning '' (not null) means env var is set to empty — Python side detects this
    expect(out === '' || out === null).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest src/main/lib/userDataADO/kosmosPlaceholders.test.ts`
Expected: FAIL — `KosmosPlaceholder.RESEARCH_RUNTIME_DIR` is undefined.

**Step 3: Implement**

Add to enum:

```ts
export enum KosmosPlaceholder {
  PROFILE_WORKSPACES_FOLDER = '@KOSMOS_PROFILE_WORKSPACES_FOLDER',
  RESEARCH_RUNTIME_DIR     = '@KOSMOS_RESEARCH_RUNTIME_DIR',
  RESEARCH_RESOURCES_DIR   = '@KOSMOS_RESEARCH_RESOURCES_DIR',
  RESEARCH_TUSHARE_TOKEN   = '@KOSMOS_RESEARCH_TUSHARE_TOKEN',
  RESEARCH_USER_DATA_DIR   = '@KOSMOS_RESEARCH_USER_DATA_DIR',
}
```

Add metadata for new path-typed entries (TOKEN is STRING):

```ts
const PLACEHOLDER_METADATA = {
  [KosmosPlaceholder.PROFILE_WORKSPACES_FOLDER]: { type: PlaceholderType.PATH },
  [KosmosPlaceholder.RESEARCH_RUNTIME_DIR]:     { type: PlaceholderType.PATH },
  [KosmosPlaceholder.RESEARCH_RESOURCES_DIR]:   { type: PlaceholderType.PATH },
  [KosmosPlaceholder.RESEARCH_USER_DATA_DIR]:   { type: PlaceholderType.PATH },
  [KosmosPlaceholder.RESEARCH_TUSHARE_TOKEN]:   { type: PlaceholderType.STRING },
};
```

Add switch cases in `getPlaceholderValue`:

```ts
case KosmosPlaceholder.RESEARCH_RUNTIME_DIR:
  value = path.join(getUserDataPath(), 'runtimes', 'research-mcp');
  break;
case KosmosPlaceholder.RESEARCH_USER_DATA_DIR:
  value = getUserDataPath();
  break;
case KosmosPlaceholder.RESEARCH_RESOURCES_DIR: {
  // app.isPackaged → process.resourcesPath/mcp/research
  // dev               → app.getAppPath()/resources/mcp/research
  const { app } = require('electron');
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'mcp', 'research')
    : path.join(app.getAppPath(), 'resources', 'mcp', 'research');
  value = base;
  break;
}
case KosmosPlaceholder.RESEARCH_TUSHARE_TOKEN: {
  // Lazy-import to avoid circular dep
  const { ProfileCacheManager } = require('./profileCacheManager');
  const profile = ProfileCacheManager.getInstance().getCachedProfile(context.alias);
  value = profile?.researchApiTokens?.tushare ?? '';
  break;
}
```

**Step 4: Run test, expect PASS**

Run: `npx jest src/main/lib/userDataADO/kosmosPlaceholders.test.ts`

**Step 5: Commit**

```bash
git add src/main/lib/userDataADO/kosmosPlaceholders.ts src/main/lib/userDataADO/kosmosPlaceholders.test.ts
git commit -m "feat(placeholders): add research-mcp placeholders (runtime/resources/token/userData)"
```

---

### Task 2: Create Python MCP package skeleton + `check_env` tool

**Files:**
- Create: `resources/mcp/research/pyproject.toml`
- Create: `resources/mcp/research/requirements.txt`
- Create: `resources/mcp/research/src/research_mcp/__init__.py`
- Create: `resources/mcp/research/src/research_mcp/__main__.py`
- Create: `resources/mcp/research/src/research_mcp/server.py`
- Create: `resources/mcp/research/src/research_mcp/tools/__init__.py`
- Create: `resources/mcp/research/src/research_mcp/tools/env.py`
- Create: `resources/mcp/research/src/research_mcp/lib/__init__.py`
- Create: `resources/mcp/research/src/research_mcp/lib/result.py`
- Create: `resources/mcp/research/tests/test_env.py`

**Step 1: Write the failing test**

```python
# tests/test_env.py
from research_mcp.tools.env import check_env

def test_check_env_returns_ok_structure():
    r = check_env()
    assert r["ok"] is True
    assert "tushare" in r
    assert "python_version" in r

def test_check_env_tushare_false_when_no_token(monkeypatch):
    monkeypatch.delenv("TUSHARE_TOKEN", raising=False)
    r = check_env()
    assert r["tushare"] is False
    assert "hint" in r
```

**Step 2: Run test, expect FAIL** (module not found)

Run: `cd resources/mcp/research && uv run pytest tests/test_env.py -v`

**Step 3: Implement**

```toml
# pyproject.toml
[project]
name = "research-mcp"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "mcp>=1.0.0",
  "tushare>=1.4.0",
  "akshare>=1.13.0",
  "yfinance>=0.2.40",
  "pandas>=2.0.0",
  "pdfplumber>=0.11.0",
  "requests>=2.31.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/research_mcp"]

[tool.pytest.ini_options]
pythonpath = ["src"]
```

```python
# src/research_mcp/lib/result.py
from typing import TypedDict, NotRequired, Optional, List

class ToolResult(TypedDict):
    ok: bool
    error: NotRequired[str]
    retryable: NotRequired[bool]
    paths: NotRequired[List[str]]
    summary: NotRequired[str]

def ok(**kwargs) -> dict:
    return {"ok": True, **kwargs}

def fail(error: str, retryable: bool = False) -> dict:
    return {"ok": False, "error": error, "retryable": retryable}
```

```python
# src/research_mcp/tools/env.py
import os, sys, platform

def check_env() -> dict:
    token = os.environ.get("TUSHARE_TOKEN", "").strip()
    return {
        "ok": True,
        "tushare": bool(token),
        "python_version": platform.python_version(),
        "hint": "请在 Settings → 投研 API 配置 Tushare token" if not token else None,
    }
```

```python
# src/research_mcp/server.py — minimal MCP stdio server
import asyncio
from mcp.server import Server
from mcp.server.stdio import stdio_server
import mcp.types as types
from .tools.env import check_env

app = Server("research-mcp")

@app.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="check_env",
            description="Check research-mcp environment readiness (tushare token, python version)",
            inputSchema={"type": "object", "properties": {}},
        ),
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    import json
    if name == "check_env":
        result = check_env()
    else:
        result = {"ok": False, "error": f"unknown tool: {name}", "retryable": False}
    return [types.TextContent(type="text", text=json.dumps(result, ensure_ascii=False))]

async def main():
    async with stdio_server() as (r, w):
        await app.run(r, w, app.create_initialization_options())

def run():
    asyncio.run(main())
```

```python
# src/research_mcp/__main__.py
from .server import run
if __name__ == "__main__":
    run()
```

```txt
# requirements.txt — used for hash check (mirror of pyproject deps)
mcp>=1.0.0
tushare>=1.4.0
akshare>=1.13.0
yfinance>=0.2.40
pandas>=2.0.0
pdfplumber>=0.11.0
requests>=2.31.0
```

**Step 4: Bootstrap venv + run tests**

```bash
cd resources/mcp/research
uv venv --python 3.11
uv pip install -e . pytest
uv run pytest tests/test_env.py -v
```

Expected: 2 passed.

**Step 5: Commit**

```bash
git add resources/mcp/research/
git commit -m "feat(research-mcp): add Python MCP skeleton with check_env tool"
```

---

### Task 3: Wire `research-mcp` into electron-builder asarUnpack + extraResources

**Files:**
- Modify: `electron-builder.config.js`

**Step 1: Add to `asarUnpack` and `extraResources`**

Locate the `asarUnpack` array (around line 103) and append:

```js
// Python MCP servers (must be unpacked so Python can import .py files at runtime)
'resources/mcp/**',
```

Locate top-level `extraResources` (around line 124) — leave as-is. The `resources/mcp/research/` path is already under `resources/` and will be packaged as `resources/mcp/research/` in the final app via the `asarUnpack` rule above.

Also add to top-level `files` exclusion list to skip Python venv/cache that may exist locally:

```js
'!resources/mcp/research/.venv/**',
'!resources/mcp/research/**/__pycache__/**',
'!resources/mcp/research/**/*.pyc',
```

**Step 2: Smoke build (dev only, no installer)**

Run: `npm run build:main`
Expected: success.

**Step 3: Commit**

```bash
git add electron-builder.config.js
git commit -m "build: include resources/mcp in asarUnpack, exclude venv/__pycache__"
```

---

### Task 4: Auto-seed `research-mcp` server config for investment-studio brand

**Files:**
- Create: `src/main/lib/mcpRuntime/seedResearchMcp.ts`
- Modify: `src/main/main.ts` (call seeder during app startup, after profile loaded)
- Test: `src/main/lib/mcpRuntime/seedResearchMcp.test.ts`

**Step 1: Write failing test**

```ts
import { buildResearchMcpConfig } from './seedResearchMcp';

describe('buildResearchMcpConfig', () => {
  it('produces stdio config with placeholder env values', () => {
    const cfg = buildResearchMcpConfig('/path/to/uv');
    expect(cfg.command).toBe('/path/to/uv');
    expect(cfg.args).toEqual(expect.arrayContaining([
      '--directory', '@KOSMOS_RESEARCH_RESOURCES_DIR',
      'run', '-m', 'research_mcp',
    ]));
    expect(cfg.env.TUSHARE_TOKEN).toBe('@KOSMOS_RESEARCH_TUSHARE_TOKEN');
    expect(cfg.env.RESEARCH_MCP_RUNTIME_DIR).toBe('@KOSMOS_RESEARCH_RUNTIME_DIR');
  });
});
```

**Step 2: Run, expect FAIL**

Run: `npx jest src/main/lib/mcpRuntime/seedResearchMcp.test.ts`

**Step 3: Implement**

```ts
// seedResearchMcp.ts
import { KosmosPlaceholder } from '../userDataADO/kosmosPlaceholders';

export const RESEARCH_MCP_SERVER_NAME = 'research-mcp';

export function buildResearchMcpConfig(uvPath: string) {
  return {
    command: uvPath,
    args: [
      '--directory', KosmosPlaceholder.RESEARCH_RESOURCES_DIR,
      'run', '-m', 'research_mcp',
    ],
    env: {
      TUSHARE_TOKEN:           KosmosPlaceholder.RESEARCH_TUSHARE_TOKEN,
      RESEARCH_MCP_RUNTIME_DIR: KosmosPlaceholder.RESEARCH_RUNTIME_DIR,
      RESEARCH_MCP_USER_DATA:   KosmosPlaceholder.RESEARCH_USER_DATA_DIR,
    },
    transport: 'stdio',
  };
}

/** Add research-mcp to user's MCP server list if missing. Idempotent. */
export async function seedResearchMcpIfMissing(opts: {
  alias: string;
  brandName: string;
  uvPath: string;
}): Promise<void> {
  if (opts.brandName !== 'investment-studio') return;
  const { ProfileCacheManager } = await import('../userDataADO/profileCacheManager');
  const pc = ProfileCacheManager.getInstance();
  const profile = pc.getCachedProfile(opts.alias);
  const exists = profile?.mcpServers?.some(s => s.name === RESEARCH_MCP_SERVER_NAME);
  if (exists) return;
  await pc.addMcpServerConfig(opts.alias, {
    name: RESEARCH_MCP_SERVER_NAME,
    ...buildResearchMcpConfig(opts.uvPath),
  } as any);
}
```

**Step 4: Wire into main.ts**

Search for the post-login bootstrap section (where `currentUserAlias` is first assigned). Add after profile is loaded:

```ts
try {
  const { seedResearchMcpIfMissing, RESEARCH_MCP_SERVER_NAME } =
    await import('./lib/mcpRuntime/seedResearchMcp');
  const { getRuntimeManager } = await import('./lib/runtime/RuntimeManager');
  const rm = await getRuntimeManager();
  const uvPath = rm.getInternalToolPath('uv');
  await seedResearchMcpIfMissing({
    alias: this.currentUserAlias,
    brandName: BRAND_NAME, // existing constant
    uvPath,
  });
} catch (e) {
  logger.warn('[research-mcp] seed failed (non-fatal)', 'main', { error: String(e) });
}
```

**Step 5: Run test, expect PASS**

Run: `npx jest src/main/lib/mcpRuntime/seedResearchMcp.test.ts`

**Step 6: Commit**

```bash
git add src/main/lib/mcpRuntime/seedResearchMcp.ts src/main/lib/mcpRuntime/seedResearchMcp.test.ts src/main/main.ts
git commit -m "feat(research-mcp): auto-seed research-mcp server for investment-studio brand"
```

---

## Milestone M2 — 13 Atomic Tools (with TDD per tool)

**Repeated pattern per tool** — each tool follows the same 5 steps:

> 1. Write a Python unit test that calls the tool with sample input + a temp `out_dir`, asserts the returned `{ok, paths}` shape and that expected output files exist.
> 2. Run pytest → fails.
> 3. Implement the tool in the appropriate module under `src/research_mcp/tools/*.py`. All errors → `fail(...)`, never raise.
> 4. Register the tool in `server.py`'s `list_tools()` + `call_tool()` dispatch (one-line addition each).
> 5. Run pytest → passes. Commit.

**Tool list (one task each):**

| Task | Tool | Module | Required deps |
|---|---|---|---|
| 5 | `tushare_collect` | `tools/data_collect.py` | tushare |
| 6 | `yfinance_collect` | `tools/data_collect.py` | yfinance |
| 7 | `peer_collect` | `tools/data_collect.py` | tushare/akshare |
| 8 | `capital_flow` | `tools/data_collect.py` | akshare (no token) |
| 9 | `pdf_download_extract` | `tools/pdf.py` | pdfplumber, requests |
| 10 | `derived_metrics` | `tools/compute.py` | pandas |
| 11 | `financial_audit_11` | `tools/compute.py` | pandas |
| 12 | `technical_analysis` | `tools/compute.py` | pandas |
| 13 | `data_snapshot` | `tools/compute.py` | — |
| 14 | `assemble_report` | `tools/report.py` | — |
| 15 | `monitor_compare` | `tools/report.py` | — |

**Authoritative references for tool semantics & business logic:** copy/adapt from `Q:\src\Stock-Analysis\scripts\` (`tushare_collector`, `pdf_reader`, `derived_metrics`, `financial_audit`, `peer_collector`, `capital_flow`, `technical_analysis`, `data_snapshot`, `assemble_report`, `monitor`).

### Conventions for all 11 tool tasks (5–15)

**Skeleton test (adapt per tool):**

```python
def test_<toolname>_writes_expected_output(tmp_path):
    out = tools.<toolname>(<inputs>, str(tmp_path))
    assert out["ok"] is True
    assert (tmp_path / "<expected_file>").exists()
    assert "summary" in out
```

**Skeleton implementation:**

```python
def <toolname>(<typed inputs>, out_dir: str) -> dict:
    try:
        os.makedirs(out_dir, exist_ok=True)
        # …work…
        # idempotency: if expected output exists with mtime today → return ok early
        return ok(paths=[...], summary="...")
    except Exception as e:
        return fail(str(e), retryable=_is_retryable(e))
```

**Server registration template:**

```python
# in server.py
TOOLS = {
    "check_env":           (env.check_env,        {}),
    "tushare_collect":     (data_collect.tushare_collect, {...schema...}),
    # ... add one line per task
}
```

**Idempotency rule:** every data/compute tool checks `mtime` of its primary output file; if file exists AND mtime is today (local TZ) AND non-empty → return `ok(paths=[...], summary="cached")`.

**Commit message:** `feat(research-mcp): implement <toolname> tool`

---

## Milestone M3 — Install Manager + UX

### Task 16: `ResearchMcpInstallManager` (singleton)

**Files:**
- Create: `src/main/lib/researchMcp/researchMcpInstallManager.ts`
- Create: `src/main/lib/researchMcp/index.ts`
- Test: `src/main/lib/researchMcp/researchMcpInstallManager.test.ts`

**Reference pattern:** `src/main/lib/nativeModules/nativeModuleManager.ts` (singleton, install lock, progress events, install meta JSON).

**Step 1: Write failing test for `isInstalled` / `getInstallMeta`**

```ts
import { ResearchMcpInstallManager } from './researchMcpInstallManager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ResearchMcpInstallManager', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rmim-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('reports not installed for empty runtime dir', () => {
    const m = new ResearchMcpInstallManager(tmp, '/dev/null/uv');
    expect(m.isInstalled()).toBe(false);
  });

  it('reports installed when meta + venv exist', () => {
    fs.mkdirSync(path.join(tmp, '.venv'));
    fs.writeFileSync(
      path.join(tmp, '.install-meta.json'),
      JSON.stringify({ deps_hash: 'abc', python_version: '3.11.0', version: '0.1.0' }),
    );
    const m = new ResearchMcpInstallManager(tmp, '/dev/null/uv');
    expect(m.isInstalled()).toBe(true);
  });
});
```

**Step 2: Run, expect FAIL**

**Step 3: Implement**

```ts
// researchMcpInstallManager.ts
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

export interface InstallMeta {
  deps_hash: string;
  python_version: string;
  version: string;
}

export type InstallStage = 'detect_uv' | 'create_venv' | 'install_deps' | 'health_check';

export interface InstallProgress {
  stage: InstallStage;
  percent: number;
  message?: string;
}

export class ResearchMcpInstallManager extends EventEmitter {
  private installLock: Promise<void> | null = null;
  private cancelled = false;

  constructor(
    private readonly runtimeDir: string,
    private readonly uvPath: string,
    private readonly resourcesDir?: string,
  ) { super(); }

  isInstalled(): boolean {
    return fs.existsSync(path.join(this.runtimeDir, '.venv'))
        && fs.existsSync(path.join(this.runtimeDir, '.install-meta.json'));
  }

  getInstallMeta(): InstallMeta | null {
    try {
      const raw = fs.readFileSync(path.join(this.runtimeDir, '.install-meta.json'), 'utf8');
      return JSON.parse(raw);
    } catch { return null; }
  }

  computeDepsHash(requirementsPath: string): string {
    const buf = fs.readFileSync(requirementsPath);
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
  }

  cancel() { this.cancelled = true; }

  async install(): Promise<{ ok: boolean; error?: string }> {
    if (this.installLock) { await this.installLock; return { ok: this.isInstalled() }; }
    let resolveLock!: () => void;
    this.installLock = new Promise(r => resolveLock = r);
    try {
      this.cancelled = false;
      // Stage 1
      this.emit('progress', { stage: 'detect_uv', percent: 10 } as InstallProgress);
      if (!fs.existsSync(this.uvPath)) {
        return { ok: false, error: `uv not found at ${this.uvPath}` };
      }
      if (this.cancelled) return this.cleanupCancel();
      // Stage 2: create venv
      this.emit('progress', { stage: 'create_venv', percent: 25 } as InstallProgress);
      fs.mkdirSync(this.runtimeDir, { recursive: true });
      await this.run(this.uvPath, ['venv', path.join(this.runtimeDir, '.venv'), '--python', '3.11']);
      if (this.cancelled) return this.cleanupCancel();
      // Stage 3: install deps
      this.emit('progress', { stage: 'install_deps', percent: 40 } as InstallProgress);
      const reqPath = path.join(this.resourcesDir!, 'requirements.txt');
      await this.run(this.uvPath, ['pip', 'install', '--python',
        path.join(this.runtimeDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'),
        '-r', reqPath]);
      if (this.cancelled) return this.cleanupCancel();
      // Stage 4: write meta
      this.emit('progress', { stage: 'health_check', percent: 95 } as InstallProgress);
      const meta: InstallMeta = {
        deps_hash: this.computeDepsHash(reqPath),
        python_version: '3.11',
        version: '0.1.0',
      };
      fs.writeFileSync(path.join(this.runtimeDir, '.install-meta.json'), JSON.stringify(meta, null, 2));
      this.emit('progress', { stage: 'health_check', percent: 100 } as InstallProgress);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message ?? String(e) };
    } finally {
      resolveLock(); this.installLock = null;
    }
  }

  private cleanupCancel(): { ok: false; error: string } {
    try { fs.rmSync(path.join(this.runtimeDir, '.venv'), { recursive: true, force: true }); } catch {}
    return { ok: false, error: 'cancelled' };
  }

  private run(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      p.stderr.on('data', d => {
        stderr += d.toString();
        this.emit('log', d.toString());
      });
      p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`)));
      p.on('error', reject);
    });
  }
}
```

**Step 4: Run test, expect PASS**

**Step 5: Commit**

```bash
git add src/main/lib/researchMcp/
git commit -m "feat(research-mcp): add ResearchMcpInstallManager (4-stage install + cancel cleanup)"
```

---

### Task 17: IPC handlers for install + status

**Files:**
- Modify: `src/main/main.ts` (add handlers grouped near `researchApi:*`)
- Modify: `src/main/preload.ts` (expose to renderer)

**Step 1: Add handlers**

```ts
ipcMain.handle('researchMcp:isInstalled', async () => {
  const { getResearchMcpInstallManager } = await import('./lib/researchMcp');
  return (await getResearchMcpInstallManager()).isInstalled();
});

ipcMain.handle('researchMcp:install', async (event) => {
  const { getResearchMcpInstallManager } = await import('./lib/researchMcp');
  const m = await getResearchMcpInstallManager();
  const onProgress = (p: any) => event.sender.send('researchMcp:progress', p);
  m.on('progress', onProgress);
  try {
    return await m.install();
  } finally {
    m.off('progress', onProgress);
  }
});

ipcMain.handle('researchMcp:cancel', async () => {
  const { getResearchMcpInstallManager } = await import('./lib/researchMcp');
  (await getResearchMcpInstallManager()).cancel();
  return { ok: true };
});
```

Add `getResearchMcpInstallManager` lazy-getter to `src/main/lib/researchMcp/index.ts` mirroring other singletons.

**Step 2: Expose in preload**

```ts
researchMcp: {
  isInstalled: () => ipcRenderer.invoke('researchMcp:isInstalled'),
  install: () => ipcRenderer.invoke('researchMcp:install'),
  cancel: () => ipcRenderer.invoke('researchMcp:cancel'),
  onProgress: (cb: (p: any) => void) => {
    const listener = (_e: any, p: any) => cb(p);
    ipcRenderer.on('researchMcp:progress', listener);
    return () => ipcRenderer.removeListener('researchMcp:progress', listener);
  },
},
```

**Step 3: Smoke test**

Run: `npm run build:main` → expect success.

**Step 4: Commit**

```bash
git add src/main/main.ts src/main/preload.ts src/main/lib/researchMcp/index.ts
git commit -m "feat(research-mcp): IPC handlers for install/cancel/progress"
```

---

### Task 18: Install modal UI component

**Files:**
- Create: `src/renderer/components/researchMcp/ResearchMcpInstallDialog.tsx`
- Create: `src/renderer/components/researchMcp/useResearchMcpInstall.ts`

**Step 1:** Use Radix Dialog (mirror `src/renderer/components/autoUpdate/UpdateDialog.tsx`). Show:
- Title: "安装投研引擎 (research-mcp)"
- Stage label + progress bar
- Cancel button (calls `window.electronAPI.researchMcp.cancel()`)
- Error state: stderr last 20 lines + Retry/Copy log/Close buttons
- Backdrop blocks click-through; close X disabled while installing

**Step 2:** No automated test for v1 (UI). Manual smoke: run app dev, simulate `isInstalled === false`, trigger install, verify each stage advances.

**Step 3: Commit**

```bash
git add src/renderer/components/researchMcp/
git commit -m "feat(research-mcp): install dialog UI with 4-stage progress + cancel"
```

---

### Task 19: Wire skill entry point (entry A) — health check + install prompt

**Files:**
- Modify: `src/renderer/components/pages/AgentPage.tsx` (or wherever slash commands route)

**Step 1:** Before dispatching `/stock-analyze`:

```ts
const ok = await window.electronAPI.researchMcp.isInstalled();
if (!ok) {
  setShowResearchInstallDialog(true);
  return; // skill resumes after dialog success
}
```

**Step 2:** Manual smoke test.

**Step 3: Commit**

```bash
git add src/renderer/components/pages/AgentPage.tsx
git commit -m "feat(research-mcp): trigger install dialog when skill invoked without ready runtime"
```

---

### Task 20: Settings entry point (entry B) — manual install/reset button

**Files:**
- Create: `src/renderer/components/settings/ResearchEngineSettings.tsx`
- Modify: `src/renderer/components/pages/SettingsPage.tsx` (add nav entry "投研引擎")

**Step 1:** Panel shows install state (Installed ✓ / Not installed) + buttons:
- "安装" (when not installed) → opens same dialog
- "重新安装" / "重置" (when installed) → confirm dialog → delete `.venv` + `.install-meta.json` → trigger install
- "查看日志" → opens `{userData}/logs/research-mcp/`

**Step 2:** Commit

```bash
git add src/renderer/components/settings/ResearchEngineSettings.tsx src/renderer/components/pages/SettingsPage.tsx
git commit -m "feat(research-mcp): Settings → 投研引擎 panel (install/reset/logs)"
```

---

## Milestone M4 — Skill + Prompts

### Task 21: Author `skills/stock-analyze/SKILL.md`

**Files:**
- Create: `skills/stock-analyze/SKILL.md`

**Step 1:** Write SKILL.md per design §6.1. YAML front-matter:

```yaml
---
name: stock-analyze
description: 个股深度研报，6 phase pipeline + 3-reviewer 自审 loop（最多 3 轮）
trigger: /stock-analyze
version: 1.0.0
---
```

Body sections:
1. Argument parsing (extract company, resolve `ts_code` via `tushare_collect`)
2. Phase 0 — `check_env`
3. Phase 1 — Data collection (5 tools, sequential)
4. Phase 2 — Compute (3 tools)
5. Phase 3 — Snapshot
6. Phase 4 — Part writing (load `prompts/partN-*.md` + snapshot.json)
7. Phase 5 — Reviewer loop (max 3×3, see Task 22)
8. Phase 6 — Monitor compare (only if prior date dir exists)
9. Phase 7 — Deliver (write to `{targetDir}/research/stock-analyze/{date}/report.md` + copy to `{targetDir}/{company}-{date}.md`)

Each phase lists exact tool names + input shapes + on-error behavior.

**Step 2: Commit**

```bash
git add skills/stock-analyze/SKILL.md
git commit -m "feat(skill): add stock-analyze SKILL.md (6-phase + reviewer loop)"
```

---

### Tasks 22–29: Author 8 prompt files

One commit per file. Each is plain markdown that the main LLM loads at runtime.

| Task | File | Purpose |
|---|---|---|
| 22 | `skills/stock-analyze/prompts/part1-profile.md` | 公司基本面、行业、商业模式 |
| 23 | `skills/stock-analyze/prompts/part2-financial.md` | 财务质量（基于 derived_metrics + audit_11） |
| 24 | `skills/stock-analyze/prompts/part3-valuation.md` | 估值（DCF/PE/PB 区间 + 同行对比） |
| 25 | `skills/stock-analyze/prompts/part4-technical.md` | 技术面（KDJ/MACD/MA/筹码） + 资金流 |
| 26 | `skills/stock-analyze/prompts/part5-conclusion.md` | 投资逻辑、风险、目标价 |
| 27 | `skills/stock-analyze/prompts/reviewer-completeness.md` | 检查 5 个 part 是否覆盖必备维度 |
| 28 | `skills/stock-analyze/prompts/reviewer-accuracy.md` | 数据是否全部源自 snapshot.json 白名单 |
| 29 | `skills/stock-analyze/prompts/reviewer-consistency.md` | 跨 part 数字/结论一致性 |

**Each prompt MUST include:**
- A "你的角色" section
- A "输入" section (snapshot.json 路径 + 已有 part 路径)
- A "输出契约" section — for reviewers, YAML front-matter `verdict: PASS|FAIL`; for parts, plain markdown ≤ 1500 字
- A "禁止行为" list (e.g., 禁止编造数字、禁止引用 snapshot 之外的事实)

**Each task 5 steps:**
1. Read source counterpart in `Q:\src\Stock-Analysis\scripts\` for reference logic
2. Draft prompt
3. Self-review against design §6
4. Save
5. `git commit -m "feat(skill): add stock-analyze prompts/<filename>"`

---

### Task 30: Register `/stock-analyze` in investment-studio system prompt

**Files:**
- Modify: `brands/investment-studio/config.json` or wherever the brand system prompt is concatenated (search for global system prompt pattern in `src/main/lib/chat/globalSystemPrompt.ts`)

**Step 1:** Locate the brand-level system prompt augmentation. Append:

```markdown
## 可用 skill (slash 命令)
- `/stock-analyze <公司名|股票代码>` — 个股深度研报（深度版，约 1-3 分钟，会调用 research-mcp）
- `/deep-report <公司名>` — 个股快速尽调（轻量版，秒级）
```

**Step 2: Commit**

```bash
git add brands/investment-studio/ src/main/lib/chat/globalSystemPrompt.ts
git commit -m "feat(skill): register /stock-analyze and /deep-report slash commands"
```

---

### Task 31: End-to-end smoke run "招商银行"

**Manual verification — no test code, but document outcome in commit message.**

**Steps:**

1. `npm run build && npm run electron`
2. Set Tushare token in Settings → 投研 API
3. Pick or create a workspace folder bound to a chat
4. Type `/stock-analyze 招商银行`
5. Expect: install dialog appears (first time), 4 stages complete
6. Skill runs through Phase 0–7
7. Verify final outputs:
   - `{targetDir}/research/stock-analyze/2026-MM-DD/report.md` exists, ≥ 5 sections, ≥ 3000 字
   - `{targetDir}/招商银行-2026-MM-DD.md` is a copy of above
   - `{targetDir}/research/stock-analyze/2026-MM-DD/_run.log` lists all tool calls in order
   - File tree in left panel shows the new files without manual refresh

**Step 6:** Tag the run

```bash
git tag stock-analyze-smoke-pass-$(date +%Y%m%d)
```

---

## Milestone M5 — Polish & Hot-Reload

### Task 32: Token change → restart MCP server

**Files:**
- Modify: `src/main/main.ts` `researchApi:setToken` handler

**Step 1: Add restart call**

After `pcManager.updateResearchApiTokens(...)` call, before returning:

```ts
if (ok && provider === 'tushare') {
  try {
    const { getMCPClientManager } = await import('./lib/mcpRuntime/mcpClientManager');
    const mgr = await getMCPClientManager();
    await mgr.reconnectServer('research-mcp');
    event.sender.send('toast', { kind: 'info', message: 'Research MCP 已重启以应用新 token' });
  } catch (e) {
    logger.warn('[research-mcp] restart on token change failed', 'main', { error: String(e) });
  }
}
```

**Step 2:** Manual smoke — change token in Settings, observe MCP reconnect log.

**Step 3: Commit**

```bash
git add src/main/main.ts
git commit -m "feat(research-mcp): auto-restart MCP server on tushare token change"
```

---

### Task 33: Background silent upgrade on app start

**Files:**
- Modify: `src/main/main.ts` (add to startup sequence, after seeder)

**Step 1: Add upgrade check**

```ts
// After seedResearchMcpIfMissing
setImmediate(async () => {
  try {
    const { getResearchMcpInstallManager } = await import('./lib/researchMcp');
    const m = await getResearchMcpInstallManager();
    if (!m.isInstalled()) return;
    const meta = m.getInstallMeta();
    const reqPath = path.join(/* RESEARCH_RESOURCES_DIR */, 'requirements.txt');
    if (!fs.existsSync(reqPath)) return;
    const currentHash = m.computeDepsHash(reqPath);
    if (meta?.deps_hash !== currentHash) {
      logger.info('[research-mcp] deps drift detected, silent upgrading', 'main');
      await m.install(); // overwrites meta on success; on failure leaves old install intact
    }
  } catch (e) {
    logger.warn('[research-mcp] silent upgrade failed', 'main', { error: String(e) });
  }
});
```

**Step 2:** Manual smoke — bump a version in `requirements.txt`, restart app, observe background install in logs.

**Step 3: Commit**

```bash
git add src/main/main.ts
git commit -m "feat(research-mcp): background silent upgrade when requirements.txt hash changes"
```

---

### Task 34: macOS smoke run

Repeat Task 31 on macOS (x64 or arm64). Document any platform-specific issues. Fix any encountered (likely candidates: `path.join` separators, `python3.11` discovery, Tushare network from CN-restricted endpoints).

Commit any fixes with `fix(research-mcp): macOS …`.

---

### Task 35: Final design-doc cross-check

**Step 1:** Re-read `docs/plans/2026-05-15-stock-analyze-integration-design.md` Section 13 ("Decisions Locked"). For each row, confirm shipped behavior matches.

**Step 2:** Update design doc only if a decision was overridden during implementation. Append a "Deviations" section.

**Step 3:**

```bash
git add docs/plans/2026-05-15-stock-analyze-integration-design.md
git commit -m "docs(research-mcp): record any deviations from locked design"
```

---

## Test Inventory

| Layer | Files |
|---|---|
| TS unit | `kosmosPlaceholders.test.ts`, `seedResearchMcp.test.ts`, `researchMcpInstallManager.test.ts` |
| Python unit | `tests/test_env.py` + 11 per-tool tests under `resources/mcp/research/tests/` |
| Manual smoke | Task 31 (Win), Task 34 (macOS) |

Run all TS tests: `npm test`
Run all Python tests: `cd resources/mcp/research && uv run pytest -v`

---

## Hard References

- Design doc: `docs/plans/2026-05-15-stock-analyze-integration-design.md`
- Source skill: `Q:\src\Stock-Analysis\scripts\` (read-only reference for tool semantics)
- Existing pattern (install manager): `src/main/lib/nativeModules/nativeModuleManager.ts`
- Existing pattern (singleton + lazy-getter): any `*/index.ts` in `src/main/lib/`
- Brand config: `brands/investment-studio/config.json`
- Existing skill placeholder dirs (untouched): `skills/{deep-report,earnings-forecast,earnings-review,industry-comparison,marginal-tracking,stock-screening}/`
