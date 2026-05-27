Compressing markdown to caveman format.

---
name: team
description: N coordinated agents on shared task list using Claude Code native teams
argument-hint: "[N:agent-type] [ralph] <task description>"
aliases: []
level: 4
---

# Team Skill

Spawn N agents on shared task list. Use Claude Code native team tools. Replace legacy `/swarm` (SQLite). Built-in team management, inter-agent messaging, task deps. No external deps.

`swarm` alias removed in #1131.

## Usage

```
/oh-my-claudecode:team N:agent-type "task description"
/oh-my-claudecode:team "task description"
/oh-my-claudecode:team ralph "task description"
```

### Parameters

- **N** - Agent count (1-20). Optional; auto-size from task decomp.
- **agent-type** - OMC agent for `team-exec` stage (executor, debugger, designer, codex, gemini). Optional; default stage-aware routing. `codex` spawn Codex CLI workers, `gemini` spawn Gemini CLI workers (need CLI installed). See Stage Agent Routing.
- **task** - High-level task to decompose + distribute.
- **ralph** - Optional. Wrap team pipeline in Ralph persistence loop (retry on fail, architect verify before done). See Team + Ralph Composition.
- **--no-review** - Skip `team-review → team-revise` loop. Default: after `team-verify` pass, `code-reviewer` (opus) review all changes + iterate with executor until approve. `--no-review` skip entirely.
- **--no-commit** - Skip auto git commit after stages pass. Default: conventional commit after `team-review` approve (or after `team-verify` if `--no-review`). `--no-commit` leave staged, no commit.

### Examples

```bash
/team 5:executor "fix all TypeScript errors across the project"
/team 3:debugger "fix build errors in src/"
/team 4:designer "implement responsive layouts for all page components"
/team "refactor the auth module with security review"
/team ralph "build a complete REST API for user management"
# With Codex CLI workers (requires: npm install -g @openai/codex)
/team 2:codex "review architecture and suggest improvements"
# With Gemini CLI workers (requires: npm install -g @google/gemini-cli)
/team 2:gemini "redesign the UI components"
# Mixed: Codex for backend analysis, Gemini for frontend (use /ccg instead for this)
```

## Architecture

```
User: "/team 3:executor fix all TypeScript errors"
              |
              v
      [TEAM ORCHESTRATOR (Lead)]
              |
              +-- TeamCreate("fix-ts-errors")
              |       -> lead becomes team-lead@fix-ts-errors
              |
              +-- Analyze & decompose task into subtasks
              |       -> explore/architect produces subtask list
              |
              +-- TaskCreate x N (one per subtask)
              |       -> tasks #1, #2, #3 with dependencies
              |
              +-- TaskUpdate x N (pre-assign owners)
              |       -> task #1 owner=worker-1, etc.
              |
              +-- Task(team_name="fix-ts-errors", name="worker-1") x 3
              |       -> spawns teammates into the team
              |
              +-- Monitor loop
              |       <- SendMessage from teammates (auto-delivered)
              |       -> TaskList polling for progress
              |       -> SendMessage to unblock/coordinate
              |
              +-- Completion
                      -> SendMessage(shutdown_request) to each teammate
                      <- SendMessage(shutdown_response, approve: true)
                      -> TeamDelete("fix-ts-errors")
                      -> state_clear(mode="team")  [via MCP tool, not direct file delete]
```

**Storage layout (managed by Claude Code):**

```
~/.claude/
  teams/fix-ts-errors/
    config.json          # Team metadata + members array
  tasks/fix-ts-errors/
    .lock                # File lock for concurrent access
    1.json               # Subtask #1
    2.json               # Subtask #2 (may be internal)
    3.json               # Subtask #3
    ...
```

## Goal Workflow Relationship

Team = primary authority for parallel staged execution. Keep Team as orchestration loop unless lead explicitly hands off to `/goal` or Ralph.

- `/goal` — native Claude Code handoff target only; does NOT replace `team-verify`/`team-fix`
- `Ultragoal` artifact-only refs — durable checkpoint/evidence artifacts, not worker execution
- Conflict policies: `refuse` | `adopt_existing` | `artifact_only`

## Staged Pipeline (Canonical Team Runtime)

Team execution follow staged pipeline:

`team-plan -> team-prd -> team-exec -> team-verify -> team-fix (loop) -> team-review -> team-revise (loop) -> team-commit`

Flags `--no-review` + `--no-commit` collapse later stages:
- `--no-review`: pipeline end after `team-verify` pass → `team-commit` (or stop if `--no-commit` too)
- `--no-commit`: pipeline end after `team-review` approve, no commit

### Stage Agent Routing

Each pipeline stage use **specialized agents** — not just executors. Lead pick agents by stage + task type.

