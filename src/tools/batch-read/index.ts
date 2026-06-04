/**
 * Batch Read MCP Tool
 *
 * Multi-file batch reading with AST-aware truncation and session-scoped dedup.
 * Supports three detail levels: full, signatures, overview.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import type { SgNode } from '@ast-grep/napi';
import { Lang } from '@ast-grep/napi';
import {
  BatchReadInput,
  type ReadDedupEntry,
  type FileReadResult,
} from './types.js';
import { parseFilePath, readFileWithEncoding, langForFile } from '../batch-edit/utils.js';
import { getSg } from '../shared/ast-loader.js';
import type { LineRange } from '../shared/types.js';
import { ToolDefinition } from '../types.js';

// ─── AST truncation helpers ─────────────────────────────────────────────────

/**
 * Node kinds that represent function/method declarations across languages.
 */
const FUNCTION_KINDS = new Set([
  'function_declaration',
  'method_definition',
  'function_definition',
  'arrow_function',
  'generator_function_declaration',
  'function_signature',
  'method_signature',
  'constructor_definition',
]);

/**
 * Node kinds that represent body blocks.
 */
const BODY_KINDS = new Set([
  'statement_block',
  'block',
  'function_body',
  'class_body',
]);

/**
 * Node kinds that represent top-level declarations for overview mode.
 */
const OVERVIEW_KINDS = new Set([
  'export_statement',
  'import_statement',
  'import_declaration',
  'export_declaration',
  'lexical_declaration',    // const/let at top level
  'variable_declaration',  // var at top level
  'type_alias_declaration',
  'interface_declaration',
  'class_declaration',
  'function_declaration',
  'enum_declaration',
  'abstract_class_declaration',
]);

/**
 * AST-aware truncation: replace function/method bodies with `{ ... }`.
 * Returns truncated source text, or null if AST unavailable.
 */
function astTruncateSignatures(content: string, language: string): string | null {
  const api = getSg();
  if (!api) return null;

  try {
    const langEnum = language as Lang;
    const root = api.parse(langEnum, content);
    const rootNode = root.root();

    // Collect body ranges to replace (start, end in char offsets)
    const bodyRanges: Array<{ start: number; end: number; replacement: string }> = [];

    function visit(node: SgNode): void {
      const kind = node.kind();

      // If this is a function-like node, find its body child and mark for truncation
      if (FUNCTION_KINDS.has(kind)) {
        const children = node.children();
        for (const child of children) {
          if (BODY_KINDS.has(child.kind())) {
            const range = child.range();
            bodyRanges.push({
              start: range.start.index,
              end: range.end.index,
              replacement: `{ ... }`,
            });
            break;
          }
        }
        // Don't recurse into children that were already handled
        return;
      }

      // Recurse into children
      for (const child of node.children()) {
        visit(child);
      }
    }

    visit(rootNode);

    if (bodyRanges.length === 0) {
      // No functions found — return content as-is for signatures mode
      return content;
    }

    // Apply replacements back-to-front to preserve positions
    bodyRanges.sort((a, b) => b.start - a.start);
    let result = content;
    for (const range of bodyRanges) {
      result = result.substring(0, range.start) + range.replacement + result.substring(range.end);
    }

    return result;
  } catch {
    return null;
  }
}

/**
 * AST-aware overview: keep only export/import/top-level declarations.
 * Returns overview text, or null if AST unavailable.
 */
function astOverview(content: string, language: string): string | null {
  const api = getSg();
  if (!api) return null;

  try {
    const langEnum = language as Lang;
    const root = api.parse(langEnum, content);
    const rootNode = root.root();

    const keptLines: string[] = [];

    for (const child of rootNode.children()) {
      const kind = child.kind();
      if (OVERVIEW_KINDS.has(kind)) {
        // For overview, keep just the first line of each declaration
        const text = child.text();
        const firstLine = text.split('\n')[0];
        // Truncate long first lines
        if (firstLine.length > 200) {
          keptLines.push(firstLine.substring(0, 197) + '...');
        } else {
          keptLines.push(firstLine);
        }
      }
    }

    if (keptLines.length === 0) {
      return content.split('\n').slice(0, 5).join('\n') + '\n// ... (no top-level declarations detected)';
    }

    return keptLines.join('\n');
  } catch {
    return null;
  }
}

/**
 * Regex-based fallback for signatures mode (no AST available).
 * Strips multi-line function bodies by collapsing to `{ ... }`.
 */
