---
name: team
description: Persistent role-collaboration team — heterogeneous roles, each a long-lived session that owns a knowledge domain, coordinating over an event-driven pipeline
argument-hint: "[--init | --add-member | --del-member] [template] [ralph] <task or team description>"
aliases: []
level: 4
---

# Team Orchestrator

Stand up a **team of persistent, heterogeneous roles** to deliver a task. Each role is a long-lived session (subprocess) that owns one knowledge domain and keeps a stable context for its whole lifetime. Roles collaborate directly over an event-driven pipeline; the orchestrator (this skill, the lead session) coordinates rather than relays.

This replaces the older subagent-pool design (N identical executors draining a pre-assigned queue). Built on Claude Code native team tools. Supersedes the removed `/swarm` (#1131) and the stage-pipeline model.

<Core_Principle>

> **A role is a knowledge domain.** Tasks that draw on the same context belong to the same role. A role keeps a stable context across the whole session so its knowledge compounds. A role that context-switches is doing several jobs and doing each badly.

Three derived rules:

1. **Persistent identity** — a role lives from creation to session end (or explicit `--del-member`), accumulating knowledge across pipeline phases. Never a one-shot spawn.
2. **Context isolation** — review is isolated from implementation; architect never touches implementation detail; an implementer never reaches into another domain. Each protects its own context.
3. **Orchestrator is an assistant, not a switchboard** — it manages membership, records tasks, handles escalations, relays human intent. It does NOT sit on the critical path of every message.

</Core_Principle>

<Roles>

Minimal role set. Each row lists what the role stably holds (knowledge / mindset) vs. what is injected per unit of work.

| Role | Stably holds | Injected per work item | Worktree | Writes code |
|---|---|---|---|---|
| **orchestrator** (lead) | Task goal, team roster, pipeline state | — | ❌ | ❌ |
| **architect** | System structure, component relations, interface contracts, tech debt | — | ❌ | ❌ (docs only) |
| **plan-reviewer** | Plan-review methodology + accumulated plan-defect patterns | plan + human spec | ❌ | ❌ |
| **implementer**×N | One code domain's implementation detail + local conventions | the current task | ✅ | ✅ |
| **code-reviewer**×N | Code-review methodology + project anti-patterns | interface contract + diff | ❌ | ❌ |
| **test-engineer** | Expected behavior, edge cases, coverage map, quality bar | new interface defs | ✅ | ✅ |
| **security** (optional) | Threat model, vulnerability patterns | diff | ❌ | ❌ |

Each role's full prompt lives in `roles/<role>.md`. The orchestrator injects that file's content when spawning the role.

**Domain partitioning:** the lead decides domain boundaries at `--init` (by module, or by layer — a layer is just a coarse module). Each domain gets **one implementer + one code-reviewer** so implementation and review stay isolated yet paired. Reviewers scale with domains, not with worker count.

**Hard boundaries:**
- Architect reviews "does this code match the design?" — never implementation detail.
- Implementers never cross-review each other (reaching into another domain pollutes both contexts).
- Reviewers hold a **critical mindset + accumulated project anti-patterns**, not domain implementation knowledge. The review baseline (contract + spec) is injected each time so they know *what* to check against.
- **Interface ownership is the architect's.** An implementer that finds an interface must change escalates to the architect; the architect updates the design and broadcasts. Implementers do not unilaterally redefine shared interfaces.

**Roles deliberately NOT separate:** standalone debugger (debugging draws on knowledge the implementer or test-engineer already holds — a separate debugger has the weakest context). Tech-writer folds into implementer unless docs are large enough to be their own domain.

</Roles>

<Lifecycle>

Roles are bound to the lead session. Lead session ends → all roles go offline. A role persists until explicitly removed.

### Create — guided questionnaire

```
/team --init "build auth module"   (or a fuller team description)
```

1. Orchestrator analyzes the task and selects a starting **template** (see `templates.md`) or composes one.
2. It recommends roles **one at a time**, questionnaire-style, each with a one-line rationale. The user accepts/skips per role — selective acceptance keeps the cognitive load low.
3. For accepted roles: resolve routing (per-role provider/model), create worktrees only for code-writing roles, spawn each as a persistent session with its `roles/<role>.md` prompt.
4. Write initial state (see State Schema). The architect begins planning; everyone else stands by for their trigger.

If the user passes a known template name (`/team --init feature "…"`), seed the questionnaire from that template.

### Grow / shrink — dynamic membership

```
/team --add-member "security auditor for the token flow"
/team --del-member code-reviewer-auth
```

- `--add-member` → resolve role from description, create worktree if it writes code, spawn one persistent session, announce it to upstream/downstream peers. Backed by engine `scaleUp`.
- `--del-member` → graceful shutdown of that one role (drain → shutdown_request → confirm → remove). Backed by engine `scaleDown`. Other roles keep running.

### Default invocation

`/team "<task>"` with no `--init` runs the questionnaire non-interactively: orchestrator picks the template, spawns the default roster, and proceeds. `/team ralph "<task>"` wraps the pipeline in a Ralph persistence loop.

</Lifecycle>

<Communication_Topology>

Event-driven pipeline. Roles message **peers directly** along pipeline edges; the orchestrator only handles escalations.

```
        Human ───────────────────────────────────────────────┐
          │ (spec / requirement revision; may reach any role)  │
          ▼                                                     │
     Orchestrator ◄──── escalation (block / phase-done / conflict / spec-change) ─┐
          │ (task delegation, decisions)                        │                 │
          ▼                                                      │                 │
     Architect ◄──────────────── design questions ──────────────┼──── Implementer×N
          │ plan + interfaces                                    │         │
          ▼                                                      │         │ commit + handoff
     Plan-reviewer ── REVISE ─► Architect                        │         ▼
          │ APPROVE                                              │   Code-reviewer×N
          ▼                                            ITERATE   │         │
     Orchestrator (trigger exec) ─────────────────────────────────────────┘ (back to implementer)
          │                                                                │ APPROVE
          ▼                                                                ▼
     Implementer×N ◄──── behavior checks ────► Test-engineer ──────────────┘
          │ all domains PASS
          ▼
     Orchestrator ──── report ───► Human
```

**Rules:**
- Roles connected by a pipeline edge talk **directly** via `SendMessage` (peer-to-peer; the engine routes to any named recipient, not just the lead).
- The orchestrator receives only three message classes: **block** (cannot proceed, needs a decision), **phase-done** (a role finished its slice), **conflict** (cross-domain coordination failed). It is an escalation handler, not a relay.
- **Human is first-class** and may contact any role directly. The contacted role is **responsible for notifying the orchestrator of any spec change**:
  ```
  human → architect: "requirement changed: X → Y"
  architect → orchestrator: { type:"spec_updated", delta:"X→Y", impact:["task#3","task#5"] }
  orchestrator: pause affected tasks / notify relevant implementers / re-trigger plan review
  ```
- Cross-domain implementer coordination: direct peer message **plus** a note in shared state so the orchestrator stays informed (a public channel, not a back-room DM).
- Use peer `message`, not `broadcast`, by default. Broadcast only for genuinely team-wide changes (e.g., an interface the architect just revised).

</Communication_Topology>

<Task_Allocation>

Pull model. Tasks carry a `domain` tag; the owning implementer claims them.

```
Architect decomposes the plan → task list (each task: domain tag + blockedBy)
   ▼
Orchestrator records tasks into TaskList (records only — does not decompose)
   ▼
Implementer pulls tasks for its own domain (claim by domain tag)
   ▼
Implementer silently splits sub-tasks (parent_task_id; no orchestrator notice needed)
```

- **Pull beats push:** the orchestrator need not track each implementer's live capacity; load balances naturally; it only watches for tasks that sit unclaimed too long, then intervenes.
- **One domain = one implementer**, so claiming is uncontended — non-atomic claim is fine (no race by construction).
- **Cross-domain tasks** escalate to the orchestrator to assign or coordinate.
- **Review / test work does NOT go through TaskList** — it is purely event-driven: `implementer done → SendMessage → code-reviewer fires → APPROVE → SendMessage → test-engineer fires`.

</Task_Allocation>

<IO_Contracts>

Each role declares three things: what it needs, what it produces, who it hands to. Hybrid typing.

- **Strong-typed:** file paths/locations (machine knows where to read/write).
- **Soft-typed:** content-quality requirements (the downstream role judges sufficiency in natural language).
- **Delivery:** files store content (source of truth) + messages trigger the downstream (event notice).
- **Pipeline is statically defined**; contracts are for validation, not auto-wiring (one output may have several legal downstreams — wiring isn't unique).
- **Role memory is self-maintained** — reviewers write their own `.omc/team/review-patterns/*.md`; the longer they run, the better they know where this project breaks.

```yaml
role: architect
input:
  required: [human_spec, codebase_overview]
output:
  - { artifact: plan,       path: .omc/team/plan/architect-plan.md }
  - { artifact: interfaces, path: .omc/team/interfaces/ }   # spec docs, NOT importable code
trigger_downstream:
  - { role: plan-reviewer, inject: [plan, interfaces] }

role: plan-reviewer
input:
  required: [plan, human_spec]                              # spec = the review baseline
  context_files: [.omc/team/review-patterns/plan.md]        # self-maintained, accumulated
output:
  - { artifact: verdict, values: [APPROVE, REVISE] }
  - { artifact: notes,   path: .omc/team/reviews/plan-review.md }
on_approve: orchestrator → trigger implementers
on_revise:  architect (feedback injected)
```

</IO_Contracts>

<Worktree_Layout>

**Only code-writing roles get a worktree.** Everyone else operates on the shared `.omc/team/` tree — directly visible on the filesystem, no commit needed.

```
repo-root/
  .omc/team/                       ← shared space, all roles read/write, no commit needed
    spec.md                        ← human requirement
    plan/architect-plan.md
    interfaces/                    ← architect's interface specs (docs, not import targets)
    reviews/{plan,code}.md
    review-patterns/{plan,code}.md ← reviewers' self-maintained memory
    handoffs/
  .omc/worktrees/{team}/
    implementer-<domain>/          ← that domain's code
    test-engineer/                 ← tests, branched from an implementer branch
```

**Commit visibility:**
- Architect / reviewer artifacts → written to `.omc/team/`, visible immediately, **no commit**.
- Implementer code → must `git commit` before a reviewer can `git diff` it:
  ```
  implementer done → git commit → SendMessage(code-reviewer-<domain>, "PR ready on branch X")
  code-reviewer → git diff <base>...X → writes .omc/team/reviews/code.md
  code-reviewer APPROVE → SendMessage(test-engineer, "branch X approved")
  test-engineer → git checkout -b test/X --track X → writes tests
  ```

Worktrees survive individual role idle/exit; cleaned only on team shutdown. API reference in the engine: `createWorkerWorktree`, `removeWorkerWorktree`, `mergeWorkerBranch`, `mergeAllWorkerBranches`, `cleanupTeamWorktrees` (see `src/team/git-worktree.ts`). Branch names are sanitized; paths validated against traversal.

</Worktree_Layout>

<Orchestrator_Responsibilities>

The lead session is the ONLY one that calls `TeamCreate` / `TeamDelete`, `TaskCreate` / `TaskUpdate` (record-only), `scaleUp` / `scaleDown`, and that spawns role sessions.

### Startup

1. Parse input: extract mode (`--init`/`--add-member`/`--del-member`), template, task, `ralph`.
2. `state_read(mode="team")`. If `active=true` and `current_phase` non-terminal → resume.
3. `TeamCreate` → become `orchestrator@{team_name}`.
4. Run the `--init` questionnaire (or seed from template / default roster).
5. Spawn accepted roles as persistent sessions (inject `roles/<role>.md`). Architect starts planning.
6. Drive the pipeline by **reacting to escalations and phase-done events**, not by relaying. Write state on each phase transition.
7. On completion: shutdown roles → `TeamDelete` → `state_clear(mode="team")`.

### Phase transitions the orchestrator owns

| Trigger | Orchestrator action |
|---|---|
| architect: plan ready | trigger plan-reviewer |
| plan-reviewer: APPROVE | record tasks into TaskList, signal implementers to pull |
| plan-reviewer: REVISE | route feedback to architect (loop, bounded by `max_review_loops`) |
| code-reviewer: ITERATE (escalated) | implementer already handles inline; orchestrator only tracks loop count vs `max_fix_loops` |
| test-engineer: all domains PASS | merge branches → commit phase |
| any role: block / conflict / spec_updated | pause affected work, decide, re-dispatch |

The orchestrator does not micromanage exec/review/test handoffs — those flow peer-to-peer. It steps in at phase boundaries and escalations only.

</Orchestrator_Responsibilities>

<State_Schema>

Write on every phase transition via `state_write(mode="team", ...)`. All values are strings — coerce on read (`parseInt`, `=== 'true'`).

```
state_write(mode="team", active=true, current_phase="plan", state={
  "team_name":          "build-auth",
  "template":           "feature",
  "task":               "build auth module",
  "roster":             "architect,implementer-auth,code-reviewer-auth,test-engineer",
  "domains":            "auth,api",
  "human_in_loop":      "true",
  "review_loop_count":  "0",
  "max_review_loops":   "3",
  "fix_loop_count":     "0",
  "max_fix_loops":      "3",
  "test_track":         "true",
  "linked_ralph":       "false",
  "phase_history":      "plan:2026-06-01T12:00:00Z"
})
```

| Field | Type | Description |
|---|---|---|
| `active` | boolean | Team mode active |
| `current_phase` | string | `plan` \| `plan-review` \| `exec` \| `code-review` \| `test` \| `commit` \| terminal |
| `team_name` | string | Slug from task |
| `template` | string | Seed template name |
| `roster` | string | Comma-separated live role names |
| `domains` | string | Comma-separated domain tags |
| `human_in_loop` | boolean | Human participating in spec |
| `review_loop_count` / `max_review_loops` | number | Plan-review iterations |
| `fix_loop_count` / `max_fix_loops` | number | Code-review/fix iterations |
| `test_track` | boolean | Test-engineer active |
| `linked_ralph` | boolean | Wrapped in Ralph loop |
| `phase_history` | string | Comma-separated `phase:timestamp` |

Terminal phases: `complete`, `failed`, `cancelled`.

</State_Schema>

<Stop_Conditions>

- **Plan-review loop:** `architect → plan-reviewer → architect` until APPROVE, or `review_loop_count` hits `max_review_loops` → accept best version (do not block forever).
- **Code-review/fix loop:** `implementer → code-reviewer → implementer` until APPROVE, or `fix_loop_count` hits `max_fix_loops` → terminal `failed`.
- **Test loop:** test failures route back to the owning implementer (feature bug) or test-engineer (test bug) until pass or `max_fix_loops`.

</Stop_Conditions>

<Resume_And_Cancel>

### Resume
On startup, `state_read(mode="team")`. If `active=true` + non-terminal:
1. Re-join the team (TeamCreate detects an existing team — skip create).
2. `TaskList` for progress; read `.omc/team/handoffs/` and `.omc/team/reviews/` for context.
3. Resume from `current_phase`.

### Cancel
`/oh-my-claudecode:cancel` handles teardown:
1. `state_read(mode="team")` → `team_name`, `linked_ralph`.
2. `shutdown_request` to every live role; await `shutdown_response` (echo exact `request_id`; 15s timeout each).
3. `TeamDelete`.
4. `state_clear(mode="team")`. If `linked_ralph`: also `state_clear(mode="ralph")`.

`.omc/team/` artifacts (handoffs, reviews, patterns) are preserved for resume.

</Resume_And_Cancel>

<Role_Preamble>

Prepended to every spawned role prompt, then the role-specific `roles/<role>.md` content. Adapt `{...}` per role.

```
You are role "{role_name}" in team "{team_name}", a PERSISTENT session.
You own one knowledge domain. Keep your context stable — do not take work outside your domain.
The orchestrator ("orchestrator") coordinates; it is not your message relay.

== PERSISTENCE ==
You are an interactive session, NOT a one-shot worker. Stay alive after each unit of work.
Keep your accumulated context. The orchestrator and peers will send more messages over time.

== COLLABORATION ==
- Message PEERS directly (SendMessage) along your pipeline edges — see your role's downstream list.
- Escalate to the orchestrator ONLY for: block (need a decision), phase-done, conflict, or spec change.
- If a human contacts you and changes the spec, you MUST notify the orchestrator:
  { type:"message", recipient:"orchestrator", content:"spec_updated: <delta>; impact:<tasks>", summary:"spec change" }
- Read your I/O contract in roles/{role_name}.md. Produce your declared artifacts at their declared paths.

== SHUTDOWN ==
On shutdown_request, extract `request_id` and echo it back verbatim:
{ type:"shutdown_response", request_id:"<exact id>", approve:true }

== RULES ==
- NEVER spawn sub-agents (no Task tool), never run team/ralph/autopilot/ultrawork skills.
- NEVER fabricate request_id.
- Code-writing roles: stay inside your assigned worktree; coordinate cross-domain via SendMessage.
- Non-code roles: write artifacts under .omc/team/ (shared, visible without commit).
- Use SendMessage type "message" (peer) by default; "broadcast" only for team-wide changes.
```

</Role_Preamble>

<Shutdown_Protocol>

**Execute in order. Never TeamDelete before every role confirms.**

1. `TaskList` — confirm real tasks (non-`_internal`) are complete or failed.
2. `shutdown_request` to each live role (DM, not broadcast).
3. Await `shutdown_response` per role (30s; warn + continue on timeout).
4. `TeamDelete` — only after all confirm or time out.
5. Orphan scan (best-effort):
   ```bash
   if [ -n "${CLAUDE_PLUGIN_ROOT}" ]; then
     node "${CLAUDE_PLUGIN_ROOT}/scripts/cleanup-orphans.mjs" --team-name {team_name}
   fi
   ```
6. `state_clear(mode="team")`.

Workers echo the exact `request_id` from the incoming `shutdown_request`. Fabricated IDs cause silent shutdown failure.

</Shutdown_Protocol>

<Per_Role_Routing>

> Scope: `/team` only.

Declare provider + model per canonical role. Resolved once at team creation, stored in `TeamConfig.resolved_routing`, immutable for the team's lifetime (see `src/team/stage-router.ts`).

```jsonc
// .claude/omc.jsonc
{
  "team": {
    "roleRouting": {
      "orchestrator":   { "model": "inherit" },
      "architect":      { "provider": "claude", "model": "HIGH" },
      "plan-reviewer":  { "provider": "claude", "model": "HIGH" },
      "executor":       { "provider": "claude", "model": "MEDIUM" },
      "code-reviewer":  { "provider": "gemini" },
      "test-engineer":  { "provider": "gemini", "model": "MEDIUM" },
      "security-reviewer": { "provider": "codex" }
    }
  }
}
```

**Canonical roles:** `orchestrator`, `planner`, `analyst`, `architect`, `executor`, `debugger`, `critic`, `code-reviewer`, `security-reviewer`, `test-engineer`, `designer`, `writer`, `code-simplifier`, `explore`, `document-specialist`. (Team roles map onto these: implementer → `executor`, plan-reviewer → `critic` or a dedicated entry, security → `security-reviewer`.)

**Aliases** normalize via `normalizeDelegationRole()`: `reviewer` → `code-reviewer`, `quality-reviewer` → `code-reviewer`, `harsh-critic` → `critic`, `build-fixer` → `debugger`. Unknown roles fail at parse time.

- `provider` — `"claude" | "codex" | "gemini"`. Omit → `claude`. `orchestrator` pinned to `claude`.
- `model` — `"HIGH" | "MEDIUM" | "LOW"` or explicit ID.
- `agent` — optional Claude agent name (honored only when provider is `claude`).

**Env override:** `OMC_TEAM_ROLE_OVERRIDES='{"code-reviewer":{"provider":"gemini"}}'`. Precedence: env > project config > user config > built-in defaults. Invalid JSON → visible warning, ignore, continue. CLI missing → visible warning, fall back to Claude with same tier/agent. Empty `roleRouting` → all Claude, tiers from `routing.tierModels`.

</Per_Role_Routing>

<Configuration>

Optional, in `.claude/omc.jsonc` (project) or `[$CLAUDE_CONFIG_DIR|~/.claude]/../config/claude-omc/config.jsonc` (user). Project overrides user; `OMC_TEAM_ROLE_OVERRIDES` supersedes both.

```jsonc
{
  "team": {
    "ops": {
      "maxAgents":          20,
      "defaultAgentType":   "claude",
      "monitorIntervalMs":  30000,
      "shutdownTimeoutMs":  15000,
      "maxReviewLoops":     3,
      "maxFixLoops":        3,
      "enableTestTrack":    "auto"
    }
  }
}
```

</Configuration>

<Team_Ralph_Composition>

Activate on `/team ralph "task"` or both keywords.

```
state_write(mode="team",  ..., state={"linked_ralph": "true"})
state_write(mode="ralph", ..., state={"linked_team": "true", "team_name": "..."})
```

1. Ralph outer loop starts.
2. Pipeline runs: plan → plan-review → exec → code-review → test.
3. On test PASS: Ralph runs architect verification (HIGH tier min).
4. Architect approves → both modes complete → run `/oh-my-claudecode:cancel`.
5. Review/fix loop exceeds its max → Ralph increments iteration, retries the pipeline.
6. Ralph exceeds `max_iterations` → terminal `failed`.

Cancelling either mode cancels both (team shut down gracefully first, then Ralph cleared).

</Team_Ralph_Composition>

<Gotchas>

1. **Roles are persistent** — do not let a role exit after one unit of work. Idle roles wait for their next trigger message. This is the core difference from the old model.
2. **Peer messaging is engine-supported** — `SendMessage`/inbox routes to any named recipient. The old "always report to team-lead" rule is gone; relaying through the lead is an anti-pattern now.
3. **Internal tasks pollute TaskList** — auto-created per member with `metadata._internal: true`. Filter when counting real progress.
4. **Pull, not push** — implementers claim by domain tag; the lead records tasks but does not pre-assign owners (one domain = one implementer makes claiming uncontended).
5. **Task IDs are strings** — always pass string values.
6. **TeamDelete requires empty team** — all roles shut down first.
7. **Messages auto-deliver** — peer messages arrive as new turns; no polling for inbound.
8. **shutdown_response needs verbatim request_id** — fabricated IDs fail silently.
9. **Team name must be a valid slug** — lowercase, numbers, hyphens.
10. **Broadcast is expensive** — N separate messages; DM by default.
11. **Interface changes belong to the architect** — implementers escalate, never unilaterally redefine shared contracts.
12. **state_write transports strings** — coerce on read.
13. **Worktrees only for code roles** — architect/reviewers write `.omc/team/`, visible without commit; implementer code needs a commit before review can diff it.

</Gotchas>

## Parallel session caveats

- **Multi-repo workspace anchor:** drop a `.omc-workspace` marker at the parent dir so multiple sessions across sub-repos share one `.omc/`. Resolution order: `OMC_STATE_DIR > .omc-workspace > git > cwd`.
- **Session id source:** OMC_SESSION_ID env var wins in CLI contexts; hook payload data.session_id wins in hook contexts.
- **Plan id (when applicable):** the architect's plan at `.omc/team/plan/architect-plan.md` is shared across sessions by design; resume reads it to recover the task graph.
- **Parallel verdict:** Supported — session-scoped state + shared `.omc/team/` artifacts (handoffs, reviews, review-patterns) by design.

<Communication_Patterns>

```json
// implementer → code-reviewer (peer, PR ready)
{"type": "message", "recipient": "code-reviewer-auth",
 "content": "PR ready on branch omc-team/build-auth/auth. Fixed session timeout in src/auth/session.ts.",
 "summary": "auth PR ready"}

// code-reviewer → implementer (peer, iterate)
{"type": "message", "recipient": "implementer-auth",
 "content": "ITERATE: null-deref risk at session.ts:42 on expired token. See .omc/team/reviews/code.md.",
 "summary": "review: iterate"}

// any role → orchestrator (escalation only)
{"type": "message", "recipient": "orchestrator",
 "content": "spec_updated: token TTL 1h→24h; impact task#3,#5", "summary": "spec change"}

// architect → all implementers (broadcast — interface revised)
{"type": "broadcast",
 "content": "Interface UserSession changed: added `refreshToken`. Pull .omc/team/interfaces/.",
 "summary": "interface revised"}
```

</Communication_Patterns>
