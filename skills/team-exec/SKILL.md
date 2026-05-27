---
name: team-exec
description: Execution stage for team pipeline — spawns executor workers in isolated worktrees, collects handoffs
argument-hint: "(internal — invoked by /team orchestrator)"
aliases: []
level: 2
---

# team-exec

Execution stage of the team pipeline. Orchestrator creates isolated worktrees, spawns executor workers, monitors progress, collects handoffs. On `ITERATE` feedback from `team-review`, lead re-spawns workers with reviewer feedback attached.

This skill is injected into agent prompts by the team orchestrator. Workers do NOT call `TeamCreate`, `TaskCreate`, or `Task`.

<Agents>

| Agent | Model | When |
|---|---|---|
| `executor` | sonnet | Default worker |
| `executor` | opus | Complex tasks (multi-system changes, architectural work) |
| `debugger` | sonnet | Tasks involving build errors, type errors, regressions |
| `designer` | sonnet | UI/styling tasks |
| `writer` | haiku | Documentation-only tasks |
| `test-engineer` | sonnet | Test creation tasks (distinct from tester track) |

Lead selects agent type per task based on task description. User `N:agent-type` param overrides the default for all exec workers (not per-task).

</Agents>

<Inputs>

- `.omc/plans/spec.md` — full spec + task graph from team-plan
- `.omc/handoffs/team-plan.md` — planning decisions and risks
- Reviewer feedback (on re-spawn after ITERATE): `.omc/handoffs/team-review.md`

</Inputs>

<Outputs>

Per worker: handoff written to `.omc/handoffs/exec-{workerName}.md`

</Outputs>

<Procedure>

### Initial spawn

1. Read `.omc/handoffs/team-plan.md` and `.omc/plans/spec.md`.
2. For each task in task graph:
   a. `createWorkerWorktree(teamName, workerName, repoRoot)` — create isolated worktree BEFORE spawning.
   b. `TaskCreate` with subject, description, activeForm.
   c. `TaskUpdate` to pre-assign owner (prevent race conditions).
3. Spawn all workers in parallel (background agents). Do NOT wait for one to finish before spawning next.
4. Include worker preamble + task assignment + spec context in each worker prompt.
5. Include reviewer feedback if this is a re-spawn after ITERATE.

### Worker prompt structure

```
{worker_preamble}

== YOUR ASSIGNMENT ==
Task: {task subject}
Description: {task description}
Worktree: {absolute worktree path}

== CONTEXT ==
Plan spec: .omc/plans/spec.md (read on start)
Plan handoff: .omc/handoffs/team-plan.md (read on start)
{if re-spawn: Reviewer feedback: .omc/handoffs/team-review.md — address ALL points}

== EXEC HANDOFF ==
When complete, write .omc/handoffs/exec-{workerName}.md (see format below).
Then SendMessage to team-lead.
```

### Monitoring

- Inbound messages from workers arrive as new turns — no polling needed for messages.
- Poll `TaskList` periodically (every `monitorIntervalMs`, default 30s) to check overall status.
- Watchdog: task stuck `in_progress` >5min without messages → send status check.
- Suspected dead worker (no messages + stuck >10min) → reassign task, log warning.
- Worker fails 2+ tasks → stop assigning new tasks.

### Completion

All tasks complete or failed → collect handoffs → write stage handoff → transition to `team-review`.

Before transitioning, orchestrator merges all worker branches into a single staging branch and writes state:
```
# Merge all worker branches into one feature branch for review
git checkout -b omc-team/{teamName}/feature {baseBranch}
for each workerBranch: git merge --no-ff {workerBranch}

# Update state with canonical feature branch name
state_write(mode="team", state={"feature_branch": "omc-team/{teamName}/feature"})
```

This single `feature_branch` is what `team-review` diffs against base, and what `team-testcode` branches from.

</Procedure>

<Worker_Exec_Handoff_Format>

Each worker writes this on task completion before sending completion message:

```markdown
## Exec Handoff: {workerName}

- **Changed**: [file paths + approximate line ranges + what changed]
- **Why**: [rationale, links to plan tasks by ID]
- **Decisions**: [non-obvious implementation choices made]
- **Worktree**: {absolute worktree path — PRESERVED, not cleaned up}
- **Risks**: [anything that could affect review or downstream workers]
```

Worktrees stay alive after worker session exits. Only cleaned up on team shutdown or `cleanupTeamWorktrees`.

</Worker_Exec_Handoff_Format>

<Stage_Handoff_Format>

After all workers complete, orchestrator writes `.omc/handoffs/team-exec.md`:

```markdown
## Handoff: team-exec → team-review

- **Decided**: [implementation approach, patterns used]
- **Rejected**: [alternatives considered during exec]
- **Risks**: [areas needing close review — e.g., "worker-2 modified shared config"]
- **Files**: [list of all exec handoff paths]
- **Workers**: [worker-1: tasks T1,T2 | worker-2: task T3]
- **Remaining**: [anything exec deferred or couldn't complete]
```

</Stage_Handoff_Format>

<Re_Spawn_After_ITERATE>

When `team-review` returns `ITERATE`:

1. Read `.omc/handoffs/team-review.md` for specific feedback.
2. Increment `fix_loop_count` in state.
3. Check `fix_loop_count` against `max_fix_loops`. If exceeded → terminal `failed`.
4. For each feedback point, identify which worker/task owns the affected file.
5. Create new tasks targeting the specific feedback points.
6. Create new worktrees for re-spawn workers (branch from existing feature branch).
7. Spawn workers with reviewer feedback explicitly in prompt:
   ```
   You are fixing specific issues identified by the code reviewer.
   Read .omc/handoffs/team-review.md for the complete feedback.
   Address EVERY point listed. Do not change unrelated code.
   ```
8. After re-spawn workers complete: re-merge all worker branches (including re-spawn branches) into `omc-team/{teamName}/feature`, update `state.feature_branch`.
9. Return to `team-review` with updated feature branch.

</Re_Spawn_After_ITERATE>

<Worker_Preamble_Rules>

Workers spawned in this stage follow the standard worker preamble (in `team/SKILL.md`) plus these exec-specific rules:

- Read `.omc/plans/spec.md` on start — understand full scope.
- Read `.omc/handoffs/team-plan.md` on start — understand decisions and risks.
- If reviewer feedback present: read `.omc/handoffs/team-review.md` first — reviewer feedback takes priority.
- Write exec handoff BEFORE sending completion message to lead.
- Run verification (LSP diagnostics, `tsc --noEmit`, or task-specified check) before writing handoff.
- If verification fails: fix before declaring complete. If cannot fix: report failure with details.

</Worker_Preamble_Rules>

<Rules>

- Create worktree BEFORE spawning each worker. Never spawn without an isolated worktree.
- Pre-assign all task owners BEFORE spawning any worker.
- Spawn all workers in parallel — do not serialize spawning.
- Worker sessions exit after handoff. Worktrees stay alive.
- Re-spawn on ITERATE uses new worker sessions, not reactivating old ones.
- `max_fix_loops` is a hard limit — do not exceed it. If reached, transition to `failed`.

</Rules>
