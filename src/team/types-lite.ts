// src/team/types-lite.ts

/**
 * Lightweight type definitions for team worker lifecycle.
 *
 * Standalone types extracted from the deleted types.ts — no imports from
 * deleted modules (contracts, phase-controller, leader-nudge-guidance).
 * Used by worker-restart.ts, heartbeat.ts, and worker-spawn.ts.
 */

/** Bridge daemon configuration — passed via --config file to bridge-entry.ts */
export interface BridgeConfig {
  teamName: string;
  workerName: string;
  provider: 'codex' | 'gemini';
  model?: string;
  workingDirectory: string;
  pollIntervalMs: number;       // default: 3000
  taskTimeoutMs: number;        // default: 600000 (10 min)
  maxConsecutiveErrors: number;  // default: 3 — self-quarantine threshold
  outboxMaxLines: number;       // default: 500 — rotation trigger
  maxRetries?: number;          // default: 5 — max task retry attempts
  permissionEnforcement?: 'off' | 'audit' | 'enforce'; // default: 'off'
  permissions?: BridgeWorkerPermissions;
}

/** Permission scoping embedded in BridgeConfig (mirrors WorkerPermissions shape) */
export interface BridgeWorkerPermissions {
  allowedPaths: string[];   // glob patterns relative to workingDirectory
  deniedPaths: string[];    // glob patterns that override allowed
  allowedCommands: string[]; // command prefixes (e.g., 'npm test', 'tsc')
  maxFileSize: number;      // max bytes per file write
}

export interface McpWorkerMember {
  agentId: string;          // "{workerName}@{teamName}"
  name: string;             // workerName
  agentType: string;        // "mcp-codex" | "mcp-gemini"
  model: string;
  joinedAt: number;         // Date.now()
  tmuxPaneId: string;       // tmux session name
  cwd: string;
  backendType: 'tmux';
  subscriptions: string[];
}

/** Heartbeat file content */
export interface HeartbeatData {
  workerName: string;
  teamName: string;
  provider: 'codex' | 'gemini' | 'claude';
  pid: number;
  lastPollAt: string;       // ISO timestamp of last poll cycle
  currentTaskId?: string;   // task being executed, if any
  consecutiveErrors: number;
  status: 'ready' | 'polling' | 'executing' | 'shutdown' | 'quarantined';
}
