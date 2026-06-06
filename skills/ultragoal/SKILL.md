---
name: ultragoal
description: Durable multi-goal workflow that persists plan artifacts under .omc/ultragoal and integrates with Claude Code /goal for session persistence
when_to_use: User wants a durable repo-native way to track goals across sessions or worktrees; work is large enough for multiple ordered stories; user wants completion gated behind ai-slop-cleaner + verification + code-review
argument-hint: "<brief or task description>"
level: 3
---

- The task is a single small change — use direct delegation or `ralph` instead
- The user wants a planning-only artifact with no execution loop — use `plan` instead
- The user wants automatic iteration with reviewer verification — use `ralph` instead

Ultragoal manages a durable multi-goal plan across Claude Code sessions. It persists goals in `.omc/ultragoal/goals.json` (like ralph's `prd.json`), tracks plan state via `state_write`, and integrates with Claude Code `/goal` (a session-scoped Stop hook) to keep each session focused until its goal is met.

<Steps>

1. **Create the plan** (first iteration only):
   a. Parse the user's brief into discrete goals. Each goal should be completable in one session.
   b. Write goals.json to `.omc/ultragoal/goals.json` using the `Write` tool:
   ```json
   {
     "version": 1,
     "createdAt": "<ISO timestamp>",
     "updatedAt": "<ISO timestamp>",
     "claudeGoalMode": "aggregate",
     "claudeObjective": "<aggregate /goal condition string>",
     "activeGoalId": null,
     "goals": [
       {
         "id": "G001-<slug>",
         "title": "<short title>",
         "objective": "<verifiable completion condition>",
         "status": "pending",
         "attempt": 0,
         "createdAt": "<ISO>",
         "updatedAt": "<ISO>"
       }
     ]
   }
   ```
   c. Write brief.md to `.omc/ultragoal/brief.md` using the `Write` tool.
   d. Record plan state via `state_write`:
   ```
   state_write(mode="ultragoal", active=true, current_phase="exec", state={
     "plan_path": ".omc/ultragoal/goals.json",
     "active_goal_id": "",
     "claude_goal_mode": "aggregate",
     "total_goals": "<N>",
     "completed_goals": "0"
   })
   ```

2. **Pick next goal**: Read `.omc/ultragoal/goals.json`, find the first goal with `status: "pending"`. If none pending, check for `status: "failed"` if retry is desired. If all resolved, go to Step 6.

3. **Start the goal**:
   a. Update goals.json: set the goal's `status` to `"in_progress"`, increment `attempt`, set `startedAt` and `updatedAt` to current ISO timestamp, set `activeGoalId` on the plan.
   b. Update state_write: set `active_goal_id` to the goal's id.
   c. Set Claude `/goal` with the goal's objective as the condition. In aggregate mode, use the plan's `claudeObjective` instead.
   d. Work the goal — implement, test, verify.

4. **Checkpoint the goal**:
   a. When the goal's acceptance criteria are met, update goals.json: set `status` to `"complete"`, set `completedAt`, set `evidence` with test/file evidence, clear `activeGoalId`.
   b. Update state_write: increment `completed_goals`.
   c. Clear or let `/goal` auto-clear.

5. **Loop**: Go to Step 2.

6. **Final quality gate** (when all goals are complete):
   a. Run `ai-slop-cleaner` on all changed files.
   b. Re-run tests, build, lint — confirm all pass.
   c. Run code-review (architect or critic).
   d. If review is not clean: set the last goal to `"review_blocked"`, add a new blocker goal, loop back to Step 2.
   e. If all clean: mark plan complete via `state_write(active=false, current_phase="complete")`.

</Steps>

<Goal_Structure>

**Goal statuses**: `pending` | `in_progress` | `complete` | `failed` | `review_blocked`

**Goal fields**:
- `id`: `G001-<slug>` format (use `normalizeGoalId` pattern: lowercase, hyphens, max 36 chars)
- `title`: short display name (max 72 chars)
- `objective`: verifiable completion condition — what `/goal` checks
- `status`: current status
- `attempt`: retry count (starts at 0, incremented on start)
- `evidence`: test output, file paths, or other proof of completion
- `createdAt` / `updatedAt` / `startedAt` / `completedAt` / `failedAt`: ISO timestamps

**Aggregate vs per-story mode**:
- `aggregate` (default): one `/goal` covers the whole plan. `claudeObjective` lists all goals. `/goal` stays active until all stories done.
- `per_story`: each goal gets its own `/goal`. `/goal` clears after each goal completes.

</Goal_Structure>

<Failure_And_Review>

**Goal failure**: Set `status: "failed"`, record `failureReason`. Retry by setting back to `"pending"` and re-running.

**Final review blockers**: When final code-review is not clean:
1. Set the goal to `"review_blocked"`, record evidence
2. Add a new goal for the blocker resolution
3. Keep `/goal` active
4. Re-run after fixes

**Quality gate** (final goal only):
- ai-slop-cleaner: PASS
- verification: tests + build + lint all green
- code-review: APPROVE + architect CLEAR

</Failure_And_Review>

<Tool_Usage>

- Use `Write` tool to create/update goals.json and brief.md
- Use `Read` tool to read goals.json for picking next goal
- Use `state_write` / `state_read` for plan metadata (active, current_phase, progress counters)
- Use `state_write(mode="ultragoal", active=false, current_phase="complete")` on plan completion
- `/goal` is a Claude Code native command — invoke it directly in-session, not via Bash

</Tool_Usage>

<Examples>

<Good>
Creating a plan:
```
User: /ultragoal Migrate user module from REST to GraphQL

Claude:
1. Write .omc/ultragoal/brief.md with the migration description
2. Write .omc/ultragoal/goals.json with G001-Schema, G002-DataLayer, G003-Middleware, G004-Tests, G005-Cutover
3. state_write(mode="ultragoal", active=true, current_phase="exec", ...)
4. Set /goal: "Complete all ultragoal stories: G001-Schema; G002-DataLayer; ..."
5. Start working G001
```
Why good: Uses Write/Read/state_write directly, no CLI.
</Good>

<Good>
Checkpointing a goal:
```
After implementing GraphQL schema:
1. Run tests → PASS
2. Read .omc/ultragoal/goals.json
3. Update G001: status="complete", completedAt=now, evidence="schema.ts exists, codegen passes"
4. Write updated goals.json
5. state_write(completed_goals="1")
6. Pick next goal G002
```
Why good: Direct file operations, clear verification.
</Good>

<Bad>
Using CLI commands:
```
Bash("omc ultragoal create-goals --brief '...' --goal '...'")
Bash("omc ultragoal checkpoint --goal-id G001 --status complete")
```
Why bad: CLI layer removed. Use Write/Read/state_write directly.
</Bad>

</Examples>

<Important_Limitations>
- `/goal` is a Claude Code session-scoped Stop hook. It cannot be invoked from a shell command.
- Goals.json is the single source of truth for plan state. state_write stores metadata only.
- Cross-session persistence is achieved through file artifacts (.omc/ultragoal/), not background processes.
- For parallel ultragoal runs in the same workspace, use distinct plan directories (.omc/ultragoal/plans/{planId}/).
</Important_Limitations>
