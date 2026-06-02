import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolveRoleAssignment, buildResolvedRoutingSnapshot } from '../stage-router.js';
import { CANONICAL_TEAM_ROLES } from '../../shared/types.js';
import type { CanonicalTeamRole, PluginConfig } from '../../shared/types.js';
import { CLAUDE_FAMILY_DEFAULTS, BUILTIN_EXTERNAL_MODEL_DEFAULTS } from '../../config/models.js';

type TeamRoleRoutingConfig = NonNullable<NonNullable<PluginConfig['team']>['roleRouting']>;

const EMPTY: PluginConfig = {};

const ENV_KEYS = [
  'OMC_MODEL_HIGH',
  'OMC_MODEL_MEDIUM',
  'OMC_MODEL_LOW',
  'CLAUDE_CODE_BEDROCK_OPUS_MODEL',
  'CLAUDE_CODE_BEDROCK_SONNET_MODEL',
  'CLAUDE_CODE_BEDROCK_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
];

let savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] !== undefined) {
      process.env[key] = savedEnv[key];
    } else {
      delete process.env[key];
    }
  }
});

const EXPECTED_DEFAULTS: Record<CanonicalTeamRole, { model: string; agent: string }> = {
  orchestrator: { model: CLAUDE_FAMILY_DEFAULTS.OPUS, agent: 'omc' },
  planner: { model: CLAUDE_FAMILY_DEFAULTS.OPUS, agent: 'planner' },
  analyst: { model: CLAUDE_FAMILY_DEFAULTS.OPUS, agent: 'analyst' },
  architect: { model: CLAUDE_FAMILY_DEFAULTS.OPUS, agent: 'architect' },
  executor: { model: CLAUDE_FAMILY_DEFAULTS.SONNET, agent: 'executor' },
  debugger: { model: CLAUDE_FAMILY_DEFAULTS.SONNET, agent: 'debugger' },
  critic: { model: CLAUDE_FAMILY_DEFAULTS.OPUS, agent: 'critic' },
  'code-reviewer': { model: CLAUDE_FAMILY_DEFAULTS.OPUS, agent: 'codeReviewer' },
  'security-reviewer': { model: CLAUDE_FAMILY_DEFAULTS.SONNET, agent: 'securityReviewer' },
  'test-engineer': { model: CLAUDE_FAMILY_DEFAULTS.SONNET, agent: 'testEngineer' },
  designer: { model: CLAUDE_FAMILY_DEFAULTS.SONNET, agent: 'designer' },
  writer: { model: CLAUDE_FAMILY_DEFAULTS.HAIKU, agent: 'writer' },
  'code-simplifier': { model: CLAUDE_FAMILY_DEFAULTS.OPUS, agent: 'codeSimplifier' },
  explore: { model: CLAUDE_FAMILY_DEFAULTS.HAIKU, agent: 'explore' },
  'document-specialist': { model: CLAUDE_FAMILY_DEFAULTS.SONNET, agent: 'documentSpecialist' },
};

