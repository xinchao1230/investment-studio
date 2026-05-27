import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { loadJobs } from '../jobLoader';

describe('jobLoader', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads jobs from valid yaml', () => {
    const jobsFile = path.join(tmpDir, 'jobs.yaml');
    fs.writeFileSync(jobsFile, `
jobs:
  - name: daily-research
    skill: research
    target: AAPL
    cron: "0 7 * * *"
`);
    const jobs = loadJobs(jobsFile);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toBe('daily-research');
    expect(jobs[0].skill).toBe('research');
    expect(jobs[0].target).toBe('AAPL');
    expect(jobs[0].cron).toBe('0 7 * * *');
  });

  it('supports multiple targets', () => {
    const jobsFile = path.join(tmpDir, 'jobs.yaml');
    fs.writeFileSync(jobsFile, `
jobs:
  - name: multi-research
    skill: research
    targets:
      - AAPL
      - MSFT
      - GOOG
    cron: "0 8 * * *"
`);
    const jobs = loadJobs(jobsFile);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].targets).toEqual(['AAPL', 'MSFT', 'GOOG']);
  });

  it('returns empty array for missing file', () => {
    const jobs = loadJobs(path.join(tmpDir, 'nonexistent.yaml'));
    expect(jobs).toEqual([]);
  });

  it('returns empty array for malformed yaml', () => {
    const jobsFile = path.join(tmpDir, 'bad.yaml');
    fs.writeFileSync(jobsFile, '{{{{not valid yaml');
    const jobs = loadJobs(jobsFile);
    expect(jobs).toEqual([]);
  });
});