function regexTruncateSignatures(content: string): string {
  // Collapse sequences of lines between { and } for function-like declarations
  const lines = content.split('\n');
  const result: string[] = [];
  let inBody = false;
  let braceDepth = 0;
  let signatureLine = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (inBody) {
      // Count braces to find end of body
      for (const ch of trimmed) {
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      if (braceDepth <= 0) {
        result.push(signatureLine + ' { ... }');
        inBody = false;
        braceDepth = 0;
        signatureLine = '';
      }
      continue;
    }

    // Detect function-like lines ending with { or =>
    if (
      (/\b(function|def|fn|pub fn|func|method|class)\b/.test(trimmed) ||
       /^\s*(export\s+)?(async\s+)?function\b/.test(line) ||
       /^\s*(export\s+)?(abstract\s+)?class\b/.test(line)) &&
      (trimmed.endsWith('{') || trimmed.endsWith('=>') || lines[i + 1]?.trim() === '{')
    ) {
      signatureLine = line.replace(/\s*\{\s*$/, '');
      inBody = true;
      braceDepth = 1;
      if (trimmed.endsWith('{')) {
        // opening brace already on this line
      } else {
        // brace is on next line — advance
        i++;
      }
      continue;
    }

    result.push(line);
  }

  if (inBody && signatureLine) {
    result.push(signatureLine + ' { ... }');
  }

  return result.join('\n');
}

/**
 * Regex-based fallback for overview mode.
 */
function regexOverview(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith('export ') ||
      trimmed.startsWith('import ') ||
      trimmed.startsWith('export type ') ||
      trimmed.startsWith('export interface ') ||
      trimmed.startsWith('export enum ') ||
      trimmed.startsWith('export class ') ||
      trimmed.startsWith('export const ') ||
      trimmed.startsWith('export function ') ||
      trimmed.startsWith('export default ')
    ) {
      result.push(line);
    }
  }

  if (result.length === 0) {
    return content.split('\n').slice(0, 5).join('\n') + '\n// ... (no top-level declarations detected)';
  }

  return result.join('\n');
}

// ─── Line range extraction ──────────────────────────────────────────────────

/**
 * Extract raw lines within range (1-based, inclusive).
 * Returns plain text without line number prefixes.
 */
function extractLineRangeRaw(
  content: string,
  range: LineRange,
): { text: string; lineCount: number } {
  const lines = content.split('\n');
  const startLine = Math.max(0, range.start - 1);
  const endLine = Math.min(lines.length - 1, range.end - 1);

  return {
    text: lines.slice(startLine, endLine + 1).join('\n'),
    lineCount: endLine - startLine + 1,
  };
}

/**
 * Extract lines within range (1-based, inclusive).
 * Returns the text with line number prefixes.
 */
function extractLineRangeText(
  content: string,
  range: LineRange,
): { text: string; lineCount: number } {
  const lines = content.split('\n');
  const startLine = Math.max(0, range.start - 1);
  const endLine = Math.min(lines.length - 1, range.end - 1);

  const selectedLines: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    selectedLines.push(`${i + 1}: ${lines[i]}`);
  }

  return {
    text: selectedLines.join('\n'),
    lineCount: endLine - startLine + 1,
  };
}

// ─── Session-scoped dedup store ─────────────────────────────────────────────

/** Module-level dedup store keyed by `absolutePath + lineRangeKey + detail`. */
const dedupStore = new Map<string, ReadDedupEntry>();

/** Max entries in dedup store before bulk clear. */
const DEDUP_STORE_MAX_SIZE = 5000;

/**
 * Build dedup key from absolute path, line range, and detail level.
 */
function dedupKey(absPath: string, lineRangeKey: string | null, detail: string): string {
  return `${absPath}\0${lineRangeKey ?? ''}\0${detail}`;
}

/**
 * Check if a file read can be deduplicated.
 * Returns true if file mtime+size match the stored entry.
 */
function canDedup(absPath: string, lineRangeKey: string | null, detail: string): boolean {
  const key = dedupKey(absPath, lineRangeKey, detail);
  const entry = dedupStore.get(key);
  if (!entry) return false;

  try {
    const stat = fs.statSync(absPath);
    return stat.mtimeMs === entry.mtimeMs && stat.size === entry.size;
  } catch {
    return false;
  }
}

/**
 * Record a file read in the dedup store.
 */
function recordRead(absPath: string, lineRangeKey: string | null, detail: string): void {
  try {
    // Prevent unbounded growth
    if (dedupStore.size >= DEDUP_STORE_MAX_SIZE) {
      dedupStore.clear();
    }

    const stat = fs.statSync(absPath);
    const key = dedupKey(absPath, lineRangeKey, detail);
    dedupStore.set(key, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      detail,
      lineRangeKey,
    });
  } catch {
    // stat failed — don't cache
  }
}

/**
 * Clear dedup store (for testing).
 */
export function clearDedupStore(): void {
  dedupStore.clear();
}

// ─── Main handler ───────────────────────────────────────────────────────────

