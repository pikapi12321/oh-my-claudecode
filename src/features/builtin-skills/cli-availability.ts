import { execSync } from 'node:child_process';

export type CliAgentType = 'claude' | 'codex' | 'gemini';

export function isCliAvailable(agentType: CliAgentType): boolean {
  try {
    execSync(`which ${agentType}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
