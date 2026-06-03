/**
 * Builtin Agent Seeder
 * Seeds builtin agent AGENT.md files into user profile. Idempotent and non-fatal.
 *
 * Mirrors the builtinSkillSeeder pattern:
 * - Reads source from resources/examples/agents/{name}/
 * - Copies to {profileDir}/agents/{name}/AGENT.md if not already present
 * - Skips agents that already exist (never overwrites user modifications)
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

import { SubAgentFileManager } from '../subAgent/subAgentFileManager';
import { getBuiltinAgentNamesForBrand } from '../../../shared/constants/builtinAgents';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { createLogger } from '../unifiedLogger';

const logger = createLogger();

export interface AgentSeedResult {
  installed: string[];
  skipped: string[];
  failed: { name: string; error: string }[];
}

/**
 * Find the source directory for a builtin agent.
 * Searches both packaged and development paths.
 */
function findAgentSourceDir(agentName: string): string | null {
  const candidates: string[] = [];
  const resourcesPath = (process as any).resourcesPath;

  if (app.isPackaged && resourcesPath) {
    candidates.push(path.join(resourcesPath, 'agents', agentName));
    candidates.push(path.join(resourcesPath, 'examples', 'agents', agentName));
  } else {
    const appPath = app.getAppPath();
    candidates.push(path.join(appPath, 'agents', agentName));
    candidates.push(path.join(appPath, 'resources', 'examples', 'agents', agentName));
  }

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'AGENT.md'))) {
      return dir;
    }
  }
  return null;
}

/**
 * Copy a directory recursively (sync).
 */
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

/**
 * Seed builtin agents into the user's profile.
 *
 * For each agent in the brand's builtin list:
 * 1. Check if agents/{name}/AGENT.md already exists in profile → skip
 * 2. Find source in resources/examples/agents/{name}/
 * 3. Copy entire directory to profile
 */
export async function seedBuiltinAgents(
  userAlias: string,
  brandName: string
): Promise<AgentSeedResult> {
  const result: AgentSeedResult = { installed: [], skipped: [], failed: [] };

  const names = getBuiltinAgentNamesForBrand(brandName);
  if (names.length === 0) return result;

  logger.info(`[BuiltinAgentSeeder] Seeding ${names.length} builtin agent(s) for brand=${brandName}, user=${userAlias}`);

  const profileDir = path.join(app.getPath('userData'), 'profiles', userAlias);
  const fileManager = SubAgentFileManager.getInstance();

  for (const agentName of names) {
    try {
      // Check if already exists
      const agentMdPath = fileManager.getAgentFilePath(profileDir, agentName);
      if (fs.existsSync(agentMdPath)) {
        result.skipped.push(agentName);
        continue;
      }

      // Find source directory
      const sourceDir = findAgentSourceDir(agentName);
      if (!sourceDir) {
        result.failed.push({ name: agentName, error: 'source directory not found' });
        continue;
      }

      // Copy entire agent directory to profile
      const destDir = fileManager.getAgentDirectory(profileDir, agentName);
      copyDirSync(sourceDir, destDir);

      // Verify the copy by parsing
      const content = fs.readFileSync(path.join(destDir, 'AGENT.md'), 'utf-8');
      const parsed = fileManager.parseAgentMarkdown(content);
      if (!parsed.data) {
        result.failed.push({ name: agentName, error: `parse failed: ${parsed.error}` });
        // Clean up failed install
        try { fs.rmSync(destDir, { recursive: true, force: true }); } catch { /* best effort */ }
        continue;
      }

      // Register in profile.sub_agents index so renderer sees it immediately
      await profileCacheManager.addSubAgent(userAlias, parsed.data);

      result.installed.push(agentName);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.failed.push({ name: agentName, error: msg });
    }
  }

  // Ensure ALL builtin agents are in main agent's sub_agents list
  // (covers both newly installed and previously skipped agents)
  const allSeeded = [...result.installed, ...result.skipped];
  if (allSeeded.length > 0) {
    try {
      const profile = profileCacheManager.getCachedProfile(userAlias) as any;
      if (profile && Array.isArray(profile.chats)) {
        let changed = false;
        for (const chat of profile.chats) {
          if (chat.agent) {
            const subAgents: string[] = Array.isArray(chat.agent.sub_agents) ? chat.agent.sub_agents : [];
            const missing = allSeeded.filter(a => !subAgents.includes(a));
            if (missing.length > 0) {
              chat.agent.sub_agents = [...subAgents, ...missing];
              changed = true;
            }
          }
        }
        if (changed) {
          await profileCacheManager.forceNotifyProfileDataManager(userAlias);
          logger.info(`[BuiltinAgentSeeder] Ensured ${allSeeded.length} agent(s) in main agent sub_agents list`);
        }
      }
    } catch {
      // best effort
    }
  }

  logger.info(
    `[BuiltinAgentSeeder] Done: installed=${result.installed.length}, skipped=${result.skipped.length}, failed=${result.failed.length}`
  );
  return result;
}
