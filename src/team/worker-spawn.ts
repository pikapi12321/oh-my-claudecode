// src/team/worker-spawn.ts

/**
 * Worker spawn orchestration for team auto-resume.
 *
 * Clean replacement for the deleted scaling.ts spawn logic. Reads config.json,
 * creates tmux panes via modern tmux-session APIs, builds CLI argv via
 * model-contract, spawns with --resume or --session-id, bootstraps the worker
 * overlay, and manages backoff/restart state.
 */

import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';
import {
  sanitizeName,
  createTeamSession,
  isWorkerAlive,
  spawnWorkerInPane,
  type WorkerPaneConfig,
} from './tmux-session.js';
import {
  type CliAgentType,
  buildWorkerArgv,
  type WorkerLaunchConfig,
} from './model-contract.js';
import {
  composeInitialInbox,
  ensureWorkerStateDir,
  writeWorkerOverlay,
  generateTriggerMessage,
} from './worker-bootstrap.js';
import type { WorkerBootstrapParams } from './worker-bootstrap.js';
import { shouldRestart, recordRestart, clearRestartState } from './worker-restart.js';
import { writeHeartbeat } from './heartbeat.js';
import { atomicWriteJson, validateResolvedPath } from './fs-utils.js';

/** Minimal shape of a worker entry in config.json */
export interface WorkerInfo {
  name: string;
  agentType: string;
  model?: string;
  pane_id?: string;
  session_id?: string;
  status?: string;
  role?: string;
  worktree_path?: string;
}

/** Minimal shape of team config.json */
export interface TeamConfig {
  team_name: string;
  working_directory: string;
  leader_session_id?: string;
  workers: WorkerInfo[];
  max_workers?: number;
  next_worker_index?: number;
  team_state_root?: string;
}

/** Read team config.json from the standard location. */
export function readTeamConfig(teamName: string, cwd: string): TeamConfig | null {
  const sanitized = sanitizeName(teamName);
  const configPath = join(cwd, '.claude', 'teams', sanitized, 'config.json');
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as TeamConfig;
  } catch {
    return null;
  }
}

/** Save team config.json back to disk. */
export function saveTeamConfig(config: TeamConfig, cwd: string): void {
  const sanitized = sanitizeName(config.team_name);
  const configPath = join(cwd, '.claude', 'teams', sanitized, 'config.json');
  atomicWriteJson(configPath, config);
}

/** Resolve a worker's agent type string to a CliAgentType. */
function asCliAgentType(agentType: string): CliAgentType {
  const lower = agentType.toLowerCase();
  if (lower === 'claude' || lower === 'codex' || lower === 'gemini' || lower === 'cursor') {
    return lower;
  }
  return 'claude';
}

export interface SpawnWorkerResult {
  ok: boolean;
  workerName: string;
  sessionId?: string;
  paneId?: string;
  error?: string;
}

/**
 * Spawn or resume a single worker.
 *
 * If the worker has a stored pane_id and that pane is still alive,
 * this is a no-op (worker is already running). Otherwise creates a fresh
 * tmux session and spawns the worker CLI.
 */
