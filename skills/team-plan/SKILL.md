---
name: team-plan
description: Planning stage for team pipeline — explores codebase, produces spec + task graph, decides tester track
argument-hint: "<task description>"
aliases: []
level: 2
---

# team-plan

Planning stage of the team pipeline. Runs `explore` + `planner` (+ optional `analyst`/`architect`) to produce a spec document and task graph. Also decides whether the tester track is active.

This skill is injected into agent prompts by the team orchestrator. Sub-skill agents do NOT call `TeamCreate`, `TaskCreate`, or `Task`.

<Agents>

| Agent | Model | Role |
|---|---|---|
| `explore` | haiku | Scan codebase, gather context, map relevant files |
| `planner` | opus | Synthesize spec, decompose into task graph |
| `analyst` | opus | Optional — use when requirements are ambiguous |
| `architect` | opus | Optional — use when task spans complex system boundaries |

Lead selects `analyst` when user request is ambiguous or under-specified. Lead selects `architect` when task touches multiple system boundaries (e.g., new service, protocol change, data migration).

</Agents>

<Inputs>

- Task description (from user)
- Codebase context (from `explore` agent scan)
- Optional: prior handoffs in `.omc/handoffs/` (for resumed runs)

</Inputs>

<Outputs>

1. **Spec document** — written to `.omc/plans/spec.md`
2. **Interface definitions** — written to `.omc/plans/interfaces.md`
3. **Task graph** — a flat list of tasks with dependency ordering (used by orchestrator to create `TaskCreate` calls)
4. **Handoff** — written to `.omc/handoffs/team-plan.md`
5. **Tester track decision** — announced to user, can be overridden

</Outputs>

<Procedure>

1. **Explore phase** — `explore` (haiku) scans codebase:
   - Identify relevant files, modules, entry points
   - Map existing test infrastructure (test runner, test dirs, patterns)
   - Identify constraints (locked files, critical paths, shared types)
   - Output: context summary handed to planner

2. **Plan phase** — `planner` (opus) synthesizes:
   - Acceptance criteria from task description + codebase context
   - Tech decisions (patterns to follow, files to create/modify)
   - Task decomposition: each task file-scoped or module-scoped to avoid worker conflicts
   - Dependency ordering between tasks
   - Risk flags (auth/crypto/DB/payment touches → note for reviewer tier selection)

3. **Interface definition phase** — `planner` writes `.omc/plans/interfaces.md`:
   - Extract every new or changed **public** interface from the task scope: functions, methods, API endpoints, exported types
   - For each: write signature + behavioral contract (inputs, outputs, errors, side effects)
   - Error conditions and side effects are the primary test surface — be explicit
   - Mark each interface `[new]` (introduced by this task) vs `[stable]` (existing API being modified)
   - If no public interface changes (e.g., pure internal refactor): write a single line noting this — do NOT omit the file
   - Internal implementation details go in spec.md, not here

4. **Tester track decision**:
   - Scan task type → apply heuristic:
     - Features, bug fixes, refactors → tester track ON
     - Docs, config, scripts, tooling-only → tester track OFF
     - Ambiguous → default ON
   - If `--no-tests` already in orchestrator state: skip detection, set track OFF, do not prompt.
   - Otherwise: announce decision and proceed immediately — do NOT block waiting for user input.
     Example: "Test track: ON (new feature detected). Pass --no-tests to this skill to skip."

5. **Write spec** — `planner` writes `.omc/plans/spec.md`:

```markdown
# Spec: <task title>

## Goal
<what must be true when done>

## Acceptance Criteria
- [ ] <criterion 1>
- [ ] <criterion 2>

## Technical Decisions
- <decision and rationale>

## Task Graph
| ID | Description | Depends On | Assigned To |
|----|-------------|------------|-------------|
| T1 | <task>      | —          | worker-1    |
| T2 | <task>      | T1         | worker-2    |

## Risk Flags
- <e.g., "touches auth middleware — force Deep review tier">
- <e.g., "modifies shared types — T1 must complete before T2">

## Files Affected
- <path>: <what changes>
```

6. **Write handoff** — lead writes `.omc/handoffs/team-plan.md`:

```markdown
## Handoff: team-plan → team-exec

- **Decided**: [key decisions — tech choices, decomp strategy, worker count]
- **Rejected**: [alternatives considered and why]
- **Risks**: [for exec stage — e.g., shared type conflict, missing dep]
- **Files**: [spec.md, interfaces.md, any design docs]
- **Tester track**: ON | OFF — <reason>
- **Remaining**: [items exec needs to handle that plan didn't resolve]
```

