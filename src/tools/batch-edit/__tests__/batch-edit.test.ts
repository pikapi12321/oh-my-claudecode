/**
 * Batch Edit Tool — Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  normalizeQuotes,
  normalizeTypography,
  findActualString,
  findAllMatches,
  preserveQuoteStyle,
  parseFilePath,
  readFileWithEncoding,
  writeFileWithEncoding,
  extractLineRange,
  generateDiff,
  langForFile,
} from '../utils.js';
import { batchEditTool } from '../index.js';

// ─── Temp directory for file tests ──────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-edit-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── normalizeQuotes ────────────────────────────────────────────────────────

describe('normalizeQuotes', () => {
  it('converts curly double quotes to ASCII', () => {
    expect(normalizeQuotes('“hello”')).toBe('"hello"');
  });

  it('converts curly single quotes to ASCII', () => {
    expect(normalizeQuotes('‘hello’')).toBe("'hello'");
  });

  it('leaves ASCII quotes unchanged', () => {
    expect(normalizeQuotes('"hello"')).toBe('"hello"');
  });
});

// ─── normalizeTypography ────────────────────────────────────────────────────

describe('normalizeTypography', () => {
  it('converts em-dash to --', () => {
    expect(normalizeTypography('foo—bar')).toBe('foo--bar');
  });

  it('converts ellipsis to ...', () => {
    expect(normalizeTypography('wait…')).toBe('wait...');
  });
});

// ─── findActualString ───────────────────────────────────────────────────────

describe('findActualString', () => {
  it('returns exact match unchanged', () => {
    const result = findActualString('hello world', 'hello');
    expect(result).toBe('hello');
  });

  it('matches across curly-quote normalization', () => {
    const file = 'const x = “value”';
    const search = 'const x = "value"';
    const result = findActualString(file, search);
    expect(result).toBe('const x = “value”');
  });

  it('returns null when not found', () => {
    expect(findActualString('hello', 'world')).toBeNull();
  });
});

// ─── findAllMatches ─────────────────────────────────────────────────────────

describe('findAllMatches', () => {
  it('finds multiple exact matches', () => {
    const positions = findAllMatches('ababab', 'ab');
    expect(positions).toEqual([0, 2, 4]);
  });

  it('finds normalized matches', () => {
    const positions = findAllMatches('“foo” and “foo”', '"foo"');
    expect(positions.length).toBe(2);
  });

  it('returns empty when not found', () => {
    expect(findAllMatches('hello', 'xyz')).toEqual([]);
  });
});

// ─── preserveQuoteStyle ─────────────────────────────────────────────────────

describe('preserveQuoteStyle', () => {
  it('returns newString unchanged when oldString === actualOldString', () => {
    expect(preserveQuoteStyle('foo', 'foo', 'bar')).toBe('bar');
  });

  it('applies curly double quotes to newString', () => {
    const result = preserveQuoteStyle(
      'const x = "old"',
      'const x = “old”',
      'const x = "new"',
    );
    expect(result).toBe('const x = “new”');
  });

  it('preserves contraction apostrophes', () => {
    const result = preserveQuoteStyle(
      "don't",
      "don’t",
      "won't",
    );
    expect(result).toBe("won’t");
  });
});

// ─── parseFilePath ──────────────────────────────────────────────────────────

describe('parseFilePath', () => {
  it('parses plain path without range', () => {
    const { filePath, lineRange } = parseFilePath('src/foo.ts');
    expect(filePath).toBe('src/foo.ts');
    expect(lineRange).toBeNull();
  });

  it('parses path with line range', () => {
    const { filePath, lineRange } = parseFilePath('src/foo.ts#10-20');
    expect(filePath).toBe('src/foo.ts');
    expect(lineRange).toEqual({ start: 10, end: 20 });
  });

  it('parses path with single line', () => {
    const { filePath, lineRange } = parseFilePath('src/foo.ts#5');
    expect(filePath).toBe('src/foo.ts');
    expect(lineRange).toEqual({ start: 5, end: 5 });
  });
});

// ─── extractLineRange ───────────────────────────────────────────────────────

describe('extractLineRange', () => {
  const content = 'line1\nline2\nline3\nline4\nline5';

  it('extracts middle lines', () => {
    const { text, startOffset } = extractLineRange(content, { start: 2, end: 4 });
    expect(text).toBe('line2\nline3\nline4');
    expect(startOffset).toBe(6); // "line1\n" = 6 chars
  });

  it('extracts first line', () => {
    const { text } = extractLineRange(content, { start: 1, end: 1 });
    expect(text).toBe('line1');
  });
});

// ─── generateDiff ───────────────────────────────────────────────────────────

describe('generateDiff', () => {
  it('generates a unified diff', () => {
    const diff = generateDiff('hello\nworld', 'hello\nuniverse', 'test.txt');
    expect(diff).toContain('--- a/test.txt');
    expect(diff).toContain('+++ b/test.txt');
    expect(diff).toContain('-world');
    expect(diff).toContain('+universe');
  });
});

// ─── langForFile ────────────────────────────────────────────────────────────

describe('langForFile', () => {
  it('maps .ts to TypeScript', () => {
    expect(langForFile('foo.ts')).toBe('TypeScript');
  });

  it('maps .py to Python', () => {
    expect(langForFile('foo.py')).toBe('Python');
  });

  it('returns null for unknown extension', () => {
    expect(langForFile('foo.xyz')).toBeNull();
  });
});

// ─── readFileWithEncoding / writeFileWithEncoding ────────────────────────────

describe('encoding round-trip', () => {
  it('preserves UTF-8 content', () => {
    const filePath = path.join(tmpDir, 'test.ts');
    fs.writeFileSync(filePath, 'const x = 1;\n');

    const { content, encoding } = readFileWithEncoding(filePath);
    expect(content).toBe('const x = 1;\n');
    expect(encoding.charset).toBe('utf8');
    expect(encoding.lineEndings).toBe('lf');

    writeFileWithEncoding(filePath, 'const x = 2;\n', encoding);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('const x = 2;\n');
  });

  it('preserves CRLF line endings', () => {
    const filePath = path.join(tmpDir, 'crlf.txt');
    fs.writeFileSync(filePath, 'line1\r\nline2\r\n');

    const { content, encoding } = readFileWithEncoding(filePath);
    expect(content).toBe('line1\nline2\n');
    expect(encoding.lineEndings).toBe('crlf');

    writeFileWithEncoding(filePath, 'line1\nline3\n', encoding);
    expect(fs.readFileSync(filePath, 'utf8')).toBe('line1\r\nline3\r\n');
  });
});

// ─── batchEditTool handler ──────────────────────────────────────────────────

describe('batchEditTool handler', () => {
  it('applies a simple replacement', async () => {
    const filePath = path.join(tmpDir, 'sample.ts');
    fs.writeFileSync(filePath, 'const a = 1;\nconst b = 2;\n');

    const result = await batchEditTool.handler({
      edits: [{
        file_path: filePath,
        old_string: 'const a = 1;',
        new_string: 'const a = 10;',
        replace_all: false,
      }],
      fuzzy: 'exact', verbose: false,
    });

    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('1 succeeded');
    expect(fs.readFileSync(filePath, 'utf8')).toContain('const a = 10;');
  });

  it('creates a new file when old_string is null', async () => {
    const filePath = path.join(tmpDir, 'new.ts');

    const result = await batchEditTool.handler({
      edits: [{
        file_path: filePath,
        old_string: null,
        new_string: 'export default 42;\n',
        replace_all: false,
      }],
      fuzzy: 'exact', verbose: false,
    });

    expect(result.isError).toBeFalsy();
    expect(fs.readFileSync(filePath, 'utf8')).toBe('export default 42;\n');
  });

  it('reports error on missing string', async () => {
    const filePath = path.join(tmpDir, 'sample.ts');
    fs.writeFileSync(filePath, 'hello\n');

    const result = await batchEditTool.handler({
      edits: [{
        file_path: filePath,
        old_string: 'nonexistent',
        new_string: 'replaced',
        replace_all: false,
      }],
      fuzzy: 'exact', verbose: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('String not found');
    // Error should not leak file content
    expect(result.content[0].text).not.toContain('File content');
  });

  it('rejects ambiguous match without replace_all', async () => {
    const filePath = path.join(tmpDir, 'dup.ts');
    fs.writeFileSync(filePath, 'foo\nfoo\n');

    const result = await batchEditTool.handler({
      edits: [{
        file_path: filePath,
        old_string: 'foo',
        new_string: 'bar',
        replace_all: false,
      }],
      fuzzy: 'exact', verbose: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('2 matches');
  });

  it('replaces all when replace_all is true', async () => {
    const filePath = path.join(tmpDir, 'dup.ts');
    fs.writeFileSync(filePath, 'foo\nfoo\n');

    const result = await batchEditTool.handler({
      edits: [{
        file_path: filePath,
        old_string: 'foo',
        new_string: 'bar',
        replace_all: true,
      }],
      fuzzy: 'exact', verbose: false,
    });

    expect(result.isError).toBeFalsy();
    expect(fs.readFileSync(filePath, 'utf8')).toBe('bar\nbar\n');
  });

  it('applies sequential edits to same file', async () => {
    const filePath = path.join(tmpDir, 'seq.ts');
    fs.writeFileSync(filePath, 'a = 1\nb = 2\n');

    const result = await batchEditTool.handler({
      edits: [
        { file_path: filePath, old_string: 'a = 1', new_string: 'a = 10', replace_all: false },
        { file_path: filePath, old_string: 'b = 2', new_string: 'b = 20', replace_all: false },
      ],
      fuzzy: 'exact', verbose: false,
    });

    expect(result.isError).toBeFalsy();
    expect(fs.readFileSync(filePath, 'utf8')).toBe('a = 10\nb = 20\n');
  });

  it('handles curly-quote normalization', async () => {
    const filePath = path.join(tmpDir, 'quotes.ts');
    fs.writeFileSync(filePath, 'const msg = “hello”;\n');

    const result = await batchEditTool.handler({
      edits: [{
        file_path: filePath,
        old_string: 'const msg = "hello";',
        new_string: 'const msg = "world";',
        replace_all: false,
      }],
      fuzzy: 'normalized', verbose: false,
    });

    expect(result.isError).toBeFalsy();
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('“world”');
  });

  it('applies multiple cross-file edits', async () => {
    const file1 = path.join(tmpDir, 'a.ts');
    const file2 = path.join(tmpDir, 'b.ts');
    fs.writeFileSync(file1, 'export const A = 1;\n');
    fs.writeFileSync(file2, 'export const B = 2;\n');

    const result = await batchEditTool.handler({
      edits: [
        { file_path: file1, old_string: 'A = 1', new_string: 'A = 10', replace_all: false },
        { file_path: file2, old_string: 'B = 2', new_string: 'B = 20', replace_all: false },
      ],
      fuzzy: 'exact', verbose: false,
    });

    expect(result.isError).toBeFalsy();
    expect(fs.readFileSync(file1, 'utf8')).toContain('A = 10');
    expect(fs.readFileSync(file2, 'utf8')).toContain('B = 20');
  });

  it('deletes text and strips dangling newline', async () => {
    const filePath = path.join(tmpDir, 'del.ts');
    fs.writeFileSync(filePath, 'line1\nline2\nline3\n');

    const result = await batchEditTool.handler({
      edits: [{
        file_path: filePath,
        old_string: 'line2',
        new_string: '',
        replace_all: false,
      }],
      fuzzy: 'exact', verbose: false,
    });

    expect(result.isError).toBeFalsy();
    // "line2\n" should be removed entirely, not leaving an empty line
    expect(fs.readFileSync(filePath, 'utf8')).toBe('line1\nline3\n');
  });

  it('blocks sensitive files', async () => {
    const filePath = path.join(tmpDir, '.env');
    fs.writeFileSync(filePath, 'SECRET=abc\n');

    const result = await batchEditTool.handler({
      edits: [{
        file_path: filePath,
        old_string: 'SECRET=abc',
        new_string: 'SECRET=xyz',
        replace_all: false,
      }],
      fuzzy: 'exact', verbose: false,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Refusing to edit sensitive file');
    // File unchanged
    expect(fs.readFileSync(filePath, 'utf8')).toBe('SECRET=abc\n');
  });
});

// ─── Normalized mode + typography ───────────────────────────────────────────

describe('normalized fuzzy mode with typography', () => {
  it('matches em-dash (—) in file when search uses --', async () => {
    const filePath = path.join(tmpDir, 'typo.ts');
    fs.writeFileSync(filePath, 'const msg = "foo—bar";\n');

    const result = await batchEditTool.handler({
      edits: [{
        file_path: filePath,
        old_string: 'const msg = "foo--bar";',
        new_string: 'const msg = "baz--qux";',
        replace_all: false,
      }],
      fuzzy: 'normalized', verbose: false,
    });

    expect(result.isError).toBeFalsy();
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('baz');
  });

  it('matches ellipsis (…) in file when search uses ...', async () => {
    const filePath = path.join(tmpDir, 'ellip.ts');
    fs.writeFileSync(filePath, 'const x = "loading…";\n');

    const result = await batchEditTool.handler({
      edits: [{
        file_path: filePath,
        old_string: 'const x = "loading...";',
        new_string: 'const x = "done";',
        replace_all: false,
      }],
      fuzzy: 'normalized', verbose: false,
    });

    expect(result.isError).toBeFalsy();
    expect(fs.readFileSync(filePath, 'utf8')).toContain('"done"');
  });

  it('maps positions correctly when typography changes length', async () => {
    const filePath = path.join(tmpDir, 'pos.ts');
    // em-dash (1 char) in file, -- (2 chars) in search
    fs.writeFileSync(filePath, 'aaa\nbbb—ccc\nddd\n');

    const result = await batchEditTool.handler({
      edits: [{
        file_path: filePath,
        old_string: 'bbb--ccc',
        new_string: 'BBB--CCC',
        replace_all: false,
      }],
      fuzzy: 'normalized', verbose: false,
    });

    expect(result.isError).toBeFalsy();
    // Verify surrounding context preserved
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('aaa');
    expect(content).toContain('ddd');
  });
});

// ─── AST matching mode ──────────────────────────────────────────────────────

describe('AST fuzzy mode', () => {
  it('matches structurally equivalent code ignoring whitespace', async () => {
    const filePath = path.join(tmpDir, 'ast.ts');
    fs.writeFileSync(filePath, 'function   add(  a ,  b )  {\n  return a + b;\n}\n');

    const result = await batchEditTool.handler({
      edits: [{
        file_path: filePath,
        old_string: 'function add(a, b) {\n  return a + b;\n}',
        new_string: 'function add(a: number, b: number): number {\n  return a + b;\n}',
        replace_all: false,
      }],
      fuzzy: 'ast', verbose: false,
    });

    expect(result.isError).toBeFalsy();
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toContain('number');
  });
});

// ─── Line range editing ─────────────────────────────────────────────────────

describe('line range editing', () => {
  it('edits only within #start-end range', async () => {
    const filePath = path.join(tmpDir, 'range.ts');
    fs.writeFileSync(filePath, 'line1\nconst x = 1;\nline3\nconst x = 1;\nline5\n');

    // Edit only the second occurrence using line range
    const result = await batchEditTool.handler({
      edits: [{
        file_path: filePath + '#4-4',
        old_string: 'const x = 1;',
        new_string: 'const x = 99;',
        replace_all: false,
      }],
      fuzzy: 'exact', verbose: false,
    });

    expect(result.isError).toBeFalsy();
    const content = fs.readFileSync(filePath, 'utf8');
    // First occurrence untouched, second occurrence changed
    const lines = content.split('\n');
    expect(lines[1]).toBe('const x = 1;');   // line 2 (unchanged)
    expect(lines[3]).toBe('const x = 99;');   // line 4 (changed)
  });

  it('preserves content outside line range', async () => {
    const filePath = path.join(tmpDir, 'range2.ts');
    const original = 'AAA\nBBB\nCCC\nDDD\nEEE\n';
    fs.writeFileSync(filePath, original);

    const result = await batchEditTool.handler({
      edits: [{
        file_path: filePath + '#2-4',
        old_string: 'BBB\nCCC\nDDD',
        new_string: 'XXX\nYYY\nZZZ',
        replace_all: false,
      }],
      fuzzy: 'exact', verbose: false,
    });

    expect(result.isError).toBeFalsy();
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toBe('AAA\nXXX\nYYY\nZZZ\nEEE\n');
  });
});