describe('stage-router resolveRoleAssignment', () => {
  describe('defaults (no team.roleRouting)', () => {
    for (const role of CANONICAL_TEAM_ROLES) {
      it(`resolves ${role} → claude + tier-default model + canonical agent`, () => {
        const out = resolveRoleAssignment(role, EMPTY);
        expect(out.provider).toBe('claude');
        expect(out.agent).toBe(EXPECTED_DEFAULTS[role].agent);
        expect(out.model).toBe(EXPECTED_DEFAULTS[role].model);
      });
    }
  });

  describe('explicit overrides', () => {
    it('respects provider=codex with explicit model passthrough', () => {
      const cfg: PluginConfig = {
        team: { roleRouting: { critic: { provider: 'codex', model: 'gpt-5.3-codex' } } },
      };
      const out = resolveRoleAssignment('critic', cfg);
      expect(out.provider).toBe('codex');
      expect(out.model).toBe('gpt-5.3-codex');
      expect(out.agent).toBe('critic');
    });

    it('respects provider=gemini and resolves model from builtin defaults when omitted', () => {
      const cfg: PluginConfig = {
        team: { roleRouting: { 'code-reviewer': { provider: 'gemini' } } },
      };
      const out = resolveRoleAssignment('code-reviewer', cfg);
      expect(out.provider).toBe('gemini');
      expect(out.model).toBe(BUILTIN_EXTERNAL_MODEL_DEFAULTS.geminiModel);
      expect(out.agent).toBe('codeReviewer');
    });

    it('resolves tier name (HIGH) into Claude opus model for claude provider', () => {
      const cfg: PluginConfig = {
        team: { roleRouting: { executor: { provider: 'claude', model: 'HIGH' } } },
      };
      const out = resolveRoleAssignment('executor', cfg);
      expect(out.provider).toBe('claude');
      expect(out.model).toBe(CLAUDE_FAMILY_DEFAULTS.OPUS);
    });

    it('tier name on external provider falls back to provider builtin (tiers are claude-centric)', () => {
      const cfg: PluginConfig = {
        team: { roleRouting: { executor: { provider: 'codex', model: 'HIGH' } } },
      };
      const out = resolveRoleAssignment('executor', cfg);
      expect(out.provider).toBe('codex');
      expect(out.model).toBe(BUILTIN_EXTERNAL_MODEL_DEFAULTS.codexModel);
    });

    it('respects explicit agent override', () => {
      const cfg: PluginConfig = {
        team: { roleRouting: { executor: { agent: 'debugger' } } },
      };
      const out = resolveRoleAssignment('executor', cfg);
      expect(out.agent).toBe('debugger');
    });

    it('respects routing.tierModels overrides for claude tier resolution', () => {
      const cfg: PluginConfig = {
        routing: { tierModels: { HIGH: 'claude-opus-custom-id' } },
        team: { roleRouting: { critic: { provider: 'claude', model: 'HIGH' } } },
      };
      const out = resolveRoleAssignment('critic', cfg);
      expect(out.model).toBe('claude-opus-custom-id');
    });
  });

  describe('orchestrator pinning', () => {
    it('orchestrator provider always pinned to claude even when user specifies codex', () => {
      const cfg: PluginConfig = {
        team: { roleRouting: { orchestrator: { model: 'HIGH' } } },
      };
      const out = resolveRoleAssignment('orchestrator', cfg);
      expect(out.provider).toBe('claude');
      expect(out.agent).toBe('omc');
    });
  });

  describe('alias normalization', () => {
    it('"reviewer" alias normalizes to code-reviewer (resolved as code-reviewer)', () => {
      const cfg: PluginConfig = {
        team: { roleRouting: { reviewer: { provider: 'codex' } } as TeamRoleRoutingConfig },
      };
      const out = resolveRoleAssignment('reviewer' as CanonicalTeamRole, cfg);
      expect(out.provider).toBe('codex');
      expect(out.agent).toBe('codeReviewer');
    });

    it('canonical role lookup honors alias-keyed roleRouting entries', () => {
      const cfg: PluginConfig = {
        team: { roleRouting: { reviewer: { provider: 'gemini' } } as TeamRoleRoutingConfig },
      };
      const out = resolveRoleAssignment('code-reviewer', cfg);
      expect(out.provider).toBe('gemini');
      expect(out.agent).toBe('codeReviewer');
    });

    it('resolved snapshot uses alias-keyed routing entries for canonical stage roles', () => {
      const cfg: PluginConfig = {
        team: { roleRouting: { reviewer: { provider: 'codex' } } as TeamRoleRoutingConfig },
      };
      const snap = buildResolvedRoutingSnapshot(cfg);
      expect(snap['code-reviewer'].primary.provider).toBe('codex');
    });
  });

  // omitModelPin gate: on non-standard providers the config loader auto-sets
  // routing.omitModelPin. Claude workers must then NOT receive a baked tier
  // model ID (proxies reject Anthropic IDs like claude-opus-4-7); '' makes the
  // spawn path omit --model so the worker inherits its own env's model.
  describe('omitModelPin gate', () => {
    const INHERIT: PluginConfig = { routing: { omitModelPin: true } };

    it('returns empty model for a tier-default claude role under omitModelPin', () => {
      const out = resolveRoleAssignment('architect', INHERIT);
      expect(out.provider).toBe('claude');
      expect(out.model).toBe('');
      expect(out.agent).toBe('architect');
    });

    it('returns empty model for an explicit tier name under omitModelPin', () => {
      const cfg: PluginConfig = {
        routing: { omitModelPin: true },
        team: { roleRouting: { executor: { model: 'HIGH' } } },
      };
      expect(resolveRoleAssignment('executor', cfg).model).toBe('');
    });

    it('still honors an explicit non-tier model ID under omitModelPin', () => {
      const cfg: PluginConfig = {
        routing: { omitModelPin: true },
        team: { roleRouting: { architect: { model: 'claude-sonnet-4-6' } } },
      };
      expect(resolveRoleAssignment('architect', cfg).model).toBe('claude-sonnet-4-6');
    });

    it('does not affect external providers under omitModelPin', () => {
      const cfg: PluginConfig = {
        routing: { omitModelPin: true },
        team: { roleRouting: { critic: { provider: 'codex', model: 'gpt-5.3-codex' } } },
      };
      const out = resolveRoleAssignment('critic', cfg);
      expect(out.provider).toBe('codex');
      expect(out.model).toBe('gpt-5.3-codex');
    });

    it('resolves tier model normally when omitModelPin is off', () => {
      expect(resolveRoleAssignment('architect', EMPTY).model).toBe(CLAUDE_FAMILY_DEFAULTS.OPUS);
    });

    it('snapshot fallback also inherits (empty model) under omitModelPin', () => {
      const snap = buildResolvedRoutingSnapshot(INHERIT);
      expect(snap.architect.primary.model).toBe('');
      expect(snap.architect.fallback.model).toBe('');
    });
  });
});
