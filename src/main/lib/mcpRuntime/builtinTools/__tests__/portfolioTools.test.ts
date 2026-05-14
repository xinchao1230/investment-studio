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

  describe('init_target', () => {
    it('creates all expected files and directories', async () => {
      const result = await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业', industry: '有色金属' });
      expect(result.success).toBe(true);

      const targetDir = path.join(tmpDir, '洛阳钼业_603993');
      expect(fs.existsSync(targetDir)).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'earnings'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'models'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'profile.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'key-drivers.md'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'notes.md'))).toBe(true);
      expect(fs.existsSync(path.join(targetDir, 'tracking.md'))).toBe(true);
    });

    it('profile.yaml has correct content', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业', industry: '有色金属' });
      const profilePath = path.join(tmpDir, '洛阳钼业_603993', 'profile.yaml');
      const profile = yaml.load(fs.readFileSync(profilePath, 'utf-8')) as Record<string, string>;
      expect(profile.stock_code).toBe('603993');
      expect(profile.name).toBe('洛阳钼业');
      expect(profile.industry).toBe('有色金属');
      expect(profile.follow_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('rejects duplicates', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      const result = await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });
  });

  describe('list_targets', () => {
    it('lists multiple targets', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      await PortfolioTools.executeInitTarget({ stock_code: '600519', name: '贵州茅台' });
      const result = await PortfolioTools.executeListTargets();
      expect(result.success).toBe(true);
      const targets = JSON.parse(result.data);
      expect(targets).toHaveLength(2);
      expect(targets.map((t: any) => t.stock_code).sort()).toEqual(['600519', '603993']);
    });

    it('returns empty array when none', async () => {
      const result = await PortfolioTools.executeListTargets();
      expect(result.success).toBe(true);
      expect(JSON.parse(result.data)).toEqual([]);
    });
  });

  describe('get_target_files', () => {
    it('returns file paths', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      const result = await PortfolioTools.executeGetTargetFiles({ stock_code: '603993' });
      expect(result.success).toBe(true);
      const files = JSON.parse(result.data) as string[];
      expect(files).toContain('profile.yaml');
      expect(files).toContain('key-drivers.md');
      expect(files).toContain('notes.md');
      expect(files).toContain('tracking.md');
    });

    it('fails for missing target', async () => {
      const result = await PortfolioTools.executeGetTargetFiles({ stock_code: '999999' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('get_tracking_status', () => {
    it('returns status array with stock_code', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      const result = await PortfolioTools.executeGetTrackingStatus();
      expect(result.success).toBe(true);
      const statuses = JSON.parse(result.data);
      expect(statuses).toHaveLength(1);
      expect(statuses[0].stock_code).toBe('603993');
      expect(statuses[0].name).toBe('洛阳钼业');
      expect(statuses[0]).toHaveProperty('last_tracking_update');
      expect(statuses[0]).toHaveProperty('note_lines');
    });
  });

  describe('update_key_drivers', () => {
    it('overwrites key-drivers.md content', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      const newContent = '# New Key Drivers\n\n- Factor A\n- Factor B\n';
      const result = await PortfolioTools.executeUpdateKeyDrivers({ stock_code: '603993', content: newContent });
      expect(result.success).toBe(true);

      const targetDir = path.join(tmpDir, '洛阳钼业_603993');
      const content = fs.readFileSync(path.join(targetDir, 'key-drivers.md'), 'utf-8');
      expect(content).toBe(newContent);
    });
  });

  describe('append_note', () => {
    it('adds timestamped note', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      const result = await PortfolioTools.executeAppendNote({ stock_code: '603993', content: 'First note' });
      expect(result.success).toBe(true);

      const notesPath = path.join(tmpDir, '洛阳钼业_603993', 'notes.md');
      const content = fs.readFileSync(notesPath, 'utf-8');
      expect(content).toContain('First note');
      expect(content).toMatch(/## \d{4}-\d{2}-\d{2}/);
    });

    it('can append multiple notes', async () => {
      await PortfolioTools.executeInitTarget({ stock_code: '603993', name: '洛阳钼业' });
      await PortfolioTools.executeAppendNote({ stock_code: '603993', content: 'Note 1' });
      await PortfolioTools.executeAppendNote({ stock_code: '603993', content: 'Note 2' });

      const notesPath = path.join(tmpDir, '洛阳钼业_603993', 'notes.md');
      const content = fs.readFileSync(notesPath, 'utf-8');
      expect(content).toContain('Note 1');
      expect(content).toContain('Note 2');
    });
  });
});
