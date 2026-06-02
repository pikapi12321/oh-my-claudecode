import { describe, it, expect } from 'vitest';
import { resolveRoleFileBasename, buildRoleSystemPrompt } from '../role-prompt.js';

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

    it('maps canonical role vocabulary onto team-role files', () => {
      expect(resolveRoleFileBasename('executor')).toBe('implementer');
      expect(resolveRoleFileBasename('critic')).toBe('plan-reviewer');
      expect(resolveRoleFileBasename('security-reviewer')).toBe('security');
      expect(resolveRoleFileBasename('reviewer')).toBe('code-reviewer');
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

    it('resolves canonical roles to the team-role file body', () => {
      const prompt = buildRoleSystemPrompt('executor', 'build-auth');
      expect(prompt).toBeDefined();
      expect(prompt).toContain('Implementer');
    });

    it('returns undefined for a role with no shipped file', () => {
      expect(buildRoleSystemPrompt('orchestrator', 'build-auth')).toBeUndefined();
    });
  });
});
