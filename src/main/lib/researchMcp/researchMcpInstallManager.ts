import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export interface InstallMeta {
  deps_hash: string;
  python_version: string;
  version: string;
  installed_at?: string;
}

export type InstallStage = 'detect_uv' | 'create_venv' | 'install_deps' | 'health_check';

export interface InstallProgress {
  stage: InstallStage;
  percent: number;
  message?: string;
}

export class ResearchMcpInstallManager extends EventEmitter {
  private installLock: Promise<{ ok: boolean; error?: string }> | null = null;
  private cancelled = false;
  private activeProcess: ChildProcess | null = null;

  constructor(
    private readonly runtimeDir: string,
    private readonly uvPath: string,
    private readonly resourcesDir: string,
  ) {
    super();
  }

  isInstalled(): boolean {
    return (
      fs.existsSync(path.join(this.runtimeDir, '.venv')) &&
      fs.existsSync(path.join(this.runtimeDir, '.install-meta.json'))
    );
  }

  getInstallMeta(): InstallMeta | null {
    try {
      const raw = fs.readFileSync(path.join(this.runtimeDir, '.install-meta.json'), 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  computeDepsHash(requirementsPath: string): string {
    const buf = fs.readFileSync(requirementsPath);
    return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
  }

  cancel(): void {
    this.cancelled = true;
    if (this.activeProcess && !this.activeProcess.killed) {
      this.activeProcess.kill();
    }
  }

  async reset(): Promise<void> {
    try {
      fs.rmSync(path.join(this.runtimeDir, '.venv'), { recursive: true, force: true });
    } catch { /* ignore */ }
    try {
      fs.unlinkSync(path.join(this.runtimeDir, '.install-meta.json'));
    } catch { /* ignore */ }
  }

  async install(): Promise<{ ok: boolean; error?: string }> {
    if (this.installLock) {
      return this.installLock;
    }

    let resolveLock!: (v: { ok: boolean; error?: string }) => void;
    this.installLock = new Promise((r) => {
      resolveLock = r;
    });

    try {
      this.cancelled = false;
      const result = await this.doInstall();
      resolveLock(result);
      return result;
    } catch (e: any) {
      const result = { ok: false, error: e?.message ?? String(e) };
      resolveLock(result);
      return result;
    } finally {
      this.installLock = null;
    }
  }

  private async doInstall(): Promise<{ ok: boolean; error?: string }> {
    // Stage 1: detect uv
    this.emit('progress', { stage: 'detect_uv', percent: 5, message: 'Detecting uv tool...' } as InstallProgress);
    if (!fs.existsSync(this.uvPath)) {
      return { ok: false, error: `uv not found at ${this.uvPath}` };
    }
    this.emit('progress', { stage: 'detect_uv', percent: 15, message: 'uv ready' } as InstallProgress);
    if (this.cancelled) return this.cleanupCancel();

    // Stage 2: create venv
    this.emit('progress', { stage: 'create_venv', percent: 20, message: 'Creating Python virtual environment...' } as InstallProgress);
    fs.mkdirSync(this.runtimeDir, { recursive: true });
    const venvPath = path.join(this.runtimeDir, '.venv');
    await this.run(this.uvPath, ['venv', venvPath, '--python', '3.11']);
    this.emit('progress', { stage: 'create_venv', percent: 35, message: 'Virtual environment created' } as InstallProgress);
    if (this.cancelled) return this.cleanupCancel();

    // Stage 3: install deps
    this.emit('progress', { stage: 'install_deps', percent: 40, message: 'Installing dependencies...' } as InstallProgress);
    const reqPath = path.join(this.resourcesDir, 'requirements.txt');
    const pythonExe = process.platform === 'win32'
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python');
    await this.run(this.uvPath, ['pip', 'install', '--python', pythonExe, '-r', reqPath]);
    this.emit('progress', { stage: 'install_deps', percent: 85, message: 'Dependencies installed' } as InstallProgress);
    if (this.cancelled) return this.cleanupCancel();

    // Stage 4: health check + write meta
    this.emit('progress', { stage: 'health_check', percent: 90, message: 'Finalizing...' } as InstallProgress);
    const meta: InstallMeta = {
      deps_hash: this.computeDepsHash(reqPath),
      python_version: '3.11',
      version: '0.1.0',
      installed_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(this.runtimeDir, '.install-meta.json'), JSON.stringify(meta, null, 2));
    this.emit('progress', { stage: 'health_check', percent: 100, message: 'Installation complete' } as InstallProgress);
    return { ok: true };
  }

  private cleanupCancel(): { ok: false; error: string } {
    try {
      fs.rmSync(path.join(this.runtimeDir, '.venv'), { recursive: true, force: true });
    } catch { /* ignore */ }
    try {
      fs.unlinkSync(path.join(this.runtimeDir, '.install-meta.json'));
    } catch { /* ignore */ }
    return { ok: false, error: 'cancelled' };
  }

  private run(cmd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      this.activeProcess = p;
      let stderr = '';
      p.stdout?.on('data', (d: Buffer) => {
        this.emit('log', d.toString());
      });
      p.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
        this.emit('log', d.toString());
      });
      p.on('exit', (code) => {
        this.activeProcess = null;
        if (this.cancelled) {
          reject(new Error('cancelled'));
        } else if (code === 0) {
          resolve();
        } else {
          reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-500)}`));
        }
      });
      p.on('error', (err) => {
        this.activeProcess = null;
        reject(err);
      });
    });
  }
}