| Stage           | Required Agents                     | Optional Agents                                                                                         | Selection Criteria                                                                                                                                                                                |
| --------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **team-plan**   | `explore` (haiku), `planner` (opus) | `analyst` (opus), `architect` (opus)                                                                    | Use `analyst` for unclear requirements. Use `architect` for systems with complex boundaries.                                                                                                      |
| **team-prd**    | `analyst` (opus)                    | `critic` (opus)                                                                                         | Use `critic` to challenge scope.                                                                                                                                                                  |
| **team-exec**   | `executor` (sonnet)                 | `executor` (opus), `debugger` (sonnet), `designer` (sonnet), `writer` (haiku), `test-engineer` (sonnet) | Match agent to subtask type. Use `executor` (model=opus) for complex autonomous work, `designer` for UI, `debugger` for compilation issues, `writer` for docs, `test-engineer` for test creation. |
| **team-verify** | `verifier` (sonnet)                 | `test-engineer` (sonnet), `security-reviewer` (sonnet), `code-reviewer` (opus)                          | Always run `verifier`. Add `security-reviewer` for auth/crypto changes. Add `code-reviewer` for >20 files or architectural changes. `code-reviewer` also covers style/formatting checks.          |
| **team-fix**    | `executor` (sonnet)                 | `debugger` (sonnet), `executor` (opus)                                                                  | Use `debugger` for type/build errors + regression isolation. Use `executor` (model=opus) for complex multi-file fixes.                                                                          |
| **team-review** | `code-reviewer` (opus)              | `security-reviewer` (sonnet)                                                                            | Skip when `--no-review`. `code-reviewer` review all changes for correctness, maintainability, edge cases. Return `APPROVE` or `ITERATE` with specific actionable feedback. Add `security-reviewer` for auth/crypto changes. |
| **team-revise** | `executor` (sonnet)                 | `executor` (opus), `debugger` (sonnet)                                                                  | Run only when `team-review` return `ITERATE`. Executor address reviewer feedback. Return to `team-review` for re-eval. Max iterations: `max_review_loops` (default: 3).                |
| **team-commit** | lead (inline, no agent spawn)       | —                                                                                                       | Skip when `--no-commit`. Lead run `git add -A` + conventional commit. Message from task description + stage history. Follow commit protocol (trailers).                             |

**Routing rules:**

1. **Lead pick agents per stage, not user.** User `N:agent-type` param only override `team-exec` stage worker type. All other stages use stage-appropriate specialists.
2. **Specialist agents complement executor agents.** Route analysis/review to architect/critic Claude agents, UI work to designer agents. Tmux CLI workers one-shot, don't participate in team communication.
3. **Cost mode affect model tier.** Downgrade: `opus` agents to `sonnet`, `sonnet` to `haiku` where quality permit. `team-verify` always use at least `sonnet`.
4. **Risk level escalate review.** Security-sensitive or >20 file changes must include `security-reviewer` + `code-reviewer` (opus) in `team-verify`.

### Stage Entry/Exit Criteria

- **team-plan**
  - Entry: Team invocation parsed, orchestration start.
  - Agents: `explore` scan codebase, `planner` create task graph, optional `analyst`/`architect` for complex tasks.
  - Exit: Decomp complete, runnable task graph ready.
- **team-prd**
  - Entry: Scope ambiguous or acceptance criteria missing.
  - Agents: `analyst` extract requirements, optional `critic`.
  - Exit: Acceptance criteria + boundaries explicit.
- **team-exec**
  - Entry: `TeamCreate`, `TaskCreate`, assignment, worker spawn complete.
  - Agents: Workers spawn as appropriate specialist type per subtask (see routing table).
  - Exit: Execution tasks reach terminal state for current pass.
- **team-verify**
  - Entry: Execution pass finish.
  - Agents: `verifier` + task-appropriate reviewers (see routing table).
  - Exit (pass): Verification gates pass, no required follow-up.
  - Exit (fail): Fix tasks generated, control move to `team-fix`.
- **team-fix**
  - Entry: Verification found defects/regressions/incomplete criteria.
  - Agents: `executor`/`debugger` by defect type.
  - Exit: Fixes complete, flow return to `team-exec` then `team-verify`.
- **team-review** *(skip with `--no-review`)*
  - Entry: `team-verify` pass, no required fix tasks remain.
  - Agents: `code-reviewer` (opus) review all changes via `git diff` vs base branch. Add `security-reviewer` for auth/crypto scope.
  - Reviewer return `APPROVE` (with rationale) or `ITERATE` (with specific file-anchored feedback — no vague complaints).
  - Exit (pass): `code-reviewer` return `APPROVE` → proceed to `team-commit`.
  - Exit (fail): Reviewer return `ITERATE` → enter `team-revise`.
- **team-revise** *(run only when `team-review` return `ITERATE`)*
  - Entry: `team-review` return `ITERATE` with feedback.
  - Agents: `executor` (sonnet) address each feedback point. Use `executor` (opus) for architectural feedback. Use `debugger` for regression-risk changes.
  - Exit: Revisions complete → return to `team-review`. Repeat until `APPROVE` or `max_review_loops` reach (default: 3). If limit reach, present best version + note outstanding concerns.
- **team-commit** *(skip with `--no-commit`)*
  - Entry: `team-review` approve (or `team-verify` pass if `--no-review`).
  - Action (inline, no agent spawn): Lead run `git add -A` + `git commit` with conventional commit message from task description + stage handoffs. Follow commit protocol (trailers: `Constraint:`, `Rejected:`, `Confidence:`, `Scope-risk:`).
  - Exit: Commit create → pipeline complete.

### Verify/Fix Loop and Stop Conditions

Continue `team-exec -> team-verify -> team-fix` until:

1. Verification pass + no required fix tasks remain → proceed to `team-review` (or `team-commit` if `--no-review`), or
2. Work reach explicit terminal blocked/failed outcome with evidence.

`team-fix` bounded by max attempts. If fix attempts exceed `max_fix_loops` (default: 3, configurable via `ops.maxFixLoops`), transition to terminal `failed` (no infinite loop).

### Review/Revise Loop and Stop Conditions

After `team-verify` pass, continue `team-review -> team-revise` until:

1. `code-reviewer` return `APPROVE` → proceed to `team-commit` (or stop if `--no-commit`), or
2. `review_loop_count` reach `max_review_loops` (default: 3) → present best version with outstanding concerns, proceed to `team-commit`.

