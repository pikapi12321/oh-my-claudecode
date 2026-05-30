---
internal: true
name: team-testplan
description: Test planning stage for team pipeline — writes test plan doc from spec in parallel with team-exec, no code
argument-hint: "(internal — invoked by /team orchestrator)"
aliases: []
level: 2
---

# team-testplan

Test planning stage. Runs in PARALLEL with `team-exec`. Produces a test plan document — scenarios, edge cases, happy/error paths — from the spec. No code is written. After writing, a lightweight reviewer checks alignment with spec.

This skill is injected into agent prompts by the team orchestrator. It has no dependency on exec output and does not block exec from running.

<Agents>

| Agent | Model | Role |
|---|---|---|
| `test-engineer` | sonnet | Write test plan document |
| `code-reviewer` | sonnet | Lightweight alignment check after plan written |

</Agents>

<Inputs>

- `.omc/plans/spec.md` — full spec + acceptance criteria from team-plan
- `.omc/plans/interfaces.md` — proposed public interfaces from team-plan (function signatures, error conditions, side effects)
- Task graph from team-plan (passed by orchestrator in prompt)

</Inputs>

<Outputs>

- Test plan document: `.omc/plans/test-plan.md`
- No code, no worktree needed

</Outputs>

<Procedure>

1. Read `.omc/plans/spec.md` and `.omc/plans/interfaces.md` — extract acceptance criteria, task scope, risk flags, and interface contracts.
2. Derive test scenarios:
   - **When `interfaces.md` lists interface changes**: treat each interface contract as the primary test surface. Derive scenarios directly from signatures, error conditions, and side effects. Each function's error conditions → at least one error-path scenario.
   - **When `interfaces.md` says "No Public Interface Changes"**: derive scenarios from acceptance criteria alone (original behavior below).
   - For each acceptance criterion: happy path (expected input → expected output), error/edge case scenarios (boundary values, missing inputs, error states), integration points (where this feature interacts with existing code)
3. Write `.omc/plans/test-plan.md` (see format below).
4. Send plan to lightweight `code-reviewer` (sonnet) for alignment check:
   - Does every acceptance criterion have at least one test scenario?
   - Are error paths covered for each acceptance criterion?
   - Any obvious gaps?
5. If reviewer flags gaps: test-engineer fills them, no re-review needed.
6. Notify orchestrator that test plan is complete (SendMessage).

</Procedure>

<Test_Plan_Format>

```markdown
# Test Plan: <task title>

## Source
Spec: .omc/plans/spec.md (revision noted)

## Coverage Matrix
| Acceptance Criterion | Happy Path | Error Path | Edge Cases |
|---|---|---|---|
| <criterion 1> | scenario S1 | scenario S2 | scenario S3 |
| <criterion 2> | scenario S4 | — | scenario S5 |

## Test Scenarios

### S1: <scenario name>
- **Type**: happy path | error path | edge case
- **Interface**: `functionName(...)` — which contract this tests (omit if scenario is not tied to a specific interface)
- **Setup**: <preconditions>
- **Action**: <what to call / trigger>
- **Expected**: <what should happen>
- **Notes**: <anything test-code author needs to know>

### S2: ...

## Integration Points
- <component A> calls <component B> — verify interface contract
- <component C> reads from <store D> — verify read/write consistency

## Out of Scope
- <what is NOT tested in this plan and why>
```

</Test_Plan_Format>

<Alignment_Review_Prompt>

Lightweight reviewer receives:

```
Review this test plan against the spec for coverage gaps only.
Spec: {spec content}
Test plan: {test plan content}

Check:
1. Every acceptance criterion has at least one happy-path scenario.
2. Every acceptance criterion has at least one error/edge scenario.
3. No obviously critical path is missing.

Return:
- ALIGNED: <brief confirmation>
OR
- GAPS: <specific missing scenarios by criterion>
```

If GAPS: test-engineer adds missing scenarios directly.
- If GAPS listed ≤3 missing scenarios: no re-review needed.
- If GAPS listed >3 missing scenarios: run a second alignment check on the filled plan (same prompt, same reviewer). One re-check maximum.

</Alignment_Review_Prompt>

<Parallelism_Contract>

This stage runs concurrently with `team-exec`. Rules:
- Read-only from `.omc/plans/spec.md` (written by team-plan, stable).
- Write to `.omc/plans/test-plan.md` only — no exec worktree access.
- Does NOT block exec workers and is NOT blocked by them.
- Orchestrator waits for BOTH `team-exec` AND `team-testplan` to complete before starting `team-review`.

</Parallelism_Contract>

<Rules>

- No code written in this stage. Test plan is a document only.
- No worktree needed — reads from `.omc/plans/`, writes to `.omc/plans/`.
- Do not wait for exec to complete. Run purely from spec.
- Scenarios must be concrete enough for `team-testcode` to translate directly into test code without re-reading the spec.
- If spec is ambiguous on a behavior, note it explicitly in the scenario's Notes field.

</Rules>
