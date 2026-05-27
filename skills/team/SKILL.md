---
name: team
description: N coordinated agents on shared task list using Claude Code native teams
argument-hint: "[N:agent-type] [ralph] [--no-tests] [--no-review] [--no-commit] [--from=<stage>] <task description>"
aliases: []
level: 4
---

# Team Orchestrator

Spawn N agents on a shared task list through a staged pipeline. Uses Claude Code native team tools. Replaces legacy `/swarm` (removed in #1131).

<Usage>

```
/oh-my-claudecode:team N:agent-type "task description"
/oh-my-claudecode:team "task description"
/oh-my-claudecode:team ralph "task description"
```

### Parameters

- **N** — Agent count (1–20). Optional; auto-size from task decomposition.
- **agent-type** — OMC agent for `team-exec` stage workers (executor, debugger, designer, codex, gemini). Optional; defaults to stage-aware routing. `codex`/`gemini` spawn CLI workers (CLI must be installed).
- **task** — High-level task description.
- **ralph** — Wrap pipeline in Ralph persistence loop (retry on fail, architect verify before done).
- **--no-tests** — Skip test track entirely. Default: auto-detect from task type.
- **--no-review** — Skip `team-review` stage. Default: run code review after exec.
- **--no-commit** — Skip auto git commit. Default: conventional commit after pipeline completes.
- **--from=\<stage\>** — Resume from a specific stage (`plan`, `exec`, `review`, `testcode`, `testrun`, `triage`).

### Examples

```bash
/team 5:executor "fix all TypeScript errors across the project"
/team 3:debugger "fix build errors in src/"
/team 4:designer "implement responsive layouts for all page components"
/team "refactor the auth module with security review"
/team ralph "build a complete REST API for user management"
/team 2:codex "review architecture and suggest improvements"
/team 2:gemini "redesign the UI components"
```

</Usage>

<Pipeline>

```
[/team "task"]
       │
       ▼
  [team-plan]       planner + architect → spec + interfaces + task graph
  Decides: tester track? (auto: yes for features/bugfixes, no for docs/config)
       │
  ┌────┴────────────────────────────────────────────────┐
  │ feature track                                       │ test track (parallel)
  │ (implements interfaces.md contracts)                │ (tests interfaces.md contracts)
  ▼                                                     ▼
[team-exec]                                       [team-testplan]
executor workers in isolated                      test-engineer writes test plan
worktrees → exec handoffs                         from spec + interfaces — no code
       │                                        │
  ─────────────────────────────────────────────┘
                    ▼
             [team-review]         tier-based model selection
             reviews feature diff + test plan together
                │           │
             APPROVE      ITERATE ──► re-spawn executor → back to [team-exec]
                │
                ▼
          [team-testcode]
          test-engineer branches from feature branch
          writes test code → lightweight review
                │
                ▼
          [team-testrun]
          run test suite
             │        │
           PASS      FAIL
             │        │
             │        ▼
             │   [team-triage]
             │   diagnose: feature bug OR test bug
             │   ├── feature bug → re-exec → re-review → testrun
             │   └── test bug   → tester fixes → testrun
             ▼
        [team-commit]
        merge feature branch, then test branch
        clean up both worktrees
```

Flags collapse stages:
- `--no-tests`: skip `team-testplan`, `team-testcode`, `team-testrun`, `team-triage`
- `--no-review`: skip `team-review` stage. If tester track is ON, proceed straight to `team-testcode` after exec (feature interface considered stable without explicit approval). If tester track is OFF, proceed straight to `team-commit`.
- `--no-commit`: stop after review/testrun, no merge

</Pipeline>

<Orchestrator_Responsibilities>

The orchestrator (this skill, running as lead) is the ONLY session that calls:
- `TeamCreate` / `TeamDelete`
- `TaskCreate` / `TaskUpdate`
- `Task` (spawn sub-agent workers)

Sub-skills (`team-plan`, `team-exec`, etc.) define the logic for each stage. The orchestrator injects sub-skill content into agent prompts — sub-skills do NOT call team tools themselves.

### Startup sequence

1. Parse input: extract N, agent-type, task, flags.
2. Check `state_read(mode="team")`. If `active=true` and `current_phase` is non-terminal, resume from that stage.
3. Call `TeamCreate` → become `team-lead@{team_name}`.
4. Write initial state (see State Schema).
5. Run `team-plan` stage (inject `skills/team-plan/SKILL.md` content into planner agent prompt).
6. Progress through pipeline stages, writing state on each transition.
7. On completion: shutdown teammates → `TeamDelete` → `state_clear(mode="team")`.

### Stage dispatch

| Stage | Sub-skill injected | Agents spawned by lead |
|---|---|---|
| team-plan | `team-plan/SKILL.md` | explore (haiku), planner (opus), optional analyst/architect |
| team-exec | `team-exec/SKILL.md` | executor workers per task |
| team-testplan | `team-testplan/SKILL.md` | test-engineer (sonnet) |
| team-review | `team-review/SKILL.md` | code-reviewer (tier-selected) |
| team-testcode | `team-testcode/SKILL.md` | test-engineer (sonnet) |
| team-testrun | `team-testrun/SKILL.md` | lead inline |
| team-triage | `team-triage/SKILL.md` | code-reviewer (sonnet) |
| team-commit | inline | none |

</Orchestrator_Responsibilities>

<State_Schema>

Write on every stage transition via `state_write(mode="team", ...)`. All values transported as strings — coerce on read.

```
state_write(mode="team", active=true, current_phase="team-plan", state={
  "team_name":          "fix-ts-errors",
  "agent_count":        "3",
  "agent_types":        "executor",
  "task":               "fix all TypeScript errors",
  "fix_loop_count":     "0",
  "max_fix_loops":      "3",
  "review_loop_count":  "0",
  "max_review_loops":   "3",
  "triage_loop_count":  "0",
  "max_triage_loops":   "3",
  "tester_track":       "true",
  "test_phase":         "testplan",
  "feature_branch":     "omc-team/fix-ts-errors/worker-1",
  "skip_review":        "false",
  "skip_commit":        "false",
  "skip_tests":         "false",
  "linked_ralph":       "false",
  "stage_history":      "team-plan:2026-01-01T12:00:00Z"
})
```

| Field | Type | Description |
|---|---|---|
| `active` | boolean | Team mode active |
| `current_phase` | string | Current pipeline stage name |
| `team_name` | string | Slug derived from task description |
| `agent_count` | number | Worker count |
| `agent_types` | string | Comma-separated exec worker types |
| `task` | string | Original task description |
| `fix_loop_count` | number | Current exec/fix iteration |
| `max_fix_loops` | number | Max fix iterations (default: 3) |
| `review_loop_count` | number | Current review/revise iterations |
| `max_review_loops` | number | Max review iterations (default: 3) |
| `triage_loop_count` | number | Current triage iterations |
| `max_triage_loops` | number | Max triage loops (default: 3) |
| `tester_track` | boolean | Test track active |
| `test_phase` | string | `testplan` \| `testcode` \| `testrun` \| `done` |
| `feature_branch` | string | Feature branch name (for tester to branch from) |
| `skip_review` | boolean | `--no-review` passed |
| `skip_commit` | boolean | `--no-commit` passed |
| `skip_tests` | boolean | `--no-tests` passed |
| `linked_ralph` | boolean | Wrapped in Ralph loop |
| `stage_history` | string | Comma-separated `stage:timestamp` entries |

Terminal phases: `complete`, `failed`, `cancelled`.

</State_Schema>

<Stage_Handoff_Convention>

Each completing stage writes a handoff doc BEFORE transition.

**Location:** `.omc/handoffs/<stage-name>.md`

**Format:**
```markdown
## Handoff: <current-stage> → <next-stage>

- **Decided**: [key decisions made in this stage]
- **Rejected**: [alternatives considered and why]
- **Risks**: [identified risks for the next stage]
- **Files**: [key files created or modified]
- **Remaining**: [items left for next stage]
```

Rules:
1. Lead reads previous handoff BEFORE spawning next stage agents. Handoff content is included in the agent spawn prompt.
2. Handoffs accumulate — later stages can read all prior handoffs.
3. Handoffs survive `TeamDelete` and `cancel` — preserved for resume.
4. 10–20 lines max. Decisions + rationale, not full specs (those live in deliverable files).

</Stage_Handoff_Convention>

<Stop_Conditions>

### Exec/fix loop
Continue `team-exec → team-review → team-exec` until:
1. `team-review` returns `APPROVE`, OR
2. `fix_loop_count` reaches `max_fix_loops` → terminal `failed`.

### Triage loop
Continue `team-triage → [re-exec or re-test] → team-testrun` until:
1. Tests pass, OR
2. `triage_loop_count` reaches `max_triage_loops` → terminal `failed`.

### Review loop (within team-review)
See `team-review/SKILL.md`. Max `max_review_loops` revise iterations before accepting best version.

</Stop_Conditions>

<Resume_And_Cancel>

### Resume
On startup, check `state_read(mode="team")`. If `active=true` + `current_phase` non-terminal:
1. Re-join existing team (TeamCreate will detect conflict — skip if team exists).
2. Call `TaskList` to determine current progress.
3. Read `.omc/handoffs/` to recover context.
4. Resume from `current_phase`.

### Cancel
`/oh-my-claudecode:cancel` handles cleanup:
1. `state_read(mode="team")` → get `team_name`, `linked_ralph`.
2. Send `shutdown_request` to all active teammates (from `config.json` members).
3. Wait for `shutdown_response` per member (15s timeout).
4. `TeamDelete`.
5. `state_clear(mode="team")`.
6. If `linked_ralph`: `state_clear(mode="ralph")`.

Handoffs in `.omc/handoffs/` are preserved for potential resume.

</Resume_And_Cancel>

<Worker_Preamble>

Include in every spawned worker prompt. Adapt per worker with specific task assignments and worktree path.

```
You are a TEAM WORKER in team "{team_name}". Your name is "{worker_name}".
You report to the team lead ("team-lead").
You are NOT the leader — never perform orchestration actions.

== WORK PROTOCOL ==

1. CLAIM: TaskList → find your assigned pending tasks (owner="{worker_name}").
   TaskUpdate: {"taskId": "ID", "status": "in_progress", "owner": "{worker_name}"}

2. WORK: Execute using Read, Write, Edit, Bash, LSP, MCP tools.
   Do NOT use Task tool to spawn sub-agents.
   Do NOT invoke team/ralph/autopilot/ultrawork skills.

3. COMPLETE: TaskUpdate: {"taskId": "ID", "status": "completed"}

4. REPORT: SendMessage to team-lead:
   {"type": "message", "recipient": "team-lead",
    "content": "Completed task #ID: <summary>", "summary": "Task #ID complete"}

5. NEXT: Check TaskList for more assigned tasks. If none:
   SendMessage: {"type": "message", "recipient": "team-lead",
    "content": "All assigned tasks complete. Standing by.", "summary": "All tasks done"}

6. SHUTDOWN: On shutdown_request, extract `request_id` and echo back:
   {"type": "shutdown_response",
    "request_id": "<exact request_id from shutdown_request>", "approve": true}

== BLOCKED TASKS ==
Skip tasks with unresolved blockedBy. Poll TaskList periodically.

== ERRORS ==
{"type": "message", "recipient": "team-lead",
 "content": "FAILED task #ID: <reason>", "summary": "Task #ID failed"}
Do NOT mark failed task as completed.

== RULES ==
- NEVER use Task tool or spawn sub-agents
- NEVER run tmux orchestration commands
- NEVER run team/ralph/autopilot/ultrawork skills
- NEVER fabricate request_id — extract from incoming shutdown_request
- ALWAYS use absolute paths within assigned workingDirectory
- NEVER read/write outside assigned worktree — coordinate via SendMessage
- ALWAYS report via SendMessage to "team-lead"
- SendMessage type "message" only — never "broadcast"
```

</Worker_Preamble>

<Shutdown_Protocol>

**CRITICAL: Execute in exact order. Never TeamDelete before all teammates confirm.**

1. `TaskList` — verify all real tasks (non-internal) are complete or failed.
2. Send `shutdown_request` to each active teammate:
   ```json
   {"type": "shutdown_request", "recipient": "worker-1",
    "content": "All work complete, shutting down team"}
   ```
3. Wait up to 30s per teammate for `shutdown_response`. Log warning on timeout, continue.
4. `TeamDelete` — only after all teammates confirm or timeout.
5. Orphan scan (best-effort, requires `CLAUDE_PLUGIN_ROOT`):
   ```bash
   if [ -n "${CLAUDE_PLUGIN_ROOT}" ]; then
     node "${CLAUDE_PLUGIN_ROOT}/scripts/cleanup-orphans.mjs" --team-name {team_name}
   fi
   ```
6. `state_clear(mode="team")`.

`request_id` in shutdown_request must be extracted and echoed back by workers verbatim. Fabricated IDs cause silent shutdown failure.

</Shutdown_Protocol>

<Git_Worktree_Integration>

Workers operate in isolated git worktrees to prevent file conflicts.

**Before spawning each worker:**
Call `createWorkerWorktree(teamName, workerName, repoRoot)` → creates `.omc/worktrees/{team}/{worker}` on branch `omc-team/{teamName}/{workerName}`.

Pass resulting path as `workingDirectory` in spawn call.

**After all workers complete:**
`mergeAllWorkerBranches(teamName, repoRoot, baseBranch?)` or merge individually.

**API reference:**

| Function | Description |
|---|---|
| `createWorkerWorktree(teamName, workerName, repoRoot, baseBranch?)` | Create isolated worktree |
| `removeWorkerWorktree(teamName, workerName, repoRoot)` | Remove worktree + branch |
| `listTeamWorktrees(teamName, repoRoot)` | List all team worktrees |
| `cleanupTeamWorktrees(teamName, repoRoot)` | Remove all team worktrees |
| `checkMergeConflicts(workerBranch, baseBranch, repoRoot)` | Non-destructive conflict check |
| `mergeWorkerBranch(workerBranch, baseBranch, repoRoot)` | Merge worker branch (--no-ff) |
| `mergeAllWorkerBranches(teamName, repoRoot, baseBranch?)` | Merge all completed workers |

Notes:
- Worktrees are NOT cleaned on individual worker shutdown — only on team shutdown.
- Branch names sanitized via `sanitizeName()` to prevent injection.
- All paths validated against directory traversal.

</Git_Worktree_Integration>

<Per_Role_Routing>

> Scope: `/team` only. Two routing systems coexist by design.

Declare provider + model per canonical role. Resolved once at team creation, stored in `TeamConfig.resolved_routing` — stable for team lifetime.

```jsonc
// .claude/omc.jsonc
{
  "team": {
    "roleRouting": {
      "orchestrator":   { "model": "inherit" },
      "planner":        { "provider": "claude", "model": "HIGH" },
      "analyst":        { "provider": "claude", "model": "HIGH" },
      "executor":       { "provider": "claude", "model": "MEDIUM" },
      "critic":         { "provider": "codex" },
      "code-reviewer":  { "provider": "gemini" },
      "test-engineer":  { "provider": "gemini", "model": "MEDIUM" }
    }
  }
}
```

**Canonical roles:** `orchestrator`, `planner`, `analyst`, `architect`, `executor`, `debugger`, `critic`, `code-reviewer`, `security-reviewer`, `test-engineer`, `designer`, `writer`, `code-simplifier`, `explore`, `document-specialist`.

**Aliases** normalize via `normalizeDelegationRole()`: `reviewer` → `code-reviewer`, `quality-reviewer` → `code-reviewer`, `harsh-critic` → `critic`, `build-fixer` → `debugger`. Unknown roles fail at parse time.

**Spec fields (`TeamRoleAssignmentSpec`):**
- `provider` — `"claude" | "codex" | "gemini"`. Omit → `claude`.
- `model` — `"HIGH" | "MEDIUM" | "LOW"` or explicit model ID.
- `agent` — optional Claude agent name. Only honored when provider is `claude`.

`orchestrator` pinned to `claude`; only `model` is user-configurable.

**Env override:**
```bash
OMC_TEAM_ROLE_OVERRIDES='{"critic":{"provider":"codex"},"code-reviewer":{"provider":"gemini"}}'
```

Precedence: env > project config > user config > built-in defaults.

Invalid JSON in env var → emit visible `SendMessage` warning, ignore override, continue. Never abort silently.

**CLI missing fallback:** If configured CLI not in PATH, emit visible warning, fall back to Claude with same tier/agent. Fallback loud by design.

**Zero-config:** Empty `roleRouting` → all workers are Claude, tiers from `routing.tierModels`.

</Per_Role_Routing>

<Configuration>

Optional settings in `.claude/omc.jsonc` (project) or `~/.config/claude-omc/config.jsonc` (user). Project overrides user; env `OMC_TEAM_ROLE_OVERRIDES` supersedes both.

```jsonc
{
  "team": {
    "ops": {
      "maxAgents":          20,
      "defaultAgentType":   "claude",
      "monitorIntervalMs":  30000,
      "shutdownTimeoutMs":  15000,
      "maxFixLoops":        3,
      "maxReviewLoops":     3,
      "maxTriageLoops":     3,
      "enableTestTrack":    "auto"  // "auto" | "always" | "never"
    }
  }
}
```

- **maxAgents** — Max teammates (default: 20)
- **defaultAgentType** — CLI provider when not specified (default: `claude`)
- **monitorIntervalMs** — TaskList poll interval (default: 30s)
- **shutdownTimeoutMs** — Shutdown response wait per member (default: 15s)
- **maxFixLoops** — Max exec/fix iterations before `failed` (default: 3)
- **maxReviewLoops** — Max review/revise iterations before accepting best version (default: 3)
- **maxTriageLoops** — Max triage iterations before `failed` (default: 3)
- **enableTestTrack** — `"auto"`: detect from task type; `"always"`: force on; `"never"`: force off

</Configuration>

<Team_Ralph_Composition>

Activate when user invokes `/team ralph "task"` or both keywords detected.

**State linkage:**
```
state_write(mode="team", ..., state={"linked_ralph": "true"})
state_write(mode="ralph", ..., state={"linked_team": "true", "team_name": "..."})
```

**Execution flow:**
1. Ralph outer loop starts (iteration 1).
2. Team pipeline runs: `team-plan → team-exec → team-review`.
3. If `team-review` APPROVE: Ralph runs architect verification (STANDARD tier min).
4. If architect approves: both modes complete, run `/oh-my-claudecode:cancel`.
5. If review ITERATE or architect rejects: re-enter exec, loop.
6. If fix loop exceeds `max_fix_loops`: Ralph increments iteration + retries full pipeline.
7. If Ralph exceeds `max_iterations`: terminal `failed`.

**Cancellation:** Cancel either mode cancels both. Cancel Ralph → cancel team first (graceful shutdown), then clear Ralph. Cancel team → clear team, mark Ralph cancelled.

</Team_Ralph_Composition>

<Gotchas>

1. **Internal tasks pollute TaskList** — Auto-created per teammate with `metadata._internal: true`. Filter when counting real task progress.
2. **No atomic claiming** — Lead pre-assigns owners via `TaskUpdate(taskId, owner)` before spawning. Workers only work on tasks assigned to them.
3. **Task IDs are strings** — Auto-increment strings ("1", "2", "3"). Always pass string values.
4. **TeamDelete requires empty team** — All teammates must shut down first. Lead is excluded from check.
5. **Messages auto-deliver** — Teammate messages arrive as new conversation turns. No polling needed for inbound.
6. **Teammate prompt in config** — Full prompt stored in `config.json`. Do not put secrets in teammate prompts.
7. **Members auto-remove on shutdown** — After shutdown_response + terminate, auto-removed from config.
8. **shutdown_response needs request_id** — Extract from incoming shutdown_request JSON. Fabricated IDs cause silent failure.
9. **Team name must be valid slug** — Lowercase letters, numbers, hyphens. Derive from task description.
10. **Broadcast expensive** — Sends separate message to every teammate. Use DM (`message`) by default.
11. **CLI workers are one-shot** — Full filesystem access, can make code changes, but can't use TaskList/SendMessage. Lead manages lifecycle: write prompt, spawn, read output, mark complete.
12. **MCP state_write transports strings** — Coerce on read: `parseInt(state.fix_loop_count, 10)`, `state.linked_ralph === 'true'`.
13. **team-verify backward compat** — Old `team-verify`/`team-revise` stage names are replaced by `team-review` + executor re-spawn. State values using old names should be migrated to `team-review` on resume.

</Gotchas>

<Parallel_Session_Caveats>

- **Multi-repo workspace anchor:** Drop `.omc-workspace` marker at parent dir so multiple sessions across sub-repos share one `.omc/`. Resolution order: `OMC_STATE_DIR > .omc-workspace > git > cwd`.
- **Session id source:** `OMC_SESSION_ID` env var wins in CLI contexts; hook payload `data.session_id` wins in hook contexts.
- **Team handoffs shared:** `.omc/handoffs/` shared by design across sessions (see multi-repo workspace anchor).
- **Parallel verdict:** Supported — session-scoped state + shared handoffs by design.

</Parallel_Session_Caveats>

<Communication_Patterns>

```json
// Teammate → lead (task complete)
{"type": "message", "recipient": "team-lead",
 "content": "Completed task #1: Fixed 3 type errors in src/auth/login.ts",
 "summary": "Task #1 complete"}

// Lead → teammate (guidance / reassignment)
{"type": "message", "recipient": "worker-2",
 "content": "Task #3 is now unblocked. Also pick up task #5.",
 "summary": "New task assignment"}

// Broadcast (sparingly — N separate messages)
{"type": "broadcast",
 "content": "STOP: shared types in src/types/index.ts have changed. Pull latest.",
 "summary": "Shared types changed"}
```

</Communication_Patterns>