**HARD GATE: Do NOT proceed to `team-commit` until `code-reviewer` return `APPROVE` or loop limit exhaust. Stop after one revision without re-run reviewer = protocol violation.**

### Stage Handoff Convention

Transition between stages, important context — decisions made, alternatives rejected, risks identified — live only in lead conversation history. If lead context compact or agents restart, knowledge lost.

**Each completing stage MUST produce handoff doc before transition.**

Lead write handoffs to `.omc/handoffs/<stage-name>.md`.

#### Handoff Format

```markdown
## Handoff: <current-stage> → <next-stage>

- **Decided**: [key decisions made in this stage]
- **Rejected**: [alternatives considered and why they were rejected]
- **Risks**: [identified risks for the next stage]
- **Files**: [key files created or modified]
- **Remaining**: [items left for the next stage to handle]
```

#### Handoff Rules

1. **Lead read previous handoff BEFORE spawn next stage agents.** Handoff content included in next stage agent spawn prompts, agents start with full context.
2. **Handoffs accumulate.** Verify stage can read all prior handoffs (plan → prd → exec) for full decision history.
3. **On team cancel, handoffs survive** in `.omc/handoffs/` for session resume. Not deleted by `TeamDelete`.
4. **Handoffs lightweight.** 10-20 lines max. Capture decisions + rationale, not full specs (those live in deliverable files like DESIGN.md).

#### Example

```markdown
## Handoff: team-plan → team-exec

- **Decided**: Microservice architecture with 3 services (auth, api, worker). PostgreSQL for persistence. JWT for auth tokens.
- **Rejected**: Monolith (scaling concerns), MongoDB (team expertise is SQL), session cookies (API-first design).
- **Risks**: Worker service needs Redis for job queue — not yet provisioned. Auth service has no rate limiting in initial design.
- **Files**: DESIGN.md, TEST_STRATEGY.md
- **Remaining**: Database migration scripts, CI/CD pipeline config, Redis provisioning.
```

### Resume and Cancel Semantics

- **Resume:** Restart from last non-terminal stage using staged state + live task status. Read `.omc/handoffs/` to recover stage transition context.
- **Cancel:** `/oh-my-claudecode:cancel` request teammate shutdown, wait for responses (best effort), mark phase `cancelled` with `active=false`, capture cancel metadata, then delete team resources + clear/preserve Team state per policy. Handoff files in `.omc/handoffs/` preserved for potential resume.
- Terminal states: `complete`, `failed`, `cancelled`.

## Workflow

### Phase 1: Parse Input

- Extract **N** (agent count), validate 1-20
- Extract **agent-type**, validate map to known OMC subagent
- Extract **task** description

### Phase 2: Analyze & Decompose

Use `explore` or `architect` (via MCP or agent) to analyze codebase + break task into N subtasks:

- Each subtask **file-scoped** or **module-scoped** to avoid conflicts
- Subtasks independent or clear dependency ordering
- Each subtask need concise `subject` + detailed `description`
- Identify dependencies between subtasks (e.g., "shared types must be fixed before consumers")

### Phase 3: Create Team

Call `TeamCreate` with slug from task:

```json
{
  "team_name": "fix-ts-errors",
  "description": "Fix all TypeScript errors across the project"
}
```

**Response:**

```json
{
  "team_name": "fix-ts-errors",
  "team_file_path": "~/.claude/teams/fix-ts-errors/config.json",
  "lead_agent_id": "team-lead@fix-ts-errors"
}
```

Current session become team lead (`team-lead@fix-ts-errors`).

Write OMC state using `state_write` MCP tool for proper session-scoped persistence:

```
state_write(mode="team", active=true, current_phase="team-plan", state={
  "team_name": "fix-ts-errors",
  "agent_count": 3,
  "agent_types": "executor",
  "task": "fix all TypeScript errors",
  "fix_loop_count": 0,
  "max_fix_loops": 3,
  "review_loop_count": 0,
  "max_review_loops": 3,
  "skip_review": false,
  "skip_commit": false,
  "linked_ralph": false,
  "stage_history": "team-plan"
})
```

> **Note:** MCP `state_write` tool transport all values as strings. Consumers must coerce when reading:
> ```js
> const fixLoopCount = parseInt(state.fix_loop_count, 10);
> const maxFixLoops  = parseInt(state.max_fix_loops, 10);
> const agentCount   = parseInt(state.agent_count, 10);
> const linkedRalph  = state.linked_ralph === 'true';
> ```

**State schema fields:**

| Field            | Type    | Description                                                                             |
| ---------------- | ------- | --------------------------------------------------------------------------------------- |
| `active`            | boolean | Team mode active                                                                                                           |
| `current_phase`     | string  | Current pipeline stage: `team-plan`, `team-prd`, `team-exec`, `team-verify`, `team-fix`, `team-review`, `team-revise`, `team-commit` |
| `team_name`         | string  | Slug name for team                                                                                                                |
| `agent_count`       | number  | Worker agent count                                                                                                               |
| `agent_types`       | string  | Comma-separated agent types in team-exec                                                                                         |
| `task`              | string  | Original task description                                                                                                             |
| `fix_loop_count`    | number  | Current fix iteration count                                                                                                           |
| `max_fix_loops`     | number  | Max fix iterations before fail (default: 3)                                                                                    |
| `review_loop_count` | number  | Current review/revise iteration count                                                                                                 |
| `max_review_loops`  | number  | Max review iterations before accept best version (default: 3)                                                                  |
| `skip_review`       | boolean | Whether `--no-review` passed (skip `team-review` + `team-revise`)                                                              |
| `skip_commit`       | boolean | Whether `--no-commit` passed (skip `team-commit`)                                                                                |
| `linked_ralph`      | boolean | Team linked to ralph persistence loop                                                                                    |
| `stage_history`     | string  | Comma-separated stage transitions with timestamps                                                                             |

