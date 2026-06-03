import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..', '..', '..');

function runPreToolHook(scriptPath: string, command: string) {
  return JSON.parse(
    execFileSync('node', [scriptPath], {
      cwd: packageRoot,
      input: JSON.stringify({
        tool_name: 'Bash',
        tool_input: { command },
      }),
      encoding: 'utf-8',
    }),
  ) as Record<string, unknown>;
}

describe('pre-tool-use packaged artifacts', () => {
  it('does not warn for .json commands just because .js is a substring', () => {
    const scriptPath = join(packageRoot, 'templates', 'hooks', 'pre-tool-use.mjs');

    expect(runPreToolHook(scriptPath, 'cat settings.json > backup.txt')).toEqual({
      continue: true,
      suppressOutput: true,
    });

    expect(JSON.stringify(runPreToolHook(scriptPath, 'cat app.js > backup.txt'))).toContain(
      'Bash command may modify source files',
    );
  });
});

describe('pre-tool-use packaged artifacts', () => {
  it('does not warn for .json commands just because .js is a substring', () => {
    const scriptPath = join(packageRoot, 'templates', 'hooks', 'pre-tool-use.mjs');

    expect(runPreToolHook(scriptPath, 'cat settings.json > backup.txt')).toEqual({
      continue: true,
      suppressOutput: true,
    });

    expect(JSON.stringify(runPreToolHook(scriptPath, 'cat app.js > backup.txt'))).toContain(
      'Bash command may modify source files',
    );
  });
});
