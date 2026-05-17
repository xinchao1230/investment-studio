import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { shell } from 'electron';
import { BuiltinToolDefinition, ToolExecutionResult } from './types';

export class PortfolioTools {
  private static workspaceDir: string = '';

  static setWorkspaceDir(dir: string): void {
    this.workspaceDir = dir;
  }

  static getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  /**
   * Normalize stock code for comparison (strip market suffix like .SH/.SZ/.SS).
   * Used for both duplicate detection and find-target-by-code lookups so that
   * `600036` and `600036.SH` resolve to the same target.
   */
  private static normalizeCode(c: string): string {
    return (c || '').toUpperCase().replace(/\.(SS|SH|SZ|SHA|SZA|HK|US|BJ)$/i, '');
  }

  /**
   * Locate a target directory under workspaceDir. Source of truth is the
   * `profile.yaml` content inside each subdirectory — directory naming is
   * NOT used (so both new `${name}` dirs and legacy `${name}_${code}` dirs
   * are transparently supported).
   *
   * Matching priority:
   *  1. If `stockCode` is non-empty and a profile's `stock_code` (normalized)
   *     equals normalized `stockCode` → match.
   *  2. Else if `name` is provided and a profile's `name` equals it → match.
   *
   * Returns the first matching directory's absolute path, or null.
   *
   * Made public so other main-process modules (e.g. agentChat post-process)
   * can resolve a target's directory without duplicating filesystem logic.
   */
  public static findTargetDir(stockCode: string, name?: string): string | null {
    if (!fs.existsSync(this.workspaceDir)) return null;
    const code = (stockCode || '').trim();
    const wantName = (name || '').trim();
    if (!code && !wantName) return null;
    const wantNorm = code ? this.normalizeCode(code) : '';
    const entries = fs.readdirSync(this.workspaceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      const profilePath = path.join(this.workspaceDir, entry.name, 'profile.yaml');
      if (!fs.existsSync(profilePath)) continue;
      try {
        const p = yaml.load(fs.readFileSync(profilePath, 'utf-8')) as {
          stock_code?: string;
          name?: string;
          listed?: boolean;
        };
        const pCode = (p?.stock_code || '').trim();
        const pName = (p?.name || '').trim();
        const pListed = p?.listed !== false && !!pCode; // default true if has code
        // Match by code:
        //   - For listed profiles, compare normalized codes so `600036` and
        //     `600036.SH` resolve to the same target.
        //   - For unlisted profiles, the stored stock_code IS the company
        //     name (synthetic placeholder); compare as a plain string. This
        //     is what makes `deleteTarget(stockCode = name)` work for
        //     unlisted targets when the renderer doesn't separately pass
        //     `name`.
        if (wantNorm && pCode && pListed && this.normalizeCode(pCode) === wantNorm) {
          return path.join(this.workspaceDir, entry.name);
        }
        if (code && !pListed && pCode && pCode === code) {
          return path.join(this.workspaceDir, entry.name);
        }
        if (wantName && pName === wantName) {
          return path.join(this.workspaceDir, entry.name);
        }
      } catch { /* skip malformed */ }
    }
    return null;
  }

  /**
   * Render a markdown H1 title for a target template file. For listed
   * companies the title is `${name} (${code})`; for unlisted companies
   * (empty code) the parentheses block is dropped to avoid `# Acme () - X`.
   */
  private static formatTitle(name: string, code: string, suffix: string): string {
    const trimmed = (code || '').trim();
    if (trimmed) return `# ${name} (${trimmed}) - ${suffix}`;
    return `# ${name} - ${suffix}`;
  }

  // --- Definitions ---

  static getInitTargetDefinition(): BuiltinToolDefinition {
    return {
      name: 'portfolio_init_target',
      description: 'Create a new research target folder with standard template files (profile.yaml, key-drivers.md, notes.md, tracking.md, inputs/, earnings/, research/, models/). For unlisted/private companies, pass an empty string (or omit) for stock_code.',
      inputSchema: {
        type: 'object',
        properties: {
          stock_code: { type: 'string', description: 'Stock code, e.g. 603993 or 603993.SH. Pass empty string for unlisted/private companies.' },
          name: { type: 'string', description: 'Company name, e.g. 海底捞' },
          industry: { type: 'string', description: 'Industry (optional)' },
        },
        required: ['name'],
      },
    };
  }