**Update state on every stage transition:**

```
state_write(mode="team", current_phase="team-exec", state={
  "stage_history": "team-plan:2026-02-07T12:00:00Z,team-prd:2026-02-07T12:01:00Z,team-exec:2026-02-07T12:02:00Z"
})
```

**Read state for resume detection:**

```
state_read(mode="team")
```

If `active=true` + `current_phase` non-terminal, resume from last incomplete stage vs create new team.

### Phase 4: Create Tasks

Call `TaskCreate` for each subtask. Set dependencies with `TaskUpdate` using `addBlockedBy`.

```json
// TaskCreate for subtask 1
{
  "subject": "Fix type errors in src/auth/",
  "description": "Fix all TypeScript errors in src/auth/login.ts, src/auth/session.ts, and src/auth/types.ts. Run tsc --noEmit to verify.",
  "activeForm": "Fixing auth type errors"
}
```

**Response store task file (e.g. `1.json`):**

```json
{
  "id": "1",
  "subject": "Fix type errors in src/auth/",
  "description": "Fix all TypeScript errors in src/auth/login.ts...",
  "activeForm": "Fixing auth type errors",
  "owner": "",
  "status": "pending",
  "blocks": [],
  "blockedBy": []
}
```

For tasks with dependencies, use `TaskUpdate` after creation:

```json
// Task #3 depends on task #1 (shared types must be fixed first)
{
  "taskId": "3",
  "addBlockedBy": ["1"]
}
```

**Pre-assign owners from lead** to avoid race conditions (no atomic claiming):

```json
// Assign task #1 to worker-1
{
  "taskId": "1",
  "owner": "worker-1"
}
```

### Phase 5: Spawn Teammates

Spawn N teammates using `Task` with `team_name` + `name` params. Each teammate get team worker preamble (see below) + specific assignment.

Before spawning, call `createWorkerWorktree(teamName, workerName, repoRoot)` (see Git Worktree Integration) to create isolated worktree. Pass resulting path as `workingDirectory`:

```json
{
  "subagent_type": "oh-my-claudecode:executor",
  "team_name": "fix-ts-errors",
  "name": "worker-1",
  "prompt": "<worker-preamble + assigned tasks>",
  "workingDirectory": ".omc/worktrees/fix-ts-errors/worker-1"
}
```

**Response:**

```json
{
  "agent_id": "worker-1@fix-ts-errors",
  "name": "worker-1",
  "team_name": "fix-ts-errors"
}
```

**Side effects:**

- Teammate added to `config.json` members array
- **Internal task** auto-created (with `metadata._internal: true`) tracking agent lifecycle
- Internal tasks appear in `TaskList` output — filter when count real tasks

**IMPORTANT:** Complete Phase 4 (all `TaskCreate` + `TaskUpdate` owner pre-assignment) BEFORE spawning any worker. Then spawn all teammates in parallel (background agents). Do NOT wait for one worker to finish before spawn next.

### Phase 6: Monitor

Lead orchestrator monitor progress through two channels:

1. **Inbound messages** — Teammates send `SendMessage` to `team-lead` when complete tasks or need help. Arrive auto as new conversation turns (no polling needed).

2. **TaskList polling** — Periodic call `TaskList` to check overall progress:
   ```
   #1 [completed] Fix type errors in src/auth/ (worker-1)
   #3 [in_progress] Fix type errors in src/api/ (worker-2)
   #5 [pending] Fix type errors in src/utils/ (worker-3)
   ```
   Format: `#ID [status] subject (owner)`

**Coordination actions lead can take:**

- **Unblock teammate:** Send `message` with guidance or missing context
- **Reassign work:** If teammate finish early, use `TaskUpdate` to assign pending tasks + notify via `SendMessage`
- **Handle failures:** If teammate report failure, reassign task or spawn replacement

#### Task Watchdog Policy

Monitor for stuck or failed teammates:

- **Max in-progress age**: If task stay `in_progress` >5min without messages, send status check (≈10× `monitorIntervalMs` at default 30s)
- **Suspected dead worker**: No messages + stuck task 10+ min → reassign task to another worker (adjust threshold if `monitorIntervalMs` changed)
- **Reassign threshold**: If worker fail 2+ tasks, stop assign new tasks to it

### Phase 6.5: Stage Transitions (State Persistence)

On every stage transition, update OMC state:

```
// Enter team-exec after planning
state_write(mode="team", current_phase="team-exec", state={
  "stage_history": "team-plan:T1,team-prd:T2,team-exec:T3"
})

// Enter team-verify after execution
state_write(mode="team", current_phase="team-verify")

// Enter team-fix after verify failure
state_write(mode="team", current_phase="team-fix", state={
  "fix_loop_count": 1
})
```

Enable:

- **Resume**: If lead crash, `state_read(mode="team")` reveal last stage + team name for recovery
- **Cancel**: Cancel skill read `current_phase` to know cleanup needed
- **Ralph integration**: Ralph can read team state to know if pipeline complete or fail

### Phase 7: Completion

When all real tasks (non-internal) complete or fail:

1. **Verify results** — Check all subtasks marked `completed` via `TaskList`
2. **Shutdown teammates** — Send `shutdown_request` to each active teammate:
   ```json
   {
     "type": "shutdown_request",
     "recipient": "worker-1",
     "content": "All work complete, shutting down team"
   }
   ```
