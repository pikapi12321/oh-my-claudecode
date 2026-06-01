---
internal: true
name: team-templates
description: Preset role compositions for /team --init; the orchestrator seeds the questionnaire from one of these
argument-hint: "(internal — read by /team orchestrator during --init)"
aliases: []
level: 2
---

# Team Templates

Preset role compositions. The orchestrator picks one at `--init` (or by explicit `/team --init <template> "…"`) and offers its roles to the user **one at a time**, questionnaire-style. The user accepts or skips each; the orchestrator spawns the accepted set.

Templates are starting points, not contracts — `--add-member` / `--del-member` reshape the team at any time.

## Scaling rule (applies to every template)

Implementers partition the work by **domain** (module, or layer-as-coarse-module). For each domain the orchestrator offers **one implementer + one code-reviewer** so implementation and review stay isolated yet paired. So "implementer×N" means N domains, each with its own reviewer. The architect sets the domain count at plan time.

## Presets

### `feature` — default for new functionality
```
architect              ×1   design + interfaces + task decomposition
implementer            ×N   one per domain
code-reviewer          ×N   one per domain (paired with its implementer)
test-engineer          ×1   behavior + coverage
plan-reviewer          ×1   reviews the plan before exec
```
Full pipeline: plan → plan-review → exec → code-review → test → commit.

### `bugfix` — targeted fix, design already stable
```
implementer            ×1   the domain owning the bug
code-reviewer          ×1   paired
test-engineer          ×1   (optional) regression test
```
No architect/plan-reviewer — the design isn't changing. Add an architect only if the fix touches an interface. Skip exec→plan-review; go straight to exec → code-review → test.

### `security` — auth / permissions / sensitive data
```
security               ×1   threat model + vuln review across the change
implementer            ×N   one per affected domain
code-reviewer          ×N   paired
architect              ×1   (optional) if trust boundaries change
```
Security reviews every domain's diff in addition to the paired code-reviewers.

### `ui` — front-end / visual work
```
designer               ×1   acts as the implementer for UI domains (component design + CSS + markup)
implementer            ×N   non-UI domains, if any
code-reviewer          ×N   paired
```
The designer is a code-writing role here (its own worktree). Add an architect if the UI work implies API/contract changes.

### `full-stack` — coordinated front + back
```
architect              ×1   cross-cutting design + shared interfaces
implementer-frontend   ×1   fe domain
implementer-backend    ×1   be domain
code-reviewer          ×2   one per domain
test-engineer          ×1   end-to-end behavior
plan-reviewer          ×1
```
Frontend and backend are two domains; the architect's shared interface contracts let them build in parallel — each sees the same contract in `.omc/team/interfaces/`.

## Composition heuristics for `--init`

When no template name is given, the orchestrator infers from the task:
- New feature / multi-component build → `feature`.
- "fix" / "bug" / "broken" + a single area → `bugfix`.
- auth / security / vulnerability keywords → `security`.
- UI / component / layout / styling keywords → `ui`.
- Both front-end and back-end work implied → `full-stack`.

Always recommend `plan-reviewer` whenever an `architect` is present (a plan worth writing is worth reviewing). Always recommend at least one `code-reviewer` for any code-writing roster (review isolated from implementation is the quality floor). If the user skips these, proceed but note the reduced quality assurance.
