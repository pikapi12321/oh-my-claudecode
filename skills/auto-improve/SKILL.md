---
name: auto-improve
description: Stateful single-mission improvement loop with strict evaluator contract, markdown decision logs, and max-runtime stop behavior
when_to_use: You have a mission and evaluator from /deep-interview --auto-improve; you want persistent single-mission improvement with strict evaluation and durable experiment logs; you need periodic reruns via Claude Code native cron
argument-hint: "[--mission-dir <path>] [--max-runtime <duration>] [--cron <spec>] [--resume <run-id>]"
level: 4
---

- You need evaluator generation at runtime — use `/deep-interview --auto-improve` first
- You need multiple missions orchestrated together — v1 forbids that
- You want the deprecated `omc auto-improve` CLI flow — it is no longer authoritative
<Contract>
- Single-mission only in v1
- Mission setup/evaluator generation stays in `deep-interview --auto-improve`
- Evaluator output must be structured JSON with required boolean `pass` and optional numeric `score`
- Non-passing iterations do **not** stop the run
- Stop conditions are explicit and bounded, with max-runtime as the primary strict stop hook
</Contract>

<Required_Artifacts>
Canonical persistent storage lives under `.omc/auto-improve/<mission-slug>/` and/or `.omc/logs/auto-improve/<run-id>/`.

Minimum required artifacts:
- mission spec
- evaluator script or command reference
- per-iteration evaluation JSON
- markdown decision logs

Recommended canonical shape:
```text
.omc/auto-improve/<mission-slug>/
  mission.md
  evaluator.json
  runs/<run-id>/
    evaluations/
      iteration-0001.json
      iteration-0002.json
    decision-log.md
```
Reuse existing runtime artifacts when available rather than duplicating them unnecessarily.
</Required_Artifacts>

<Workflow>
1. Confirm a single mission exists and evaluator setup is already available.
2. Ensure mode/state is active for `auto-improve` and records:
   - mission slug/dir
   - evaluator reference
   - iteration count
   - started/updated timestamps
   - explicit max-runtime or deadline
3. On every iteration:
   - run exactly one experiment/change cycle
   - run the evaluator
   - persist machine-readable evaluation JSON
   - append a human-readable markdown decision log entry
   - continue even when evaluation does not pass
4. Stop when:
   - max-runtime ceiling is reached
   - user explicitly cancels
   - another explicit terminal condition is recorded by the runtime
</Workflow>

<Cron_Integration>
Claude Code native cron is a supported integration point for periodic mission enhancement. In v1, prefer documenting/configuring cron inputs over building a large scheduler UI.

If cron is used:
- keep one mission per scheduled job
- preserve the same mission/evaluator contract
- append new run artifacts rather than overwriting prior experiments
</Cron_Integration>

<Execution_Policy>
- Do not hand execution back to `omc auto-improve`
- Do not create multi-mission orchestration
- Prefer reusing `src/auto-improve/*` runtime/schema helpers where they already match the stricter contract
- Keep logs useful to humans, not only machines
</Execution_Policy>
