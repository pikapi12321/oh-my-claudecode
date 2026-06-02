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
> Dynamic membership state (roster, base branch, phase, task) lives in **`.omc/roster.json`**
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
   only for code-writing roles, spawn each as a persistent session. You pass only the **role
   name**; the engine auto-injects that role's system prompt at spawn — it reads
   `skills/team/role-preamble.md`, interpolates `{role_name}`/`{team_name}`, and prepends it to
   `roles/<role>.md`, delivered via `--append-system-prompt` so the role identity survives the
   role's own context compaction. Do NOT hand-inject the preamble.
4. Write initial team state via `state_write(mode="team", ...)` (schema in your kernel).
5. **Write `.omc/roster.json`** (top-level; one team per project) immediately after roles are
   spawned — `{ teamName, task, baseRef, roles:[{name,sessionId,domain,hasWorktree}], updatedAt }`.
   The SessionStart hook reads it to re-inject roster context after compaction. Keep it current.
6. The architect begins planning; everyone else stands by for their trigger. From here you are
   reacting to escalations and phase-done events per your kernel — you do NOT relay or write code.

If the user passes a known template name (`/team --init feature "…"`), seed from that template.

### Grow / shrink — dynamic membership

```
/team --add-member "security auditor for the token flow"
/team --del-member code-reviewer-auth
```

- `--add-member` → resolve role from description, create worktree if it writes code, spawn one
  persistent session, announce it to upstream/downstream peers. Backed by engine `scaleUp`.
  **Update `.omc/roster.json`.**
- `--del-member` → graceful shutdown of that one role (drain → shutdown_request → confirm →
  remove). Backed by engine `scaleDown`. Other roles keep running. **Update `.omc/roster.json`.**

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
      "executor":       { "provider": "claude", "model": "MEDIUM" },
      "code-reviewer":  { "provider": "gemini" },
      "test-engineer":  { "provider": "gemini", "model": "MEDIUM" },
      "security-reviewer": { "provider": "codex" }
    }
  }
}
```

**Canonical roles:** `orchestrator`, `planner`, `analyst`, `architect`, `executor`, `debugger`,
`critic`, `code-reviewer`, `security-reviewer`, `test-engineer`, `designer`, `writer`,
`code-simplifier`, `explore`, `document-specialist`. (Team roles map onto these: implementer →
`executor`, plan-reviewer → `critic` or a dedicated entry, security → `security-reviewer`.)

**Aliases** normalize via `normalizeDelegationRole()`: `reviewer` → `code-reviewer`,
`quality-reviewer` → `code-reviewer`, `harsh-critic` → `critic`, `build-fixer` → `debugger`.
Unknown roles fail at parse time.

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
