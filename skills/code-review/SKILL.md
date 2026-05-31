---
name: code-review
description: Parallel multi-specialist code review — spawns specialized reviewers in parallel for correctness, security, and tests (lite) or adds performance and design (full)
argument-hint: "[--lite|--full] [--staged|--branch <name>|--pr <num>] [<context>]"
level: 3
---

<Skill_Instructions>

## Code Review Skill

Runs 3 specialized reviewers in parallel (`--lite`, default) or 5 (`--full`), each focused on a single domain. Aggregates all findings by severity and presents a unified verdict.

### Modes

| Flag | Reviewers |
|------|-----------|
| (default) / `--lite` | correctness · security · tests |
| `--full` | + performance · design |

### Scope Flags

| Flag | Scope |
|------|-------|
| (default) | `git diff HEAD` — all uncommitted changes |
| `--staged` | `git diff --cached` — staged changes only |
| `--branch <name>` | `git diff <name>...HEAD` — current branch vs base |
| `--pr <num>` | `gh pr diff <num>` — PR diff |

Any remaining text after flags is treated as context passed to reviewers (e.g. "this is a refactor of the auth middleware").

---

## Execution Protocol

### Step 1 — Determine scope

Parse the invocation arguments:
- If `--full`: activate all 5 reviewers. Otherwise: activate 3 (`--lite`).
- If `--staged`: use `git diff --cached`. If `--branch <name>`: use `git diff <name>...HEAD`. If `--pr <num>`: use `gh pr diff <num>`. Otherwise: use `git diff HEAD`.
- Run the appropriate scope command yourself to verify the diff is non-empty. If empty: output "Nothing to review — diff is empty." and stop.

### Step 2 — Build the shared prompt prefix

Construct a prompt to pass to each reviewer agent. Include:
- The scope command used (so agents run the same command)
- Any context text provided by the user
- A reminder to focus ONLY on their domain

Example prompt:
```
Review scope: `git diff HEAD` (run this yourself to see the changes).
Context: <user-provided context, or "none">
Focus ONLY on your assigned domain. Do not report findings outside your lane.
```

### Step 3 — Spawn reviewers in ONE parallel batch

**CRITICAL**: All reviewer agents MUST be spawned in a single message as parallel Agent tool calls. Never spawn them sequentially.

**Lite (default)** — spawn all three simultaneously:
1. `Task(subagent_type="oh-my-claudecode:code-reviewer-correctness", prompt=<shared_prefix>)`
2. `Task(subagent_type="oh-my-claudecode:code-reviewer-security", prompt=<shared_prefix>)`
3. `Task(subagent_type="oh-my-claudecode:code-reviewer-tests", prompt=<shared_prefix>)`

**Full** — spawn all five simultaneously:
1. `Task(subagent_type="oh-my-claudecode:code-reviewer-correctness", prompt=<shared_prefix>)`
2. `Task(subagent_type="oh-my-claudecode:code-reviewer-security", prompt=<shared_prefix>)`
3. `Task(subagent_type="oh-my-claudecode:code-reviewer-tests", prompt=<shared_prefix>)`
4. `Task(subagent_type="oh-my-claudecode:code-reviewer-performance", prompt=<shared_prefix>)`
5. `Task(subagent_type="oh-my-claudecode:code-reviewer-design", prompt=<shared_prefix>)`

Wait for ALL agents to complete before proceeding.

### Step 4 — Aggregate and present

Collect all findings from all reviewer outputs. Deduplicate exact same file:line references across reviewers. Then present:

```
## Code Review — <mode> (<N> specialists)

### 🔴 CRITICAL  (<count>)
[all CRITICAL findings from any reviewer, sorted by file path]

### 🟠 HIGH  (<count>)
[all HIGH findings]

### 🟡 MEDIUM  (<count>)
[all MEDIUM findings]

### 🔵 LOW  (<count>)
[all LOW findings — collapsed if > 5, show "... and N more LOW findings"]

---
### Reviewer Verdicts
| Reviewer | Verdict |
|----------|---------|
| Correctness | APPROVE / REQUEST CHANGES |
| Security | APPROVE / REQUEST CHANGES |
| Tests | APPROVE / REQUEST CHANGES |
| Performance | APPROVE / REQUEST CHANGES | ← full only
| Design | APPROVE / REQUEST CHANGES | ← full only

### Overall Verdict: APPROVE / REQUEST CHANGES
[1-3 sentences: summarize the most important findings, or confirm clean review]
```

**Overall verdict rule**: REQUEST CHANGES if any reviewer returned REQUEST CHANGES at HIGH confidence. APPROVE if all reviewers approved or only LOW/MEDIUM findings exist.

---

## Failure Modes to Avoid

- **Sequential spawning**: spawning reviewers one at a time wastes the parallelism benefit. Spawn all in one batch.
- **Scope mismatch**: passing a different scope to different agents. All agents must run the same diff command.
- **Dropping findings**: presenting only a summary without the individual file:line findings. Always include the detail.
- **False aggregation**: claiming a finding is a duplicate without verifying the file:line and problem description actually match.

</Skill_Instructions>
