import * as fs from 'fs';
import * as path from 'path';

export interface RunResult {
  jobName: string;
  success: boolean;
  output?: string;
  error?: string;
}

export async function runJob(job: { name: string; skill: string; target?: string; targets?: string[] }, workspaceDir: string): Promise<RunResult[]> {
  const targets = job.targets || (job.target ? [job.target] : []);
  const results: RunResult[] = [];

  for (const target of targets) {
    try {
      const triggerDir = path.join(workspaceDir, '.scheduler', 'triggers');
      fs.mkdirSync(triggerDir, { recursive: true });

      const trigger = {
        skill: job.skill,
        target,
        timestamp: new Date().toISOString(),
        jobName: job.name,
      };

      const triggerFile = path.join(triggerDir, `${job.skill}-${target}-${Date.now()}.json`);
      fs.writeFileSync(triggerFile, JSON.stringify(trigger, null, 2));

      try {
        const notifier = require('node-notifier');
        notifier.notify({ title: 'Investment Studio', message: `Running ${job.skill} for ${target}` });
      } catch {
        // notification optional
      }

      results.push({ jobName: job.name, success: true, output: `Trigger created: ${triggerFile}` });
    } catch (err: any) {
      results.push({ jobName: job.name, success: false, error: err.message });
    }
  }

  return results;
}