async function batchReadHandler(
  args: unknown,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const parsed = BatchReadInput.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid input: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { files } = parsed.data;
  const results: FileReadResult[] = [];
  let hasFatalError = false;

  for (const fileReq of files) {
    const rawPath = fileReq.file_path;
    const detail = fileReq.detail ?? 'full';

    const { filePath, lineRange } = parseFilePath(rawPath);
    const absPath = path.resolve(filePath);
    const lineRangeKey = lineRange ? `${lineRange.start}-${lineRange.end}` : null;

    try {
      // Check file exists
      if (!fs.existsSync(absPath)) {
        results.push({
          file_path: rawPath,
          detail,
          lines: 0,
          block: `=== ${rawPath} ===\nFile not found: ${absPath}`,
          deduplicated: false,
          error: true,
        });
        continue;
      }

      // Check dedup
      if (canDedup(absPath, lineRangeKey, detail)) {
        results.push({
          file_path: rawPath,
          detail,
          lines: 0,
          block: `=== ${rawPath} (unchanged) ===\nFile unchanged since last read.`,
          deduplicated: true,
          error: false,
        });
        continue;
      }

      // Read file content with encoding detection (handles UTF-16LE BOM)
      const { content } = readFileWithEncoding(absPath);
      const totalLines = content.split('\n').length;

      // Apply line range if specified
      let readContent: string;
      let displayLines: number;
      let displayPath = rawPath;

      if (lineRange) {
        const { text, lineCount } = extractLineRangeText(content, lineRange);
        readContent = text;
        displayLines = lineCount;
        displayPath = rawPath; // already includes #range
      } else {
        readContent = content;
        displayLines = totalLines;
      }

      // Apply detail level
      let outputContent: string;
      const lang = langForFile(filePath);

      if (detail === 'full') {
        if (lineRange) {
          // Line range already has numbered output
          outputContent = readContent;
        } else {
          // Add line numbers for full reads
          const numbered = readContent.split('\n').map((line, i) => `${i + 1}: ${line}`);
          outputContent = numbered.join('\n');
        }
      } else if (detail === 'signatures') {
        // Use range-extracted content (without line numbers) for truncation
        const sourceContent = lineRange ? extractLineRangeRaw(content, lineRange).text : readContent;
        if (lang) {
          outputContent = astTruncateSignatures(sourceContent, lang) ?? regexTruncateSignatures(sourceContent);
        } else {
          outputContent = regexTruncateSignatures(sourceContent);
        }
        displayLines = outputContent.split('\n').length;
      } else if (detail === 'overview') {
        // Use range-extracted content (without line numbers) for truncation
        const sourceContent = lineRange ? extractLineRangeRaw(content, lineRange).text : readContent;
        if (lang) {
          outputContent = astOverview(sourceContent, lang) ?? regexOverview(sourceContent);
        } else {
          outputContent = regexOverview(sourceContent);
        }
        displayLines = outputContent.split('\n').length;
      } else {
        outputContent = readContent;
      }

      // Record in dedup store
      recordRead(absPath, lineRangeKey, detail);

      // Build block header
      const header = `=== ${displayPath} (${displayLines} lines, ${detail}) ===`;

      results.push({
        file_path: rawPath,
        detail,
        lines: displayLines,
        block: `${header}\n${outputContent}`,
        deduplicated: false,
        error: false,
      });
    } catch (err) {
      // Per-file read errors are reported inline, not as batch-level errors.
      results.push({
        file_path: rawPath,
        detail,
        lines: 0,
        block: `=== ${rawPath} ===\nError: ${err instanceof Error ? err.message : String(err)}`,
        deduplicated: false,
        error: true,
      });
    }
  }

  // Build final output
  const output = results.map(r => r.block).join('\n\n');
  const dedupCount = results.filter(r => r.deduplicated).length;
  const readCount = results.filter(r => !r.deduplicated).length;
  const errorCount = results.filter(r => r.error).length;

  const summary = `\n\nBatch read: ${readCount} files read, ${dedupCount} unchanged, ${errorCount} errors`;

  // Only report batch-level error for fatal issues (invalid input, unexpected exceptions).
  // File-not-found and per-file read errors are reported inline in each file's block.
  return {
    content: [{ type: 'text', text: output + summary }],
    isError: hasFatalError,
  };
}

// ─── Schema for ToolDefinition generic ──────────────────────────────────────

const batchReadSchema = {
  files: BatchReadInput.shape.files,
};

// ─── Tool definition export ─────────────────────────────────────────────────

export const batchReadTool: ToolDefinition<typeof batchReadSchema> = {
  name: 'batch_read',
  description: `Multi-file batch reading with AST-aware truncation and session-scoped dedup. Reads multiple files in one call with three detail levels:
- full: raw content with line numbers
- signatures: function/type signatures only, bodies collapsed to { ... }
- overview: export/import/top-level declarations only
Supports #line-range suffix on file_path (e.g. src/foo.ts#50-100).
Session-scoped mtime dedup: unchanged files return a short stub instead of full content.`,
  schema: batchReadSchema,
  handler: batchReadHandler,
  annotations: {
    readOnlyHint: true,
  },
};

export { batchReadTool as default };
