/**
 * Search Tool — Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { searchTool } from '../index.js';

// ─── Temp directory for file tests ──────────────────────────────────────────

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-test-'));
  origCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(origCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Helper to create a temp file
function createFile(relPath: string, content: string): string {
  const absPath = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf-8');
  return relPath;
}

/** Call handler with partial args (Zod defaults applied at runtime). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (args: Record<string, unknown>) => searchTool.handler(args as any);

// ─── Input validation ───────────────────────────────────────────────────────

describe('input validation', () => {
  it('rejects empty file_glob_patterns', async () => {
    const result = await call({ file_glob_patterns: [] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid input');
  });

  it('rejects invalid regex', async () => {
    createFile('test.ts', 'const x = 1;');
    const result = await call({
      file_glob_patterns: ['*.ts'],
      content_regex: '[invalid',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid regex');
  });
});

// ─── Paths only mode ────────────────────────────────────────────────────────

describe('output_mode: paths', () => {
  it('returns file paths only', async () => {
    createFile('a.ts', 'const x = 1;');
    createFile('b.ts', 'const y = 2;');
    createFile('c.js', 'var z = 3;');

    const result = await call({
      file_glob_patterns: ['*.ts'],
      output_mode: 'paths',
    });

    const text = result.content[0].text;
    expect(text).toContain('a.ts');
    expect(text).toContain('b.ts');
    expect(text).not.toContain('c.js');
    expect(text).toContain('2 files');
  });

  it('returns no files message when nothing matches', async () => {
    const result = await call({
      file_glob_patterns: ['*.xyz'],
      output_mode: 'paths',
    });

    expect(result.content[0].text).toBe('No files matched the given patterns.');
  });
});

// ─── Match count mode ───────────────────────────────────────────────────────

describe('output_mode: match_count', () => {
  it('returns file paths with match counts', async () => {
    createFile('multi.ts', 'const x = 1;\nconst y = 2;\nconst z = 3;');
    createFile('single.ts', 'let a = 1;\nvar b = 2;');

    const result = await call({
      file_glob_patterns: ['*.ts'],
      content_regex: 'const',
      output_mode: 'match_count',
    });

    const text = result.content[0].text;
    expect(text).toContain('multi.ts: 3 match(es)');
    // single.ts has no 'const' matches, should be excluded
    expect(text).not.toContain('single.ts');
    expect(text).toContain('1 files, 3 matches');
  });
});

// ─── Content mode ───────────────────────────────────────────────────────────

describe('output_mode: content', () => {
  it('returns matches with context lines', async () => {
    const content = [
      'import { foo } from "./foo"',
      '',
      'export function bar() {',
      '  const result = foo(42)',
      '  return result',
      '}',
    ].join('\n');
    createFile('bar.ts', content);

    const result = await call({
      file_glob_patterns: ['*.ts'],
      content_regex: 'foo',
      output_mode: 'content',
    });

    const text = result.content[0].text;
    expect(text).toContain('← match');
    expect(text).toContain('foo(42)');
    expect(text).toContain('bar.ts');
  });

  it('lists files without content_regex', async () => {
    createFile('a.ts', 'const x = 1;');
    createFile('b.ts', 'const y = 2;');

    const result = await call({
      file_glob_patterns: ['*.ts'],
      output_mode: 'content',
    });

    const text = result.content[0].text;
    expect(text).toContain('=== a.ts ===');
    expect(text).toContain('=== b.ts ===');
    expect(text).toContain('2 files');
  });
});

// ─── Regex options ──────────────────────────────────────────────────────────

describe('regex options', () => {
  it('supports ignore_case', async () => {
    createFile('case.ts', 'const FOO = 1;\nconst foo = 2;');

    const result = await call({
      file_glob_patterns: ['*.ts'],
      content_regex: 'foo',
      ignore_case: true,
      output_mode: 'match_count',
    });

    const text = result.content[0].text;
    expect(text).toContain('2 match(es)');
  });

  it('is case-sensitive by default', async () => {
    createFile('case.ts', 'const FOO = 1;\nconst foo = 2;');

    const result = await call({
      file_glob_patterns: ['*.ts'],
      content_regex: 'foo',
      output_mode: 'match_count',
    });

    const text = result.content[0].text;
    expect(text).toContain('1 match(es)');
  });

  it('supports multiline mode', async () => {
    const content = 'export function bar(\n  a: number,\n  b: string\n) {}';
    createFile('multi.ts', content);

    const result = await call({
      file_glob_patterns: ['*.ts'],
      content_regex: 'function bar\\(.*?\\)',
      multiline: true,
      output_mode: 'match_count',
    });

    const text = result.content[0].text;
    expect(text).toContain('1 match(es)');
  });

  it('multiline mode reports correct line numbers in content mode', async () => {
    const content = [
      'import { foo } from "./foo"',
      '',
      'export function bar(',
      '  a: number,',
      '  b: string',
      ') {}',
    ].join('\n');
    createFile('ml-content.ts', content);

    const result = await call({
      file_glob_patterns: ['*.ts'],
      content_regex: 'function bar\\(.*?\\)',
      multiline: true,
      output_mode: 'content',
      lines_before: 1,
      lines_after: 1,
    });

    const text = result.content[0].text;
    // Match should start at line 3
    expect(text).toContain('[3] export function bar(');
    // Context before: line 2
    expect(text).toContain('[2]');
    // Context after: line 4
    expect(text).toContain('[4]');
    expect(text).toContain('← match');
  });
});

// ─── Context lines ──────────────────────────────────────────────────────────

describe('context lines', () => {
  it('respects lines_before and lines_after', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    lines[9] = 'MATCH HERE';
    createFile('ctx.ts', lines.join('\n'));

    const result = await call({
      file_glob_patterns: ['*.ts'],
      content_regex: 'MATCH HERE',
      lines_before: 1,
      lines_after: 1,
      output_mode: 'content',
    });

    const text = result.content[0].text;
    expect(text).toContain('[10] MATCH HERE');
    expect(text).toContain('[9] line 9');
    expect(text).toContain('[11] line 11');
    // Should NOT contain line 8 (only 1 line before)
    expect(text).not.toContain('[8] line 8');
  });
});

// ─── Glob patterns ──────────────────────────────────────────────────────────

describe('glob patterns', () => {
  it('matches nested directories', async () => {
    createFile('src/a.ts', 'const x = 1;');
    createFile('src/deep/b.ts', 'const y = 2;');
    createFile('other/c.ts', 'const z = 3;');

    const result = await call({
      file_glob_patterns: ['src/**/*.ts'],
      output_mode: 'paths',
    });

    const text = result.content[0].text;
    expect(text).toContain('a.ts');
    expect(text).toContain('b.ts');
    expect(text).not.toContain('c.ts');
  });

  it('supports multiple glob patterns', async () => {
    createFile('a.ts', 'const x = 1;');
    createFile('b.js', 'var y = 2;');

    const result = await call({
      file_glob_patterns: ['*.ts', '*.js'],
      output_mode: 'paths',
    });

    const text = result.content[0].text;
    expect(text).toContain('a.ts');
    expect(text).toContain('b.js');
    expect(text).toContain('2 files');
  });

  it('supports exact file paths', async () => {
    createFile('specific.ts', 'const x = 1;');

    const result = await call({
      file_glob_patterns: ['specific.ts'],
      output_mode: 'paths',
    });

    const text = result.content[0].text;
    expect(text).toContain('specific.ts');
  });
});

// ─── Edge cases ─────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('skips files with no regex matches', async () => {
    createFile('match.ts', 'const x = 1;');
    createFile('nomatch.ts', 'let y = 2;');

    const result = await call({
      file_glob_patterns: ['*.ts'],
      content_regex: 'const',
      output_mode: 'content',
    });

    const text = result.content[0].text;
    expect(text).toContain('match.ts');
    expect(text).not.toContain('nomatch.ts');
  });

  it('handles empty files gracefully', async () => {
    createFile('empty.ts', '');

    const result = await call({
      file_glob_patterns: ['*.ts'],
      content_regex: 'anything',
      output_mode: 'content',
    });

    expect(result.content[0].text).toBe('No matches found.\n0 files, 0 matches');
  });
});

// ─── Tool metadata ──────────────────────────────────────────────────────────

describe('tool metadata', () => {
  it('has correct name', () => {
    expect(searchTool.name).toBe('search');
  });

  it('has readOnly annotation', () => {
    expect(searchTool.annotations?.readOnlyHint).toBe(true);
  });

  it('has description', () => {
    expect(searchTool.description).toContain('glob + grep + read');
  });
});