  static getListTargetsDefinition(): BuiltinToolDefinition {
    return {
      name: 'portfolio_list_targets',
      description: 'List all research targets with basic profile info (stock_code, name, industry, follow_date)',
      inputSchema: { type: 'object', properties: {} },
    };
  }

  static getGetTargetFilesDefinition(): BuiltinToolDefinition {
    return {
      name: 'portfolio_get_target_files',
      description: 'Get all files under a research target folder',
      inputSchema: {
        type: 'object',
        properties: {
          stock_code: { type: 'string', description: 'Stock code' },
        },
        required: ['stock_code'],
      },
    };
  }

  static getDeleteTargetDefinition(): BuiltinToolDefinition {
    return {
      name: 'portfolio_delete_target',
      description: 'Delete a research target folder (moves to system recycle bin so it can be recovered). For unlisted targets (no real stock code), pass the company name as stock_code OR pass name explicitly.',
      inputSchema: {
        type: 'object',
        properties: {
          stock_code: { type: 'string', description: 'Stock code of the target to delete (may be empty for unlisted)' },
          name: { type: 'string', description: 'Optional: company name, used as fallback lookup when stock_code is missing or for unlisted targets' },
        },
        required: ['stock_code'],
      },
    };
  }

  static getGetTrackingStatusDefinition(): BuiltinToolDefinition {
    return {
      name: 'portfolio_get_tracking_status',
      description: 'Get tracking summary for all targets (last update date, number of notes, etc.)',
      inputSchema: { type: 'object', properties: {} },
    };
  }

  static getUpdateKeyDriversDefinition(): BuiltinToolDefinition {
    return {
      name: 'portfolio_update_key_drivers',
      description: 'Update key drivers markdown file for a target (overwrites content)',
      inputSchema: {
        type: 'object',
        properties: {
          stock_code: { type: 'string', description: 'Stock code' },
          content: { type: 'string', description: 'Full markdown content for key-drivers.md' },
        },
        required: ['stock_code', 'content'],
      },
    };
  }

  static getAppendNoteDefinition(): BuiltinToolDefinition {
    return {
      name: 'portfolio_append_note',
      description: 'Append a timestamped research note to a target',
      inputSchema: {
        type: 'object',
        properties: {
          stock_code: { type: 'string', description: 'Stock code' },
          content: { type: 'string', description: 'Note content (will be added with date header)' },
        },
        required: ['stock_code', 'content'],
      },
    };
  }

  static getMoveFileDefinition(): BuiltinToolDefinition {
    return {
      name: 'portfolio_move_file',
      description: 'Move a file within the portfolio workspace (target tree). Both paths must be inside the workspace. profile.yaml cannot be moved. Returns finalDestPath and renamed flag on success; returns code=EXISTS with existingPath on conflict when on_conflict=fail.',
      inputSchema: {
        type: 'object',
        properties: {
          source_abs_path: { type: 'string', description: 'Absolute path of the file to move (must be inside portfolio workspace).' },
          dest_dir_abs_path: { type: 'string', description: 'Absolute path of the destination directory (created if missing, must be inside portfolio workspace).' },
          on_conflict: { type: 'string', enum: ['fail', 'rename', 'overwrite'], description: 'How to handle name collision at destination. Default: fail.' },
        },
        required: ['source_abs_path', 'dest_dir_abs_path'],
      },
    };
  }

  static getRenameFileDefinition(): BuiltinToolDefinition {
    return {
      name: 'portfolio_rename_file',
      description: 'Rename a file in place within the portfolio workspace. profile.yaml cannot be renamed. new_name must be a basename (no path separators).',
      inputSchema: {
        type: 'object',
        properties: {
          source_abs_path: { type: 'string', description: 'Absolute path of the file to rename.' },
          new_name: { type: 'string', description: 'New basename (no directory separators).' },
        },
        required: ['source_abs_path', 'new_name'],
      },
    };
  }

