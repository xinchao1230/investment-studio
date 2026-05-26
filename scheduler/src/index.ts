import * as cron from 'node-cron';
import * as path from 'path';
import { loadJobs } from './jobLoader';
import { runJob } from './runner';

const args = process.argv.slice(2);
const workspaceDir = args[0] || process.env.INVESTMENT_STUDIO_WORKSPACE || '';
const jobsFile = path.join(workspaceDir, '.scheduler', 'jobs.yaml');

if (!workspaceDir) {
  console.error('Usage: investment-studio-scheduler <workspace-dir>');
  console.error('Or set INVESTMENT_STUDIO_WORKSPACE env var');
  process.exit(1);
}

const MODE = args.includes('--daemon') ? 'daemon' : 'once';

async function main() {
  const jobs = loadJobs(jobsFile);

  if (jobs.length === 0) {
    console.log('No jobs found in', jobsFile);
    return;
  }

  console.log(`Loaded ${jobs.length} job(s) from ${jobsFile}`);

  if (MODE === 'daemon') {
    for (const job of jobs) {
      if (!cron.validate(job.cron)) {
        console.error(`Invalid cron expression for job "${job.name}": ${job.cron}`);
        continue;
      }
      cron.schedule(job.cron, async () => {
        console.log(`[${new Date().toISOString()}] Running job: ${job.name}`);
        const results = await runJob(job, workspaceDir);
        for (const r of results) {
          console.log(`  ${r.success ? '[OK]' : '[FAIL]'} ${r.jobName}: ${r.output || r.error}`);
        }
      });
      console.log(`  Scheduled: ${job.name} (${job.cron})`);
    }
    console.log('Scheduler running in daemon mode. Press Ctrl+C to stop.');
  } else {
    for (const job of jobs) {
      console.log(`Running job: ${job.name}`);
      const results = await runJob(job, workspaceDir);
      for (const r of results) {
        console.log(`  ${r.success ? '[OK]' : '[FAIL]'} ${r.jobName}: ${r.output || r.error}`);
      }
    }
  }
}

main().catch(console.error);
