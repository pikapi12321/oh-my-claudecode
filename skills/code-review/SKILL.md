---
name: code-review
description: Code review with three modes — quick (brief sanity check), default (3 core phases: correctness, design, simplification), full (all 6 phases)
argument-hint: "[--quick|--full] [--staged|--branch <name>|--pr <num>] [<context>]"
level: 3
---

## Code Review Skill

Three review modes, one command:

| Flag | Phases | Best for |
|------|--------|----------|
| `--quick` | 1–3 brief | Fast sanity check, low token cost |
| (default) | 1–3 | Daily PRs — correctness, design, simplification |
| `--full` | 1–6 | Significant changes — adds performance, security, tests |

The unified `code-reviewer` runs phases in sequence internally. Each phase does a surface assessment first and skips if no surface exists. Each phase produces its own report section.

| Phase | Name | Mode |
|-------|------|------|
| 1 | Correctness | always |
| 2 | Design | always |
| 3 | Simplicity | always |
| 4 | Performance | --full only |
| 5 | Security | --full only |
| 6 | Tests | --full only |

### Scope Flags

| Flag | Scope |
|------|-------|
| (default) | `git diff HEAD` — all uncommitted changes |
| `--staged` | `git diff --cached` — staged changes only |
| `--branch <name>` | `git diff <name>...HEAD` — current branch vs base |
| `--pr <num>` | `gh pr diff <num>` — PR diff |

Any remaining text after flags is treated as context passed to the reviewer (e.g. "this is a refactor of the auth middleware").

---

## Execution Protocol

### Step 1 — Determine scope and mode

Parse the invocation arguments:
- Mode: `--quick` → brief 3-phase review. `--full` → all 6 phases. Default → 3 core phases.
- Scope: `--staged` → `git diff --cached`. `--branch <name>` → `git diff <name>...HEAD`. `--pr <num>` → `gh pr diff <num>`. Default → `git diff HEAD`.
- Run the appropriate scope command yourself to verify the diff is non-empty. If empty: output "Nothing to review — diff is empty." and stop.

---

### Step 2 — Spawn the reviewer

Spawn ONE agent:

```
Task(subagent_type="oh-my-claudecode:code-reviewer", prompt="<scope_command> — run this to see the changes.\nContext: <user context or 'none'>\nMode: <default|full|quick>")
```

For `--quick` mode, set Mode to "quick" and append: "Be brief — focus on finding real defects, skip low-severity findings."
For default mode, set Mode to "default".
For `--full` mode, set Mode to "full".

Wait for the agent to complete.

---

### Step 3 — Present the output

Present the agent's full output. The unified reviewer already produces:
1. Per-phase sections with findings and verdicts
2. Positive observations
3. Open questions (low-confidence findings)
4. Overall verdict

No additional aggregation needed — present as-is.

---

## Failure Modes to Avoid

- **Scope mismatch**: passing a different scope to the agent than what you ran to verify non-empty diff.
- **Dropping findings**: presenting only a summary without the individual file:line findings.
- **Re-aggregating**: the unified reviewer already aggregates — don't duplicate its work.
