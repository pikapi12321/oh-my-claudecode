---
name: team-triage
description: Triage stage for team pipeline — diagnoses test failures as feature bug or test bug, routes to fix
argument-hint: "(internal — invoked by /team orchestrator)"
aliases: []
level: 2
---

# team-triage

Triage stage. A `code-reviewer` (sonnet) reads the failing test output, the feature diff, and the test code diff to diagnose whether the failure is caused by a feature implementation bug or a test code bug. Produces a triage decision with evidence and routes accordingly.

This skill is injected into agent prompts by the team orchestrator. The triage agent reads only — it does not make any code changes.

<Agents>

| Agent | Model | Role |
|---|---|---|
| `code-reviewer` | sonnet | Read-only diagnosis — no code changes |

</Agents>

<Inputs>

- Failing test output: `.omc/handoffs/testrun-failure.md`
- Feature diff: `git diff {baseBranch}...{featureBranch}`
- Test code diff: `git diff {featureBranch}...{testerBranch}`
- Exec handoffs: `.omc/handoffs/exec-*.md` (for context on implementation decisions)
- Test code handoff: `.omc/handoffs/test-code.md` (for context on test decisions)

</Inputs>

<Outputs>

- Triage decision: `FEATURE_BUG`, `TEST_BUG`, or `ABANDON`
- Handoff written to `.omc/handoffs/team-triage.md`

</Outputs>

<Procedure>

1. Orchestrator increments `triage_loop_count` in state.
2. Check `triage_loop_count` against `max_triage_loops`. If exceeded → decision is `ABANDON` (skip triage agent, go straight to handoff + terminal `failed`).
3. Spawn `code-reviewer` (sonnet) with triage prompt (see below).
4. Collect decision + evidence.
5. Write handoff to `.omc/handoffs/team-triage.md`.
6. Route based on decision.

</Procedure>

<Triage_Prompt>

```
You are a code reviewer performing test failure triage. Read-only — do NOT suggest code changes here.

== FAILING TESTS ==
{contents of .omc/handoffs/testrun-failure.md}

== FEATURE DIFF ==
{git diff baseBranch...featureBranch}

== TEST CODE DIFF ==
{git diff featureBranch...testerBranch}

== IMPLEMENTATION CONTEXT ==
{summary from .omc/handoffs/exec-*.md}

== DIAGNOSIS TASK ==
Determine the root cause of each failing test.

For each failing test, answer:
1. What behavior is the test asserting?
2. Does the feature code implement that behavior? (look in feature diff)
3. Is the test assertion correct per the spec behavior? (look in test code diff)

FEATURE_BUG: test is correct, feature does not implement the required behavior.
TEST_BUG: feature is correct, test has wrong assertion, wrong setup, or wrong expectation.
MIXED: some failures are feature bugs, others are test bugs — list each separately.

== OUTPUT FORMAT ==
Decision: FEATURE_BUG | TEST_BUG | MIXED
Evidence:
- {test name}: {FEATURE_BUG|TEST_BUG} — {one-sentence explanation}
- {test name}: ...

Fix guidance:
- FEATURE_BUG: {which file + what behavior to fix}
- TEST_BUG: {which test + what assertion to correct}
```

</Triage_Prompt>

<Routing>

### FEATURE_BUG

1. Orchestrator re-spawns exec workers (reading triage fix guidance from handoff).
2. Workers read `.omc/handoffs/team-triage.md` for specific fix targets.
3. After exec: back to `team-review` (must re-approve changed feature code).
4. After review APPROVE: back to `team-testrun`.
5. Loop guard: each pass through triage increments `triage_loop_count`.

### TEST_BUG

1. Orchestrator re-spawns `test-engineer` in tester worktree (reading triage fix guidance).
2. Tester reads `.omc/handoffs/team-triage.md` for specific fixes.
3. Tester fixes test assertions (does NOT change feature code).
4. Lightweight review (sonnet) of test fix.
5. Back to `team-testrun`.
6. Loop guard: triage_loop_count still incremented.

### MIXED

Sequential handling — do NOT run both paths in parallel:
1. Run FEATURE_BUG path first (re-exec → re-review → must APPROVE before proceeding).
2. Then run TEST_BUG path (tester fixes test assertions in the updated tester worktree).
3. After both complete → back to `team-testrun`.

Rationale: FEATURE_BUG path may change interfaces that TEST_BUG fixes depend on. Running in parallel risks test fixes targeting a stale interface.

### ABANDON

When `triage_loop_count` >= `max_triage_loops`:
- Write handoff with decision `ABANDON` and summary of all triage attempts.
- Orchestrator transitions to terminal `failed`.
- User presented with: failing test names + all triage handoffs for manual investigation.

</Routing>

<Handoff_Format>

```markdown
## Handoff: team-triage → {next-stage}

- **Loop**: {triage_loop_count} of {max_triage_loops}
- **Decision**: FEATURE_BUG | TEST_BUG | MIXED | ABANDON
- **Evidence**:
  - {test name}: {FEATURE_BUG|TEST_BUG} — {explanation}
- **Fix guidance**:
  - Feature: [file + behavior to fix, if FEATURE_BUG]
  - Test: [test file + assertion to correct, if TEST_BUG]
- **Remaining**: [any failures not diagnosed, e.g., flaky tests]
```

</Handoff_Format>

<Triage_Worker_Rules>

The triage agent (`code-reviewer` sonnet):
- Reads only. Makes no file changes. Issues no bash commands that modify files.
- Returns structured diagnosis per failing test — not a general "the code looks wrong" assessment.
- Must cite specific lines from feature diff or test code diff as evidence.
- If a test failure is ambiguous (could be either feature bug or test bug): default to `FEATURE_BUG` — shipping a broken feature is worse than an extra exec+review cycle. Only classify as TEST_BUG when evidence clearly shows the feature implements the correct behavior.
- If failure output is truncated or incomplete: note this in evidence and request full output before diagnosing.

</Triage_Worker_Rules>

<Rules>

- Triage agent is read-only. Never spawns sub-agents. Never modifies files.
- `triage_loop_count` increments on every entry to this stage (before spawning agent).
- `ABANDON` is decided by orchestrator before spawning agent — do not spawn reviewer on loop limit.
- Fix guidance in handoff must be specific enough for exec worker or tester to act without re-asking.
- MIXED decisions must list every failing test individually — no grouped "these all have the same issue" unless truly identical root cause.

</Rules>
