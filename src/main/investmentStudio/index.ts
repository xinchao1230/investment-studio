/**
 * Investment Studio — brand-specific main-process glue.
 *
 * Registers all `research*` and `builtinSkills:seed` IPC handlers.
 * Also exports `runPostLoginSeeders()` for post-auth initialization.
 */

import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface InvestmentStudioDeps {
  getCurrentUserAlias: () => string | null;
  getProfileCacheManager: () => Promise<any>;
}

const BRAND_INVESTMENT_STUDIO = 'investment-studio';

function seedLog(msg: string): void {
  console.log(`[investment-studio] ${msg}`);
}

// ---------------------------------------------------------------------------
// Research API token storage (simple file-based in userData)
// ---------------------------------------------------------------------------

function getTokenFilePath(): string {
  return path.join(app.getPath('userData'), 'research-api-tokens.json');
}

function readTokens(): Record<string, string> {
  try {
    const content = fs.readFileSync(getTokenFilePath(), 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function writeTokens(tokens: Record<string, string>): void {
  fs.writeFileSync(getTokenFilePath(), JSON.stringify(tokens, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Post-login seeders
// ---------------------------------------------------------------------------

export async function runPostLoginSeeders(
  userLogin: string,
  source: string,
): Promise<void> {
  const brand = process.env.BRAND_NAME || 'openkosmos';
  seedLog(`=== runPostLoginSeeders source=${source} user=${userLogin} brand=${brand} ===`);

  // 1) Seed research-mcp server config
  try {
    const { seedResearchMcpIfMissing } = await import('../lib/mcpRuntime/seedResearchMcp');
    const { RuntimeManager } = await import('../lib/runtime/RuntimeManager');
    let uvPath = '';
    try {
      uvPath = RuntimeManager.getInstance().getBinaryPath('uv');
      seedLog(`[research-mcp] uvPath=${uvPath}`);
    } catch (uvErr) {
      seedLog(`[research-mcp] getBinaryPath('uv') threw: ${uvErr instanceof Error ? uvErr.message : String(uvErr)}`);
    }
    const r = await seedResearchMcpIfMissing({ alias: userLogin, brandName: brand, uvPath });
    seedLog(`[research-mcp] result: seeded=${r.seeded} reason=${r.reason ?? 'ok'}`);
  } catch (e) {
    seedLog(`[research-mcp] EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2) Seed builtin skills
  try {
    const { seedBuiltinSkills } = await import('../lib/skill/builtinSkillSeeder');
    const r = await seedBuiltinSkills(userLogin, brand);
    seedLog(`[builtin-skills] installed=[${r.installed.join(',')}] skipped=[${r.skipped.join(',')}] failed=[${r.failed.map(f => `${f.name}:${f.error}`).join('|')}]`);
  } catch (e) {
    seedLog(`[builtin-skills] EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 3) Ensure portfolio/_shared/ subdirs exist
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

  // 4) Auto-install research-mcp Python venv in background
  if (brand === BRAND_INVESTMENT_STUDIO) {
    setImmediate(() => { void autoInstallResearchMcpVenv(); });
  }
}

async function autoInstallResearchMcpVenv(): Promise<void> {
  try {
    const { getResearchMcpInstallManager } = await import('../lib/researchMcp');
    const m = getResearchMcpInstallManager();
    if (m.isInstalled()) {
      seedLog('[research-mcp] venv already installed');
      return;
    }

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
        seedLog(`[research-mcp] post-install reconnect failed: ${msg}`);
        return;
      }
    }
  } catch (e) {
    seedLog(`[research-mcp] auto-install EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

export function registerInvestmentStudioIpc(deps: InvestmentStudioDeps): void {
  registerResearchApiIpc(deps);
  registerBuiltinSkillsIpc(deps);
  registerResearchChatIpc(deps);
}

function registerResearchApiIpc(_deps: InvestmentStudioDeps): void {
  ipcMain.handle('researchApi:getToken', async (_event, provider: string) => {
    try {
      if (provider !== 'tushare' && provider !== 'eastmoney') return undefined;
      const tokens = readTokens();
      return tokens[provider] || undefined;
    } catch {
      return undefined;
    }
  });

  ipcMain.handle('researchApi:setToken', async (_event, provider: string, token: string | null) => {
    try {
      if (provider !== 'tushare' && provider !== 'eastmoney') {
        return { ok: false, error: 'unknown provider' };
      }
      const tokens = readTokens();
      if (token) {
        tokens[provider] = token;
      } else {
        delete tokens[provider];
      }
      writeTokens(tokens);

      // Restart research-mcp so new tushare token is picked up
      if (provider === 'tushare') {
        try {
          const { mcpClientManager } = await import('../lib/mcpRuntime/mcpClientManager');
          await mcpClientManager.reconnect('research-mcp');
        } catch (e: any) {
          console.warn('[research-mcp] restart on token change failed:', e?.message ?? String(e));
        }
      }
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle('researchApi:testConnection', async (_event, provider: string) => {
    try {
      if (provider !== 'tushare' && provider !== 'eastmoney') {
        return { ok: false, error: 'unknown provider' };
      }
      const tokens = readTokens();
      const token = tokens[provider];
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

function registerBuiltinSkillsIpc(deps: InvestmentStudioDeps): void {
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

function registerResearchChatIpc(deps: InvestmentStudioDeps): void {
  const resolveResearchChatId = async (): Promise<string | null> => {
    const alias = deps.getCurrentUserAlias();
    if (!alias) return null;
    const pcManager = await deps.getProfileCacheManager();
    const profile = pcManager.getCachedProfile(alias) as any;
    if (!profile || !Array.isArray(profile.chats) || profile.chats.length === 0) return null;
    // Use the first chat (primary agent) as the research chat
    return profile.chats[0]?.chat_id || null;
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

  ipcMain.handle('researchChat:listAll', async () => {
    try {
      const alias = deps.getCurrentUserAlias();
      if (!alias) return { success: false, error: 'No current user session' };
      const chatId = await resolveResearchChatId();
      if (!chatId) return { success: true, data: { chatId: null, sessions: [] } };
      const pcManager = await deps.getProfileCacheManager();
      const all = await pcManager.getChatSessionsAsync(alias, chatId);
      const sorted = [...all].sort((a: any, b: any) =>
        String(a.chatSession_id || '').localeCompare(String(b.chatSession_id || '')),
      );
      return { success: true, data: { chatId, sessions: sorted } };
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
      if (!chatId) return { success: false, error: 'No chat config found' };

      const { chatSessionStore } = await import('../lib/chat/chatSessionStore');
      const { generateChatSessionId } = await import('../lib/userDataADO/pathUtils');
      const sessionId = generateChatSessionId();
      const nowIso = new Date().toISOString();
      const title = (opts?.title?.trim()) || 'New Chat';

      const metadata = {
        chatSession_id: sessionId,
        last_updated: nowIso,
        title,
        targetCode,
        ...(opts?.targetDir ? { targetDir: opts.targetDir } : {}),
      };
      const file = {
        chatSession_id: sessionId,
        last_updated: nowIso,
        title,
        chat_history: [],
        context_history: [],
        targetCode,
        ...(opts?.targetDir ? { targetDir: opts.targetDir } : {}),
      };

      await chatSessionStore.createSession(alias, chatId, metadata as any, file as any);
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
      if (!chatId) return { success: false, error: 'No chat config found' };
      const pcManager = await deps.getProfileCacheManager();
      const ok = await pcManager.deleteChatSession(alias, chatId, chatSessionId);
      return ok ? { success: true } : { success: false, error: 'Failed to delete' };
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
      if (!chatId) return { success: false, error: 'No chat config found' };

      const pcManager = await deps.getProfileCacheManager();
      const file = await pcManager.getChatSessionFile(alias, chatId, chatSessionId);
      if (!file) return { success: false, error: 'Session not found' };

      // Use chatSessionFileOps to update
      const { updateChatSessionFile } = await import('../lib/userDataADO/chatSessionFileOps');
      const ok = await updateChatSessionFile(alias, chatSessionId, { title: trimmed });
      return ok ? { success: true } : { success: false, error: 'Failed to rename' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('researchChat:unbindTarget', async (_event, targetCode: string) => {
    try {
      const alias = deps.getCurrentUserAlias();
      if (!alias) return { success: false, error: 'No current user session' };
      if (!targetCode) return { success: false, error: 'targetCode is required' };
      const chatId = await resolveResearchChatId();
      if (!chatId) return { success: true, data: { unboundCount: 0 } };

      const pcManager = await deps.getProfileCacheManager();
      const all = await pcManager.getChatSessionsAsync(alias, chatId);
      const matching = all.filter((s: any) => s.targetCode === targetCode);

      let unboundCount = 0;
      const { updateChatSessionFile } = await import('../lib/userDataADO/chatSessionFileOps');
      for (const meta of matching) {
        const sessionId = (meta as any).chatSession_id as string;
        try {
          await updateChatSessionFile(alias, sessionId, { targetCode: null, targetDir: null } as any);
          unboundCount += 1;
        } catch {
          // best effort
        }
      }
      return { success: true, data: { unboundCount } };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Last active chat/target persistence (simple file-based)
  const getLastActiveFile = () => path.join(app.getPath('userData'), 'research-last-active.json');
  const readLastActive = (): Record<string, any> => {
    try { return JSON.parse(fs.readFileSync(getLastActiveFile(), 'utf-8')); }
    catch { return {}; }
  };
  const writeLastActive = (data: Record<string, any>) => {
    fs.writeFileSync(getLastActiveFile(), JSON.stringify(data, null, 2), 'utf-8');
  };

  ipcMain.handle('researchChat:setLastActive', async (_event, targetCode: string | null, chatSessionId: string) => {
    try {
      const data = readLastActive();
      const key = `chat:${targetCode ?? '__global__'}`;
      data[key] = chatSessionId;
      writeLastActive(data);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('researchChat:getLastActive', async (_event, targetCode: string | null) => {
    try {
      const data = readLastActive();
      const key = `chat:${targetCode ?? '__global__'}`;
      return { success: true, data: data[key] || null };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('researchTarget:getLastActive', async () => {
    try {
      const data = readLastActive();
      return { success: true, data: data['lastTarget'] || null };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('researchTarget:setLastActive', async (_event, targetCode: string | null) => {
    try {
      const data = readLastActive();
      data['lastTarget'] = targetCode;
      writeLastActive(data);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
