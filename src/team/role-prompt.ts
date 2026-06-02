/**
 * Per-role system-prompt resolution for team workers.
 *
 * The engine reads the shipped role assets — `skills/team/role-preamble.md`
 * (the durable preamble template, single source of truth) plus the
 * role-specific `skills/team/roles/<role>.md` — and composes the string that is
 * injected into a Claude worker's system prompt via `--append-system-prompt`.
 *
 * Putting the role identity + methodology in the worker's OWN system prompt
 * means it survives that worker's own context compaction, mirroring how the
 * orchestrator kernel rides in the orchestrator's system prompt (see
 * `resolveOrchestratorKernelPath` in `src/cli/launch.ts`).
 *
 * The engine stays prompt-agnostic about content: the orchestrator passes only
 * a role NAME; this module turns it into the prompt. Only Claude workers honor
 * `--append-system-prompt` — codex/gemini callers must not pass the result
 * (gating lives in `model-contract.buildLaunchArgs`).
 */

import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { OMC_PLUGIN_ROOT_ENV } from '../lib/env-vars.js';

/**
 * Map canonical/team role aliases onto the shipped `roles/<file>.md` basename.
 * The resolved basename is ALWAYS one of these literal values — never derived
 * from caller-supplied text — so the file path can never be attacker-controlled.
 *
 * Each shipped `skills/team/roles/<file>.md` MUST appear as a value here.
 * Team role names map onto canonical roles (implementer → executor,
 * plan-reviewer → critic, security → security-reviewer); the prompt files are
 * named by TEAM role, so both vocabularies resolve here.
 */
/**
 * Shipped team role file basenames. The key IS the role name as registered in
 * roster.json and assigned at spawn — no aliases, no vocabulary translation.
 * Domain-suffixed variants (implementer-auth, code-reviewer-api) are handled by
 * the longest-prefix loop in resolveRoleFileBasename.
 */
const ROLE_ALIAS_TO_FILE: Record<string, string> = {
  architect: 'architect',
  'code-reviewer': 'code-reviewer',
  implementer: 'implementer',
  'plan-reviewer': 'plan-reviewer',
  security: 'security',
  'test-engineer': 'test-engineer',
};

/** Strip a leading YAML frontmatter block from markdown content. */
function stripFrontmatter(content: string): string {
  const match = content.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
  return match ? match[1].trim() : content.trim();
}

/**
 * Resolve the shipped `skills/team` directory. Prefers the explicit plugin root
 * (`OMC_PLUGIN_ROOT`), then falls back to the package root derived from this
 * module's location (src/team or dist/team → package root two levels up).
 */
function resolveSkillsTeamDir(): string | null {
  const candidates: string[] = [];
  const pluginRoot = process.env[OMC_PLUGIN_ROOT_ENV];
  if (pluginRoot) {
    candidates.push(join(pluginRoot, 'skills', 'team'));
  }
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    candidates.push(join(here, '..', '..', 'skills', 'team'));
  } catch {
    // import.meta.url unavailable — rely on plugin-root candidate only.
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Map a role string (team role, canonical role, or domain-suffixed variant such
 * as `implementer-auth` / `code-reviewer-auth`) onto a shipped role file
 * basename. Longest match wins so `code-reviewer-auth` beats nothing and
 * `plan-reviewer` is never shadowed by a shorter prefix. Returns undefined for
 * unknown roles (e.g. orchestrator, or a free-text role with no shipped file).
 */
export function resolveRoleFileBasename(role: string): string | undefined {
  const normalized = role.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9][a-z0-9-]*$/.test(normalized)) return undefined;

  // Exact alias/canonical hit.
  if (ROLE_ALIAS_TO_FILE[normalized]) return ROLE_ALIAS_TO_FILE[normalized];

  // Domain-suffixed variant: match against the longest alias that the role
  // either equals or begins with (`<alias>-<domain>`).
  const aliases = Object.keys(ROLE_ALIAS_TO_FILE).sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    if (normalized === alias || normalized.startsWith(`${alias}-`)) {
      return ROLE_ALIAS_TO_FILE[alias];
    }
  }
  return undefined;
}

/**
 * Build the system-prompt string for a team role: the interpolated preamble
 * followed by the role's `roles/<file>.md` body.
 *
 * Resolution order:
 *   1. Alias / longest-prefix match from ROLE_ALIAS_TO_FILE (shipped roles + canonical vocab).
 *   2. Direct file check: if `roles/<slug>.md` exists on disk, use it as a custom role.
 *      Custom roles are written by the orchestrator's `--add-member` interview and follow
 *      the same `_template.md` structure as shipped roles. The slug is validated against
 *      `^[a-z0-9][a-z0-9-]*$` before the path is constructed, so no traversal is possible.
 *
 * Returns undefined when no file resolves (caller spawns without `--append-system-prompt`,
 * preserving prior behavior). If the preamble template is missing but the role body exists,
 * the body is returned alone with a warning — a degraded but still useful identity.
 */
export function buildRoleSystemPrompt(role: string, teamName: string): string | undefined {
  const normalized = role.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9][a-z0-9-]*$/.test(normalized)) return undefined;

  const skillsTeamDir = resolveSkillsTeamDir();
  if (!skillsTeamDir) return undefined;

  // 1. Alias / prefix resolution for shipped roles.
  let basename = resolveRoleFileBasename(role);

  // 2. Custom role: fall back to direct slug lookup if no alias matched.
  if (!basename) {
    const customPath = join(skillsTeamDir, 'roles', `${normalized}.md`);
    if (existsSync(customPath)) basename = normalized;
  }

  if (!basename) return undefined;

  const roleFilePath = join(skillsTeamDir, 'roles', `${basename}.md`);
  let roleBody: string;
  try {
    roleBody = stripFrontmatter(readFileSync(roleFilePath, 'utf-8'));
  } catch {
    // No shipped role file → no role identity to inject.
    return undefined;
  }
  if (!roleBody) return undefined;

  const interpolate = (text: string): string =>
    text
      .replace(/\{role_name\}/g, role)
      .replace(/\{team_name\}/g, teamName);

  let preamble = '';
  const preamblePath = join(skillsTeamDir, 'role-preamble.md');
  try {
    preamble = interpolate(readFileSync(preamblePath, 'utf-8').trim());
  } catch {
    console.warn('[team/role-prompt] role-preamble.md not found; injecting role body without preamble.');
  }

  return preamble
    ? `${preamble}\n\n---\n\n${roleBody}`
    : roleBody;
}
