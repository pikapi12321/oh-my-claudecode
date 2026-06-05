/**
 * PreToolUse hook: warn when orchestrator spawns Agent in team mode.
 *
 * When a team is active, the orchestrator should prefer SendMessage to teammates
 * over spawning one-shot subagents. This hook soft-warns (does not block) when
 * the Agent tool is used while a team config exists.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { readStdin } from './lib/stdin.mjs';

function hasActiveTeam() {
  try {
    const home = process.env.HOME || '/tmp';
    const teamsDir = join(home, '.claude', 'teams');
    if (!existsSync(teamsDir)) return false;

    const entries = readdirSync(teamsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const configPath = join(teamsDir, entry.name, 'config.json');
      if (!existsSync(configPath)) continue;

      try {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        const members = Array.isArray(config.members) ? config.members : [];
        if (members.length > 0) return true;
      } catch {
        // skip malformed config
      }
    }
  } catch {
    // teams dir not found
  }
  return false;
}

async function main() {
  const input = await readStdin();
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const toolName = data.tool_name || data.toolName || '';
  if (toolName !== 'Agent') {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  if (!hasActiveTeam()) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  const toolInput = data.tool_input || data.toolInput || {};
  const description = toolInput.description || '';

  // Warn but don't block — allow legitimate subagent uses (explore, etc.)
  console.log(JSON.stringify({
    continue: true,
    warning: `Team is active. Prefer SendMessage to a teammate over spawning a subagent (${description}). Only use Agent for tasks no teammate covers.`,
  }));
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true }));
});
