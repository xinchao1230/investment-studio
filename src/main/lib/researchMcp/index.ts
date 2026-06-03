import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { ResearchMcpInstallManager } from './researchMcpInstallManager';

let instance: ResearchMcpInstallManager | null = null;

function resolveDevResearchResourcesDir(): string {
  // In webpack dev app.getAppPath() === <repo-root>; in electron-vite dev it
  // points to <repo-root>/dist-vite/main. Pick the first candidate where the
  // resources tree actually exists so uv --directory is valid in both flows.
  const appPath = app.getAppPath();
  const candidates = [
    path.join(appPath, 'resources', 'mcp', 'research'),
    path.join(appPath, '..', '..', 'resources', 'mcp', 'research'),
    path.join(process.cwd(), 'resources', 'mcp', 'research'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

export function getResearchMcpInstallManager(): ResearchMcpInstallManager {
  if (!instance) {
    const { RuntimeManager } = require('../runtime/RuntimeManager');
    const runtimeDir = path.join(app.getPath('userData'), 'runtimes', 'research-mcp');
    let uvPath = '';
    try {
      uvPath = RuntimeManager.getInstance().getBinaryPath('uv');
    } catch {
      uvPath = 'uv'; // fallback to PATH
    }
    const resourcesDir = app.isPackaged
      ? path.join((process as { resourcesPath?: string }).resourcesPath!, 'mcp', 'research')
      : resolveDevResearchResourcesDir();
    instance = new ResearchMcpInstallManager(runtimeDir, uvPath, resourcesDir);
  }
  return instance;
}

export { ResearchMcpInstallManager } from './researchMcpInstallManager';
export type { InstallMeta, InstallStage, InstallProgress } from './researchMcpInstallManager';
