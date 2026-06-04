/**
 * Batch Edit MCP Tool
 *
 * Multi-file batch editing with AST-aware fuzzy matching.
 * Handles curly-quote normalization, encoding, atomic writes,
 * uniqueness checks, and line-range scoping.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import {
  BatchEditInput,
  EditOp,
  type FuzzyMode,
  type EditResult,
  type LineRange,
  type FileEncoding,
} from './types.js';
import {
  findActualString,
  findAllMatches,
  preserveQuoteStyle,
  parseFilePath,
  readFileWithEncoding,
  extractLineRange,
  generateDiff,
  normalizeTypography,
  langForFile,
} from './utils.js';
import {
  findAstMatches,
  astStructuralMatch,
  hasAstGrep,
} from './ast-matcher.js';
import { atomicWriteSync } from '../../lib/atomic-write.js';
import { ToolDefinition } from '../types.js';

// ─── Sensitive file guard ───────────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  /\.env$/i,
  /\.env\.\w+$/i,
  /credentials/i,
  /\.pem$/i,
  /\.key$/i,
  /\.secret/i,
  /secrets?\.(json|yaml|yml|toml)$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /package-lock\.json$/i,
];

const SENSITIVE_DIR_PATTERNS = [
  /(?:^|[/\\])\.git(?:[/\\]|$)/,
  /(?:^|[/\\])node_modules(?:[/\\]|$)/,
];

function isSensitiveFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  // Check directory-level sensitive paths first
  if (SENSITIVE_DIR_PATTERNS.some(p => p.test(filePath))) return true;
  return SENSITIVE_PATTERNS.some(p => p.test(basename) || p.test(filePath));
}

// ─── Schema from types.ts (single source of truth) ──────────────────────────

// Derive ZodRawShape from BatchEditInput for ToolDefinition generic
const batchEditSchema = {
  edits: EditOp.array().min(1).describe('Edit operations, applied sequentially per file'),
  fuzzy: BatchEditInput.shape.fuzzy.describe('Matching strategy'),
};

// ─── Core edit logic ────────────────────────────────────────────────────────

interface ResolvedFile {
  filePath: string;
  absolutePath: string;
  content: string;
  encoding: FileEncoding;
  isExisting: boolean;
  /** File mtime at read time (ms). Used for staleness check before write. */
  mtimeMs: number;
}

/**
 * Build a position map from normalized string back to original.
 * normalizeTypography can change length (— → --), so we need
 * a character-by-character mapping from normalized index → original index.
 */
function buildNormToOrigMap(original: string): { normText: string; normToOrig: number[] } {
  const normToOrig: number[] = [];
  let normText = '';

  for (let i = 0; i < original.length; i++) {
    const ch = original[i];
    let normCh: string;

    switch (ch) {
      case '‘': case '’': normCh = "'"; break;
      case '“': case '”': normCh = '"'; break;
      case '—': normCh = '--'; break; // em-dash → 2 chars
      case '–': normCh = '-';  break;  // en-dash → 1 char
      case '…': normCh = '...'; break; // ellipsis → 3 chars
      default: normCh = ch;
    }

    for (let j = 0; j < normCh.length; j++) {
      normToOrig.push(i);
      normText += normCh[j];
    }
  }

  return { normText, normToOrig };
}

/**
 * Apply a single edit operation to content.
 * Returns the new content and match info, or throws on error.
 */
