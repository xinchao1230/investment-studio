/**
 * Investment Studio — brand-specific main-process glue.
 *
 * This file isolates everything that is specific to the `investment-studio`
 * brand (Stella, research-mcp, research API tokens, target↔chat binding,
 * builtin skills auto-seeding) so `main.ts` stays focused on the generic
 * Electron lifecycle and shared IPC surface.
 *
 * Shape:
 *   - `registerInvestmentStudioIpc(deps)`: registers all `research*` and
 *     `builtinSkills:seed` IPC handlers. Safe to call for any brand —
 *     handlers are no-ops where they need access to brand-specific data.
 *   - `runPostLoginSeeders(userLogin, source, deps)`: invoked from every
 *     successful auth path (auth:setCurrentSession, device-flow callback)
 *     to seed the research-mcp config + builtin skills, then kick off the
 *     background venv install. Idempotent and non-fatal.
 *
 * The `deps` object lets us reach into `main.ts` state (current user alias,
 * profile cache manager) without coupling the module to the `ElectronApp`
 * class shape.
 */

import { app, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface InvestmentStudioDeps {
  /** Returns the currently signed-in user alias, or null. */
  getCurrentUserAlias: () => string | null;
  /** Lazily resolves the profile cache manager singleton. */
  getProfileCacheManager: () => Promise<any>;
}

const BRAND_INVESTMENT_STUDIO = 'investment-studio';

// ---------------------------------------------------------------------------
// Post-login seeders (research-mcp config + builtin skills + auto venv install)
// ---------------------------------------------------------------------------

function seedLog(msg: string): void {
  console.log(`[investment-studio] ${msg}`);
}

/**
 * Run brand-aware post-login seeders.
 * Called from every successful auth path so we cover both auto-login and
 * fresh-login flows. Idempotent and non-fatal.
 */
export async function runPostLoginSeeders(
  userLogin: string,
  source: string,
): Promise<void> {
  const brand = process.env.BRAND_NAME || 'openkosmos';
  seedLog(`=== runPostLoginSeeders source=${source} user=${userLogin} brand=${brand} ===`);

  // 1) Seed `research-mcp` server config (brand-gated inside the helper).
  try {
    const { seedResearchMcpIfMissing } = await import('../lib/mcpRuntime/seedResearchMcp');
    const { runtimeManager } = await import('../lib/runtime/RuntimeManager');
    let uvPath = '';
    try {
      uvPath = runtimeManager.getBinaryPath('uv');
      seedLog(`[research-mcp] uvPath=${uvPath}`);
    } catch (uvErr) {
      seedLog(`[research-mcp] getBinaryPath('uv') threw: ${uvErr instanceof Error ? uvErr.message : String(uvErr)}`);
    }
    const r = await seedResearchMcpIfMissing({ alias: userLogin, brandName: brand, uvPath });
    seedLog(`[research-mcp] result: seeded=${r.seeded} reason=${r.reason ?? 'ok'}`);
  } catch (e) {
    seedLog(`[research-mcp] EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2) Seed builtin skills for the active brand.
  try {
    const { seedBuiltinSkills } = await import('../lib/skill/builtinSkillSeeder');
    const r = await seedBuiltinSkills(userLogin, brand);
    seedLog(`[builtin-skills] installed=[${r.installed.join(',')}] skipped=[${r.skipped.join(',')}] failed=[${r.failed.map(f => `${f.name}:${f.error}`).join('|')}]`);
  } catch (e) {
    seedLog(`[builtin-skills] EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2.5) Ensure portfolio/_shared/ subdirs exist (cross-target shared resources).
  if (brand === BRAND_INVESTMENT_STUDIO) {
    try {
      const sharedRoot = path.join(app.getPath('userData'), 'portfolio', '_shared');
      for (const sub of ['methodology', 'macro', 'templates']) {
        fs.mkdirSync(path.join(sharedRoot, sub), { recursive: true });
      }
      seedLog('[portfolio/_shared] ensured');
    } catch (e) {
      seedLog(`[portfolio/_shared] EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 3) Auto-install the research-mcp Python venv in the background.
  // Only for investment-studio brand; user never has to click "Install".
  if (brand === BRAND_INVESTMENT_STUDIO) {
    setImmediate(() => { void autoInstallResearchMcpVenv(); });
  }
}

async function autoInstallResearchMcpVenv(): Promise<void> {
  try {
    const { getResearchMcpInstallManager } = await import('../lib/researchMcp');
    const m = getResearchMcpInstallManager();
    if (m.isInstalled()) {
      seedLog('[research-mcp] venv already installed, skipping auto-install');
      return;
    }

    // Disconnect the stuck initial connection (spawned with broken/missing
    // venv) before reinstalling, otherwise the post-install reconnect can't
    // acquire the per-server lock.
    try {
      const { mcpClientManager } = await import('../lib/mcpRuntime/mcpClientManager');
      await mcpClientManager.disconnect('research-mcp');
      seedLog('[research-mcp] pre-install disconnect ok');
    } catch (e) {
      seedLog(`[research-mcp] pre-install disconnect failed (ignored): ${e instanceof Error ? e.message : String(e)}`);
    }

    seedLog('[research-mcp] starting background auto-install');
    const r = await m.install();
    seedLog(`[research-mcp] auto-install result: ok=${r.ok}${r.error ? ' error=' + r.error : ''}`);
    if (!r.ok) return;

    // Retry reconnect a few times in case the lock is briefly held.
    const { mcpClientManager } = await import('../lib/mcpRuntime/mcpClientManager');
    for (let i = 0; i < 10; i++) {
      try {
        await mcpClientManager.reconnect('research-mcp');
        seedLog(`[research-mcp] post-install reconnect ok (attempt ${i + 1})`);
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('currently connecting') && i < 9) {
          await new Promise(res => setTimeout(res, 2000));
          continue;
        }
        seedLog(`[research-mcp] post-install reconnect failed (attempt ${i + 1}): ${msg}`);
        return;
      }
    }
  } catch (e) {
    seedLog(`[research-mcp] auto-install EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// IPC handlers — researchApi, researchMcp, builtinSkills, researchChat
// ---------------------------------------------------------------------------

export function registerInvestmentStudioIpc(deps: InvestmentStudioDeps): void {
  registerResearchApiIpc(deps);
  registerBuiltinSkillsIpc(deps);
  registerResearchChatIpc(deps);
}

// ---------------- researchApi:* ----------------

function registerResearchApiIpc(deps: InvestmentStudioDeps): void {
  ipcMain.handle('researchApi:getToken', async (_event, provider: string) => {
    try {
      if (provider !== 'tushare' && provider !== 'eastmoney') return undefined;
      const alias = deps.getCurrentUserAlias();
      if (!alias) return undefined;
      const pcManager = await deps.getProfileCacheManager();
      const profile = pcManager.getCachedProfile(alias);
      return profile?.researchApiTokens?.[provider as 'tushare' | 'eastmoney'];
    } catch {
      return undefined;
    }
  });

  ipcMain.handle('researchApi:setToken', async (_event, provider: string, token: string | null) => {
    try {
      if (provider !== 'tushare' && provider !== 'eastmoney') {
        return { ok: false, error: 'unknown provider' };
      }
      const alias = deps.getCurrentUserAlias();
      if (!alias) return { ok: false, error: 'no current user' };
      const value = token ?? '';
      const pcManager = await deps.getProfileCacheManager();
      const ok = await pcManager.updateResearchApiTokens(
        alias,
        { [provider]: value } as { tushare?: string; eastmoney?: string },
      );
      // 🔄 Restart research-mcp server so the new token is picked up via
      // @KOSMOS_RESEARCH_TUSHARE_TOKEN placeholder substitution.
      if (ok && provider === 'tushare') {
        try {
          const { mcpClientManager } = await import('../lib/mcpRuntime/mcpClientManager');
          await mcpClientManager.reconnect('research-mcp');
        } catch (e: any) {
          console.warn('[research-mcp] restart on tushare token change failed:', e?.message ?? String(e));
        }
      }
      return { ok };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle('researchApi:testConnection', async (_event, provider: string) => {
    try {
      if (provider !== 'tushare' && provider !== 'eastmoney') {
        return { ok: false, error: 'unknown provider' };
      }
      const alias = deps.getCurrentUserAlias();
      if (!alias) return { ok: false, error: 'no current user' };
      const pcManager = await deps.getProfileCacheManager();
      const profile = pcManager.getCachedProfile(alias);
      const token = profile?.researchApiTokens?.[provider as 'tushare' | 'eastmoney'];
      if (!token) return { ok: false, error: 'token not configured' };
      const { testTushareToken, testEastmoneyToken } = await import('../lib/researchApi/testConnection');
      return provider === 'tushare'
        ? await testTushareToken(token)
        : await testEastmoneyToken(token);
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
}

// ---------------- builtinSkills:seed ----------------

function registerBuiltinSkillsIpc(deps: InvestmentStudioDeps): void {
  // Idempotently install all builtin skills for the current brand into the
  // active user profile. Used by FRE Step 3.6 and login-time bootstrap.
  ipcMain.handle('builtinSkills:seed', async () => {
    try {
      const alias = deps.getCurrentUserAlias();
      if (!alias) return { ok: false, error: 'No current user alias set' };
      const { seedBuiltinSkills } = await import('../lib/skill/builtinSkillSeeder');
      const brandName = process.env.BRAND_NAME || 'openkosmos';
      const result = await seedBuiltinSkills(alias, brandName);
      return { ok: true, result };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
}

// ---------------- researchChat:* (target ↔ chat binding) ----------------

function registerResearchChatIpc(deps: InvestmentStudioDeps): void {
  // Resolve the chat_id used by the Research workspace (= primary agent's chat).
  // Returns null if no current user, no profile, or no chats exist.
  const resolveResearchChatId = async (): Promise<string | null> => {
    const alias = deps.getCurrentUserAlias();
    if (!alias) return null;
    const pcManager = await deps.getProfileCacheManager();
    const profile = pcManager.getCachedProfile(alias) as any;
    if (!profile || !Array.isArray(profile.chats) || profile.chats.length === 0) return null;
    const { getDefaultPrimaryAgentName } = await import('../lib/userDataADO/types/profile');
    const primaryAgentName = profile.primaryAgent || getDefaultPrimaryAgentName(process.env.BRAND_NAME);
    const primary = profile.chats.find((c: any) => c?.agent?.name === primaryAgentName);
    return primary?.chat_id || profile.chats[0]?.chat_id || null;
  };

  ipcMain.handle('researchChat:listByTarget', async (_event, targetCode: string | null) => {
    try {
      const alias = deps.getCurrentUserAlias();
      if (!alias) return { success: false, error: 'No current user session' };
      const chatId = await resolveResearchChatId();
      if (!chatId) return { success: true, data: { chatId: null, sessions: [] } };
      const pcManager = await deps.getProfileCacheManager();
      const all = await pcManager.getChatSessionsAsync(alias, chatId);
      const filtered = all.filter((s: any) => {
        const sc = s.targetCode === undefined ? null : s.targetCode;
        return sc === targetCode;
      });
      return { success: true, data: { chatId, sessions: filtered } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('researchChat:create', async (
    _event,
    targetCode: string | null,
    opts?: { title?: string; targetDir?: string },
  ) => {
    try {
      const alias = deps.getCurrentUserAlias();
      if (!alias) return { success: false, error: 'No current user session' };
      const chatId = await resolveResearchChatId();
      if (!chatId) return { success: false, error: 'No chat config found for current user' };

      const { ChatSessionUtils } = await import('../lib/userDataADO/types/profile');
      const sessionId = ChatSessionUtils.generateChatSessionId();
      const nowIso = new Date().toISOString();
      const title = (opts?.title?.trim()) || 'New Chat';

      const sessionMeta = {
        chatSession_id: sessionId,
        last_updated: nowIso,
        title,
        targetCode,
        ...(opts?.targetDir ? { targetDir: opts.targetDir } : {}),
      };
      const sessionFile = {
        chatSession_id: sessionId,
        last_updated: nowIso,
        title,
        chat_history: [],
        context_history: [],
        targetCode,
        ...(opts?.targetDir ? { targetDir: opts.targetDir } : {}),
      };

      const pcManager = await deps.getProfileCacheManager();
      const ok = await pcManager.addChatSession(alias, chatId, sessionMeta as any, sessionFile as any);
      if (!ok) return { success: false, error: 'Failed to add chat session' };
      return { success: true, data: { chatId, chatSessionId: sessionId } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('researchChat:delete', async (_event, chatSessionId: string) => {
    try {
      const alias = deps.getCurrentUserAlias();
      if (!alias) return { success: false, error: 'No current user session' };
      const chatId = await resolveResearchChatId();
      if (!chatId) return { success: false, error: 'No chat config found for current user' };
      const pcManager = await deps.getProfileCacheManager();
      const ok = await pcManager.deleteChatSession(alias, chatId, chatSessionId);
      return ok ? { success: true } : { success: false, error: 'Failed to delete chat session' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('researchChat:rename', async (_event, chatSessionId: string, title: string) => {
    try {
      const alias = deps.getCurrentUserAlias();
      if (!alias) return { success: false, error: 'No current user session' };
      const trimmed = (title || '').trim();
      if (!trimmed) return { success: false, error: 'Title cannot be empty' };
      const chatId = await resolveResearchChatId();
      if (!chatId) return { success: false, error: 'No chat config found for current user' };

      const pcManager = await deps.getProfileCacheManager();
      const file = await pcManager.getChatSessionFile(alias, chatId, chatSessionId);
      if (!file) return { success: false, error: 'Chat session file not found' };
      const nowIso = new Date().toISOString();
      const updatedFile = { ...file, title: trimmed, last_updated: nowIso };
      const ok = await pcManager.updateChatSession(
        alias,
        chatId,
        chatSessionId,
        { title: trimmed, last_updated: nowIso },
        updatedFile as any,
      );
      return ok ? { success: true } : { success: false, error: 'Failed to rename chat session' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('researchChat:setLastActive', async (_event, targetCode: string | null, chatSessionId: string) => {
    try {
      const alias = deps.getCurrentUserAlias();
      if (!alias) return { success: false, error: 'No current user session' };
      const pcManager = await deps.getProfileCacheManager();
      const ok = await pcManager.setLastActiveChatByTarget(alias, targetCode, chatSessionId);
      return ok ? { success: true } : { success: false, error: 'Failed to set last active chat' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('researchChat:getLastActive', async (_event, targetCode: string | null) => {
    try {
      const alias = deps.getCurrentUserAlias();
      if (!alias) return { success: false, error: 'No current user session' };
      const pcManager = await deps.getProfileCacheManager();
      const sessionId = pcManager.getLastActiveChatByTarget(alias, targetCode);
      return { success: true, data: sessionId };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
