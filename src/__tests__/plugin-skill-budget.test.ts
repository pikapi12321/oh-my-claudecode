import { describe, expect, it } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { copyPluginSyncPayload } from '../installer/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..');
const PLUGIN_JSON = join(REPO_ROOT, '.claude-plugin', 'plugin.json');
const SKILLS_DIR = join(REPO_ROOT, 'skills');
const COMMANDS_DIR = join(REPO_ROOT, 'commands');

function readPluginJson(): { skills?: unknown; commands?: unknown } {
  return JSON.parse(readFileSync(PLUGIN_JSON, 'utf-8')) as { skills?: unknown; commands?: unknown };
}

function bundledSkillDirs(): string[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS_DIR, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function pluginSkillDirs(): string[] {
  const { skills } = readPluginJson();
  expect(Array.isArray(skills)).toBe(true);
  return (skills as string[])
    .map((skillPath) => skillPath.replace(/^\.\/skills\//, '').replace(/\/$/, ''))
    .sort();
}


describe('plugin skill context budget gate (issues #2943, #2986)', () => {
  it('registers every bundled skill through plugin.json with concise native skill shims', () => {
    const defaultSkillDirs = pluginSkillDirs();
    const allSkillDirs = bundledSkillDirs();

    expect(allSkillDirs.length).toBeGreaterThan(25);
    expect(defaultSkillDirs).toEqual(allSkillDirs);
  });

  it('keeps bundled skills discoverable and manually callable', () => {
    expect(readPluginJson().commands).toBe('./commands/');

    const registeredSkillDirs = pluginSkillDirs();
    for (const skillDir of bundledSkillDirs()) {
      const skillContent = readFileSync(join(SKILLS_DIR, skillDir, 'SKILL.md'), 'utf-8');
      const frontmatterName = skillContent.match(/^name:\s*(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '') ?? skillDir;
      expect(registeredSkillDirs).toContain(skillDir);

      const commandPath = join(COMMANDS_DIR, `${frontmatterName}.md`);
      if (existsSync(commandPath)) {
        const commandContent = readFileSync(commandPath, 'utf-8');
        const expectedSkillPath = `skills/${skillDir}/SKILL.md`;
        expect(commandContent).toContain(expectedSkillPath);
        expect(commandContent).toContain('$ARGUMENTS');
      }
    }
  });

  it('materializes declared plugin command wrappers into cache sync targets', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'omc-plugin-commands-cache-'));
    try {
      const sourceRoot = join(tempRoot, 'source');
      const targetRoot = join(tempRoot, 'cache', 'omc', 'oh-my-claudecode', '4.14.1');
      mkdirSync(join(sourceRoot, '.claude-plugin'), { recursive: true });
      mkdirSync(join(sourceRoot, 'commands'), { recursive: true });
      mkdirSync(join(sourceRoot, 'dist', 'hooks'), { recursive: true });
      mkdirSync(join(sourceRoot, 'bridge'), { recursive: true });
      mkdirSync(join(sourceRoot, 'hooks'), { recursive: true });
      mkdirSync(join(sourceRoot, 'skills', 'plan'), { recursive: true });
      writeFileSync(join(sourceRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({
        name: 'oh-my-claudecode',
        commands: './commands/',
        skills: ['./skills/plan/'],
      }, null, 2));
      writeFileSync(join(sourceRoot, 'commands', 'omc-setup.md'), 'Read skills/omc-setup/SKILL.md and pass $ARGUMENTS.\n');
      writeFileSync(join(sourceRoot, 'dist', 'hooks', 'skill-bridge.cjs'), 'console.log("skill bridge");\n');
      writeFileSync(join(sourceRoot, 'bridge', 'cli.cjs'), 'console.log("bridge");\n');
      writeFileSync(join(sourceRoot, 'hooks', 'hooks.json'), '{}\n');
      writeFileSync(join(sourceRoot, 'skills', 'plan', 'SKILL.md'), 'name: plan\n');
      writeFileSync(join(sourceRoot, 'package.json'), JSON.stringify({ name: 'oh-my-claude-sisyphus', version: '4.14.1' }));

      const result = copyPluginSyncPayload(sourceRoot, [targetRoot]);

      expect(result.errors).toEqual([]);
      expect(result.synced).toBe(true);

      const manifest = JSON.parse(
        readFileSync(join(targetRoot, '.claude-plugin', 'plugin.json'), 'utf-8')
      ) as { commands?: string; skills?: string[] };
      expect(manifest.commands).toBe('./commands/');
      expect(manifest.skills).toEqual(['./skills/plan/']);
      expect(existsSync(join(targetRoot, 'commands'))).toBe(true);
      expect(readFileSync(join(targetRoot, 'commands', 'omc-setup.md'), 'utf-8')).toContain('$ARGUMENTS');
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('preserves deprecated slash aliases as command wrappers', () => {
    expect(readFileSync(join(COMMANDS_DIR, 'learner.md'), 'utf-8')).toContain('skills/skillify/SKILL.md');
    expect(readFileSync(join(COMMANDS_DIR, 'psm.md'), 'utf-8')).toContain('skills/project-session-manager/SKILL.md');
  });
});
