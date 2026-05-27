---
name: team-testcode
description: Test code writing stage for team pipeline — tester branches from approved feature branch and writes test code
argument-hint: "(internal — invoked by /team orchestrator)"
aliases: []
level: 2
---

# team-testcode

Test code writing stage. Starts ONLY after `team-review` returns `APPROVE` for the feature code. A `test-engineer` worker branches from the feature branch (not base), translates the test plan into actual test code, then receives a lightweight review.

This skill is injected into agent prompts by the team orchestrator. The tester worker follows the same worker preamble as exec workers, with tester-specific constraints.

<Agents>

| Agent | Model | Role |
|---|---|---|
| `test-engineer` | sonnet | Write test code in tester worktree |
| `code-reviewer` | sonnet | Lightweight review of test code |

</Agents>

<Inputs>

- `.omc/plans/test-plan.md` — test scenarios to implement
- Feature branch (stable, approved by team-review): branch name from `state.feature_branch`
- Feature code interface (available in feature branch worktree)

</Inputs>

<Outputs>

- Test code committed to tester worktree branch
- Handoff written to `.omc/handoffs/test-code.md`

</Outputs>

<Procedure>

1. Orchestrator creates tester worktree branching FROM the feature branch (not base):
   ```
   createWorkerWorktree(teamName, "tester", repoRoot, featureBranch)
   ```
   This ensures tests can import the stable, approved feature interface.

2. Orchestrator spawns `test-engineer` worker with tester prompt (see below).

3. `test-engineer` in tester worktree:
   a. Read `.omc/plans/test-plan.md` — scenarios are the source of truth.
   b. Explore existing test infrastructure in worktree:
      - Test runner config (jest.config, vitest.config, pytest.ini, etc.)
      - Existing test patterns and file naming conventions
      - Test utilities, fixtures, mocks available
   c. Detect test command from project (same detection table as team-testrun: `package.json` `"test"` script → `npm test`, `vitest.config.*` → `npx vitest run`, etc.). Write detected command to handoff.
   d. For each scenario in test plan: write test code matching existing patterns.
   e. Run existing test suite to verify new tests don't break passing tests.
   e. Do NOT fix feature code — if interface doesn't match test plan, note it in handoff.
   f. Write handoff to `.omc/handoffs/test-code.md`.
   g. SendMessage to team-lead: "Test code complete."

4. Orchestrator spawns `code-reviewer` (sonnet) for lightweight test code review:
   - Are tests well-structured and following project conventions?
   - Does each test correspond to a scenario in the test plan?
   - Any tests that would always pass or always fail regardless of implementation?

5. If reviewer flags issues: test-engineer fixes directly (no re-review).

6. Orchestrator transitions to `team-testrun`.

</Procedure>

<Tester_Worker_Prompt_Structure>

```
{standard_worker_preamble}

== YOUR ASSIGNMENT ==
Role: test-engineer
Worktree: {tester_worktree_path} (branched from feature branch: {feature_branch})

You are writing TEST CODE only. Do NOT modify feature code.

== INPUTS ==
- Test plan: .omc/plans/test-plan.md — implement every scenario listed
- Feature interface: read from your worktree (already contains approved feature code)

== PROCEDURE ==
1. Explore existing test infrastructure (runner, patterns, fixtures, mocks).
2. Detect test command from project files (vitest.config, jest.config, package.json test script, pytest.ini, etc.).
3. For each scenario in test-plan.md: write a test matching project conventions.
4. Run existing tests to verify no regressions using the detected command.
5. If feature interface doesn't match what test plan expects: note in handoff, do NOT change feature code.
6. Write .omc/handoffs/test-code.md (include detected test command in "Test command" field).
7. SendMessage to team-lead: "Test code complete."

== RULES ==
- Write tests only. Never touch feature code files.
- Match existing test file naming, directory structure, and import patterns.
- Each test must correspond to exactly one scenario ID from the test plan.
- Do not write tests for behaviors not in the test plan.
- If a scenario is untestable as written, note it in handoff under "Untestable scenarios".
```

</Tester_Worker_Prompt_Structure>

<Handoff_Format>

```markdown
## Handoff: team-testcode → team-testrun

- **Files created**: [test file paths]
- **Scenarios covered**: [S1, S2, S3, ...]
- **Untestable scenarios**: [Sn — reason, e.g., "requires live network, mocking needed"]
- **Interface mismatches**: [if feature interface differs from test plan expectations]
- **Worktree**: {tester_worktree_path}
- **Branch**: {tester_branch_name}
- **Test command**: {command to run the test suite}
```

</Handoff_Format>

<Worktree_Dependency>

The tester worktree MUST branch from the feature branch:

```
base ──── feature branch (worker-1 work) ────────────────────
                        └──── tester branch (test code here)
```

This ensures:
- Tests can import the stable approved feature interface without workarounds.
- Merge order in `team-commit` is always: feature first, then test.
- Test code never modifies feature files (separate branch prevents accidental cross-contamination).

</Worktree_Dependency>

<Rules>

- Do NOT start until feature interface is stable: either `team-review` returns `APPROVE`, OR `--no-review` flag is set (in which case exec completion = stable signal).
- Tester worktree branches from `state.feature_branch`, not from base branch.
- Test code must not modify feature implementation files. If a tester accidentally modifies feature files, it is a protocol violation — orchestrator must flag and re-run.
- One test per scenario ID from the test plan. Tests not corresponding to a scenario ID should not be written.
- Tester writes tests for the interface as it exists in the feature branch — not for a hypothetical ideal interface.

</Rules>
