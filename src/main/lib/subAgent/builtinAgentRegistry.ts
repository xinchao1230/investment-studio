/**
 * Built-in Agent Registry
 *
 * Read-only, main-process singleton that exposes the sub-agents shipped with the
 * app under `resources/examples/agents/<name>/AGENT.md`. Built-ins are NOT
 * copied into per-user profile directories; consumers merge this list with the
 * user's own sub-agents at read time.
 *
 * See docs/plans/2026-06-03-builtin-registry-design.md.
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

import { SubAgentFileManager } from './subAgentFileManager';
import { getBuiltinAgentNamesForBrand } from '../../../shared/constants/builtinAgents';
import { createConsoleLogger } from '../unifiedLogger';
import type { SubAgentConfig } from '../userDataADO/types/profile';

const logger = createConsoleLogger();

class BuiltinAgentRegistry {
  private static _instance: BuiltinAgentRegistry | null = null;

  /** Cache keyed by brand → frozen list of built-in agent configs. */
  private byBrand: Map<string, ReadonlyArray<SubAgentConfig>> = new Map();
  /** Reserved name set across ALL brands (used by write guards). */
  private reservedNames: Set<string> | null = null;

  static getInstance(): BuiltinAgentRegistry {
    if (!BuiltinAgentRegistry._instance) {
      BuiltinAgentRegistry._instance = new BuiltinAgentRegistry();
    }
    return BuiltinAgentRegistry._instance;
  }

  static resetForTests(): void {
    BuiltinAgentRegistry._instance = null;
  }

  list(brand?: string): ReadonlyArray<SubAgentConfig> {
    const b = brand ?? this.currentBrand();
    const cached = this.byBrand.get(b);
    if (cached) return cached;
    const loaded = this.loadForBrand(b);
    this.byBrand.set(b, loaded);
    return loaded;
  }

  has(name: string): boolean {
    if (!this.reservedNames) {
      this.reservedNames = this.computeReservedNames();
    }
    return this.reservedNames.has(name);
  }

  get(name: string, brand?: string): SubAgentConfig | undefined {
    return this.list(brand).find(a => a.name === name);
  }

  /**
   * Absolute path to the built-in AGENT.md for `name`, or null if not built-in
   * or the source file cannot be located. Used by the runtime when an agent
   * marked `source: 'BUILTIN'` needs to be loaded from disk.
   */
  resolveAgentFile(name: string): string | null {
    if (!this.has(name)) return null;
    const dir = findBuiltinAgentDir(name);
    return dir ? path.join(dir, 'AGENT.md') : null;
  }

  private currentBrand(): string {
    return process.env.BRAND_NAME || 'openkosmos';
  }

  private loadForBrand(brand: string): ReadonlyArray<SubAgentConfig> {
    const names = getBuiltinAgentNamesForBrand(brand);
    if (names.length === 0) return Object.freeze([]);

    const fileManager = SubAgentFileManager.getInstance();
    const configs: SubAgentConfig[] = [];

    for (const name of names) {
      const dir = findBuiltinAgentDir(name);
      if (!dir) {
        logger.warn(`[BuiltinAgentRegistry] AGENT.md not found for built-in "${name}"`);
        continue;
      }
      try {
        const content = fs.readFileSync(path.join(dir, 'AGENT.md'), 'utf-8');
        const parsed = fileManager.parseAgentMarkdown(content);
        if (!parsed.data) {
          logger.warn(`[BuiltinAgentRegistry] Failed to parse AGENT.md for "${name}": ${parsed.error}`);
          continue;
        }
        const cfg = parsed.data;
        cfg.source = 'BUILTIN';
        configs.push(Object.freeze(cfg) as SubAgentConfig);
      } catch (e) {
        logger.warn(`[BuiltinAgentRegistry] Failed to load built-in "${name}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    logger.info(`[BuiltinAgentRegistry] Loaded ${configs.length}/${names.length} built-in agents for brand="${brand}"`);
    return Object.freeze(configs);
  }

  private computeReservedNames(): Set<string> {
    // Reserve every name that any known brand registers as built-in. This keeps
    // write guards correct even if the runtime brand changes mid-process.
    const set = new Set<string>();
    for (const brand of ['openkosmos', 'investment-studio']) {
      for (const name of getBuiltinAgentNamesForBrand(brand)) {
        set.add(name);
      }
    }
    return set;
  }
}

/**
 * Resolve the on-disk directory of a built-in agent. Same candidate ladder as
 * the (now-deleted) seeder used; required because `app.getAppPath()` differs
 * across webpack dev, electron-vite dev, and the packaged asar build.
 */
function findBuiltinAgentDir(name: string): string | null {
  const candidates: string[] = [];
  const appPath = app.getAppPath();
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;

  candidates.push(path.join(appPath, 'resources', 'examples', 'agents', name));
  candidates.push(path.join(appPath, 'agents', name));
  candidates.push(path.join(appPath, '..', '..', 'resources', 'examples', 'agents', name));
  candidates.push(path.join(appPath, '..', '..', 'agents', name));
  if (resourcesPath) {
    candidates.push(path.join(resourcesPath, 'examples', 'agents', name));
    candidates.push(path.join(resourcesPath, 'agents', name));
  }

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'AGENT.md'))) {
      return dir;
    }
  }
  return null;
}

export const builtinAgentRegistry = BuiltinAgentRegistry.getInstance();
export { BuiltinAgentRegistry };