3. **Await responses** — Each teammate respond with `shutdown_response(approve: true)` + terminate
4. **Delete team** — Call `TeamDelete` to clean up:
   ```json
   { "team_name": "fix-ts-errors" }
   ```
   Response:
   ```json
   {
     "success": true,
     "message": "Cleaned up directories and worktrees for team \"fix-ts-errors\"",
     "team_name": "fix-ts-errors"
   }
   ```
5. **Clean OMC state** — Remove `.omc/state/team-state.json`
6. **Report summary** — Present results to user

## Agent Preamble

When spawn teammates, include preamble in prompt to establish work protocol. Adapt per teammate with specific task assignments.

```
You are a TEAM WORKER in team "{team_name}". Your name is "{worker_name}".
You report to the team lead ("team-lead").
You are not the leader and must not perform leader orchestration actions.

== WORK PROTOCOL ==

1. CLAIM: Call TaskList to see your assigned tasks (owner = "{worker_name}").
   Pick the first task with status "pending" that is assigned to you.
   Call TaskUpdate to set status "in_progress":
   {"taskId": "ID", "status": "in_progress", "owner": "{worker_name}"}

2. WORK: Execute the task using your tools (Read, Write, Edit, Bash, LSP, MCP tools, etc.).
   Do NOT use the Task tool to spawn new agents.
   Do NOT invoke team/ralph/autopilot orchestration skills.
   All direct file and code tools are permitted.

3. COMPLETE: When done, mark the task completed:
   {"taskId": "ID", "status": "completed"}

4. REPORT: Notify the lead via SendMessage:
   {"type": "message", "recipient": "team-lead", "content": "Completed task #ID: <summary of what was done>", "summary": "Task #ID complete"}

5. NEXT: Check TaskList for more assigned tasks. If you have more pending tasks, go to step 1.
   If no more tasks are assigned to you, notify the lead:
   {"type": "message", "recipient": "team-lead", "content": "All assigned tasks complete. Standing by.", "summary": "All tasks done, standing by"}

6. SHUTDOWN: When you receive a shutdown_request, extract the `request_id` field from the incoming message and echo it back:
   {"type": "shutdown_response", "request_id": "<exact request_id from shutdown_request>", "approve": true}

== BLOCKED TASKS ==
If a task has blockedBy dependencies, skip it until those tasks are completed.
Check TaskList periodically to see if blockers have been resolved.

== ERRORS ==
If you cannot complete a task, report the failure to the lead:
{"type": "message", "recipient": "team-lead", "content": "FAILED task #ID: <reason>", "summary": "Task #ID failed"}
Do NOT mark the task as completed. Leave it in_progress so the lead can reassign.

== RULES ==
- NEVER spawn sub-agents or use the Task tool
- NEVER run tmux pane/session orchestration commands (for example `tmux split-window`, `tmux new-session`)
- NEVER run team spawning/orchestration skills or commands (for example `$team`, `$ultrawork`, `$autopilot`, `$ralph`, `omc team ...`, `omx team ...`)
- NEVER fabricate `request_id` in shutdown_response — extract exact value from incoming shutdown_request
- ALWAYS use absolute file paths within your assigned worktree (`workingDirectory` passed at spawn time)
- NEVER read or write files outside your assigned worktree — coordinate via SendMessage if cross-worker file access needed
- ALWAYS report progress via SendMessage to "team-lead"
- Use SendMessage with type "message" only -- never "broadcast"
```

All teammate prompts must preserve core rule: **worker = executor only, never leader/orchestrator**.

## Communication Patterns

### Teammate to Lead (task completion report)

```json
{
  "type": "message",
  "recipient": "team-lead",
  "content": "Completed task #1: Fixed 3 type errors in src/auth/login.ts and 2 in src/auth/session.ts. All files pass tsc --noEmit.",
  "summary": "Task #1 complete"
}
```

### Lead to Teammate (reassignment or guidance)

```json
{
  "type": "message",
  "recipient": "worker-2",
  "content": "Task #3 is now unblocked. Also pick up task #5 which was originally assigned to worker-1.",
  "summary": "New task assignment"
}
```

### Broadcast (use sparingly — sends N separate messages)

```json
{
  "type": "broadcast",
  "content": "STOP: shared types in src/types/index.ts have changed. Pull latest before continuing.",
  "summary": "Shared types changed"
}
```

### Shutdown Protocol (BLOCKING)

**CRITICAL: Steps execute in exact order. Never call TeamDelete before shutdown confirm.**

**Step 1: Verify completion**

```
Call TaskList — verify all real tasks (non-internal) complete or fail.
```

**Step 2: Request shutdown from each teammate**

**Lead sends:**

```json
{
  "type": "shutdown_request",
  "recipient": "worker-1",
  "content": "All work complete, shutting down team"
}
```

**Step 3: Wait for responses (BLOCKING)**

- Wait up to 30s per teammate for `shutdown_response`
- Track which teammates confirm vs timeout
- If teammate don't respond within 30s: log warning, mark as unresponsive

**Teammate receives + responds:**

```json
{
  "type": "shutdown_response",
  "request_id": "shutdown-1770428632375@worker-1",
  "approve": true
}
```

After approval:

- Teammate process terminate
- Teammate auto-remove from `config.json` members array
- Internal task for teammate complete

**Step 4: TeamDelete — only after ALL teammates confirm or timeout**

```json
{ "team_name": "fix-ts-errors" }
```

**Step 5: Orphan scan**

Check for agent processes that survive TeamDelete:

