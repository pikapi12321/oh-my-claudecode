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
const ROLE_ALIAS_TO_FILE: Record<string, string> = {
  // team-role identity (file basename === role)
  architect: 'architect',
  'code-reviewer': 'code-reviewer',
  implementer: 'implementer',
  'plan-reviewer': 'plan-reviewer',
  security: 'security',
  'test-engineer': 'test-engineer',
  // canonical role vocabulary
  executor: 'implementer',
  critic: 'plan-reviewer',
  'security-reviewer': 'security',
  reviewer: 'code-reviewer',
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
 * Returns undefined when the role has no shipped prompt file (the caller then
 * spawns without `--append-system-prompt`, preserving prior behavior). If the
 * preamble template is missing but the role body exists, the body is returned
 * alone with a warning — a degraded but still useful identity.
 */
export function buildRoleSystemPrompt(role: string, teamName: string): string | undefined {
  const basename = resolveRoleFileBasename(role);
  if (!basename) return undefined;

  const skillsTeamDir = resolveSkillsTeamDir();
  if (!skillsTeamDir) return undefined;

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
