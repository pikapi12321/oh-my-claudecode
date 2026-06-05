/**
 * PreToolUse hook: block Agent tool in team mode (unless creating a team member).
 *
 * When a team is active, Agent tool is blocked unless the call includes team_name
 * (i.e., orchestrator creating a team member). All other Agent calls — orchestrator
 * spawning one-shot subagents, teammates spawning subagents — are blocked.
 * Use SendMessage to contact teammates instead.
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

  // Allow Agent with team_name — orchestrator creating a team member
  if (toolInput.team_name) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  // Block — no team_name means one-shot subagent, which is forbidden in team mode
  const description = toolInput.description || '';
  console.log(JSON.stringify({
    decision: 'block',
    reason: `Team is active. Use SendMessage to contact a teammate instead of spawning a subagent (${description}). Agent tool is only allowed with team_name for creating team members.`,
  }));
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true }));
});