export async function spawnWorker(
  config: TeamConfig,
  worker: WorkerInfo,
  tasks: Array<{ id: string; subject: string; description: string }>,
  opts: { systemPrompt?: string } = {},
): Promise<SpawnWorkerResult> {
  const cwd = resolve(config.working_directory);
  const teamName = sanitizeName(config.team_name);
  const workerName = sanitizeName(worker.name);
  const agentType = asCliAgentType(worker.agentType);

  // Check if existing pane is still alive — resume, don't respawn.
  if (worker.pane_id) {
    const alive = await isWorkerAlive(worker.pane_id);
    if (alive) {
      clearRestartState(cwd, teamName, workerName);
      return { ok: true, workerName, paneId: worker.pane_id };
    }
    // Pane is dead — fall through to respawn.
  }

  // Check restart backoff before spawning.
  const cooldownMs = shouldRestart(cwd, teamName, workerName);
  if (cooldownMs !== null && cooldownMs > 0) {
    return {
      ok: false,
      workerName,
      error: `Worker ${workerName} in backoff cooldown (${cooldownMs}ms remaining)`,
    };
  }

  // Create team session (split-pane or detached).
  const session = await createTeamSession(teamName, 1, cwd);
  const paneId = session.workerPaneIds[0] ?? session.leaderPaneId;

  // Generate session ID for this spawn.
  const sessionId = randomUUID();

  // Build CLI args.
  const extraFlags: string[] = [];
  if (worker.session_id) {
    extraFlags.push('--resume', worker.session_id);
  } else {
    extraFlags.push('--session-id', sessionId);
  }

  const launchConfig: WorkerLaunchConfig = {
    teamName: config.team_name,
    workerName: worker.name,
    model: worker.model,
    cwd,
    extraFlags,
    systemPrompt: opts.systemPrompt,
  };

  const argv = buildWorkerArgv(agentType, launchConfig);

  // Prepare worker state directory and overlay.
  const stateRoot = config.team_state_root ?? join(cwd, '.omc', 'state', 'team', teamName);
  await ensureWorkerStateDir(config.team_name, worker.name, cwd);

  const bootstrapParams: WorkerBootstrapParams = {
    teamName: config.team_name,
    workerName: worker.name,
    agentType,
    tasks,
    cwd,
    instructionStateRoot: stateRoot,
  };

  await writeWorkerOverlay(bootstrapParams);
  const triggerMsg = generateTriggerMessage(config.team_name, worker.name, stateRoot);
  await composeInitialInbox(config.team_name, worker.name, triggerMsg, cwd);

  // Write initial heartbeat.
  writeHeartbeat(cwd, {
    workerName,
    teamName,
    provider: agentType === 'codex' ? 'codex' : agentType === 'gemini' ? 'gemini' : 'claude',
    pid: 0,
    lastPollAt: new Date().toISOString(),
    currentTaskId: undefined,
    consecutiveErrors: 0,
    status: 'ready',
  });

  // Update worker info in config.
  worker.pane_id = paneId;
  worker.session_id = sessionId;
  worker.status = 'spawning';

  // Launch CLI in pane via safe spawnWorkerInPane (handles escaping).
  const binary = argv[0] ?? 'claude';
  const args = argv.slice(1);
  const paneConfig: WorkerPaneConfig = {
    teamName: config.team_name,
    workerName: worker.name,
    envVars: {},
    launchBinary: binary,
    launchArgs: args,
    cwd,
  };
  await spawnWorkerInPane(session.sessionName, paneId, paneConfig);

  return { ok: true, workerName, sessionId, paneId };
}

/**
 * Spawn or resume all workers for a team. Reads config.json, checks liveness,
 * and spawns dead workers. Returns results for each worker.
 */
export async function spawnTeamWorkers(
  teamName: string,
  cwd: string,
  tasks: Array<{ id: string; subject: string; description: string }> = [],
  opts: { systemPrompt?: string } = {},
): Promise<SpawnWorkerResult[]> {
  // Validate working_directory against itself (ensures no traversal).
  const resolvedCwd = resolve(cwd);
  validateResolvedPath(resolvedCwd, resolvedCwd);

  const config = readTeamConfig(teamName, resolvedCwd);
  if (!config) {
    return [{ ok: false, workerName: '*', error: `Team ${teamName} not found` }];
  }

  // Validate the config's working_directory too.
  const configCwd = resolve(config.working_directory);
  validateResolvedPath(configCwd, configCwd);

  const results: SpawnWorkerResult[] = [];
  for (const worker of config.workers) {
    const result = await spawnWorker(config, worker, tasks, opts);
    results.push(result);

    // Record restart on failure.
    if (!result.ok) {
      recordRestart(resolvedCwd, teamName, sanitizeName(worker.name));
    }
  }

  // Save updated config (pane IDs, session IDs).
  saveTeamConfig(config, resolvedCwd);

  return results;
}
