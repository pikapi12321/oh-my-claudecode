import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { resolveRoleFileBasename, buildRoleSystemPrompt } from '../role-prompt.js';

// Resolve the skills/team/roles directory relative to the package root.
const ROLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'skills', 'team', 'roles');

describe('role-prompt', () => {
  describe('resolveRoleFileBasename', () => {
    it('maps team-role identities to their own file', () => {
      expect(resolveRoleFileBasename('architect')).toBe('architect');
      expect(resolveRoleFileBasename('implementer')).toBe('implementer');
      expect(resolveRoleFileBasename('code-reviewer')).toBe('code-reviewer');
      expect(resolveRoleFileBasename('plan-reviewer')).toBe('plan-reviewer');
      expect(resolveRoleFileBasename('test-engineer')).toBe('test-engineer');
      expect(resolveRoleFileBasename('security')).toBe('security');
    });

    it('strips domain suffixes via longest-prefix match', () => {
      expect(resolveRoleFileBasename('implementer-auth')).toBe('implementer');
      expect(resolveRoleFileBasename('code-reviewer-auth')).toBe('code-reviewer');
      expect(resolveRoleFileBasename('test-engineer-api')).toBe('test-engineer');
    });

    it('does not let a short prefix shadow a longer role name', () => {
      // "plan-reviewer" must NOT resolve to anything shorter; "code-reviewer-x"
      // must map to code-reviewer, not "reviewer".
      expect(resolveRoleFileBasename('plan-reviewer-core')).toBe('plan-reviewer');
      expect(resolveRoleFileBasename('code-reviewer-core')).toBe('code-reviewer');
    });

    it('returns undefined for removed vocabulary aliases', () => {
      // Routing keys must match roster names exactly; these aliases were removed.
      expect(resolveRoleFileBasename('executor')).toBeUndefined();
      expect(resolveRoleFileBasename('critic')).toBeUndefined();
      expect(resolveRoleFileBasename('reviewer')).toBeUndefined();
      // 'security-reviewer' still resolves via longest-prefix (security + -reviewer suffix),
      // same as 'security-auth' would — this is correct domain-suffix behavior, not an alias.
      expect(resolveRoleFileBasename('security-reviewer')).toBe('security');
    });

    it('is case-insensitive', () => {
      expect(resolveRoleFileBasename('Implementer-Auth')).toBe('implementer');
    });

    it('returns undefined for roles with no shipped file', () => {
      expect(resolveRoleFileBasename('orchestrator')).toBeUndefined();
      expect(resolveRoleFileBasename('writer')).toBeUndefined();
      expect(resolveRoleFileBasename('')).toBeUndefined();
    });

    it('rejects path-traversal / unsafe input', () => {
      expect(resolveRoleFileBasename('../../etc/passwd')).toBeUndefined();
      expect(resolveRoleFileBasename('implementer/../../x')).toBeUndefined();
    });
  });

  describe('buildRoleSystemPrompt', () => {
    it('composes interpolated preamble + role body for a known role', () => {
      const prompt = buildRoleSystemPrompt('implementer-auth', 'build-auth');
      expect(prompt).toBeDefined();
      // Preamble interpolation: full role name + team name.
      expect(prompt).toContain('role "implementer-auth" in team "build-auth"');
      // Role body marker from roles/implementer.md.
      expect(prompt).toContain('Implementer');
      // Preamble + body separator present.
      expect(prompt).toContain('---');
    });

    it('returns undefined for old canonical vocabulary aliases (no longer supported)', () => {
      expect(buildRoleSystemPrompt('executor', 'build-auth')).toBeUndefined();
    });

    it('returns undefined for a role with no shipped file', () => {
      expect(buildRoleSystemPrompt('orchestrator', 'build-auth')).toBeUndefined();
    });

    describe('custom role fallback (user-authored roles/<slug>.md)', () => {
      const CUSTOM_SLUG = 'data-validator';
      const customRolePath = join(ROLES_DIR, `${CUSTOM_SLUG}.md`);

      beforeAll(() => {
        writeFileSync(
          customRolePath,
          [
            '---',
            `name: team-role-${CUSTOM_SLUG}`,
            'description: Validates data contracts',
            '---',
            '',
            '# Role: Data Validator',
            '',
            'You own the data-validation knowledge domain.',
          ].join('\n'),
          'utf-8',
        );
      });

      afterAll(() => {
        if (existsSync(customRolePath)) unlinkSync(customRolePath);
      });

      it('resolves a custom role file that exists on disk', () => {
        const prompt = buildRoleSystemPrompt(CUSTOM_SLUG, 'my-team');
        expect(prompt).toBeDefined();
        expect(prompt).toContain('Data Validator');
        expect(prompt).toContain(`role "${CUSTOM_SLUG}" in team "my-team"`);
      });

      it('does not resolve a custom role that does NOT exist on disk', () => {
        expect(buildRoleSystemPrompt('nonexistent-custom-role', 'my-team')).toBeUndefined();
      });

      it('blocks path traversal even via the custom-role fallback', () => {
        expect(buildRoleSystemPrompt('../../etc/passwd', 'my-team')).toBeUndefined();
      });
    });
  });
});
