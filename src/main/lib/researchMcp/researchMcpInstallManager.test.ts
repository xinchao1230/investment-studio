import { ResearchMcpInstallManager } from './researchMcpInstallManager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ResearchMcpInstallManager', () => {
  let tmp: string;
  const resourcesDir = path.join(__dirname, '..', '..', '..', '..', 'resources', 'mcp', 'research');

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rmim-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('reports not installed for empty runtime dir', () => {
    const m = new ResearchMcpInstallManager(tmp, '/dev/null/uv', resourcesDir);
    expect(m.isInstalled()).toBe(false);
  });

  it('reports installed when meta + venv exist', () => {
    fs.mkdirSync(path.join(tmp, '.venv'));
    fs.writeFileSync(
      path.join(tmp, '.install-meta.json'),
      JSON.stringify({ deps_hash: 'abc', python_version: '3.11.0', version: '0.1.0' }),
    );
    const m = new ResearchMcpInstallManager(tmp, '/dev/null/uv', resourcesDir);
    expect(m.isInstalled()).toBe(true);
  });

  it('getInstallMeta returns parsed object when file present, null otherwise', () => {
    const m = new ResearchMcpInstallManager(tmp, '/dev/null/uv', resourcesDir);
    expect(m.getInstallMeta()).toBeNull();

    const meta = { deps_hash: 'deadbeef', python_version: '3.11.0', version: '0.1.0' };
    fs.writeFileSync(path.join(tmp, '.install-meta.json'), JSON.stringify(meta));
    expect(m.getInstallMeta()).toEqual(meta);
  });

  it('computeDepsHash produces stable 16-char hex from requirements.txt', () => {
    const reqPath = path.join(resourcesDir, 'requirements.txt');
    const m = new ResearchMcpInstallManager(tmp, '/dev/null/uv', resourcesDir);
    const hash1 = m.computeDepsHash(reqPath);
    const hash2 = m.computeDepsHash(reqPath);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(hash1)).toBe(true);
  });
});
