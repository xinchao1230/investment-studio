import * as path from 'path';
import { app } from 'electron';
import { ResearchMcpInstallManager } from './researchMcpInstallManager';

let instance: ResearchMcpInstallManager | null = null;

export function getResearchMcpInstallManager(): ResearchMcpInstallManager {
  if (!instance) {
    const { runtimeManager } = require('../runtime/RuntimeManager');
    const runtimeDir = path.join(app.getPath('userData'), 'runtimes', 'research-mcp');
    const uvPath = runtimeManager.getBinaryPath('uv');
    const resourcesDir = app.isPackaged
      ? path.join((process as { resourcesPath?: string }).resourcesPath!, 'mcp', 'research')
      : path.join(app.getAppPath(), 'resources', 'mcp', 'research');
    instance = new ResearchMcpInstallManager(runtimeDir, uvPath, resourcesDir);
  }
  return instance;
}

export { ResearchMcpInstallManager } from './researchMcpInstallManager';
export type { InstallMeta, InstallStage, InstallProgress } from './researchMcpInstallManager';
