import * as path from 'path';
import { PROFILE_DIR_NAME } from '../userDataADO/pathUtils';

export interface DebugInfoEntry {
  sourcePath: string;
  zipPath: string;
}

export function getDebugInfoEntries(
  userDataPath: string,
  crashDumpsPath: string,
  currentUserAlias: string | null,
): DebugInfoEntry[] {
  const entries: DebugInfoEntry[] = [
    {
      sourcePath: path.join(userDataPath, 'logs'),
      zipPath: 'logs',
    },
    {
      sourcePath: path.join(userDataPath, 'state', 'current-run.json'),
      zipPath: path.join('state', 'current-run.json'),
    },
    {
      sourcePath: path.join(userDataPath, 'crashes'),
      zipPath: 'crashes',
    },
    {
      sourcePath: crashDumpsPath,
      zipPath: 'crashDumps',
    },
  ];

  if (currentUserAlias) {
    entries.push({
      sourcePath: path.join(userDataPath, 'profiles', PROFILE_DIR_NAME, 'schedules'),
      zipPath: path.join('profiles', '<REDACTED_ALIAS>', 'schedules'),
    });
  }

  return entries;
}