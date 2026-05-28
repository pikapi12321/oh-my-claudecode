---
name: quickplan
description: Lightweight planning — Planner runs inline, N parallel reviewer agents, up to 5 iterations. Faster than ralplan with same quality gate.
argument-hint: "[--interactive] [--deliberate] [--no-tests] [--reviewers N] <task description>"
level: 4
---

# Quickplan (Quick Planning Alias)

Quickplan is a shorthand alias for `/oh-my-claudecode:plan --quick`. It runs the Planner inline (no spawn overhead) with N parallel reviewer agents until consensus, producing the same quality output as ralplan but faster.

> **Want full RALPLAN-DR deliberation or provider overrides (`--architect codex`)?** Use `/oh-my-claudecode:ralplan` instead.

## Usage

```
/oh-my-claudecode:quickplan "task description"
/oh-my-claudecode:quickplan --reviewers 3 "task description"
/oh-my-claudecode:quickplan --interactive "task description"
```

## Flags

All flags pass through to `plan --quick`:

- `--interactive`: User prompts at draft review and final approval. Without this flag runs fully automated — marks plan `pending approval` and stops.
- `--deliberate`: Force expanded mode (pre-mortem + unit/integration/e2e/observability test plan). Auto-enables for high-risk requests (auth/security, migrations, destructive changes, production incidents, compliance/PII, public API breakage).
- `--no-tests`: Omit acceptance-criteria section. For research spikes, docs, or exploratory work.
- `--reviewers N`: Number of parallel reviewer agents (default: 2, min: 1, max: 5). Perspectives: architectural (1), quality/testability (2), security & edge cases (3), performance & scalability (4), maintainability & DX (5).

## Execution

When this skill is invoked, run `plan --quick` with the provided arguments. The full Quick Mode workflow is defined in `skills/plan/SKILL.md` under `### Quick Mode`.