function applySingleEdit(
  content: string,
  edit: EditOp,
  fuzzy: FuzzyMode,
  language: string | null,
): { newContent: string; replacements: number; diff: string } {
  const { old_string, new_string, replace_all } = edit;

  // ── Create-new-file mode ──
  if (old_string == null) {
    return {
      newContent: new_string,
      replacements: 1,
      diff: generateDiff('', new_string, edit.file_path),
    };
  }

  if (content === '' && old_string !== '') {
    throw new Error(`File is empty but old_string is non-empty: ${edit.file_path}`);
  }

  // ── Find matches based on fuzzy mode ──
  let matchPositions: number[] = [];
  let actualOldString = old_string;

  if (fuzzy === 'ast' && language && hasAstGrep()) {
    // AST matching: find structurally equivalent region
    const astRange = astStructuralMatch(content, old_string, language);
    if (astRange) {
      // Extract the actual text from the file at the AST-matched region.
      // It may differ in whitespace/punctuation from old_string.
      actualOldString = content.substring(astRange.start, astRange.end);
      matchPositions = [astRange.start];
      // Search for additional identical matches of the extracted text
      let idx = content.indexOf(actualOldString, astRange.start + 1);
      while (idx !== -1) {
        matchPositions.push(idx);
        idx = content.indexOf(actualOldString, idx + 1);
      }
    } else {
      // AST parse/match failed — fallback to exact with curly-quote normalization
      const found = findActualString(content, old_string);
      if (found) {
        actualOldString = found;
        matchPositions = findAllMatches(content, found);
      }
    }
  } else if (fuzzy === 'normalized') {
    // Build position maps for both old_string and content
    const { normText: normSearch, normToOrig: _searchMap } = buildNormToOrigMap(old_string);
    const { normText: normFile, normToOrig: fileNormToOrig } = buildNormToOrigMap(content);

    let idx = normFile.indexOf(normSearch);
    while (idx !== -1) {
      // Map normalized position back to original content position
      const origPos = fileNormToOrig[idx];
      matchPositions.push(origPos);
      idx = normFile.indexOf(normSearch, idx + 1);
    }

    if (matchPositions.length > 0) {
      // Extract the actual text from original content at the mapped position.
      // Length may differ from old_string due to typography differences,
      // so use the normalized search length mapped back to find the end.
      const startNormIdx = normFile.indexOf(normSearch);
      const endNormIdx = startNormIdx + normSearch.length;
      // Find the original end position: last normToOrig entry before endNormIdx
      let origEnd = matchPositions[0];
      if (endNormIdx < fileNormToOrig.length) {
        origEnd = fileNormToOrig[endNormIdx];
      } else {
        origEnd = content.length;
      }
      actualOldString = content.substring(matchPositions[0], origEnd);
    }
  } else {
    // Exact mode (with curly-quote normalization)
    actualOldString = findActualString(content, old_string) ?? old_string;
    matchPositions = findAllMatches(content, actualOldString);
  }

  if (matchPositions.length === 0) {
    const lineCount = content.split('\n').length;
    throw new Error(
      `String not found in file.\nFile: ${edit.file_path}\nSearched: ${old_string}\n` +
      `File has ${lineCount} lines.`
    );
  }

  // ── Uniqueness check ──
  if (matchPositions.length > 1 && !replace_all) {
    throw new Error(
      `Found ${matchPositions.length} matches of the string to replace, ` +
      `but replace_all is false. Set replace_all=true or provide more context.\n` +
      `File: ${edit.file_path}\nString: ${old_string}`
    );
  }

  // ── Preserve quote style ──
  const actualNewString = preserveQuoteStyle(old_string, actualOldString, new_string);

  // ── Dangling newline handling (CC pattern) ──
  // Before replacing, check if deleting (empty new_string) and whether
  // actualOldString + '\n' exists in content → strip the trailing newline too.
  let searchOld = actualOldString;
  if (new_string === '' && !actualOldString.endsWith('\n') && content.includes(actualOldString + '\n')) {
    searchOld = actualOldString + '\n';
  }

  // ── Apply replacement ──
  const count = replace_all ? matchPositions.length : 1;
  let newContent = content;

  if (replace_all) {
    // Replace all occurrences (iterate backwards to preserve positions)
    for (let i = matchPositions.length - 1; i >= 0; i--) {
      const pos = matchPositions[i];
      newContent =
        newContent.substring(0, pos) +
        actualNewString +
        newContent.substring(pos + searchOld.length);
    }
  } else {
    const pos = matchPositions[0];
    newContent =
      newContent.substring(0, pos) +
      actualNewString +
      newContent.substring(pos + searchOld.length);
  }

  const diff = generateDiff(content, newContent, edit.file_path);
  return { newContent, replacements: count, diff };
}

// ─── Main handler ───────────────────────────────────────────────────────────

