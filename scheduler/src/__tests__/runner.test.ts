import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runJob } from '../runner';

describe('runner', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-runner-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates trigger file in correct location', async () => {
    const results = await runJob(
      { name: 'test-job', skill: 'research', target: 'AAPL' },
      tmpDir
    );

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);

    const triggerDir = path.join(tmpDir, '.scheduler', 'triggers');
    const files = fs.readdirSync(triggerDir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^research-AAPL-\d+\.json$/);

    const content = JSON.parse(fs.readFileSync(path.join(triggerDir, files[0]), 'utf-8'));
    expect(content.skill).toBe('research');
    expect(content.target).toBe('AAPL');
    expect(content.jobName).toBe('test-job');
  });

  it('handles multiple targets', async () => {
    const results = await runJob(
      { name: 'multi-job', skill: 'analysis', targets: ['AAPL', 'MSFT'] },
      tmpDir
    );

    expect(results).toHaveLength(2);
    expect(results.every(r => r.success)).toBe(true);

    const triggerDir = path.join(tmpDir, '.scheduler', 'triggers');
    const files = fs.readdirSync(triggerDir);
    expect(files.length).toBe(2);
  });

  it('returns success results', async () => {
    const results = await runJob(
      { name: 'success-job', skill: 'scan', target: 'SPY' },
      tmpDir
    );

    expect(results).toHaveLength(1);
    expect(results[0].jobName).toBe('success-job');
    expect(results[0].success).toBe(true);
    expect(results[0].output).toContain('Trigger created:');
  });
});