```bash
# CLAUDE_PLUGIN_ROOT only available in hook contexts, not Bash tool
if [ -n "${CLAUDE_PLUGIN_ROOT}" ]; then
  node "${CLAUDE_PLUGIN_ROOT}/scripts/cleanup-orphans.mjs" --team-name fix-ts-errors
else
  echo "[warn] CLAUDE_PLUGIN_ROOT not set — skip orphan scan"
  echo "[info] Manual check: ps aux | grep fix-ts-errors"
fi
```

Scan for processes match team name whose config no longer exist + terminate (SIGTERM → 5s wait → SIGKILL). Support `--dry-run` for inspection.

> **Note:** `CLAUDE_PLUGIN_ROOT` injected by hook runtime only. Step 5 best-effort when LLM run via Bash tool directly.

**Shutdown sequence BLOCKING:** Do not proceed to TeamDelete until all teammates either:

- Confirm shutdown (`shutdown_response` with `approve: true`), OR
- Timeout (30s no response)

**IMPORTANT:** `request_id` provided in shutdown request message teammate receive. Teammate must extract + pass back. Do NOT fabricate request IDs.

## Error Handling

### Teammate Fails Task

1. Teammate send `SendMessage` to lead report failure
2. Lead decide: retry (reassign same task to same/different worker) or skip
3. To reassign: `TaskUpdate` set new owner, then `SendMessage` to new owner

### Teammate Gets Stuck (No Messages)

1. Lead detect via `TaskList` — task stuck in `in_progress` too long
2. Lead send `SendMessage` to teammate ask status
3. If no response, consider teammate dead
4. Reassign task to another worker via `TaskUpdate`

### Dependency Blocked

1. If blocking task fail, lead must decide:
   - Retry blocker
   - Remove dependency (`TaskUpdate` with modified blockedBy)
   - Skip blocked task entirely
2. Communicate decisions to affected teammates via `SendMessage`

### Teammate Crashes

1. Internal task for teammate show unexpected status
2. Teammate disappear from `config.json` members
3. Lead reassign orphaned tasks to remaining workers
4. If needed, spawn replacement teammate with `Task(team_name, name)`

## Team + Ralph Composition

When user invoke `/team ralph`, say "team ralph", or combine both keywords, team mode wrap in Ralph persistence loop. Provide:

- **Team orchestration** — multi-agent staged pipeline with specialized agents per stage
- **Ralph persistence** — retry on failure, architect verification before completion, iteration tracking

### Activation

Team+Ralph activate when:

1. User invoke `/team ralph "task"` or `/oh-my-claudecode:team ralph "task"`
2. Keyword detector find both `team` + `ralph` in prompt
3. Hook detect `MAGIC KEYWORD: RALPH` alongside team context

### State Linkage

Both modes write own state files with cross-refs:

```
// Team state (via state_write)
state_write(mode="team", active=true, current_phase="team-plan", state={
  "team_name": "build-rest-api",
  "linked_ralph": true,
  "task": "build a complete REST API"
})

// Ralph state (via state_write)
state_write(mode="ralph", active=true, iteration=1, max_iterations=10, current_phase="execution", state={
  "linked_team": true,
  "team_name": "build-rest-api"
})
```

### Execution Flow

1. Ralph outer loop start (iteration 1)
2. Team pipeline run: `team-plan -> team-prd -> team-exec -> team-verify`
3. If `team-verify` pass: Ralph run architect verification (STANDARD tier min)
4. If architect approve: both modes complete, run `/oh-my-claudecode:cancel`
5. If `team-verify` fail OR architect reject: team enter `team-fix`, loop back to `team-exec -> team-verify`
6. If fix loop exceed `max_fix_loops`: Ralph increment iteration + retry full pipeline
7. If Ralph exceed `max_iterations`: terminal `failed` state

### Cancellation

Cancel either mode cancel both:

- **Cancel Ralph (linked):** Cancel Team first (graceful shutdown), then clear Ralph state
- **Cancel Team (linked):** Clear Team, mark Ralph iteration cancelled, stop loop

See Cancellation section for details.

## Idempotent Recovery

If lead crash mid-run, team skill detect existing state + resume:

1. Check `${CLAUDE_CONFIG_DIR:-~/.claude}/teams/` for teams match task slug
2. If found, read `config.json` to discover active members
3. Resume monitor mode vs create duplicate team
4. Call `TaskList` to determine current progress
5. Continue from monitoring phase

Prevent duplicate teams + allow graceful recovery from lead failures.

## Cancellation

`/oh-my-claudecode:cancel` skill handle team cleanup:

1. Read team state via `state_read(mode="team")` to get `team_name` + `linked_ralph`
2. Send `shutdown_request` to all active teammates (from `config.json` members)
3. Wait for `shutdown_response` from each (15s timeout per member)
4. Call `TeamDelete` to remove team + task directories
5. Clear state via `state_clear(mode="team")`
6. If `linked_ralph` true, also clear ralph: `state_clear(mode="ralph")`

### Linked Mode Cancellation (Team + Ralph)

When team linked to ralph, cancel follow dependency order:

- **Cancel trigger from Ralph context:** Cancel Team first (graceful shutdown all teammates), then clear Ralph state. Ensure workers stop before persistence loop exit.
- **Cancel trigger from Team context:** Clear Team state, then mark Ralph as cancelled. Ralph stop hook detect missing team + stop iterate.
- **Force cancel (`--force`):** Clear both `team` + `ralph` state unconditional via `state_clear`.

If teammates unresponsive, `TeamDelete` may fail. Cancel skill should wait brief + retry, or inform user to manual clean `${CLAUDE_CONFIG_DIR:-~/.claude}/teams/{team_name}/` + `${CLAUDE_CONFIG_DIR:-~/.claude}/tasks/{team_name}/`.

