/**
 * Stop hook: restore tmux pane height when a session ends.
 *
 * When the orchestrator sends a message to a teammate, send-message-pane-focus.mjs
 * saves the pane height and resizes to half. If the teammate replies via SendMessage,
 * the same hook restores the sender. But if the teammate just goes idle or its
 * session ends without replying, this hook restores the pane height on Stop.
 *
 * The Stop hook fires in the teammate's own process, so TMUX_PANE gives us the
 * correct pane ID. For non-teammate sessions, the save file simply won't exist
 * and this hook is a no-op.
 */

import { readFileSync, unlinkSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { readStdin } from './lib/stdin.mjs';

const TMUX_CMD_TIMEOUT = 3000;

function restorePaneHeight(paneId) {
  const tmpPath = `/tmp/omc-pane-height-${paneId}`;
  if (!existsSync(tmpPath)) return;

  try {
    const height = parseInt(readFileSync(tmpPath, 'utf-8'), 10);
    if (Number.isFinite(height) && height > 0) {
      execFileSync('tmux', ['resize-pane', '-t', paneId, '-y', String(height)], {
        timeout: TMUX_CMD_TIMEOUT,
        stdio: 'ignore',
      });
    }
  } catch {
    // Best-effort only
  } finally {
    try { unlinkSync(tmpPath); } catch {}
  }
}

async function main() {
  if (!process.env.TMUX) {
    console.log(JSON.stringify({ continue: true }));
    return;
  }

  await readStdin();

  // TMUX_PANE is set inside tmux — use it as the pane ID
  const paneId = process.env.TMUX_PANE;
  if (paneId) {
    restorePaneHeight(paneId);
  }

  console.log(JSON.stringify({ continue: true }));
}

main().catch(() => {
  console.log(JSON.stringify({ continue: true }));
});
