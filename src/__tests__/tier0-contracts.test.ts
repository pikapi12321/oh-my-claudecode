import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSkillsCache,
  createBuiltinSkills,
  getBuiltinSkill,
  listBuiltinSkillNames,
} from '../features/builtin-skills/skills.js';

vi.mock('../features/auto-update.js', () => ({
  isTeamEnabled: () => true,
}));

const TIER0_SKILLS = ['team', 'ralph', 'ultrawork', 'autopilot'] as const;

describe('Tier-0 contract: skill aliases and canonical entrypoints', () => {
  beforeEach(() => {
    clearSkillsCache();
  });

  it('keeps Tier-0 skills as canonical unprefixed names', () => {
    const names = listBuiltinSkillNames();

    for (const name of TIER0_SKILLS) {
      expect(names).toContain(name);
      expect(names).not.toContain(`omc-${name}`);
    }
  });

  it('resolves Tier-0 skills case-insensitively', () => {
    for (const name of TIER0_SKILLS) {
      expect(getBuiltinSkill(name)?.name).toBe(name);
      expect(getBuiltinSkill(name.toUpperCase())?.name).toBe(name);
    }
  });

  it('keeps Tier-0 skills unique in the loaded builtin catalog', () => {
    const tier0Hits = createBuiltinSkills().filter((skill) => TIER0_SKILLS.includes(skill.name as typeof TIER0_SKILLS[number]));
    expect(tier0Hits.map((skill) => skill.name).sort()).toEqual([...TIER0_SKILLS].sort());
  });
});
