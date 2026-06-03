---
name: ultragoal
description: Durable multi-goal workflow that persists plan/ledger artifacts under .omc/ultragoal and prints Claude /goal handoff text for the active session
when_to_use: User wants a durable repo-native way to track goals across sessions or worktrees; work is large enough for multiple ordered stories with attempt counts; user wants completion gated behind ai-slop-cleaner + verification + code-review; user wants /goal directive coordinated with ledger across session restarts
argument-hint: "<brief or subcommand>"
level: 3
---

- The task is a single small change — use direct delegation or `ralph` instead
- The user wants the assistant to literally invoke `/goal` itself from the shell — that is not possible; `omc ultragoal` only writes artifacts and prints handoff text
- The user wants a planning-only artifact with no execution loop — use `plan` instead
Claude Code `/goal` is a session-scoped Stop hook: it blocks the session from stopping until a condition holds, and auto-clears on success. That is a great single-session execution primitive, but it loses state across sessions and does not by itself enforce a final review gate. `omc ultragoal` adds a durable plan, ledger, and gating layer so a long multi-step initiative can survive session restarts, fresh worktrees, and review iterations while still leveraging Claude `/goal` to keep the active agent focused.
<How_To_Use>

1. Create a plan from a brief:
   ```
   omc ultragoal create-goals --brief-file plan.md
   ```
   Or with explicit stories:
   ```
   omc ultragoal create-goals --brief "ship the migration" \
     --goal "Schema::Add new columns" \
     --goal "Backfill::Backfill rows in batches" \
     --goal "Cutover::Drop old columns and switch reads"
   ```
   The default mode is `aggregate` (one Claude `/goal` covers the run).
   Pass `--claude-goal-mode per-story` if you want each story to have its own `/goal`.

   **Multi-repo workspaces / parallel sessions:** when several Claude sessions
   in the same workspace need to run `/ultragoal` concurrently, pass either
   `--plan-id <stable-id>` or `--auto-plan-id` so the plan is written to
   `.omc/ultragoal/plans/{planId}/` instead of the shared single-plan path.
   Without that flag, two sessions creating goals would clobber each other.
   `--auto-plan-id` derives `{epochMs}-{slug}` from the brief title. Then thread
   the same `--plan-id <id>` through every subsequent subcommand in that session.
   Use `omc ultragoal list-plans` to enumerate available planIds when needed.

2. Start (or resume) the next story:
   ```
   omc ultragoal complete-goals
   ```
   This prints a model-facing handoff. The active Claude agent must read it and:
   - Confirm/Set the active `/goal` condition in this session.
   - Work the story.
   - When the story is complete (and for the final story, after the full quality gate), share back a snapshot of the active `/goal` state and call `checkpoint`.

3. Checkpoint a story:
   ```
   omc ultragoal checkpoint --goal-id G001-... --status complete \
     --evidence "tests/files/PR evidence" \
     --claude-goal-json '{"goal":{"objective":"...","status":"active"}}'
   ```
   For the final story, also pass `--quality-gate-json` containing
   `aiSlopCleaner`, `verification`, and `codeReview` evidence (all clean).

4. If the final review is not clean, do NOT mark complete. Record blockers:
   ```
   omc ultragoal record-review-blockers --goal-id G00X-... \
     --title "Resolve final code-review blockers" \
     --objective "Fix the listed review findings and rerun final gates" \
     --evidence "<the review findings>" \
     --claude-goal-json '{"goal":{"objective":"...","status":"active"}}'
   ```
   This appends a new blocker story and keeps the Claude `/goal` active.

5. Inspect state at any time:
   ```
   omc ultragoal status
   ```

</How_To_Use>

<Important_Limitations>
- The shell cannot invoke or mutate Claude Code `/goal` state. `omc ultragoal` only persists durable artifacts and prints instructions that the active Claude agent reads and acts on in-session.
- Snapshots passed via `--claude-goal-json` are model-supplied proof of the active `/goal` state; OMC validates them for textual consistency with the plan's expected objective and ledger event, but it cannot independently observe Claude `/goal` state.
- If the Claude `/goal` slash command is renamed or restructured, only the handoff wording needs to change; the reconciliation logic is name-agnostic.
</Important_Limitations>
