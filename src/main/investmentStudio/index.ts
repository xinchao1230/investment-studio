/**
 * Investment Studio — brand-specific main-process glue.
 *
 * Registers all `research*` and `builtinSkills:seed` IPC handlers.
 * Also exports `runPostLoginSeeders()` for post-auth initialization.
 */

import { app, ipcMain, BrowserWindow, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { PortfolioTools } from '../lib/mcpRuntime/builtinTools/portfolioTools';
import { ExcelService } from './excelService';
import { agentChatManager } from '../lib/chat/agentChatManager';
import { chatSessionStore } from '../lib/chat/chatSessionStore';
import { mcpClientManager } from '../lib/mcpRuntime/mcpClientManager';
import { seedResearchMcpIfMissing } from '../lib/mcpRuntime/seedResearchMcp';
import { RuntimeManager } from '../lib/runtime/RuntimeManager';
import { createLogger, type UnifiedLogger } from '../lib/unifiedLogger';
import { updateChatSessionFile } from '../lib/userDataADO/chatSessionFileOps';
import { profileCacheManager } from '../lib/userDataADO/profileCacheManager';
import { generateChatSessionId } from '../lib/userDataADO/pathUtils';
import {
  findReusableEmptyResearchChatSession,
  isDefaultEmptyResearchChatSession,
  type ResearchChatSessionMetadata,
} from './researchChatCleanup';
import {
  ensureResearchApiTokenFile,
  getResearchApiStatus,
  getResearchApiToken,
  getVerifiedResearchApiToken,
  isResearchApiProvider,
  recordResearchApiTestResult,
  setResearchApiToken,
} from '../lib/researchApi/tokenStorage';

export interface InvestmentStudioDeps {
  getCurrentUserAlias: () => string | null;
  getProfileCacheManager: () => Promise<any>;
}

const BRAND_INVESTMENT_STUDIO = 'investment-studio';
const startupResearchChatCleanupByAlias = new Set<string>();
let seedLogger: UnifiedLogger | null = null;

function getSeedLogger(): UnifiedLogger {
  if (!seedLogger) {
    seedLogger = createLogger();
  }
  return seedLogger;
}

function seedLog(msg: string): void {
  console.log(`[investment-studio] ${msg}`);
  try {
    getSeedLogger().info(msg, 'investment-studio');
  } catch {
    // Keep post-login seeders non-fatal even if logging is not initialized yet.
  }
}

type ProfileCacheManagerLike = {
  getCachedProfile: (alias: string) => any;
  getChatSessionsAsync: (alias: string, chatId: string) => Promise<ResearchChatSessionMetadata[]>;
  getChatSessionFile: (alias: string, chatId: string, chatSessionId: string) => Promise<any>;
};

function resolveResearchChatIdFromCache(
  pcManager: ProfileCacheManagerLike,
  alias: string,
): string | null {
  const profile = pcManager.getCachedProfile(alias) as any;
  if (!profile || !Array.isArray(profile.chats) || profile.chats.length === 0) return null;
  return profile.chats[0]?.chat_id || null;
}

async function waitForResearchChatIdFromCache(
  pcManager: ProfileCacheManagerLike,
  alias: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const chatId = resolveResearchChatIdFromCache(pcManager, alias);
    if (chatId) return chatId;
    if (pcManager.getCachedProfile(alias)) return null;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function collectDefaultEmptySessionIds(
  pcManager: ProfileCacheManagerLike,
  alias: string,
  chatId: string,
  sessions: ResearchChatSessionMetadata[],
): Promise<Set<string>> {
  const emptyIds = new Set<string>();
  await Promise.all(sessions.map(async (session) => {
    const sessionId = String(session?.chatSession_id || '');
    if (!sessionId) return;
    try {
      const file = await pcManager.getChatSessionFile(alias, chatId, sessionId);
      if (isDefaultEmptyResearchChatSession(session, file)) {
        emptyIds.add(sessionId);
      }
    } catch (error) {
      seedLog(`[research-chat] failed to inspect ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
  return emptyIds;
}

async function cleanupDefaultEmptyResearchChats(
  alias: string,
  pcManager: ProfileCacheManagerLike,
  chatId: string,
  source: string,
): Promise<{ inspectedCount: number; candidateCount: number; deletedCount: number; failedCount: number; skippedActiveCount: number }> {
  await agentChatManager.initialize(alias);
  const activeSessionId = agentChatManager.getCurrentActiveChatSessionId();
  const sessions = await pcManager.getChatSessionsAsync(alias, chatId);
  const candidates: ResearchChatSessionMetadata[] = [];
  let skippedActiveCount = 0;
  let deletedCount = 0;
  let failedCount = 0;

  seedLog(`[research-chat] cleanup start source=${source} alias=${alias} chatId=${chatId} activeSessionId=${activeSessionId ?? 'none'} sessions=${sessions.length}`);

  for (const session of sessions) {
    const sessionId = String(session?.chatSession_id || '');
    if (!sessionId) continue;
    if (sessionId === activeSessionId) {
      skippedActiveCount += 1;
      continue;
    }
    try {
      const file = await pcManager.getChatSessionFile(alias, chatId, sessionId);
      if (!isDefaultEmptyResearchChatSession(session, file)) continue;
      candidates.push(session);
    } catch (error) {
      failedCount += 1;
      seedLog(`[research-chat] cleanup inspect failed source=${source} sessionId=${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (candidates.length === 0) {
    seedLog(`[research-chat] cleanup found no default empty New Chat candidates source=${source}`);
  } else {
    seedLog(`[research-chat] cleanup found default empty New Chat candidates source=${source} count=${candidates.length}`);
  }

  for (const session of candidates) {
    const sessionId = session.chatSession_id;
    const targetCode = session.targetCode ?? 'general';
    const latestActiveSessionId = agentChatManager.getCurrentActiveChatSessionId();
    if (latestActiveSessionId === sessionId) {
      skippedActiveCount += 1;
      seedLog(`[research-chat] cleanup skipped active candidate source=${source} sessionId=${sessionId}`);
      continue;
    }
    try {
      seedLog(`[research-chat] cleanup deleting source=${source} sessionId=${sessionId} targetCode=${targetCode}`);
      const result = await agentChatManager.deleteChatSession(chatId, sessionId);
      if (result.success) {
        deletedCount += 1;
        seedLog(`[research-chat] cleanup deleted source=${source} sessionId=${sessionId}`);
      } else {
        failedCount += 1;
        seedLog(`[research-chat] cleanup delete skipped source=${source} sessionId=${sessionId}: ${result.error ?? 'delete failed'}`);
      }
    } catch (error) {
      failedCount += 1;
      seedLog(`[research-chat] cleanup delete failed source=${source} sessionId=${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  seedLog(`[research-chat] cleanup end source=${source} inspected=${sessions.length} candidates=${candidates.length} deleted=${deletedCount} failed=${failedCount} skippedActive=${skippedActiveCount}`);

  return {
    inspectedCount: sessions.length,
    candidateCount: candidates.length,
    deletedCount,
    failedCount,
    skippedActiveCount,
  };
}

async function runStartupResearchChatCleanup(alias: string): Promise<void> {
  if (startupResearchChatCleanupByAlias.has(alias)) return;
  startupResearchChatCleanupByAlias.add(alias);

  seedLog(`[research-chat] startup cleanup scheduled alias=${alias}`);
  const chatId = await waitForResearchChatIdFromCache(profileCacheManager, alias);
  if (!chatId) {
    seedLog(`[research-chat] startup cleanup skipped alias=${alias}: no research chat config`);
    return;
  }

  await cleanupDefaultEmptyResearchChats(alias, profileCacheManager, chatId, 'startup');
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

  // 3) Built-in sub-agents are served from BuiltinAgentRegistry; no per-user seeding needed.

  // 4) Ensure portfolio/_shared/ subdirs exist
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
    // Initialize PortfolioTools workspace dir so the LLM-callable
    // portfolio_* builtin tools have somewhere to write. Idempotent — also
    // initialized lazily by the `portfolio:getWorkspaceDir` IPC handler.
    try {
      const portfolioDir = path.join(app.getPath('userData'), 'portfolio');
      fs.mkdirSync(portfolioDir, { recursive: true });
      PortfolioTools.setWorkspaceDir(portfolioDir);
      seedLog(`[portfolio] workspaceDir=${portfolioDir}`);
    } catch (e) {
      seedLog(`[portfolio] setWorkspaceDir EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 5) Remove leftover default empty research chats once per app process.
  if (brand === BRAND_INVESTMENT_STUDIO) {
    setImmediate(() => {
      runStartupResearchChatCleanup(userLogin).catch((e) => {
        seedLog(`[research-chat] startup cleanup EXCEPTION: ${e instanceof Error ? e.message : String(e)}`);
      });
    });
  }

  // 6) Auto-install research-mcp Python venv in background
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
      await mcpClientManager.disconnect('research-mcp');
      seedLog('[research-mcp] pre-install disconnect ok');
    } catch (e) {
      seedLog(`[research-mcp] pre-install disconnect failed (ignored): ${e instanceof Error ? e.message : String(e)}`);
    }

    seedLog('[research-mcp] starting background auto-install');
    const r = await m.install();
    seedLog(`[research-mcp] auto-install result: ok=${r.ok}${r.error ? ' error=' + r.error : ''}`);
    if (!r.ok) return;

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
  registerPortfolioIpc(deps);
  registerExcelIpc(deps);
}

function registerExcelIpc(_deps: InvestmentStudioDeps): void {
  // Reads xlsx / csv files into Univer's IWorkbookData schema so the
  // renderer's <UniverSheet> can render them in the middle ContentTabs
  // pane. Used when the user clicks an xlsx generated by the LLM.
  ipcMain.handle('excel:readFile', async (_event, filePath: string) => {
    try {
      if (typeof filePath !== 'string' || filePath.length === 0) {
        return { success: false, error: 'invalid filePath' };
      }
      const lower = filePath.toLowerCase();
      if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
        return { success: true, data: await ExcelService.readCsv(filePath) };
      }
      return { success: true, data: await ExcelService.readXlsx(filePath) };
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) };
    }
  });
}

function registerResearchApiIpc(_deps: InvestmentStudioDeps): void {
  ipcMain.handle('researchApi:getToken', async (_event, provider: string) => {
    try {
      if (!isResearchApiProvider(provider)) return undefined;
      return getResearchApiToken(provider);
    } catch (err: any) {
      console.warn('[researchApi] getToken failed:', err?.message ?? String(err));
      return undefined;
    }
  });

  ipcMain.handle('researchApi:getVerifiedToken', async (_event, provider: string) => {
    try {
      if (!isResearchApiProvider(provider)) return undefined;
      return getVerifiedResearchApiToken(provider);
    } catch (err: any) {
      console.warn('[researchApi] getVerifiedToken failed:', err?.message ?? String(err));
      return undefined;
    }
  });

  ipcMain.handle('researchApi:getStatus', async (_event, provider: string) => {
    try {
      if (!isResearchApiProvider(provider)) {
        return { provider, hasApiKey: false, verified: false, verifiedAt: null, lastTestError: 'unknown provider' };
      }
      return getResearchApiStatus(provider);
    } catch (err: any) {
      return { provider, hasApiKey: false, verified: false, verifiedAt: null, lastTestError: err?.message ?? String(err) };
    }
  });

  ipcMain.handle('researchApi:openTokenFile', async () => {
    try {
      const filePath = ensureResearchApiTokenFile();
      const error = await shell.openPath(filePath);
      if (error) {
        return { ok: false, filePath, error };
      }
      return { ok: true, filePath };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle('researchApi:setToken', async (_event, provider: string, token: string | null) => {
    try {
      if (!isResearchApiProvider(provider)) {
        return { ok: false, error: 'unknown provider' };
      }
      const status = setResearchApiToken(provider, token);

      // Restart research-mcp so new tushare token is picked up
      if (provider === 'tushare') {
        await reconnectResearchMcpAfterTokenChange();
      }
      return { ok: true, status };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle('researchApi:testConnection', async (_event, provider: string) => {
    try {
      if (!isResearchApiProvider(provider)) {
        return { ok: false, error: 'unknown provider' };
      }
      const token = getResearchApiToken(provider);
      if (!token) return { ok: false, error: 'token not configured', status: getResearchApiStatus(provider) };
      const { testTushareToken, testEastmoneyToken, testWebIQToken } =
        await import('../lib/researchApi/testConnection');
      const result = provider === 'tushare'
        ? await testTushareToken(token)
        : provider === 'eastmoney'
          ? await testEastmoneyToken(token)
          : await testWebIQToken(token);
      const status = recordResearchApiTestResult(provider, result);
      if (provider === 'tushare' && result.ok) {
        await reconnectResearchMcpAfterTokenChange();
      }
      return { ...result, status };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
}

async function reconnectResearchMcpAfterTokenChange(): Promise<void> {
  try {
    await mcpClientManager.reconnect('research-mcp');
  } catch (e: any) {
    console.warn('[research-mcp] restart on token change failed:', e?.message ?? String(e));
  }
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

function registerPortfolioIpc(_deps: InvestmentStudioDeps): void {
  // Portfolio workspace dir lookup (used by renderer-side fs-changed
  // path-prefix filtering). Idempotently initializes the workspace dir
  // so callers don't have to invoke a portfolio_* tool first.
  ipcMain.handle('portfolio:getWorkspaceDir', async () => {
    try {
      if (!PortfolioTools.getWorkspaceDir()) {
        const portfolioDir = path.join(app.getPath('userData'), 'portfolio');
        if (!fs.existsSync(portfolioDir)) {
          fs.mkdirSync(portfolioDir, { recursive: true });
        }
        PortfolioTools.setWorkspaceDir(portfolioDir);
      }
      return { success: true, data: PortfolioTools.getWorkspaceDir() };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Move a portfolio workspace file to the OS trash. Refuses anything
  // outside the active workspace dir or named `profile.yaml`. Also
  // broadcasts a synthetic `kosmos:fs-changed` event so renderer caches
  // refresh (the broadcast normally only fires for builtin tool calls,
  // and this op goes through a plain IPC, not a tool).
  ipcMain.handle('portfolio:trashFile', async (_event, absPath: string) => {
    try {
      if (typeof absPath !== 'string' || !absPath) {
        return { success: false, error: 'absPath is required' };
      }
      const workspaceDir = PortfolioTools.getWorkspaceDir();
      if (!workspaceDir) {
        return { success: false, error: 'Workspace not initialized' };
      }
      const resolved = path.resolve(absPath);
      const rel = path.relative(workspaceDir, resolved);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        return { success: false, error: 'Path is outside the workspace' };
      }
      if (path.basename(resolved).toLowerCase() === 'profile.yaml') {
        return { success: false, error: 'profile.yaml is protected and cannot be deleted' };
      }
      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'File does not exist' };
      }
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        return { success: false, error: 'Not a regular file' };
      }
      await shell.trashItem(resolved);
      const payload = {
        tool: 'portfolio:trashFile',
        mutations: [{ path: resolved, kind: 'delete' as const }],
        timestamp: Date.now(),
      };
      for (const win of BrowserWindow.getAllWindows()) {
        try { win.webContents.send('kosmos:fs-changed', payload); }
        catch { /* ignore */ }
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  // Move a portfolio workspace file OR directory to the OS trash. Used
  // by the right-click "delete" action on user-created subfolders in the
  // research sidebar. Refuses anything outside the active workspace,
  // any target root (those go through the dedicated deleteTarget flow),
  // and any path named `profile.yaml`.
  ipcMain.handle('portfolio:trashPath', async (_event, absPath: string) => {
    try {
      if (typeof absPath !== 'string' || !absPath) {
        return { success: false, error: 'absPath is required' };
      }
      const workspaceDir = PortfolioTools.getWorkspaceDir();
      if (!workspaceDir) {
        return { success: false, error: 'Workspace not initialized' };
      }
      const resolved = path.resolve(absPath);
      const rel = path.relative(workspaceDir, resolved);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
        return { success: false, error: 'Path is outside the workspace' };
      }
      // Refuse target roots — the first path segment under workspaceDir.
      // Those have their own deleteTarget flow.
      const firstSep = rel.indexOf(path.sep);
      if (firstSep === -1) {
        return { success: false, error: 'Cannot delete a target root directory; use the delete-target action.' };
      }
      if (path.basename(resolved).toLowerCase() === 'profile.yaml') {
        return { success: false, error: 'profile.yaml is protected and cannot be deleted' };
      }
      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'File or directory does not exist' };
      }
      await shell.trashItem(resolved);
      const payload = {
        tool: 'portfolio:trashPath',
        mutations: [{ path: resolved, kind: 'delete' as const }],
        timestamp: Date.now(),
      };
      for (const win of BrowserWindow.getAllWindows()) {
        try { win.webContents.send('kosmos:fs-changed', payload); }
        catch { /* ignore */ }
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}

function registerResearchChatIpc(deps: InvestmentStudioDeps): void {
  const resolveResearchChatId = async (): Promise<string | null> => {
    const alias = deps.getCurrentUserAlias();
    if (!alias) return null;
    const pcManager = await deps.getProfileCacheManager();
    return resolveResearchChatIdFromCache(pcManager, alias);
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

      const pcManager = await deps.getProfileCacheManager();
      const sessions = await pcManager.getChatSessionsAsync(alias, chatId) as ResearchChatSessionMetadata[];
      const scopedSessions = sessions.filter((session) => {
        const sessionTargetCode = session.targetCode === undefined ? null : session.targetCode;
        return sessionTargetCode === targetCode;
      });
      const emptySessionIds = await collectDefaultEmptySessionIds(pcManager, alias, chatId, scopedSessions);
      const reusable = findReusableEmptyResearchChatSession(scopedSessions, targetCode, emptySessionIds);
      if (reusable) {
        const sessionId = reusable.chatSession_id;
        if (opts?.targetDir && reusable.targetDir !== opts.targetDir) {
          await updateChatSessionFile(alias, sessionId, { targetCode, targetDir: opts.targetDir });
        }
        return { success: true, data: { chatId, chatSessionId: sessionId } };
      }

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

  ipcMain.handle('researchChat:cleanupEmpty', async () => {
    try {
      const alias = deps.getCurrentUserAlias();
      if (!alias) return { success: false, error: 'No current user session' };
      const chatId = await resolveResearchChatId();
      if (!chatId) return { success: true, data: { deletedCount: 0, failedCount: 0 } };

      const pcManager = await deps.getProfileCacheManager();
      const result = await cleanupDefaultEmptyResearchChats(alias, pcManager, chatId, 'ipc');
      return { success: true, data: result };
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
      // Route through agentChatManager so renderer state stays coherent
      // (fallback switch + instance dispose + sessionDeleted event).
      const result = await agentChatManager.deleteChatSession(chatId, chatSessionId);
      return result.success ? { success: true } : { success: false, error: result.error || 'Failed to delete' };
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