  // --- Execution ---

  /**
   * Reject names that would produce unsafe / cross-platform-incompatible
   * directory names. Since the dirname now equals `${name}` directly (no
   * `_${code}` suffix), any path separator or reserved char would either
   * create nested subdirs (`Foo/Bar` → workspace/Foo/Bar) or fail outright
   * on Windows (`A:B`, `A?`, `A*`, etc.). Also reject leading dots/dashes
   * and Windows reserved device names.
   */
  private static validateName(name: string): string | null {
    if (!name) return 'Target name is required';
    if (name.length > 120) return 'Target name is too long (max 120 chars)';
    if (/[\\/:*?"<>|]/.test(name)) {
      return 'Target name contains invalid characters (\\ / : * ? " < > |)';
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f]/.test(name)) {
      return 'Target name contains control characters';
    }
    if (name === '.' || name === '..' || name.startsWith('.') || name.startsWith('-')) {
      return 'Target name cannot start with "." or "-"';
    }
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(name)) {
      return 'Target name is a reserved system name on Windows';
    }
    return null;
  }

  /**
   * Reject file basenames that would break filesystems. Stricter than
   * validateName because callers must also block 'profile.yaml' separately
   * (via assertNotProfileYaml).
   */
  private static validateFileBasename(name: string): string | null {
    if (!name || !name.trim()) return 'File name is required';
    if (name.length > 200) return 'File name is too long (max 200 chars)';
    if (/[\\/:*?"<>|]/.test(name)) {
      return 'File name contains invalid characters (\\ / : * ? " < > |)';
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f]/.test(name)) return 'File name contains control characters';
    if (name === '.' || name === '..') return 'File name cannot be "." or ".."';
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(name)) {
      return 'File name is a reserved system name on Windows';
    }
    return null;
  }

  /** Ensure `absPath` is strictly under `this.workspaceDir`. Throws on violation. */
  private static assertInsideWorkspace(absPath: string, label: string): void {
    if (!this.workspaceDir) throw new Error('Portfolio workspace not initialized');
    const rel = path.relative(this.workspaceDir, path.resolve(absPath));
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`${label} is outside the portfolio workspace: ${absPath}`);
    }
  }

  /** Refuse any operation touching a target's profile.yaml. */
  private static assertNotProfileYaml(absPath: string): void {
    if (path.basename(absPath).toLowerCase() === 'profile.yaml') {
      throw new Error('profile.yaml is protected and cannot be moved/renamed/deleted');
    }
  }

  /**
   * Given a desired destination path that already exists, return a free path
   * by appending ` (N)` before the extension. e.g. `foo.md` → `foo (1).md` →
   * `foo (2).md`. Hard cap at 1000 iterations.
   */
  private static resolveAutoRename(destPath: string): string {
    if (!fs.existsSync(destPath)) return destPath;
    const dir = path.dirname(destPath);
    const ext = path.extname(destPath);
    let base = path.basename(destPath, ext);
    const m = base.match(/^(.*) \((\d+)\)$/);
    let start = 1;
    if (m) { base = m[1]; start = parseInt(m[2], 10) + 1; }
    for (let i = start; i < start + 1000; i++) {
      const candidate = path.join(dir, `${base} (${i})${ext}`);
      if (!fs.existsSync(candidate)) return candidate;
    }
    throw new Error('Auto-rename exhausted 1000 attempts');
  }

  static async executeInitTarget(args: { stock_code?: string; name: string; industry?: string }): Promise<ToolExecutionResult> {
    const rawCode = (args.stock_code ?? '').trim();
    const name = (args.name ?? '').trim();
    const industry = (args.industry ?? '').trim();
    const nameError = this.validateName(name);
    if (nameError) {
      return { success: false, error: nameError };
    }

    // Listed vs unlisted distinction:
    //   listed:   user picked a real stock from the search dropdown — has a
    //             non-empty stock_code (e.g. "603993.SH").
    //   unlisted: user typed the company name and clicked "添加未上市公司"
    //             — no real stock code exists.
    //
    // For unlisted targets we store `stock_code === name` so that the renderer
    // (which keys every target by `stock_code`) keeps non-empty unique keys.
    // The `listed` boolean is the source of truth for UI / LLM branching.
    const listed = !!rawCode;
    const stockCode = listed ? rawCode : name;

    // Directory name is always `${name}` — no more `_${code}` suffix.
    const dirName = name;
    const targetDir = path.join(this.workspaceDir, dirName);

    if (fs.existsSync(targetDir)) {
      return { success: false, error: `Target directory "${dirName}" already exists` };
    }

    // Duplicate-detection scan (also catches legacy `${name}_${code}` dirs):
    //   - Same name → always reject.
    //   - Same (normalized) stock_code → reject only when BOTH sides are
    //     listed-real codes. Two unlisted targets that share a synthetic
    //     stock_code (name collision) are already caught by the name check;
    //     a listed `600036.SH` shouldn't accidentally collide with an
    //     unlisted whose name happens to be `600036.SH`.
    if (fs.existsSync(this.workspaceDir)) {
      const wantNorm = listed ? this.normalizeCode(rawCode) : '';
      for (const entry of fs.readdirSync(this.workspaceDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
        const profilePath = path.join(this.workspaceDir, entry.name, 'profile.yaml');
        if (!fs.existsSync(profilePath)) continue;
        try {
          const p = yaml.load(fs.readFileSync(profilePath, 'utf-8')) as {
            stock_code?: string;
            name?: string;
            listed?: boolean;
          };
          const existingCode = (p?.stock_code || '').trim();
          const existingName = (p?.name || '').trim();
          // Default listed=true for legacy profiles that have a stock_code
          // but no explicit `listed` field.
          const existingListed = p?.listed !== false && !!existingCode;
          if (
            listed &&
            existingListed &&
            existingCode &&
            this.normalizeCode(existingCode) === wantNorm
          ) {
            return {
              success: false,
              error: `Target with stock_code "${existingCode}" already exists at "${entry.name}". Reuse the existing target directory instead of creating a new one.`,
            };
          }
          if (existingName && existingName === name) {
            return {
              success: false,
              error: `Target with name "${existingName}" already exists at "${entry.name}"${existingCode ? ` (stock_code: ${existingCode})` : ''}. Reuse the existing target instead of creating a duplicate.`,
            };
          }
        } catch { /* skip malformed */ }
      }
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'inputs'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'earnings'), { recursive: true });
    // Note: Do NOT pre-create a `research/` (English) dir. The sidebar's
    // SUBCATEGORIES are Chinese (纪要/研报/公告/...), and stock-analyze writes
    // to `研报/stock-analyze/{date}/`. An empty pre-created English `research/`
    // biases the LLM into the "复用既有结构" branch and lands reports in
    // an extras row that users miss. Let the skill create its own path.
    fs.mkdirSync(path.join(targetDir, 'models'), { recursive: true });

    // ISO datetime with millisecond precision so the renderer can sort
    // "newest first" even when multiple targets are added the same day
    // (a YYYY-MM-DD field collapses every same-day add into one bucket).
    const now = new Date().toISOString();
    const profile = yaml.dump({
      stock_code: stockCode,
      name: name,
      industry: industry || '',
      listed: listed,
      follow_date: now,
      notes: '',
    });
    fs.writeFileSync(path.join(targetDir, 'profile.yaml'), profile, 'utf-8');

    // Template title: formatTitle drops parens entirely when code is empty,
    // so we pass rawCode unconditionally — listed ? rawCode : '' (since for
    // unlisted, rawCode is already empty by definition).
    const keyDriversContent = listed
      ? this.buildListedKeyDrivers(name, rawCode)
      : this.buildUnlistedKeyDrivers(name);
    fs.writeFileSync(path.join(targetDir, 'key-drivers.md'), keyDriversContent, 'utf-8');
    fs.writeFileSync(
      path.join(targetDir, 'notes.md'),
      `${this.formatTitle(name, rawCode, 'Research Notes')}\n\n`,
      'utf-8',
    );
    fs.writeFileSync(
      path.join(targetDir, 'tracking.md'),
      `${this.formatTitle(name, rawCode, 'Marginal Change Tracking')}\n\n> 用于记录“基本面边际变化”——关键指标 vs 上期 / 预期、行业政策、公司公告等。\n> 建议每次跟踪 skill 自动 append；手动补充时按时间倒序。\n\n| Date | Item | Previous | Current | Note |\n|------|------|----------|---------|------|\n`,
      'utf-8',
    );

    return {
      success: true,
      data: `Target "${dirName}" created at ${targetDir}`,
      mutations: [{ path: targetDir, kind: 'create' }],
    };
  }

  /**
   * Build an empty skeleton key-drivers.md for a **listed** company.
   * Section headers are intentionally preserved so reader skills
   * (earnings-review, marginal-tracking, deep-report) can still find the
   * standard anchors; bodies are left blank for the LLM (or user) to fill.
   */
  private static buildListedKeyDrivers(name: string, stockCode: string): string {
    return `${this.formatTitle(name, stockCode, 'Key Drivers')}

## 投资逻辑

**短期逻辑**：

**长期逻辑**：

## 核心跟踪变量

1.
2.
3.
`;
  }

  /**
   * Build an empty skeleton key-drivers.md for an **unlisted / private**
   * company. Adds a 单位经济与资金 section after 核心跟踪变量 so PMF /
   * runway fundamentals have a dedicated home.
   */
  private static buildUnlistedKeyDrivers(name: string): string {
    return `${this.formatTitle(name, '', 'Key Drivers')}

## 投资逻辑

**短期逻辑**：

**长期逻辑**：

## 核心跟踪变量

1.
2.
3.

## 单位经济与资金

- 关键运营指标：
- 单位经济（LTV/CAC、毛利率）：
- 现金跑道：
`;
  }

  static async executeListTargets(): Promise<ToolExecutionResult> {
    if (!fs.existsSync(this.workspaceDir)) {
      return { success: true, data: JSON.stringify([]) };
    }
    const entries = fs.readdirSync(this.workspaceDir, { withFileTypes: true });
    const targets: Array<Record<string, unknown>> = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      const profilePath = path.join(this.workspaceDir, entry.name, 'profile.yaml');
      if (!fs.existsSync(profilePath)) continue;
      try {
        const profile = yaml.load(fs.readFileSync(profilePath, 'utf-8')) as Record<string, unknown>;
        const code = typeof profile.stock_code === 'string' ? profile.stock_code : '';
        // Default listed=true for legacy profiles (have a code but missing
        // the `listed` field). New profiles always write it explicitly.
        const listed = typeof profile.listed === 'boolean'
          ? profile.listed
          : !!code;
        targets.push({
          stock_code: code,
          name: typeof profile.name === 'string' ? profile.name : '',
          industry: typeof profile.industry === 'string' ? profile.industry : '',
          listed,
          follow_date: typeof profile.follow_date === 'string' ? profile.follow_date : '',
          directory: path.join(this.workspaceDir, entry.name),
        });
      } catch { /* skip malformed */ }
    }
    return { success: true, data: JSON.stringify(targets) };
  }

  static async executeGetTargetFiles(args: { stock_code: string; name?: string }): Promise<ToolExecutionResult> {
    const targetDir = this.findTargetDir(args.stock_code, args.name);
    if (!targetDir) {
      return { success: false, error: `Target with stock_code "${args.stock_code}" not found` };
    }
    // Return objects with both the workspace-relative path (for display) and
    // the absolute path (so the renderer can fs.readFile it directly without
    // having to know the workspace root). Previously this returned bare
    // filenames, which caused the renderer to try reading from cwd.
    const files: Array<{ relPath: string; absPath: string; mtime: number }> = [];
    const walk = (dir: string, prefix: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(abs, rel);
        } else {
          let mtime = 0;
          try { mtime = fs.statSync(abs).mtimeMs; } catch { /* ignore */ }
          files.push({ relPath: rel, absPath: abs, mtime });
        }
      }
    };
    walk(targetDir, '');
    return { success: true, data: JSON.stringify(files) };
  }

  static async executeDeleteTarget(args: { stock_code: string; name?: string }): Promise<ToolExecutionResult> {
    const targetDir = this.findTargetDir(args.stock_code, args.name);
    if (!targetDir) {
      return { success: false, error: `Target with stock_code "${args.stock_code}"${args.name ? ` / name "${args.name}"` : ''} not found` };
    }
    try {
      // Move to recycle bin (recoverable). Falls back to fs.rmSync only if trash is unavailable.
      await shell.trashItem(targetDir);
    } catch (err) {
      try {
        fs.rmSync(targetDir, { recursive: true, force: true });
      } catch (rmErr) {
        const msg = rmErr instanceof Error ? rmErr.message : String(rmErr);
        return { success: false, error: `Failed to delete target: ${msg}` };
      }
    }
    return {
      success: true,
      data: `Target with stock_code "${args.stock_code}" deleted`,
      mutations: [{ path: targetDir, kind: 'delete' }],
    };
  }

  static async executeGetTrackingStatus(): Promise<ToolExecutionResult> {
    if (!fs.existsSync(this.workspaceDir)) {
      return { success: true, data: JSON.stringify([]) };
    }
    const entries = fs.readdirSync(this.workspaceDir, { withFileTypes: true });
    const statuses: Array<Record<string, unknown>> = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      const profilePath = path.join(this.workspaceDir, entry.name, 'profile.yaml');
      if (!fs.existsSync(profilePath)) continue;
      try {
        const profile = yaml.load(fs.readFileSync(profilePath, 'utf-8')) as Record<string, unknown>;
        const code = typeof profile.stock_code === 'string' ? profile.stock_code : '';
        const profileName = typeof profile.name === 'string' ? profile.name : '';
        const listed = typeof profile.listed === 'boolean' ? profile.listed : !!code;
        const trackingPath = path.join(this.workspaceDir, entry.name, 'tracking.md');
        const notesPath = path.join(this.workspaceDir, entry.name, 'notes.md');
        const trackingMtime = fs.existsSync(trackingPath) ? fs.statSync(trackingPath).mtime.toISOString().split('T')[0] : 'never';
        const noteLines = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, 'utf-8').split('\n').filter((l) => l.trim().length > 0).length : 0;
        statuses.push({ stock_code: code, name: profileName, listed, last_tracking_update: trackingMtime, note_lines: noteLines });
      } catch { /* skip */ }
    }
    return { success: true, data: JSON.stringify(statuses) };
  }

  static async executeUpdateKeyDrivers(args: { stock_code: string; content: string }): Promise<ToolExecutionResult> {
    const targetDir = this.findTargetDir(args.stock_code);
    if (!targetDir) {
      return { success: false, error: `Target with stock_code "${args.stock_code}" not found` };
    }
    const keyDriversPath = path.join(targetDir, 'key-drivers.md');
    fs.writeFileSync(keyDriversPath, args.content, 'utf-8');
    return {
      success: true,
      data: 'Key drivers updated',
      mutations: [{ path: keyDriversPath, kind: 'modify' }],
    };
  }

  static async executeAppendNote(args: { stock_code: string; content: string }): Promise<ToolExecutionResult> {
    const targetDir = this.findTargetDir(args.stock_code);
    if (!targetDir) {
      return { success: false, error: `Target with stock_code "${args.stock_code}" not found` };
    }
    const notesPath = path.join(targetDir, 'notes.md');
    const now = new Date().toISOString().split('T')[0];
    const entry = `\n## ${now}\n\n${args.content}\n`;
    fs.appendFileSync(notesPath, entry, 'utf-8');
    return {
      success: true,
      data: 'Note appended',
      mutations: [{ path: notesPath, kind: 'modify' }],
    };
  }

  static async executeMoveFile(args: {
    source_abs_path: string;
    dest_dir_abs_path: string;
    on_conflict?: 'fail' | 'rename' | 'overwrite';
  }): Promise<ToolExecutionResult> {
    const source = path.resolve(args.source_abs_path || '');
    const destDir = path.resolve(args.dest_dir_abs_path || '');
    const onConflict = args.on_conflict ?? 'fail';
    try {
      this.assertInsideWorkspace(source, 'source_abs_path');
      this.assertInsideWorkspace(destDir, 'dest_dir_abs_path');
      this.assertNotProfileYaml(source);

      if (!fs.existsSync(source)) {
        return {
          success: false,
          error: `Source file not found: ${source}`,
          data: JSON.stringify({ code: 'NOT_FOUND' }),
        };
      }
      const sStat = fs.statSync(source);
      if (!sStat.isFile()) {
        return { success: false, error: `Source is not a regular file: ${source}` };
      }

      fs.mkdirSync(destDir, { recursive: true });
      let finalDest = path.join(destDir, path.basename(source));

      // No-op short-circuit: same directory, same name.
      if (path.resolve(finalDest) === source) {
        return {
          success: true,
          data: JSON.stringify({ finalDestPath: source, renamed: false, noop: true }),
        };
      }

      const conflict = fs.existsSync(finalDest);
      let renamed = false;
      if (conflict) {
        if (onConflict === 'fail') {
          return {
            success: false,
            error: `Destination already exists: ${finalDest}`,
            data: JSON.stringify({ code: 'EXISTS', existingPath: finalDest }),
          };
        } else if (onConflict === 'rename') {
          finalDest = this.resolveAutoRename(finalDest);
          renamed = true;
        } else if (onConflict === 'overwrite') {
          fs.unlinkSync(finalDest);
        }
      }

      try {
        fs.renameSync(source, finalDest);
      } catch (e: any) {
        if (e && e.code === 'EXDEV') {
          // Cross-device fallback: copy + unlink.
          fs.copyFileSync(source, finalDest);
          fs.unlinkSync(source);
        } else {
          return {
            success: false,
            error: `Failed to move file: ${e?.message || String(e)}`,
            data: JSON.stringify({ code: e?.code || 'EIO' }),
          };
        }
      }

      return {
        success: true,
        data: JSON.stringify({ finalDestPath: finalDest, renamed }),
        mutations: [
          { path: source, kind: 'delete' },
          { path: finalDest, kind: conflict && onConflict === 'overwrite' ? 'modify' : 'create' },
        ],
      };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  }

  static async executeRenameFile(args: {
    source_abs_path: string;
    new_name: string;
  }): Promise<ToolExecutionResult> {
    const source = path.resolve(args.source_abs_path || '');
    const newName = (args.new_name || '').trim();
    try {
      this.assertInsideWorkspace(source, 'source_abs_path');
      this.assertNotProfileYaml(source);
      const nameErr = this.validateFileBasename(newName);
      if (nameErr) return { success: false, error: nameErr };
      if (newName.toLowerCase() === 'profile.yaml') {
        return { success: false, error: 'Cannot rename a file to profile.yaml (reserved)' };
      }
      if (!fs.existsSync(source)) {
        return {
          success: false,
          error: `Source file not found: ${source}`,
          data: JSON.stringify({ code: 'NOT_FOUND' }),
        };
      }
      const finalDest = path.join(path.dirname(source), newName);
      if (path.resolve(finalDest) === source) {
        return { success: true, data: JSON.stringify({ finalDestPath: source, noop: true }) };
      }
      if (fs.existsSync(finalDest)) {
        return {
          success: false,
          error: `A file named "${newName}" already exists in this folder`,
          data: JSON.stringify({ code: 'EXISTS', existingPath: finalDest }),
        };
      }
      try {
        fs.renameSync(source, finalDest);
      } catch (e: any) {
        return {
          success: false,
          error: `Failed to rename: ${e?.message || String(e)}`,
          data: JSON.stringify({ code: e?.code || 'EIO' }),
        };
      }
      return {
        success: true,
        data: JSON.stringify({ finalDestPath: finalDest }),
        mutations: [
          { path: source, kind: 'delete' },
          { path: finalDest, kind: 'create' },
        ],
      };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  }
}
