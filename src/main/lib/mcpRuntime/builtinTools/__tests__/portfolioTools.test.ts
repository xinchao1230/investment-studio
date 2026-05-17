import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { PortfolioTools } from '../portfolioTools';

describe('PortfolioTools', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-test-'));
    PortfolioTools.setWorkspaceDir(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('init_target (listed)', () => {
    it('creates all expected files and directories', async () => {
      const result = await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业', industry: '有色金属' });
      expect(result.success).toBe(true);

      // New dirname scheme: just the company name (no `_${code}` suffix).
      const targetDir = path.join(tmpDir, '洛阳钼业');
      expect(fs.existsSync(targetDir)).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'earnings'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'models'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'profile.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'key-drivers.md'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'notes.md'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'tracking.md'))).toBe(true);
    });

    it('profile.yaml has correct content with listed=true', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业', industry: '有色金属' });
      const profilePath = path.join(tmpDir, '洛阳钼业', 'profile.yaml');
      const profile = yaml.load(fs.readFileSync(profilePath, 'utf-8')) as Record<string, unknown>;
      expect(profile.stock_code).toBe('603993');
      expect(profile.name).toBe('洛阳钼业');
      expect(profile.industry).toBe('有色金属');
      expect(profile.listed).toBe(true);
      expect(profile.follow_date as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('rejects duplicate name', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      const result = await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('rejects duplicate stock_code with market suffix variant', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '600036', name: '招商银行' });
      const result = await PortfolioTools.executeInitTarget({ stock_code: '600036.SH', name: '招商银行A' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('600036');
    });

    it('rejects names with path separators or reserved chars', async () => {
      for (const bad of ['Foo/Bar', 'Foo\\Bar', 'A:B', 'A*', 'A?', 'A"', 'A<', 'A>', 'A|', '.hidden', '-flag', 'CON']) {
        const r = await PortfolioTools.executeInitTarget({ stock_code: '600000', name: bad });
        expect(r.success).toBe(false);
      }
    });

    it('rejects empty/whitespace-only name', async () => {
      const r1 = await PortfolioTools.executeInitTarget({ stock_code: '600000', name: '' });
      expect(r1.success).toBe(false);
      const r2 = await PortfolioTools.executeInitTarget({ stock_code: '600000', name: '   ' });
      expect(r2.success).toBe(false);
    });
  });

  describe('init_target (unlisted)', () => {
    it('creates target with synthetic stock_code === name when stock_code is empty', async () => {
      const result = await PortfolioTools.executeInitTarget({ stock_code: '', name: '私募基金A' });
      expect(result.success).toBe(true);

      const targetDir = path.join(tmpDir, '私募基金A');
      expect(fs.existsSync(targetDir)).toBe(true);

      const profilePath = path.join(targetDir, 'profile.yaml');
      const profile = yaml.load(fs.readFileSync(profilePath, 'utf-8')) as Record<string, unknown>;
      expect(profile.stock_code).toBe('私募基金A');
      expect(profile.name).toBe('私募基金A');
      expect(profile.listed).toBe(false);
    });

    it('renders unlisted key-drivers as an empty skeleton (no Ctrip boilerplate)', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '', name: '私募基金A' });
      const kdPath = path.join(tmpDir, '私募基金A', 'key-drivers.md');
      const content = fs.readFileSync(kdPath, 'utf-8');
      expect(content).toContain('# 私募基金A - Key Drivers');
      expect(content).not.toMatch(/\(\s*\)/);

      // Standard section anchors expected by downstream reader skills
      expect(content).toContain('## 投资逻辑');
      expect(content).toContain('## 核心跟踪变量');

      // Unlisted-specific sections
      expect(content).toContain('## 单位经济与资金');
      expect(content).toContain('现金跑道');
      expect(content).toContain('## 退出路径与风险');

      // No leaked Ctrip-template content
      expect(content).not.toContain('携程');
      expect(content).not.toContain('take rate');
      expect(content).not.toContain('同程');
    });

    it('renders listed key-drivers as an empty skeleton with 估值参考 section', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      const kdPath = path.join(tmpDir, '洛阳钼业', 'key-drivers.md');
      const content = fs.readFileSync(kdPath, 'utf-8');

      expect(content).toContain('# 洛阳钼业 (603993) - Key Drivers');
      expect(content).toContain('## 投资逻辑');
      expect(content).toContain('## 核心跟踪变量');
      expect(content).toContain('## 估值参考');
      expect(content).toContain('## 风险');

      // Listed variant must not include unlisted-only sections
      expect(content).not.toContain('## 单位经济与资金');
      expect(content).not.toContain('## 退出路径与风险');

      // No leaked Ctrip-template content
      expect(content).not.toContain('携程');
      expect(content).not.toContain('take rate');
      expect(content).not.toContain('同程');
    });

    it('tracking.md includes the usage guidance blockquote', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      const tracking = fs.readFileSync(path.join(tmpDir, '洛阳钼业', 'tracking.md'), 'utf-8');
      expect(tracking).toContain('# 洛阳钼业 (603993) - Marginal Change Tracking');
      expect(tracking).toContain('基本面边际变化');
      expect(tracking).toContain('| Date | Item | Previous | Current | Note |');
    });

    it('notes.md / tracking.md titles drop empty parens for unlisted', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '', name: '私募基金A' });
      const notes = fs.readFileSync(path.join(tmpDir, '私募基金A', 'notes.md'), 'utf-8');
      const tracking = fs.readFileSync(path.join(tmpDir, '私募基金A', 'tracking.md'), 'utf-8');
      expect(notes).toContain('# 私募基金A - Research Notes');
      expect(notes).not.toMatch(/\(\s*\)/);
      expect(tracking).toContain('# 私募基金A - Marginal Change Tracking');
      expect(tracking).not.toMatch(/\(\s*\)/);
    });

    it('rejects unlisted target sharing same name as listed', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      const result = await PortfolioTools.executeInitTarget({ stock_code: '', name: '洛阳钼业' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('allows omitting stock_code entirely (undefined)', async () => {
      const result = await PortfolioTools.executeInitTarget({ name: '某创业公司' } as { name: string });
      expect(result.success).toBe(true);
      const profile = yaml.load(
        fs.readFileSync(path.join(tmpDir, '某创业公司', 'profile.yaml'), 'utf-8'),
      ) as Record<string, unknown>;
      expect(profile.listed).toBe(false);
      expect(profile.stock_code).toBe('某创业公司');
    });
  });

  describe('list_targets', () => {
    it('lists multiple targets with listed flag', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      await PortfolioTools.executeInitTarget({ stock_code: '', name: '私募基金A' });
      const result = await PortfolioTools.executeListTargets();
      expect(result.success).toBe(true);
      const targets = JSON.parse(result.data);
      expect(targets).toHaveLength(2);
      const byName = Object.fromEntries(targets.map((t: { name: string }) => [t.name, t]));
      expect(byName['洛阳钼业'].listed).toBe(true);
      expect(byName['洛阳钼业'].stock_code).toBe('603993');
      expect(byName['私募基金A'].listed).toBe(false);
      expect(byName['私募基金A'].stock_code).toBe('私募基金A');
    });

    it('returns empty array when none', async () => {
      const result = await PortfolioTools.executeListTargets();
      expect(result.success).toBe(true);
      expect(JSON.parse(result.data)).toEqual([]);
    });

    it('defaults legacy profile (no `listed` field) to listed=true', async () => {
      // Simulate a target created under an older version of the tool.
      const legacyDir = path.join(tmpDir, '老标的');
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.writeFileSync(
        path.join(legacyDir, 'profile.yaml'),
        yaml.dump({ stock_code: '600000', name: '老标的', industry: '', follow_date: '2024-01-01', notes: '' }),
        'utf-8',
      );
      const result = await PortfolioTools.executeListTargets();
      const targets = JSON.parse(result.data);
      expect(targets[0].listed).toBe(true);
    });
  });

  describe('findTargetDir / get_target_files', () => {
    it('returns file paths for listed target', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      const result = await PortfolioTools.executeGetTargetFiles({ stock_code: '603993' });
      expect(result.success).toBe(true);
      const files = JSON.parse(result.data) as Array<{ relPath: string }>;
      const rels = files.map((f) => f.relPath);
      expect(rels).toContain('profile.yaml');
      expect(rels).toContain('key-drivers.md');
      expect(rels).toContain('notes.md');
      expect(rels).toContain('tracking.md');
    });

    it('finds unlisted target by name (stock_code === name)', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '', name: '私募基金A' });
      // Lookup with the synthetic placeholder code (== name) succeeds via name match.
      const result = await PortfolioTools.executeGetTargetFiles({ stock_code: '私募基金A', name: '私募基金A' });
      expect(result.success).toBe(true);
    });

    it('finds unlisted target when only stock_code (== name placeholder) is passed', async () => {
      // Matches the renderer\'s deleteTarget(code) call signature, which only
      // forwards `stock_code`. For unlisted targets this equals the name.
      await PortfolioTools.executeInitTarget({ stock_code: '', name: '某创业公司' });
      const result = await PortfolioTools.executeGetTargetFiles({ stock_code: '某创业公司' });
      expect(result.success).toBe(true);
    });

    it('still discovers legacy `${name}_${code}` directories', async () => {
      // Simulate a target created under the old naming scheme.
      const legacyDir = path.join(tmpDir, '老标的_600000');
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.writeFileSync(
        path.join(legacyDir, 'profile.yaml'),
        yaml.dump({ stock_code: '600000', name: '老标的', industry: '', follow_date: '2024-01-01', notes: '' }),
        'utf-8',
      );
      const result = await PortfolioTools.executeGetTargetFiles({ stock_code: '600000' });
      expect(result.success).toBe(true);
    });

    it('fails for missing target', async () => {
      const result = await PortfolioTools.executeGetTargetFiles({ stock_code: '999999' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('get_tracking_status', () => {
    it('returns status array with stock_code and listed flag', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      await PortfolioTools.executeInitTarget({ stock_code: '', name: '私募基金A' });
      const result = await PortfolioTools.executeGetTrackingStatus();
      expect(result.success).toBe(true);
      const statuses = JSON.parse(result.data);
      expect(statuses).toHaveLength(2);
      const byName = Object.fromEntries(statuses.map((s: { name: string }) => [s.name, s]));
      expect(byName['洛阳钼业'].stock_code).toBe('603993');
      expect(byName['洛阳钼业'].listed).toBe(true);
      expect(byName['洛阳钼业']).toHaveProperty('last_tracking_update');
      expect(byName['洛阳钼业']).toHaveProperty('note_lines');
      expect(byName['私募基金A'].listed).toBe(false);
    });
  });

  describe('update_key_drivers', () => {
    it('overwrites key-drivers.md content', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      const newContent = '# New Key Drivers\n\n- Factor A\n- Factor B\n';
      const result = await PortfolioTools.executeUpdateKeyDrivers({ stock_code: '603993', content: newContent });
      expect(result.success).toBe(true);

      const targetDir = path.join(tmpDir, '洛阳钼业');
      const content = fs.readFileSync(path.join(targetDir, 'key-drivers.md'), 'utf-8');
      expect(content).toBe(newContent);
    });
  });

  describe('append_note', () => {
    it('adds timestamped note', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      const result = await PortfolioTools.executeAppendNote({ stock_code: '603993', content: 'First note' });
      expect(result.success).toBe(true);

      const notesPath = path.join(tmpDir, '洛阳钼业', 'notes.md');
      const content = fs.readFileSync(notesPath, 'utf-8');
      expect(content).toContain('First note');
      expect(content).toMatch(/## \d{4}-\d{2}-\d{2}/);
    });

    it('can append multiple notes', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      await PortfolioTools.executeAppendNote({ stock_code: '603993', content: 'Note 1' });
      await PortfolioTools.executeAppendNote({ stock_code: '603993', content: 'Note 2' });

      const notesPath = path.join(tmpDir, '洛阳钼业', 'notes.md');
      const content = fs.readFileSync(notesPath, 'utf-8');
      expect(content).toContain('Note 1');
      expect(content).toContain('Note 2');
    });
  });
});
