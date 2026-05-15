/**
 * Builtin Skill Seeder
 *
 * Copies builtin skill folders shipped with the app (resources/skills/{name}/ and
 * resources/examples/skills/{name}/) into the user's profile skills directory and
 * registers them via skillManager.installSkill.
 *
 * Idempotent: skips skills already present in the profile (matched by name).
 * Non-fatal: per-skill failures are logged and do not abort the seed run.
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

/**
 * Resolve candidate source directories for a builtin skill, in priority order:
 *   1. <resourcesPath>/skills/<name>          (production, shipped via extraResources)
 *   2. <appPath>/skills/<name>                (dev: repo root)
 *   3. <resourcesPath>/examples/skills/<name> (production, examples)
 *   4. <appPath>/resources/examples/skills/<name> (dev fallback)
 */
function findSourceDir(skillName: string): string | null {
  const candidates: string[] = [];
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;

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

/**
 * Recursively copy a directory.
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
 * Seed builtin skills for the given brand into the user's profile.
 */
export async function seedBuiltinSkills(
  userAlias: string,
  brandName: string
): Promise<SeedResult> {
  const result: SeedResult = { installed: [], skipped: [], failed: [] };

  const names = getBuiltinSkillNamesForBrand(brandName);
  logger.info(`[BuiltinSkillSeeder] Seeding ${names.length} builtin skill(s) for brand=${brandName}, user=${userAlias}`);

  for (const skillName of names) {
    try {
      // Skip if already installed in the user's profile.
      const existing = skillManager.checkSkillExists(userAlias, skillName);
      if (existing) {
        result.skipped.push(skillName);
        continue;
      }

      const sourceDir = findSourceDir(skillName);
      if (!sourceDir) {
        logger.warn(`[BuiltinSkillSeeder] Skill source not found for "${skillName}" — skipping`);
        result.failed.push({ name: skillName, error: 'source directory not found' });
        continue;
      }

      // Read metadata from SKILL.md.
      const { metadata, error: metaError } = skillManager.getSkillMetadata(sourceDir);
      if (!metadata) {
        result.failed.push({ name: skillName, error: metaError || 'failed to parse metadata' });
        continue;
      }

      // installSkill moves (renames) the source dir; copy to a temp location first
      // so the bundled resources stay intact for the next user / next launch.
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
        logger.info(`[BuiltinSkillSeeder] Installed builtin skill: ${skillName}`);
      } else {
        result.failed.push({ name: skillName, error: installResult.error || 'install failed' });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`[BuiltinSkillSeeder] Failed to seed "${skillName}": ${msg}`);
      result.failed.push({ name: skillName, error: msg });
    }
  }

  // After seeding, ensure builtin agents have the freshly installed skills attached
  // in their chat.agent.skills array (not just the global profile.skills list).
  // sanitizeProfile does this on initial load, but addSkill only updates profile.skills.
  if (result.installed.length > 0) {
    try {
      const profile = profileCacheManager.getCachedProfile(userAlias) as any;
      if (profile && Array.isArray(profile.chats)) {
        const installedNames = result.installed;
        let changed = false;
        for (const chat of profile.chats) {
          if (chat.agent && isBuiltinAgent(chat.agent.name, brandName)) {
            const agentSkills: string[] = Array.isArray(chat.agent.skills) ? chat.agent.skills : [];
            const missing = installedNames.filter(s => !agentSkills.includes(s));
            if (missing.length > 0) {
              chat.agent.skills = [...agentSkills, ...missing];
              changed = true;
            }
          }
        }
        if (changed) {
          profile.updatedAt = new Date().toISOString();
          // Persist + notify renderer immediately
          await profileCacheManager.forceNotifyProfileDataManager(userAlias);
        }
      }
    } catch {
      // best effort
    }
  }

  logger.info(
    `[BuiltinSkillSeeder] Done — installed=${result.installed.length}, skipped=${result.skipped.length}, failed=${result.failed.length}`
  );
  return result;
}