async function batchEditHandler(
  args: unknown,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const parsed = BatchEditInput.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid input: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const { edits, fuzzy } = parsed.data;

  // Handler-local file cache (no module-level state — safe for concurrent calls)
  const fileCache = new Map<string, ResolvedFile>();

  function resolveFile(rawPath: string): ResolvedFile {
    const absolutePath = path.resolve(rawPath);

    if (fileCache.has(absolutePath)) {
      return fileCache.get(absolutePath)!;
    }

    let resolved: ResolvedFile;

    if (fs.existsSync(absolutePath)) {
      const { content, encoding } = readFileWithEncoding(absolutePath);
      const mtimeMs = Math.floor(fs.statSync(absolutePath).mtimeMs);
      resolved = {
        filePath: rawPath,
        absolutePath,
        content,
        encoding,
        isExisting: true,
        mtimeMs,
      };
    } else {
      resolved = {
        filePath: rawPath,
        absolutePath,
        content: '',
        encoding: { charset: 'utf8', lineEndings: 'lf' },
        isExisting: false,
        mtimeMs: 0,
      };
    }

    fileCache.set(absolutePath, resolved);
    return resolved;
  }

  const results: EditResult[] = [];
  const modifiedFiles = new Map<string, { content: string; encoding: FileEncoding }>();

  try {
    for (const edit of edits) {
      const { filePath: rawPath, lineRange } = parseFilePath(edit.file_path);

      // Sensitive file guard
      if (isSensitiveFile(rawPath)) {
        results.push({
          file_path: edit.file_path,
          success: false,
          replacements: 0,
          error: `Refusing to edit sensitive file: ${rawPath}`,
        });
        continue;
      }

      try {
        // Resolve file (use cache for same-file sequential edits)
        const file = resolveFile(rawPath);
        const language = langForFile(rawPath);

        // Use cached modified content if file was already edited in this batch
        const cached = modifiedFiles.get(file.absolutePath);
        let currentContent = cached?.content ?? file.content;
        const currentEncoding = cached?.encoding ?? file.encoding;

        // Apply line range scoping if specified
        let targetContent = currentContent;
        let prefix = '';
        let suffix = '';

        if (lineRange && file.isExisting) {
          const { text, startOffset } = extractLineRange(currentContent, lineRange);
          prefix = currentContent.substring(0, startOffset);
          const endOffset = startOffset + text.length;
          suffix = currentContent.substring(endOffset);
          targetContent = text;
        }

        const result = applySingleEdit(targetContent, edit, fuzzy, language);

        // Reconstruct full content with line range prefix/suffix
        const fullContent = prefix + result.newContent + suffix;

        // Update cache
        modifiedFiles.set(file.absolutePath, {
          content: fullContent,
          encoding: currentEncoding,
        });

        results.push({
          file_path: edit.file_path,
          success: true,
          replacements: result.replacements,
          diff: result.diff,
        });
      } catch (err) {
        results.push({
          file_path: edit.file_path,
          success: false,
          replacements: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // ── Write modified files atomically ──
    let totalFilesModified = 0;
    let totalReplacements = 0;

    for (const [absolutePath, { content, encoding }] of modifiedFiles) {
      // Check if content actually changed
      const original = fileCache.get(absolutePath);
      if (original && original.content === content) continue;

      // Staleness check: verify file wasn't modified externally since we read it
      if (original && original.isExisting && original.mtimeMs > 0) {
        try {
          const currentMtime = Math.floor(fs.statSync(absolutePath).mtimeMs);
          if (currentMtime !== original.mtimeMs) {
            results.push({
              file_path: absolutePath,
              success: false,
              replacements: 0,
              error: `File was modified externally since read (mtime changed). Aborting write to prevent data loss.`,
            });
            continue;
          }
        } catch {
          // File may have been deleted — proceed with write
        }
      }

      // Ensure parent directory exists
      const dir = path.dirname(absolutePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write atomically, preserving encoding and line endings
      if (encoding.charset === 'utf16le') {
        let out = content;
        if (encoding.lineEndings === 'crlf') {
          out = out.replace(/(?<!\r)\n/g, '\r\n');
        }
        const buf = Buffer.from('﻿' + out, 'utf16le');
        fs.writeFileSync(absolutePath, buf);
      } else {
        let out = content;
        if (encoding.lineEndings === 'crlf') {
          out = out.replace(/(?<!\r)\n/g, '\r\n');
        }
        atomicWriteSync(absolutePath, out);
      }

      totalFilesModified++;
    }

    for (const r of results) {
      if (r.success) totalReplacements += r.replacements;
    }

    // ── Build response ──
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    const lines: string[] = [];
    lines.push(`Batch edit complete: ${successCount} succeeded, ${failCount} failed`);
    lines.push(`Files modified: ${totalFilesModified}, Total replacements: ${totalReplacements}`);
    lines.push('');

    for (const r of results) {
      if (r.success) {
        lines.push(`✓ ${r.file_path} — ${r.replacements} replacement(s)`);
        if (r.diff) lines.push(r.diff);
      } else {
        lines.push(`✗ ${r.file_path} — ${r.error}`);
      }
      lines.push('');
    }

    return {
      content: [{ type: 'text', text: lines.join('\n').trim() }],
      isError: failCount > 0,
    };
  } finally {
    fileCache.clear();
  }
}

// ─── Tool definition export ─────────────────────────────────────────────────

export const batchEditTool: ToolDefinition<typeof batchEditSchema> = {
  name: 'batch_edit',
  description: `Multi-file batch editing. Preferred over native Edit when making multiple edits or editing across files — saves tokens and round-trips.

Example: {"edits": [{"file_path": "src/foo.ts", "old_string": "const x = 1;", "new_string": "const x = 2;"}]}`,
  schema: batchEditSchema,
  handler: batchEditHandler,
};

export { batchEditTool as default };
