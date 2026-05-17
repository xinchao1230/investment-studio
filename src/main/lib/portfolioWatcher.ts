/**
 * PortfolioWatcher
 *
 * chokidar-based file system watcher for the portfolio workspace directory.
 *
 * Background: the renderer relies on the `kosmos:fs-changed` IPC event to
 * keep target-file caches in sync with disk. That event is broadcast for
 * mutations produced by builtin tools (write_file etc.) and `portfolio:*`
 * IPC handlers. However, **most** portfolio file writes come from external
 * MCP servers (e.g. `research-mcp`, which spawns a Python subprocess via
 * stdio and writes CSVs through pandas) — those writes bypass the main
 * process entirely, so no `kosmos:fs-changed` is emitted and the sidebar
 * shows stale data until restart.
 *
 * This watcher closes that gap by observing portfolioDir directly and
 * broadcasting synthetic `kosmos:fs-changed` events for any add/change/
 * delete inside the tree, regardless of who wrote the file.
 *
 * Implementation notes:
 *  - Singleton: at most one chokidar instance ever exists.
 *  - `start(dir, getWindows)` is idempotent — calling it with the same
 *    dir is a no-op; calling with a different dir restarts.
 *  - 100ms debounce: pandas / multi-file writes get coalesced into a
 *    single broadcast. Per-path dedupe within the buffer (last-write-wins
 *    on `kind`).
 *  - `ignoreInitial: true`: do not flood the renderer on startup with
 *    `add` events for every existing file.
 *  - `awaitWriteFinish`: wait for the file size to stabilize before
 *    reporting — prevents firing on partial writes.
 *  - Non-fatal: any chokidar error is logged as a warning and swallowed.
 */

import * as chokidar from 'chokidar';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { safeConsole } from './utilities/safeConsole';

type Kind = 'create' | 'modify' | 'delete';
type Mutation = { path: string; kind: Kind };

export class PortfolioWatcher {
  private static _instance: PortfolioWatcher | null = null;

  private watcher: chokidar.FSWatcher | null = null;
  private watchedDir: string | null = null;
  private getWindows: (() => BrowserWindow[]) | null = null;

  private buffer: Map<string, Kind> = new Map();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly DEBOUNCE_MS = 100;

  static getInstance(): PortfolioWatcher {
    if (!PortfolioWatcher._instance) {
      PortfolioWatcher._instance = new PortfolioWatcher();
    }
    return PortfolioWatcher._instance;
  }

  /**
   * Start (or restart) the watcher. Idempotent: re-invoking with the same
   * normalized directory is a no-op. If a different directory is passed,
   * the previous watcher is stopped first.
   */
  start(dir: string, getWindows: () => BrowserWindow[]): void {
    const normalized = path.resolve(dir);
    if (this.watcher && this.watchedDir === normalized) {
      // Refresh getWindows in case main re-registered it (cheap).
      this.getWindows = getWindows;
      return;
    }
    if (this.watcher) {
      this.stop();
    }

    this.watchedDir = normalized;
    this.getWindows = getWindows;

    try {
      this.watcher = chokidar.watch(normalized, {
        ignoreInitial: true,
        persistent: true,
        depth: 8,
        ignored: (p: string) => {
          const base = path.basename(p);
          // dotfiles, Office lock/temp, partial-write temps
          if (base.startsWith('.') && base !== '.') return true;
          if (base.startsWith('~$')) return true;
          if (base.endsWith('.tmp') || base.endsWith('.crswap')) return true;
          return false;
        },
        awaitWriteFinish: {
          stabilityThreshold: 250,
          pollInterval: 80,
        },
      });

      this.watcher.on('add', (p: string) => this.enqueue(p, 'create'));
      this.watcher.on('change', (p: string) => this.enqueue(p, 'modify'));
      this.watcher.on('unlink', (p: string) => this.enqueue(p, 'delete'));
      this.watcher.on('addDir', (p: string) => this.enqueue(p, 'create'));
      this.watcher.on('unlinkDir', (p: string) => this.enqueue(p, 'delete'));
      this.watcher.on('error', (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        safeConsole.warn(`[PortfolioWatcher] chokidar error: ${msg}`);
      });

      safeConsole.log(`[PortfolioWatcher] watching ${normalized}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      safeConsole.warn(`[PortfolioWatcher] failed to start: ${msg}`);
      this.watcher = null;
      this.watchedDir = null;
    }
  }

  /**
   * Stop the watcher and drop any pending buffer. Safe to call when not
   * started.
   */
  stop(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.buffer.clear();

    const w = this.watcher;
    this.watcher = null;
    this.watchedDir = null;
    this.getWindows = null;

    if (w) {
      // close() returns a Promise; we don't await — chokidar handles
      // teardown internally and we don't want to block the quit path.
      w.close().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        safeConsole.warn(`[PortfolioWatcher] close error: ${msg}`);
      });
      safeConsole.log('[PortfolioWatcher] stopped');
    }
  }

  private enqueue(absPath: string, kind: Kind): void {
    // Last-write-wins on the same path within the debounce window: a
    // create + immediate delete collapses to delete, etc.
    this.buffer.set(absPath, kind);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), this.DEBOUNCE_MS);
  }

  private flush(): void {
    this.flushTimer = null;
    if (this.buffer.size === 0) return;

    const mutations: Mutation[] = [];
    for (const [p, kind] of this.buffer) {
      mutations.push({ path: p, kind });
    }
    this.buffer.clear();

    const payload = {
      tool: 'fs:watcher',
      mutations,
      timestamp: Date.now(),
    };

    const windows = this.getWindows ? this.getWindows() : [];
    for (const win of windows) {
      if (!win.isDestroyed()) {
        try {
          win.webContents.send('kosmos:fs-changed', payload);
        } catch {
          /* ignore — non-fatal */
        }
      }
    }
  }
}