</Procedure>

<Interfaces_Format>

```markdown
# Interfaces: <task title>

## Changed Interfaces

### <file or module path>

#### `functionName(param: Type): ReturnType` [new|stable]
- **Purpose**: one-sentence description
- **Inputs**: `paramName` — type, constraints, validation rules
- **Outputs**: return shape on success
- **Errors**: conditions under which it throws / rejects / returns an error value
- **Side effects**: mutations, I/O, events emitted (omit section if none)

### <another file or module>
...

## New Types / Schemas

### `TypeName` [new|stable]
```ts
// inline type or interface definition
```

## No Public Interface Changes
<!-- Use when task only modifies internal implementation — refactor, docs, config, etc. -->
```

</Interfaces_Format>

<Task_Graph_Format>

The task graph is passed to the orchestrator as a structured list. Each entry becomes a `TaskCreate` call:

```json
[
  {
    "id": "T1",
    "subject": "Fix type errors in src/auth/",
    "description": "Fix all TypeScript errors in src/auth/login.ts, src/auth/session.ts, src/auth/types.ts. Run tsc --noEmit to verify.",
    "activeForm": "Fixing auth type errors",
    "blockedBy": []
  },
  {
    "id": "T2",
    "subject": "Fix type errors in src/api/",
    "description": "Fix all TypeScript errors in src/api/routes.ts, src/api/middleware.ts. Depends on shared types in src/auth/types.ts being fixed first.",
    "activeForm": "Fixing api type errors",
    "blockedBy": ["T1"]
  }
]
```

Rules:
- Each task scoped to one file or one module — no task spans 5+ unrelated files.
- Shared type dependencies explicit in `blockedBy` using symbolic IDs (T1, T2, ...) — NOT runtime task IDs.
- Orchestrator resolves symbolic IDs to real `TaskCreate` response IDs after creating all tasks in order.
- Task description includes verification step (e.g., `tsc --noEmit`, `npm test`).
- Worker assignment pre-planned to avoid race conditions (lead assigns owners before spawning).

</Task_Graph_Format>

<Tester_Track_Decision>

Auto-detect heuristics (in priority order):

1. `--no-tests` flag → always OFF
2. `ops.enableTestTrack = "never"` → always OFF
3. `ops.enableTestTrack = "always"` → always ON
4. `ops.enableTestTrack = "auto"` (default):
   - Task contains: "add feature", "implement", "create", "build", "new" → ON
   - Task contains: "fix bug", "fix crash", "fix regression" → ON
   - Task contains: "refactor", "rename", "reorganize", "restructure" → ON
   - Task is only: "update docs", "update README", "update config", "bump version", "fix typo" → OFF
   - Ambiguous → ON (default to testing)

Announce to user before proceeding. User can type `--no-tests` to override.

</Tester_Track_Decision>

<Rules>

- Do NOT call `TeamCreate`, `TaskCreate`, `Task`, or `TeamDelete`. These are orchestrator tools only.
- Spec must be complete enough for `team-exec` workers to act without re-reading this stage.
- Task descriptions must be self-contained — workers do not read the spec during exec unless explicitly instructed.
- Risk flags in spec feed directly into reviewer tier selection in `team-review`.
- If `analyst` needed: lead spawns analyst, passes task description, analyst returns clarified requirements, planner incorporates.
- Handoff is 10–20 lines max. Full spec lives in `spec.md`, not the handoff.

</Rules>

<Examples>

**Example spec excerpt for "add OAuth login":**

```markdown
## Task Graph
| ID | Description | Depends On |
|----|-------------|------------|
| T1 | Add OAuth provider config to src/auth/config.ts | — |
| T2 | Implement OAuth callback handler in src/auth/oauth.ts | T1 |
| T3 | Update session middleware to handle OAuth tokens | T2 |
| T4 | Add OAuth login button to src/components/Login.tsx | T1 |

## Risk Flags
- Touches auth middleware — force Deep review tier
- T3 modifies shared session type — T3 must complete before any consumer tasks
```

**Example tester track announcement:**
```
Plan complete. Test track: ON (new feature: OAuth login detected).
Spec written to .omc/plans/spec.md.
Starting team-exec and team-testplan in parallel.
Override test track: add --no-tests to your next message.
```

</Examples>
