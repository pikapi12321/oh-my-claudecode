/**
 * Batch Read Tool — Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { batchReadTool, clearDedupStore } from '../index.js';

// ─── Temp directory for file tests ──────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-read-test-'));
  clearDedupStore();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  clearDedupStore();
});

// Helper to create a temp file
function createFile(relPath: string, content: string): string {
  const absPath = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, 'utf-8');
  return absPath;
}

// ─── Input validation ───────────────────────────────────────────────────────

describe('input validation', () => {
  it('rejects empty files array', async () => {
    const result = await batchReadTool.handler({ files: [] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid input');
  });

  it('rejects missing files field', async () => {
    const result = await batchReadTool.handler({} as unknown as { files: { file_path: string; detail: 'full' | 'signatures' | 'overview' }[] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid input');
  });
});

// ─── Full detail mode ───────────────────────────────────────────────────────

describe('full detail mode', () => {
  it('reads a single file with line numbers', async () => {
    const filePath = createFile('hello.ts', 'const x = 1;\nconst y = 2;');

    const result = await batchReadTool.handler({
      files: [{ file_path: filePath, detail: 'full' }],
    });

    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain(`=== ${filePath} (2 lines, full) ===`);
    expect(text).toContain('1: const x = 1;');
    expect(text).toContain('2: const y = 2;');
  });

  it('reads multiple files', async () => {
    const file1 = createFile('a.ts', 'export function a() {}');
    const file2 = createFile('b.ts', 'export function b() {}');

    const result = await batchReadTool.handler({
      files: [
        { file_path: file1, detail: 'full' },
        { file_path: file2, detail: 'full' },
      ],
    });

    const text = result.content[0].text;
    expect(text).toContain(`=== ${file1}`);
    expect(text).toContain(`=== ${file2}`);
    expect(text).toContain('export function a()');
    expect(text).toContain('export function b()');
  });

  it('caps output at 500 lines and shows hint', async () => {
    // Create a file with 600 lines
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`);
    const filePath = createFile('large.ts', lines.join('\n'));

    const result = await batchReadTool.handler({
      files: [{ file_path: filePath, detail: 'full' }],
    });

    const text = result.content[0].text;
    expect(text).toContain('1: line 1');
    expect(text).toContain('500: line 500');
    expect(text).not.toContain('501: line 501');
    expect(text).toContain('showing lines 1-500 of 600');
    expect(text).toContain('use #start-end to read more');
    // Header should show total lines, not capped count
    expect(text).toContain('(600 lines, full)');
  });

  it('does not cap when file has exactly 500 lines', async () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`);
    const filePath = createFile('exact.ts', lines.join('\n'));

    const result = await batchReadTool.handler({
      files: [{ file_path: filePath, detail: 'full' }],
    });

    const text = result.content[0].text;
    expect(text).toContain('500: line 500');
    expect(text).not.toContain('showing lines');
    expect(text).toContain('(500 lines, full)');
  });

  it('does not cap line range reads', async () => {
    const lines = Array.from({ length: 600 }, (_, i) => `line ${i + 1}`);
    const filePath = createFile('range-large.ts', lines.join('\n'));

    const result = await batchReadTool.handler({
      files: [{ file_path: `${filePath}#501-600`, detail: 'full' }],
    });

    const text = result.content[0].text;
    expect(text).toContain('501: line 501');
    expect(text).toContain('600: line 600');
    expect(text).not.toContain('showing lines');
  });

  it('reports file not found', async () => {
    const result = await batchReadTool.handler({
      files: [{ file_path: path.join(tmpDir, 'nonexistent.ts'), detail: 'full' }],
    });

    const text = result.content[0].text;
    expect(text).toContain('File not found');
    // File-not-found is a per-file issue, not a batch-level error
    expect(result.isError).toBeFalsy();
  });
});

// ─── Line range ─────────────────────────────────────────────────────────────

describe('line range', () => {
  it('reads specific line range with #start-end suffix', async () => {
    const content = 'line1\nline2\nline3\nline4\nline5';
    const filePath = createFile('range.ts', content);

    const result = await batchReadTool.handler({
      files: [{ file_path: `${filePath}#2-4`, detail: 'full' }],
    });

    const text = result.content[0].text;
    expect(text).toContain('2: line2');
    expect(text).toContain('3: line3');
    expect(text).toContain('4: line4');
    expect(text).not.toContain('1: line1');
    expect(text).not.toContain('5: line5');
  });

  it('handles single line range', async () => {
    const content = 'line1\nline2\nline3';
    const filePath = createFile('single.ts', content);

    const result = await batchReadTool.handler({
      files: [{ file_path: `${filePath}#2`, detail: 'full' }],
    });

    const text = result.content[0].text;
    // parseFilePath returns {start:2, end:2} for single number
    expect(text).toContain('2: line2');
  });
});

// ─── Signatures detail mode ─────────────────────────────────────────────────

describe('signatures detail mode', () => {
  it('truncates function bodies in TypeScript', async () => {
    const content = [
      'export function add(a: number, b: number): number {',
      '  const result = a + b;',
      '  return result;',
      '}',
      '',
      'export function subtract(a: number, b: number): number {',
      '  return a - b;',
      '}',
    ].join('\n');
    const filePath = createFile('math.ts', content);

    const result = await batchReadTool.handler({
      files: [{ file_path: filePath, detail: 'signatures' }],
    });

    const text = result.content[0].text;
    expect(text).toContain('signatures)');
    // Bodies should be collapsed
    expect(text).toContain('{ ... }');
    expect(text).not.toContain('const result = a + b');
  });

  it('truncates arrow function bodies in TypeScript', async () => {
    const content = [
      'export const add = (a: number, b: number): number => {',
      '  const result = a + b;',
      '  return result;',
      '};',
      '',
      'export const multiply = (a: number, b: number): number => {',
      '  return a * b;',
      '};',
    ].join('\n');
    const filePath = createFile('arrow.ts', content);

    const result = await batchReadTool.handler({
      files: [{ file_path: filePath, detail: 'signatures' }],
    });

    const text = result.content[0].text;
    expect(text).toContain('signatures)');
    // Arrow function bodies should be collapsed
    expect(text).toContain('{ ... }');
    expect(text).not.toContain('const result = a + b');
  });

  it('falls back to regex truncation for unknown languages', async () => {
    const content = [
      'function doStuff() {',
      '  lots of stuff here;',
      '}',
    ].join('\n');
    const filePath = createFile('script.xyz', content);

    const result = await batchReadTool.handler({
      files: [{ file_path: filePath, detail: 'signatures' }],
    });

    const text = result.content[0].text;
    expect(text).toContain('signatures)');
  });
});

// ─── Overview detail mode ───────────────────────────────────────────────────

describe('overview detail mode', () => {
  it('keeps only exports and imports in TypeScript', async () => {
    const content = [
      'import { z } from "zod";',
      'import * as fs from "fs";',
      '',
      'const internalVar = 42;',
      '',
      'export function publicFunc(): void {',
      '  // lots of internal logic',
      '}',
      '',
      'export type MyType = {',
      '  key: string;',
      '};',
    ].join('\n');
    const filePath = createFile('module.ts', content);

    const result = await batchReadTool.handler({
      files: [{ file_path: filePath, detail: 'overview' }],
    });

    const text = result.content[0].text;
    expect(text).toContain('overview)');
    expect(text).toContain('import { z } from "zod"');
    expect(text).toContain('export function publicFunc');
    expect(text).toContain('export type MyType');
  });

  it('provides fallback message when no declarations found', async () => {
    const content = '// just a comment\nconst x = 1;\nconsole.log(x);';
    const filePath = createFile('script.ts', content);

    const result = await batchReadTool.handler({
      files: [{ file_path: filePath, detail: 'overview' }],
    });

    const text = result.content[0].text;
    expect(text).toContain('overview)');
  });
});

// ─── Session-scoped dedup ───────────────────────────────────────────────────

describe('session-scoped dedup', () => {
  it('returns unchanged stub on second read of same file', async () => {
    const filePath = createFile('dedup.ts', 'const x = 1;');

    // First read
    const result1 = await batchReadTool.handler({
      files: [{ file_path: filePath, detail: 'full' }],
    });
    expect(result1.content[0].text).toContain('const x = 1;');
    expect(result1.content[0].text).not.toContain('File unchanged since last read');

    // Second read — should be deduped
    const result2 = await batchReadTool.handler({
      files: [{ file_path: filePath, detail: 'full' }],
    });
    expect(result2.content[0].text).toContain('File unchanged since last read');
    expect(result2.content[0].text).toContain('(unchanged)');
  });

  it('re-reads after file modification', async () => {
    const filePath = createFile('changing.ts', 'const x = 1;');

    // First read
    await batchReadTool.handler({
      files: [{ file_path: filePath, detail: 'full' }],
    });

    // Modify file (update mtime by changing content)
    const newContent = 'const x = 2;';
    fs.writeFileSync(filePath, newContent, 'utf-8');

    // Force mtime change if filesystem has coarse timestamps
    const now = new Date();
    fs.utimesSync(filePath, now, now);

    // Second read — should get new content
    const result2 = await batchReadTool.handler({
      files: [{ file_path: filePath, detail: 'full' }],
    });
    expect(result2.content[0].text).toContain('const x = 2;');
    expect(result2.content[0].text).not.toContain('File unchanged since last read');
  });

  it('deduplicates per detail level', async () => {
    const content = 'export function foo(): void {\n  return;\n}';
    const filePath = createFile('per-detail.ts', content);

    // Read as full
    await batchReadTool.handler({
      files: [{ file_path: filePath, detail: 'full' }],
    });

    // Read as signatures — should NOT be deduped (different detail)
    const result = await batchReadTool.handler({
      files: [{ file_path: filePath, detail: 'signatures' }],
    });
    expect(result.content[0].text).toContain('signatures)');
    expect(result.content[0].text).not.toContain('File unchanged since last read');
  });

  it('deduplicates per line range', async () => {
    const content = 'line1\nline2\nline3\nline4\nline5';
    const filePath = createFile('range-dedup.ts', content);

    // Read lines 1-3
    await batchReadTool.handler({
      files: [{ file_path: `${filePath}#1-3`, detail: 'full' }],
    });

    // Re-read lines 1-3 — should be deduped
    const result = await batchReadTool.handler({
      files: [{ file_path: `${filePath}#1-3`, detail: 'full' }],
    });
    expect(result.content[0].text).toContain('File unchanged since last read');

    // Read lines 3-5 — should NOT be deduped
    const result2 = await batchReadTool.handler({
      files: [{ file_path: `${filePath}#3-5`, detail: 'full' }],
    });
    expect(result2.content[0].text).toContain('3: line3');
    expect(result2.content[0].text).not.toContain('File unchanged since last read');
  });
});

// ─── Mixed batch ────────────────────────────────────────────────────────────

describe('mixed batch', () => {
  it('handles mix of full, signatures, and overview in one call', async () => {
    const file1 = createFile('full.ts', 'const x = 1;');
    const file2 = createFile('sig.ts', 'export function foo() {\n  return 42;\n}');
    const file3 = createFile('overview.ts', 'import { z } from "zod";\nexport type T = string;');

    const result = await batchReadTool.handler({
      files: [
        { file_path: file1, detail: 'full' },
        { file_path: file2, detail: 'signatures' },
        { file_path: file3, detail: 'overview' },
      ],
    });

    const text = result.content[0].text;
    expect(text).toContain('full)');
    expect(text).toContain('signatures)');
    expect(text).toContain('overview)');
    expect(text).toContain('Batch read: 3 files read, 0 unchanged');
  });

  it('handles mix of found and not-found files', async () => {
    const file1 = createFile('exists.ts', 'const x = 1;');

    const result = await batchReadTool.handler({
      files: [
        { file_path: file1, detail: 'full' },
        { file_path: path.join(tmpDir, 'missing.ts'), detail: 'full' },
      ],
    });

    const text = result.content[0].text;
    expect(text).toContain('const x = 1;');
    expect(text).toContain('File not found');
    // Mix of found/not-found — per-file error doesn't mark batch as error
    expect(result.isError).toBeFalsy();
  });
});

// ─── Tool metadata ──────────────────────────────────────────────────────────

describe('tool metadata', () => {
  it('has correct name', () => {
    expect(batchReadTool.name).toBe('batch_read');
  });

  it('has readOnly annotation', () => {
    expect(batchReadTool.annotations?.readOnlyHint).toBe(true);
  });

  it('has description', () => {
    expect(batchReadTool.description).toContain('Preferred over native Read');
  });
});
