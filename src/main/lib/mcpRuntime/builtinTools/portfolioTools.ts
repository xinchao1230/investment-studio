import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { BuiltinToolDefinition, ToolExecutionResult } from './types';

export class PortfolioTools {
  private static workspaceDir: string = '';

  static setWorkspaceDir(dir: string): void {
    this.workspaceDir = dir;
  }

  static getWorkspaceDir(): string {
    return this.workspaceDir;
  }

  private static findTargetDir(stockCode: string): string | null {
    if (!fs.existsSync(this.workspaceDir)) return null;
    const entries = fs.readdirSync(this.workspaceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.endsWith(`_${stockCode}`)) {
        return path.join(this.workspaceDir, entry.name);
      }
    }
    return null;
  }

  // --- Definitions ---

  static getInitTargetDefinition(): BuiltinToolDefinition {
    return {
      name: 'portfolio_init_target',
      description: 'Create a new research target folder with standard template files (profile.yaml, key-drivers.md, notes.md, tracking.md, earnings/, models/)',
      inputSchema: {
        type: 'object',
        properties: {
          stock_code: { type: 'string', description: 'Stock code, e.g. 603993' },
          name: { type: 'string', description: 'Company name, e.g. 海底捞' },
          industry: { type: 'string', description: 'Industry (optional)' },
        },
        required: ['stock_code', 'name'],
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

  // --- Execution ---

  static async executeInitTarget(args: { stock_code: string; name: string; industry?: string }): Promise<ToolExecutionResult> {
    const { stock_code, name, industry } = args;
    const dirName = `${name}_${stock_code}`;
    const targetDir = path.join(this.workspaceDir, dirName);

    if (fs.existsSync(targetDir)) {
      return { success: false, error: `Target "${dirName}" already exists` };
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'earnings'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'models'), { recursive: true });

    const now = new Date().toISOString().split('T')[0];
    const profile = yaml.dump({
      stock_code: stock_code,
      name: name,
      industry: industry || '',
      follow_date: now,
      notes: '',
    });
    fs.writeFileSync(path.join(targetDir, 'profile.yaml'), profile, 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'key-drivers.md'), `# ${name} (${stock_code}) - Key Drivers\n\n<!-- Add key driver factors below -->\n\n`, 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'notes.md'), `# ${name} (${stock_code}) - Research Notes\n\n`, 'utf-8');
    fs.writeFileSync(path.join(targetDir, 'tracking.md'), `# ${name} (${stock_code}) - Marginal Change Tracking\n\n| Date | Item | Previous | Current | Note |\n|------|------|----------|---------|------|\n`, 'utf-8');

    return { success: true, data: `Target "${dirName}" created at ${targetDir}` };
  }

  static async executeListTargets(): Promise<ToolExecutionResult> {
    if (!fs.existsSync(this.workspaceDir)) {
      return { success: true, data: JSON.stringify([]) };
    }
    const entries = fs.readdirSync(this.workspaceDir, { withFileTypes: true });
    const targets: Array<Record<string, string>> = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      const profilePath = path.join(this.workspaceDir, entry.name, 'profile.yaml');
      if (!fs.existsSync(profilePath)) continue;
      try {
        const profile = yaml.load(fs.readFileSync(profilePath, 'utf-8')) as Record<string, string>;
        targets.push({
          stock_code: profile.stock_code || '',
          name: profile.name || '',
          industry: profile.industry || '',
          follow_date: profile.follow_date || '',
          directory: entry.name,
        });
      } catch { /* skip malformed */ }
    }
    return { success: true, data: JSON.stringify(targets) };
  }

  static async executeGetTargetFiles(args: { stock_code: string }): Promise<ToolExecutionResult> {
    const targetDir = this.findTargetDir(args.stock_code);
    if (!targetDir) {
      return { success: false, error: `Target with stock_code "${args.stock_code}" not found` };
    }
    const files: string[] = [];
    const walk = (dir: string, prefix: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), rel);
        } else {
          files.push(rel);
        }
      }
    };
    walk(targetDir, '');
    return { success: true, data: JSON.stringify(files) };
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
        const profile = yaml.load(fs.readFileSync(profilePath, 'utf-8')) as Record<string, string>;
        const trackingPath = path.join(this.workspaceDir, entry.name, 'tracking.md');
        const notesPath = path.join(this.workspaceDir, entry.name, 'notes.md');
        const trackingMtime = fs.existsSync(trackingPath) ? fs.statSync(trackingPath).mtime.toISOString().split('T')[0] : 'never';
        const noteLines = fs.existsSync(notesPath) ? fs.readFileSync(notesPath, 'utf-8').split('\n').filter((l) => l.trim().length > 0).length : 0;
        statuses.push({ stock_code: profile.stock_code || '', name: profile.name || '', last_tracking_update: trackingMtime, note_lines: noteLines });
      } catch { /* skip */ }
    }
    return { success: true, data: JSON.stringify(statuses) };
  }

  static async executeUpdateKeyDrivers(args: { stock_code: string; content: string }): Promise<ToolExecutionResult> {
    const targetDir = this.findTargetDir(args.stock_code);
    if (!targetDir) {
      return { success: false, error: `Target with stock_code "${args.stock_code}" not found` };
    }
    fs.writeFileSync(path.join(targetDir, 'key-drivers.md'), args.content, 'utf-8');
    return { success: true, data: 'Key drivers updated' };
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
    return { success: true, data: 'Note appended' };
  }
}