## Configuration

Optional settings in `.claude/omc.jsonc` (project) or `~/.config/claude-omc/config.jsonc` (user). Project values override user values; `OMC_TEAM_ROLE_OVERRIDES` (env JSON) supersede both.

```jsonc
{
  "team": {
    "ops": {
      "maxAgents": 20,
      "defaultAgentType": "claude",
      "monitorIntervalMs": 30000,
      "shutdownTimeoutMs": 15000,
      "maxFixLoops": 3,
      "maxReviewLoops": 3,
    },
  },
}
```

- **ops.maxAgents** - Max teammates (default: 20)
- **ops.defaultAgentType** - CLI provider when `/team` invocation not specify (`claude` | `codex` | `gemini`, default: `claude`)
- **ops.monitorIntervalMs** - How often poll `TaskList` (default: 30s)
- **ops.shutdownTimeoutMs** - How long wait for shutdown responses (default: 15s)
- **ops.maxFixLoops** - Max `team-fix` iterations before terminal `failed` (default: 3)
- **ops.maxReviewLoops** - Max `team-review → team-revise` iterations before accept best version (default: 3)

> **Note:** Model precedence: Stage routing table (haiku/sonnet/opus per stage) overrides session default. Worker sessions inherit user config model as baseline only when no stage routing applies. `roleRouting` config + `OMC_TEAM_ROLE_OVERRIDES` override both.

## Per-Role Provider & Model Routing

> **Scope:** Apply to `/team` only. Task-based delegation use `delegationRouting` (see separate docs). Two systems coexist by design.

Declare which provider (`claude`, `codex`, `gemini`) + which model tier back each canonical role. Routing resolve **once** at team creation + persist in `TeamConfig.resolved_routing` — spawn, scale-up, restart all read from snapshot, so role worker CLI + model stable for team lifetime.

### Example — user target mapping

```jsonc
// .claude/omc.jsonc
{
  "team": {
    "roleRouting": {
      "orchestrator": { "model": "inherit" },
      "planner": { "provider": "claude", "model": "HIGH" },
      "analyst": { "provider": "claude", "model": "HIGH" },
      "executor": { "provider": "claude", "model": "MEDIUM" },
      "critic": { "provider": "codex" },
      "code-reviewer": { "provider": "gemini" },
      "test-engineer": { "provider": "gemini", "model": "MEDIUM" },
    },
  },
}
```

| Role            | Provider        | Model                     |
| --------------- | --------------- | ------------------------- |
| `orchestrator`  | claude (pinned) | inherit invoking session |
| `planner`       | claude          | `HIGH` (opus)             |
| `analyst`       | claude          | `HIGH` (opus)             |
| `executor`      | claude          | `MEDIUM` (sonnet)         |
| `critic`        | codex           | codex default             |
| `code-reviewer` | gemini          | gemini default            |
| `test-engineer` | gemini          | `MEDIUM` (sonnet)         |

### Canonical roles

`orchestrator`, `planner`, `analyst`, `architect`, `executor`, `debugger`, `critic`, `code-reviewer`, `security-reviewer`, `test-engineer`, `designer`, `writer`, `code-simplifier`, `explore`, `document-specialist`.

User-friendly aliases normalize via `normalizeDelegationRole()` — e.g. `reviewer` → `code-reviewer`, `quality-reviewer` → `code-reviewer`, `harsh-critic` → `critic`, `build-fixer` → `debugger`. Accepted alias keys honored during resolved snapshot creation + later stage routing, not just validation. Unknown roles fail validation at parse time.

### Spec fields (`TeamRoleAssignmentSpec`)

- **provider** — `"claude" | "codex" | "gemini"`. Omit → default `claude`.
- **model** — tier name (`"HIGH" | "MEDIUM" | "LOW"`) or explicit model ID. Tiers resolve through `routing.tierModels`.
- **agent** — optional Claude agent name (e.g. `"critic"`, `"executor"`). Only honor when resolved provider `claude`.

`orchestrator` pinned to `claude`; only `model` user-configurable. Any other key on `orchestrator` rejected by validator.

### Env override

```bash
OMC_TEAM_ROLE_OVERRIDES='{"critic":{"provider":"codex"},"code-reviewer":{"provider":"gemini"}}'
```

Precedence: `OMC_TEAM_ROLE_OVERRIDES` > `.claude/omc.jsonc` (project) > `~/.config/claude-omc/config.jsonc` (user) > built-in defaults. Invalid JSON in `OMC_TEAM_ROLE_OVERRIDES` → emit visible `SendMessage` warning to lead (same as CLI-missing fallback), then ignore override + continue with lower-precedence config. Never abort run, but never silently skip — malformed env var must surface to operator.

### Fallback when CLI missing

If CLI for config provider absent from `PATH` at spawn time, `buildLaunchArgs()` throw, team lead emit visible `SendMessage` warning + runtime fall back to deterministic Claude assignment pre-computed by `buildResolvedRoutingSnapshot` (same tier + same agent, `provider: "claude"`). Fallback loud by design — silent fallback = test failure. Probe provider availability with `omc doctor --team-routing`.

### Stickiness — resolve once, reuse everywhere

Resolved routing immutable per team. Edit config mid-team-lifetime don't affect running teams; new `/team` invocation pick up new mapping. Guarantee spawn, scale-up, worker-restart all see identical routing, including across worktree detach (snapshot travel with `TeamConfig`).

### Zero-config behavior

