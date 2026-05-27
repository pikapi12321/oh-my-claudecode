---
name: quickplan
description: Lightweight planning — Planner runs inline, N parallel reviewer agents, up to 5 iterations. Faster than ralplan with same quality gate.
argument-hint: "[--interactive] [--deliberate] [--no-tests] [--reviewers N] <task description>"
level: 4
---

<Purpose>
Quickplan is a faster alternative to ralplan. The Planner runs inline in the main thread (no agent spawn overhead). Review is handled by N parallel sub-agents each assigned a distinct critical perspective. Up to 5 revision iterations. Output is identical in quality to ralplan but completes significantly faster because: (1) no Planner spawn, (2) reviewers run in parallel not sequentially.
</Purpose>

<Flags>

- `--interactive`: Enable user prompts at draft review (after first plan draft) and final approval. Without this flag the workflow runs fully automated — Planner produces plan, reviewers evaluate in parallel, revisions happen automatically, final plan is marked `pending approval` and output stops.
- `--deliberate`: Force expanded mode. Adds pre-mortem (3 scenarios) + expanded test plan (unit/integration/e2e/observability). Without this flag, deliberate mode still auto-enables when the request signals high risk (auth/security, migrations, destructive changes, production incidents, compliance/PII, public API breakage).
- `--no-tests`: Omit the test/acceptance-criteria section from the plan. Useful for research spikes, documentation tasks, or exploratory work where test spec is not applicable.
- `--reviewers N`: Number of parallel reviewer agents (default: 2, min: 1, max: 5). The Planner assigns each reviewer a distinct perspective before spawning. With 2 reviewers the perspectives are architectural soundness and quality/testability. With more reviewers additional perspectives are added: security & edge cases (3rd), performance & scalability (4th), maintainability & DX (5th).

</Flags>

<Planning_Execution_Boundary>
Quickplan is a planning module. It may inspect context and draft or update plan/spec/proposal artifacts, but it MUST mark those artifacts as `pending approval` unless the user has explicitly opted into execution in the current turn or via the structured approval UI. Before explicit execution approval, it MUST NOT run mutation-oriented shell commands, edit source files, commit, push, open PRs, invoke execution skills, or delegate implementation tasks.
</Planning_Execution_Boundary>

<Steps>

### Step 0 — Codebase context (inline, no agent)

Before drafting, gather relevant facts inline:
- Read key files identified from the task description
- Use `codegraph_context` if `.codegraph/` exists, otherwise use `Grep`/`Glob`
- Identify affected files, existing patterns, and constraints
- **Do NOT spawn an agent for this** — use tools directly in the main thread

### Step 1 — Draft plan (inline, no agent)

Produce a structured plan inline. Format:

```
## Goal
One sentence.

## Steps
Numbered, each step: action + target file/symbol + expected outcome.

## Files Touched
List of files likely affected with brief reason.

## Acceptance Criteria
[ ] Testable criteria (omit section if --no-tests)

## Risks
≤3 risks with mitigation.

## Pre-mortem (deliberate mode only)
3 failure scenarios with mitigations.
```

Save draft to `.omc/plans/quickplan-{task-slug}.md` with status `draft`.

### Step 2 — User draft review *(--interactive only)*

If `--interactive`, use `AskUserQuestion`: present the draft plan with options:
- Proceed to parallel review
- Request changes before review
- Skip review and mark pending approval

If not `--interactive`, automatically proceed to Step 3.

### Step 3 — Parallel reviewer agents

Spawn N reviewer agents **in a single parallel batch** (all in the same message, never sequentially). The Planner assigns each reviewer a distinct perspective before spawning.

**Default perspective assignments (N=2):**
- Reviewer 1 — **Architectural**: soundness, component boundaries, data flow, coupling, scalability. Must provide steelman antithesis + at least one real tradeoff tension.
- Reviewer 2 — **Quality/Critic**: testability of acceptance criteria, risk completeness, step granularity, missing edge cases. Must enforce concrete verification steps.

**Additional perspectives when N>2:**
- Reviewer 3 — **Security & Edge Cases**: threat surface, input validation, auth boundaries, failure modes, data integrity.
- Reviewer 4 — **Performance & Scalability**: hot paths, N+1 queries, memory bounds, concurrency hazards.
- Reviewer 5 — **Maintainability & DX**: naming, abstraction leakage, test ergonomics, future modifier traps.

Each reviewer prompt MUST include:
1. The full plan text
2. Their assigned perspective label
3. Instruction: return `APPROVE` (with brief rationale) or `ITERATE` (with specific, actionable feedback — no vague complaints)
4. Instruction: be genuinely critical, not diplomatic — flag real issues even if minor

**Await all reviewer results before Step 4.**

### Step 4 — Revision loop (max 5 iterations)

**HARD GATE: You MUST NOT proceed to Step 5 until ALL reviewers return `APPROVE` OR 5 iterations have been exhausted. Stopping after one revision without re-running reviewers is a protocol violation.**

Track iteration count (starts at 1 after the first Step 3 run).

```
LOOP:
  if ALL reviewers returned APPROVE → exit loop → go to Step 5
  if iteration count >= 5 → exit loop (use best version, note outstanding concerns) → go to Step 5
  otherwise:
    1. Collect every ITERATE feedback point
    2. Revise plan inline addressing each point
    3. Increment iteration count
    4. RE-SPAWN all N reviewer agents in parallel (same perspectives as before) with the revised plan
    5. Await all reviewer results
    6. Return to top of LOOP
```

After each revision, the reviewers MUST re-evaluate the revised plan — they do not carry forward previous verdicts. Each loop iteration is a fresh parallel spawn.

### Step 5 — Final output

Mark plan as `pending approval` in `.omc/plans/quickplan-{task-slug}.md`.

Output the final plan to the user.

*(--interactive only)*: Use `AskUserQuestion` with options:
- Approve execution via team (Recommended)
- Approve execution via ralph
- Request changes
- Reject

On approval, invoke the chosen execution skill — never implement directly.

</Steps>

<Quality_Standards>
- 80%+ claims must cite a file or line number
- 90%+ acceptance criteria must be concretely testable
- Each step must name a specific target (file, function, or interface) — not "update relevant files"
- Risks must include mitigations, not just problem statements
</Quality_Standards>
