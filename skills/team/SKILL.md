---
name: team
description: Persistent role-collaboration team — heterogeneous roles, each a long-lived session that owns a knowledge domain, coordinating over an event-driven pipeline
argument-hint: "[--init | --add-member | --del-member] [template] [ralph] <task or team description>"
aliases: []
level: 4
---

# Team — membership CRUD

This skill is the **human-facing membership surface** for an OMC team: create the team,
add a member, remove a member, configure routing. It is loaded on demand when you actually
perform one of those operations.

> **The orchestrator's behavior lives elsewhere.** Identity, the pipeline, IO contracts,
> worktree/rebase discipline, phase transitions, stop conditions, the shutdown protocol, the
> gotchas — all of that is the **orchestrator system-prompt kernel**
> (`skills/team/orchestrator.system.md`), injected into the session's system prompt when you
> launch with **`omc --team`**. Because it rides in the system prompt, it survives context
> compaction without re-injection. This file deliberately does NOT repeat it.
>
> Dynamic membership state (roster, base branch, phase, task) lives in **`~/.claude/teams/{team}/config.json`**
> and is re-injected into the conversation by the SessionStart hook on every restart — never
> frozen into the system prompt, because membership mutates.

If a session reaches this skill **without** the kernel (i.e. not launched via `omc --team`),
tell the user to relaunch with `omc --team` so the orchestrator identity is durable, then
proceed.

<Lifecycle>

Roles are bound to the lead session. Lead session ends → all roles go offline. A role persists
until explicitly removed.

### Create — guided questionnaire

```
/team --init "build auth module"   (or a fuller team description)
```

1. Analyze the task and select a starting **template** (see `templates.md`) or compose one.
2. Recommend roles **one at a time**, questionnaire-style, each with a one-line rationale. The
   user accepts/skips per role — selective acceptance keeps the cognitive load low.
3. For accepted roles: resolve routing (per-role provider/model, see below), create worktrees
   only for code-writing roles, spawn each as a persistent session. Before spawning, read
   `~/.claude/teams/{team}/config.json` to build a `[TEAM ROSTER]` block listing all current
   members. Read `skills/team/role-preamble.md`, interpolate `{role_name}`, `{team_name}`, and
   `{roster}` (the roster block), then prepend the filled preamble to `roles/<role>.md` and pass
   the combined text as the Agent tool's `prompt`. This gives each teammate immediate visibility
   into the full team membership for peer coordination.
4. The architect begins planning; everyone else stands by for their trigger. From here you are
   reacting to escalations and phase-done events per your kernel — you do NOT relay or write code.

If the user passes a known template name (`/team --init feature "…"`), seed from that template.

### Grow / shrink — dynamic membership

```
/team --add-member "security auditor for the token flow"
/team --del-member code-reviewer-auth
```

- `--add-member` → resolve role from description; two paths:

  **A — Known role** (matches a shipped `skills/team/roles/<role>.md` or alias):
  Create worktree if it writes code, spawn one persistent session with roster in preamble.
  Backed by engine `scaleUp`.

  **B — Custom role** (no match in shipped roles): Run the creation interview first, then spawn.
  Interview order — ask each question, wait for the answer, then continue:
  1. **Slug** — kebab-case role name (e.g. `data-validator`); used as the file name and session identity
  2. **Domain brief** — one sentence: what knowledge does this role stably hold?
  3. **Writes code?** — yes → needs isolated worktree; no → shared `.omc/team/` access
  4. **I/O contract** — what triggers work (event/message), what artifacts it produces, which role it notifies downstream
  5. **Working methodology** — how it approaches its tasks (phases, rules, heuristics)
  6. **Permissions** — read scope, write scope, exec level (`none` / `read-only` / `domain-scoped` / `allowed`)

  After the interview, write `skills/team/roles/<slug>.md` using `_template.md` as scaffold
  (fill in every `{placeholder}` with the interview answers). Then spawn normally — the engine
  will read the new file and inject it as the role's system prompt.

  **After either path:** broadcast the updated roster to all active teammates via SendMessage
  (one message per teammate, plain text `[TEAM ROSTER]` block from fresh config.json read).
- `--del-member` → graceful shutdown of that one role (drain → shutdown_request → confirm →
  remove). Backed by engine `scaleDown`. Other roles keep running.
  **After removal:** broadcast the updated roster to all remaining active teammates via SendMessage.

### Default invocation

`/team "<task>"` with no `--init` runs the questionnaire non-interactively: pick the template,
spawn the default roster, proceed. `/team ralph "<task>"` wraps the pipeline in a Ralph
persistence loop (composition rules are in your kernel).

</Lifecycle>

<Per_Role_Routing>

> Scope: `/team` only.

Declare provider + model per canonical role. Resolved once at team creation, stored in
`TeamConfig.resolved_routing`, immutable for the team's lifetime (see `src/team/stage-router.ts`).

```jsonc
// .claude/omc.jsonc
{
  "team": {
    "roleRouting": {
      "orchestrator":   { "model": "inherit" },
      "architect":      { "provider": "claude", "model": "HIGH" },
      "plan-reviewer":  { "provider": "claude", "model": "HIGH" },
      "implementer":    { "provider": "claude", "model": "MEDIUM" },
      "code-reviewer":  { "provider": "gemini" },
      "test-engineer":  { "provider": "gemini", "model": "MEDIUM" },
      "security":       { "provider": "codex" }
    }
  }
}
```

**Valid `roleRouting` keys** — match the role name as registered in `config.json` (same as the
filename in `skills/team/roles/`):

`orchestrator`, `architect`, `plan-reviewer`, `implementer`, `code-reviewer`, `test-engineer`, `security`

Domain-suffixed variants (`implementer-auth`, `code-reviewer-api`) are also valid; they fall
back to the base role's routing config when no exact-match entry exists.

No aliases. The key you write here must be the exact name the orchestrator assigns at spawn.

- `provider` — `"claude" | "codex" | "gemini"`. Omit → `claude`. `orchestrator` pinned to `claude`.
- `model` — `"HIGH" | "MEDIUM" | "LOW"` or explicit ID.
- `agent` — optional Claude agent name (honored only when provider is `claude`).

**Env override:** `OMC_TEAM_ROLE_OVERRIDES='{"code-reviewer":{"provider":"gemini"}}'`. Precedence:
env > project config > user config > built-in defaults. Invalid JSON → visible warning, ignore,
continue. CLI missing → visible warning, fall back to Claude with same tier/agent. Empty
`roleRouting` → all Claude, tiers from `routing.tierModels`.

</Per_Role_Routing>

<Configuration>

Optional, in `.claude/omc.jsonc` (project) or
`[$CLAUDE_CONFIG_DIR|~/.claude]/../config/claude-omc/config.jsonc` (user). Project overrides user;
`OMC_TEAM_ROLE_OVERRIDES` supersedes both.

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
