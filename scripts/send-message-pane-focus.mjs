#!/usr/bin/env node

/**
 * PostToolUse Hook: SendMessage Pane Focus
 *
 * When the orchestrator sends a message to a teammate via the SendMessage tool,
 * auto-resize the target teammate's tmux pane to half the terminal height.
 * This highlights the active teammate during orchestration.
 *
 * No-op when:
 * - Not in a tmux environment
 * - Tool is not SendMessage
 * - Recipient has no registered pane_id in team config
 * - Pane is already at target height (±1 line)
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { readStdin } from './lib/stdin.mjs';
import { resolveOmcStateRoot } from './lib/state-root.mjs';

/** Escape a string for safe use in a tmux command argument. */
function tmuxEscape(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Get terminal window height via tmux display-message.
 * Returns 0 if tmux is not available.
 */
function getWindowHeight() {
  try {
    const out = execFileSync('tmux', ['display-message', '-p', '#{window_height}'], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const h = parseInt(out.trim(), 10);
    return Number.isFinite(h) && h > 0 ? h : 0;
  } catch {
    return 0;
  }
}

/**
 * Get current pane height via tmux display-message.
 * Returns 0 on failure.
 */
function getPaneHeight(paneId) {
  try {
    const out = execFileSync('tmux', ['display-message', '-t', paneId, '-p', '#{pane_height}'], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const h = parseInt(out.trim(), 10);
    return Number.isFinite(h) && h > 0 ? h : 0;
  } catch {
    return 0;
  }
}

/**
 * Resize pane to half terminal height. Skips if already at target.
 */
function resizePaneToHalfHeight(paneId) {
  if (!paneId || !paneId.startsWith('%')) return;

  const windowHeight = getWindowHeight();
  if (!windowHeight) return;

  const targetHeight = Math.floor(windowHeight / 2);
  const currentHeight = getPaneHeight(paneId);

  if (currentHeight > 0 && Math.abs(currentHeight - targetHeight) <= 1) return;

  try {
    execFileSync('tmux', ['resize-pane', '-t', paneId, '-y', String(targetHeight)], {
      timeout: 3000,
      stdio: 'ignore',
    });
  } catch {
    // silently ignore
  }
}

/**
 * Find pane_id for a teammate by scanning Claude Code team config directories.
 * Looks in ~/.claude/teams/{team-name}/config.json for a member matching recipientName.
 */
function findPaneIdForTeammate(recipientName) {
  try {
    const home = process.env.HOME || '/tmp';
    const teamsDir = join(home, '.claude', 'teams');
    if (!existsSync(teamsDir)) return null;

    const entries = readdirSync(teamsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const configPath = join(teamsDir, entry.name, 'config.json');
      if (!existsSync(configPath)) continue;

      try {
        const config = JSON.parse(readFileSync(configPath, 'utf-8'));
        const members = Array.isArray(config.members) ? config.members : [];
        const member = members.find(m => m.name === recipientName);
        if (member?.tmuxPaneId) return member.tmuxPaneId;
      } catch {
        // skip malformed config
      }
    }
  } catch {
    // teams dir not found or not readable
  }
  return null;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // Skip if not in tmux
  if (!process.env.TMUX) return;

  const skipHooks = (process.env.OMC_SKIP_HOOKS || '').split(',').map(s => s.trim());
  if (process.env.DISABLE_OMC === '1' || skipHooks.includes('pane-focus')) return;

  try {
    const input = await readStdin();
    const data = JSON.parse(input);

    const toolName = data.tool_name || data.toolName || '';
    if (toolName !== 'SendMessage') return;

    const toolInput = data.tool_input || data.toolInput || {};
    const recipientName = toolInput.to || toolInput.recipient || '';
    if (!recipientName) return;

    const cwd = data.cwd || data.directory || process.cwd();
    const paneId = findPaneIdForTeammate(recipientName);
    if (!paneId) return;

    resizePaneToHalfHeight(paneId);
  } catch {
    // best-effort — never fail the hook
  }

  // Always emit continue signal
  console.log(JSON.stringify({ continue: true }));
}

main();
