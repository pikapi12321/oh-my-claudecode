#!/usr/bin/env node

/**
 * PostToolUse Hook: SendMessage Pane Focus
 *
 * When the orchestrator sends a message to a teammate via the SendMessage tool,
 * auto-resize the target teammate's tmux pane to half the terminal height.
 * When a teammate replies (sends to orchestrator), restore their pane to its
 * original height.
 *
 * Flow:
 * - Orchestrator → teammate: save target pane height, resize to half
 * - Teammate → orchestrator: restore sender's pane from saved height
 *
 * No-op when:
 * - Not in a tmux environment
 * - Tool is not SendMessage
 * - Pane is already at target height (±1 line)
 */

import { readFileSync, existsSync, readdirSync, writeFileSync, unlinkSync } from 'fs';
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
 * Get current pane ID via tmux display-message.
 * Returns null on failure.
 */
function getCurrentPaneId() {
  try {
    return execFileSync('tmux', ['display-message', '-p', '#{pane_id}'], {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Save current pane height to a temp file before resizing.
 */
function savePaneHeight(paneId) {
  const height = getPaneHeight(paneId);
  if (height <= 0) return;
  const tmpPath = `/tmp/omc-pane-height-${paneId}`;
  try {
    // Don't overwrite a taller saved height — preserve the original
    if (existsSync(tmpPath)) {
      const saved = parseInt(readFileSync(tmpPath, 'utf-8').trim(), 10);
      if (Number.isFinite(saved) && saved > height) return;
    }
    writeFileSync(tmpPath, String(height), 'utf-8');
  } catch {
    // best-effort
  }
}

/**
 * Restore pane height from temp file. Deletes file after reading.
 * No-op if file doesn't exist or is invalid.
 */
function restorePaneHeight(paneId) {
  const tmpPath = `/tmp/omc-pane-height-${paneId}`;
  if (!existsSync(tmpPath)) return;
  try {
    const height = parseInt(readFileSync(tmpPath, 'utf-8').trim(), 10);
    if (!Number.isFinite(height) || height <= 0) return;
    execFileSync('tmux', ['resize-pane', '-t', paneId, '-y', String(height)], {
      timeout: 3000,
      stdio: 'ignore',
    });
  } catch {
    // best-effort
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
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

    const paneId = findPaneIdForTeammate(recipientName);
    const senderPaneId = getCurrentPaneId();

    if (paneId) {
      // Recipient is a teammate — orchestrator sending to teammate.
      // If pane was previously resized (saved height > current), restore first
      // so we preserve the original height across multiple message round-trips.
      const tmpPath = `/tmp/omc-pane-height-${paneId}`;
      if (existsSync(tmpPath)) {
        try {
          const saved = parseInt(readFileSync(tmpPath, 'utf-8').trim(), 10);
          const current = getPaneHeight(paneId);
          if (Number.isFinite(saved) && saved > current) {
            restorePaneHeight(paneId);
          }
        } catch {}
      }
      savePaneHeight(paneId);
      resizePaneToHalfHeight(paneId);
    } else {
      // Recipient is not a teammate (likely orchestrator/team-lead)
      // This is a teammate replying — restore sender's pane
      if (senderPaneId) restorePaneHeight(senderPaneId);
    }
  } catch {
    // best-effort — never fail the hook
  }

  // Always emit continue signal
  console.log(JSON.stringify({ continue: true }));
}

main();
