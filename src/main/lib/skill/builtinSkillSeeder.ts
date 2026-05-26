/**
 * Builtin Skill Seeder
 * Seeds builtin skill folders into user profile. Idempotent and non-fatal.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

import { skillManager } from './skillManager';
import { profileCacheManager } from '../userDataADO/profileCacheManager';
import { getBuiltinSkillNamesForBrand } from '../../../shared/constants/builtinSkills';
import { isBuiltinAgent } from '../userDataADO/types/profile';
import { createLogger } from '../unifiedLogger';

const logger = createLogger();

export interface SeedResult {
  installed: string[];
  skipped: string[];
  failed: { name: string; error: string }[];
}

function findSourceDir(skillName: string): string | null {
  const candidates: string[] = [];
  const resourcesPath = (process as any).resourcesPath;

  if (app.isPackaged && resourcesPath) {
    candidates.push(path.join(resourcesPath, 'skills', skillName));
    candidates.push(path.join(resourcesPath, 'examples', 'skills', skillName));
  } else {
    const appPath = app.getAppPath();
    candidates.push(path.join(appPath, 'skills', skillName));
    candidates.push(path.join(appPath, 'resources', 'examples', 'skills', skillName));
  }

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) {
      return dir;
    }
  }
  return null;
}

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

export async function seedBuiltinSkills(
  userAlias: string,
  brandName: string
): Promise<SeedResult> {
  const result: SeedResult = { installed: [], skipped: [], failed: [] };

  const names = getBuiltinSkillNamesForBrand(brandName);
  logger.info(`[BuiltinSkillSeeder] Seeding ${names.length} builtin skill(s) for brand=${brandName}, user=${userAlias}`);

  for (const skillName of names) {
    try {
      const existing = skillManager.checkSkillExists(userAlias, skillName);
      if (existing) {
        result.skipped.push(skillName);
        continue;
      }

      const sourceDir = findSourceDir(skillName);
      if (!sourceDir) {
        result.failed.push({ name: skillName, error: 'source directory not found' });
        continue;
      }

      const { metadata, error: metaError } = skillManager.getSkillMetadata(sourceDir);
      if (!metadata) {
        result.failed.push({ name: skillName, error: metaError || 'failed to parse metadata' });
        continue;
      }

      const tempDir = skillManager.createTempDirectory('builtin-skill-seed');
      const stagedDir = path.join(tempDir, skillName);
      copyDirSync(sourceDir, stagedDir);

      const installResult = await skillManager.installSkill(
        userAlias,
        {
          name: metadata.name,
          description: metadata.description,
          version: metadata.version || '1.0.0',
          source: 'ON-DEVICE'
        },
        stagedDir,
        false
      );

      if (installResult.success) {
        result.installed.push(skillName);
      } else {
        result.failed.push({ name: skillName, error: installResult.error || 'install failed' });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.failed.push({ name: skillName, error: msg });
    }
  }

  // Attach newly installed skills to builtin agents
  if (result.installed.length > 0) {
    try {
      const profile = profileCacheManager.getCachedProfile(userAlias) as any;
      if (profile && Array.isArray(profile.chats)) {
        let changed = false;
        for (const chat of profile.chats) {
          if (chat.agent && isBuiltinAgent(chat.agent.name, brandName)) {
            const agentSkills: string[] = Array.isArray(chat.agent.skills) ? chat.agent.skills : [];
            const missing = result.installed.filter(s => !agentSkills.includes(s));
            if (missing.length > 0) {
              chat.agent.skills = [...agentSkills, ...missing];
              changed = true;
            }
          }
        }
        if (changed) {
          await profileCacheManager.forceNotifyProfileDataManager(userAlias);
        }
      }
    } catch {
      // best effort
    }
  }

  logger.info(
    `[BuiltinSkillSeeder] Done: installed=${result.installed.length}, skipped=${result.skipped.length}, failed=${result.failed.length}`
  );
  return result;
}
