---
internal: true
name: team-review
description: Code review stage for team pipeline — tier-based model selection, reviews feature diff + test plan, returns APPROVE or ITERATE
argument-hint: "[--base <branch>]"
aliases: []
level: 3
---

# team-review

Review stage of the team pipeline. Lead scans the diff to determine review tier, then spawns a `code-reviewer` agent (and optionally `security-reviewer`) to review the feature diff and test plan together. Returns `APPROVE` or `ITERATE` with specific file-anchored feedback.

Can also be invoked standalone: `/team-review` reviews current `git diff` against base branch.

<Agents>

| Agent | Model | When |
|---|---|---|
| `code-reviewer` | sonnet | Quick or Standard tier |
| `code-reviewer` | opus | Deep tier |
| `security-reviewer` | sonnet | Deep tier or when risk override triggers |

</Agents>

<Inputs>

- Feature diff: `git diff {baseBranch}...{featureBranch}` where `featureBranch` = `state.feature_branch` (the merged staging branch from team-exec, not individual worker branches)
- Test plan: `.omc/plans/test-plan.md` (if tester track is ON)
- Exec handoffs: `.omc/handoffs/exec-*.md`
- Risk flags from spec: `.omc/plans/spec.md` (risk flags section)

</Inputs>

<Outputs>

- Decision: `APPROVE` or `ITERATE`
- Handoff written to `.omc/handoffs/team-review.md`

</Outputs>

<Review_Tiers>

Lead scans `git diff --stat` + file paths BEFORE spawning reviewer to select tier:

| Tier | Trigger | Model | Scope |
|---|---|---|---|
| Quick | ≤5 files, no auth/crypto/payment/DB, no interface change | sonnet | Logic correctness, obvious bugs |
| Standard | 6–20 files, OR interface change, OR bug fix | sonnet | + edge cases, error handling, test coverage alignment |
| Deep | >20 files, OR auth/crypto/payment/DB migration, OR architectural change | opus + security-reviewer | + security, maintainability, design quality |

**Risk override:** A single-line change in auth/crypto/payment/DB migration paths → force Deep tier regardless of file count.

**Risk flag pass-through:** If spec contains risk flags (e.g., "touches auth middleware"), those override tier selection upward.

</Review_Tiers>

<Procedure>

1. Collect inputs: run `git diff --stat` to count files, scan paths for risk signals.
2. Select tier (see Review Tiers table above).
3. Build reviewer prompt including:
   - Full diff output
   - Test plan content (if tester track ON)
   - Exec handoffs summary
   - Risk flags from spec
   - Tier + scope instructions
4. Spawn `code-reviewer` (tier-appropriate model).
5. For Deep tier: also spawn `security-reviewer` (sonnet) in parallel.
6. Collect both reviews if parallel; synthesize into single decision.
7. Write handoff to `.omc/handoffs/team-review.md`.
8. Return decision to orchestrator.

</Procedure>

<Review_Prompt_Structure>

```
You are a {tier} code reviewer for a team pipeline.

== DIFF ==
{full git diff output}

== TEST PLAN ==
{contents of .omc/plans/test-plan.md or "N/A — no test track"}

== EXEC DECISIONS ==
{summary from .omc/handoffs/exec-*.md}

== RISK FLAGS ==
{from .omc/plans/spec.md risk flags section, or "none"}

== REVIEW SCOPE ({tier} tier) ==
{tier-specific scope instructions from Review Tiers table}

== OUTPUT FORMAT ==
Return one of:

APPROVE
Rationale: <2-3 sentences on why this is ready>

OR

ITERATE
Issues:
- {file}:{line} — {problem} — Fix: {specific fix}
- {file}:{line} — {problem} — Fix: {specific fix}
```

</Review_Prompt_Structure>

<ITERATE_Feedback_Rules>

`ITERATE` feedback MUST be:
- **Specific**: file path + line number (or range) + problem + fix
- **Actionable**: worker must be able to act on it without asking follow-up questions
- **Bounded**: list only issues that block approval; cosmetic preferences go in rationale
- **No vague complaints**: "this could be cleaner" → rejected format. "src/auth/login.ts:42 — password compared with == instead of ===, fix: use === or bcrypt.compare()" → valid format.

</ITERATE_Feedback_Rules>

<Handoff_Format>

```markdown
## Handoff: team-review → {next-stage}

- **Decision**: APPROVE | ITERATE
- **Tier**: Quick | Standard | Deep
- **Rationale**: [why approved or summary of issues]
- **Review loop**: {review_loop_count} of {max_review_loops}
- **Issues** (if ITERATE):
  - {file}:{line} — {problem} — Fix: {fix}
- **Files reviewed**: [{count} files]
- **Remaining**: [anything deferred or out of scope for this review]
```

</Handoff_Format>

<Review_Loop>

On ITERATE:
1. Orchestrator increments `review_loop_count`.
2. If `review_loop_count` >= `max_review_loops`:
   - Do NOT send back to exec again.
   - Annotate handoff: "Review loop limit reached — proceeding with best version. Outstanding concerns: [list]"
   - Transition to next stage as if APPROVE (with concerns noted).
3. Otherwise: orchestrator re-spawns exec workers targeting feedback points.
4. After re-exec: return to team-review for re-evaluation. Reviewer reads new diff + prior handoff.

**Triage-triggered re-review:** When `team-triage` returns `FEATURE_BUG` and exec re-runs, the subsequent team-review pass does NOT increment `review_loop_count`. Use a separate `triage_review_count` tracked in triage state. This prevents triage fix cycles from consuming the normal review budget.

</Review_Loop>

<Standalone_Mode>

`/team-review` invoked standalone:

1. Determine base branch: `git merge-base HEAD origin/main` or `main`/`master`.
2. Run `git diff {baseBranch}...HEAD` for diff.
3. No test plan input (set to "N/A").
4. Run full tier selection + review procedure.
5. Output APPROVE/ITERATE to user directly (no handoff written in standalone mode).

</Standalone_Mode>

<Rules>

- Reviewer is a `code-reviewer` agent role. Each review spawns a new session instance — roles are not persistent sessions.
- Deep tier always uses `code-reviewer` (opus). Quick/Standard use sonnet.
- Both `code-reviewer` and `security-reviewer` results must be collected before synthesizing final decision for Deep tier.
- Reviewer reads feature diff AND test plan in the same pass — one review covers both.
- `APPROVE` requires explicit rationale. "Looks fine" is not sufficient.
- Risk override (single-line auth/crypto change) must force Deep even if reviewer instinct is Quick.

</Rules>
