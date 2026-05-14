import * as fs from 'fs';
import * as path from 'path';

interface SchedulerTrigger {
  skill: string;
  target: string;
  timestamp: string;
  jobName: string;
}

export class SchedulerWatcher {
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    private workspaceDir: string,
    private onTrigger: (trigger: SchedulerTrigger) => void
  ) {}

  start(): void {
    const triggerDir = path.join(this.workspaceDir, '.scheduler', 'triggers');
    fs.mkdirSync(triggerDir, { recursive: true });

    // Poll for trigger files every 5 seconds
    this.intervalId = setInterval(() => {
      try {
        const files = fs.readdirSync(triggerDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          const filePath = path.join(triggerDir, file);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const trigger = JSON.parse(content) as SchedulerTrigger;
            this.onTrigger(trigger);

            // Move to done/
            const doneDir = path.join(triggerDir, 'done');
            fs.mkdirSync(doneDir, { recursive: true });
            fs.renameSync(filePath, path.join(doneDir, file));
          } catch (err) {
            console.error('Failed to process trigger:', file, err);
          }
        }
      } catch {
        // trigger dir may not exist yet
      }
    }, 5000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
