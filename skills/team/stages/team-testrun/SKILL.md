---
internal: true
name: team-testrun
description: Test execution stage for team pipeline — runs test suite in tester worktree, routes to triage on failure
argument-hint: "(internal — invoked by /team orchestrator)"
aliases: []
level: 2
---

# team-testrun

Test execution stage. Lead runs the test suite inline (no agent spawn needed). Collects pass/fail results. On PASS: proceeds to `team-commit`. On FAIL: hands off to `team-triage` with full failure output.

This stage is run inline by the orchestrator lead, not via a spawned agent.

<Inputs>

- Tester worktree path: from `.omc/handoffs/test-code.md` (`Worktree` field)
- Test command: from `.omc/handoffs/test-code.md` (`Test command` field)

</Inputs>

<Outputs>

- Decision: `PASS` or `FAIL`
- On FAIL: failure output written to `.omc/handoffs/testrun-failure.md` for triage

</Outputs>

<Procedure>

1. Read `.omc/handoffs/test-code.md` to get worktree path and test command.
2. Run test suite in tester worktree:
   ```bash
   cd {tester_worktree_path} && {test_command}
   ```
3. Collect output: exit code, passing test count, failing test names, full error output.
4. Evaluate result:
   - Exit code 0 AND all tests pass → `PASS`
   - Exit code non-zero OR any test failures → `FAIL`

### On PASS

1. Write `.omc/handoffs/testrun-pass.md`:
   ```markdown
   ## Test Run: PASS
   - Tests: {pass_count} passed, 0 failed
   - Command: {test_command}
   - Worktree: {tester_worktree_path}
   ```
2. Transition to `team-commit`.

### On FAIL

1. Write `.omc/handoffs/testrun-failure.md`:
   ```markdown
   ## Test Run: FAIL
   - Tests: {pass_count} passed, {fail_count} failed
   - Command: {test_command}
   - Worktree: {tester_worktree_path}

   ## Failing Tests
   {failing test names and error messages, verbatim}

   ## Full Output
   {complete test runner output}
   ```
2. Transition to `team-triage`.

</Procedure>

<Test_Command_Detection>

If `.omc/handoffs/test-code.md` does not specify a test command, detect from project:

| Signal | Command |
|---|---|
| `package.json` has `"test"` script | `npm test` |
| `vitest.config.*` exists | `npx vitest run` |
| `jest.config.*` exists | `npx jest` |
| `pytest.ini` or `pyproject.toml` with `[tool.pytest]` | `python -m pytest` |
| `go.mod` exists | `go test ./...` |
| `Cargo.toml` exists | `cargo test` |
| None of the above | Fail with: "Cannot determine test command. Add test command to .omc/handoffs/test-code.md" |

</Test_Command_Detection>

<Triage_Routing>

On FAIL, orchestrator passes to `team-triage` with:
- Failure output from `.omc/handoffs/testrun-failure.md`
- Feature diff: `git diff {baseBranch}...{featureBranch}`
- Test code diff: `git diff {featureBranch}...{testerBranch}`

Triage determines whether failure is a feature bug or a test bug, then routes accordingly. After triage fix, orchestrator re-runs `team-testrun` (same procedure — back to step 1).

</Triage_Routing>

<Loop_Guard>

`team-testrun` itself has no loop counter — it is a pure read/execute/route step. Loop counting is in `team-triage` (`triage_loop_count`). If triage loop count reaches `max_triage_loops`, triage returns `ABANDON` and testrun transitions to `failed`.

</Loop_Guard>

<Rules>

- Lead runs test suite inline — do not spawn an agent for this step.
- Run from inside the tester worktree (not the feature worktree, not base).
- Do not modify any files. This stage is read + execute only.
- Capture complete output verbatim — triage needs the full error messages, not a summary.
- A single skipped test is not a failure. Only treat as FAIL on actual test failures (non-zero exit or explicit failure markers).
- If the test command itself cannot be found or invoked, write this as a FAIL with error "test command not found: {command}" and route to triage.

</Rules>
