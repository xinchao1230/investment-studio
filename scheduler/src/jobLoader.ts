import * as fs from 'fs';
import * as yaml from 'js-yaml';

export interface Job {
  name: string;
  skill: string;
  target?: string;
  targets?: string[];
  cron: string;
}

interface JobsConfig {
  jobs: Job[];
}

export function loadJobs(filePath: string): Job[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const config = yaml.load(content) as JobsConfig;
    return config?.jobs || [];
  } catch {
    return [];
  }
}