Empty `team.roleRouting` preserve pre-patch behavior: every worker Claude, model tiers follow `routing.tierModels`, `/team 3:executor ...` still spawn three Claude Sonnet executors.

## State Cleanup

On success completion:

1. `TeamDelete` handle all Claude Code state:
   - Remove `~/.claude/teams/{team_name}/` (config)
   - Remove `~/.claude/tasks/{team_name}/` (all task files + lock)
2. OMC state cleanup via MCP tools:
   ```
   state_clear(mode="team")
   ```
   If linked to Ralph:
   ```
   state_clear(mode="ralph")
   ```
3. Or run `/oh-my-claudecode:cancel` which handle all cleanup auto.

**IMPORTANT:** Call `TeamDelete` only AFTER all teammates shut down. `TeamDelete` fail if active members (besides lead) still exist in config.

## Git Worktree Integration

MCP workers operate in isolated git worktrees to prevent file conflicts between concurrent workers.

### How It Works

1. **Worktree creation**: Before spawn worker, call `createWorkerWorktree(teamName, workerName, repoRoot)` to create isolated worktree at `.omc/worktrees/{team}/{worker}` with branch `omc-team/{teamName}/{workerName}`.

2. **Worker isolation**: Pass worktree path as `workingDirectory` in worker `BridgeConfig`. Worker operate exclusive in own worktree.

3. **Merge coordination**: After worker complete tasks, use `checkMergeConflicts()` to verify branch can clean merge, then `mergeWorkerBranch()` to merge with `--no-ff` for clear history.

4. **Team cleanup**: On team shutdown, call `cleanupTeamWorktrees(teamName, repoRoot)` to remove all worktrees + branches.

### API Reference

| Function                                                            | Description                    |
| ------------------------------------------------------------------- | ------------------------------ |
| `createWorkerWorktree(teamName, workerName, repoRoot, baseBranch?)` | Create isolated worktree       |
| `removeWorkerWorktree(teamName, workerName, repoRoot)`              | Remove worktree + branch     |
| `listTeamWorktrees(teamName, repoRoot)`                             | List all team worktrees        |
| `cleanupTeamWorktrees(teamName, repoRoot)`                          | Remove all team worktrees      |
| `checkMergeConflicts(workerBranch, baseBranch, repoRoot)`           | Non-destructive conflict check |
| `mergeWorkerBranch(workerBranch, baseBranch, repoRoot)`             | Merge worker branch (--no-ff)  |
| `mergeAllWorkerBranches(teamName, repoRoot, baseBranch?)`           | Merge all completed workers    |

### Important Notes

- `createSession()` in `tmux-session.ts` NOT handle worktree creation — worktree lifecycle managed separate via `git-worktree.ts`
- Worktrees NOT clean on individual worker shutdown — only on team shutdown, allow post-mortem inspection
- Branch names sanitize via `sanitizeName()` to prevent injection
- All paths validate vs directory traversal

## Gotchas

1. **Internal tasks pollute TaskList** — When teammate spawn, system auto-create internal task with `metadata._internal: true`. Appear in `TaskList` output. Filter when count real task progress. Internal task subject = teammate name.

2. **No atomic claiming** — Unlike SQLite swarm, no transactional guarantee on `TaskUpdate`. Two teammates could race to claim same task. **Mitigation:** Lead pre-assign owners via `TaskUpdate(taskId, owner)` before spawn teammates. Teammates only work on tasks assigned to them.

3. **Task IDs are strings** — IDs auto-increment strings ("1", "2", "3"), not integers. Always pass string values to `taskId` fields.

4. **TeamDelete require empty team** — All teammates must shut down before call `TeamDelete`. Lead (only remaining member) excluded from check.

5. **Messages auto-deliver** — Teammate messages arrive to lead as new conversation turns. No polling or inbox-check needed for inbound messages. If lead mid-turn (processing), messages queue + deliver when turn end.

6. **Teammate prompt store in config** — Full prompt text store in `config.json` members array. Don't put secrets or sensitive data in teammate prompts.

7. **Members auto-remove on shutdown** — After teammate approve shutdown + terminate, auto-remove from `config.json`. Don't re-read config expect to find shut-down teammates.

8. **shutdown_response need request_id** — Teammate must extract `request_id` from incoming shutdown request JSON + pass back. Format `shutdown-{timestamp}@{worker-name}`. Fabricate ID cause shutdown fail silent.

9. **Team name must be valid slug** — Use lowercase letters, numbers, hyphens. Derive from task description (e.g., "fix TypeScript errors" become "fix-ts-errors").

10. **Broadcast expensive** — Each broadcast send separate message to every teammate. Use `message` (DM) by default. Only broadcast for truly team-wide critical alerts.

11. **CLI workers one-shot, not persistent** — Tmux CLI workers have full filesystem access + CAN make code changes. But run as autonomous one-shot jobs — can't use TaskList/TaskUpdate/SendMessage. Lead must manage lifecycle: write prompt_file, spawn CLI worker, read output_file, mark task complete. Don't participate in team communication like Claude teammates.

## Parallel session caveats

- **Multi-repo workspace anchor:** Drop `.omc-workspace` marker at parent dir so multiple sessions across sub-repos share one `.omc/`. Resolution order: `OMC_STATE_DIR > .omc-workspace > git > cwd`. See `docs/REFERENCE.md`.
- **Session id source:** OMC_SESSION_ID env var win in CLI contexts; hook payload data.session_id win in hook contexts.
- **Plan id (when applicable):** Team state session-scoped. Team handoffs at `.omc/handoffs/` shared by design (see Wave G in workspace plan).
- **Parallel verdict:** supported (session-scoped + shared handoffs by design)