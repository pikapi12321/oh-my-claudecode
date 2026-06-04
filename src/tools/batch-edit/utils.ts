/**
 * Batch Edit Tool — Core Utilities
 *
 * Handles: curly-quote normalization, quote style preservation,
 * encoding detection, line range parsing, diff generation.
 * Ported from Claude Code's FileEditTool/utils.ts patterns.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { LineRange, FileEncoding } from './types.js';

// ─── Curly-quote constants ──────────────────────────────────────────────────

const LEFT_SINGLE = '‘';   // '
const RIGHT_SINGLE = '’';  // '
const LEFT_DOUBLE = '“';   // "
const RIGHT_DOUBLE = '”';  // "

/** Replace all curly quotes with ASCII equivalents. */
export function normalizeQuotes(str: string): string {
  return str
    .replaceAll(LEFT_SINGLE, "'")
    .replaceAll(RIGHT_SINGLE, "'")
    .replaceAll(LEFT_DOUBLE, '"')
    .replaceAll(RIGHT_DOUBLE, '"');
}

/** Also normalize em-dashes, en-dashes, ellipsis to ASCII. */
export function normalizeTypography(str: string): string {
  return normalizeQuotes(str)
    .replaceAll('—', '--')  // em-dash
    .replaceAll('–', '-')   // en-dash
    .replaceAll('…', '...'); // ellipsis
}

// ─── File content matching ──────────────────────────────────────────────────

/**
 * Find the actual substring in fileContent that matches searchString,
 * handling curly-quote normalization. Returns the literal substring
 * from fileContent (preserving original typography), or null if not found.
 */
export function findActualString(
  fileContent: string,
  searchString: string,
): string | null {
  // Step 1: exact match
  if (fileContent.includes(searchString)) {
    return searchString;
  }

  // Step 2: normalize both and try again
  const normalizedSearch = normalizeQuotes(searchString);
  const normalizedFile = normalizeQuotes(fileContent);
  const idx = normalizedFile.indexOf(normalizedSearch);
  if (idx !== -1) {
    return fileContent.substring(idx, idx + searchString.length);
  }

  return null;
}

/**
 * Find all match positions of searchString in fileContent,
 * handling curly-quote normalization. Returns start indices.
 */
export function findAllMatches(
  fileContent: string,
  searchString: string,
): number[] {
  const positions: number[] = [];

  // Try exact first
  let idx = fileContent.indexOf(searchString);
  if (idx !== -1) {
    while (idx !== -1) {
      positions.push(idx);
      idx = fileContent.indexOf(searchString, idx + 1);
    }
    return positions;
  }

  // Normalized fallback
  const normalizedSearch = normalizeQuotes(searchString);
  const normalizedFile = normalizeQuotes(fileContent);
  idx = normalizedFile.indexOf(normalizedSearch);
  while (idx !== -1) {
    positions.push(idx);
    idx = normalizedFile.indexOf(normalizedSearch, idx + 1);
  }
  return positions;
}

// ─── Quote style preservation ───────────────────────────────────────────────

function isOpeningContext(str: string, pos: number): boolean {
  if (pos === 0) return true;
  const prev = str[pos - 1];
  return /[\s\(\[\{—–]/.test(prev);
}

/**
 * When old_string was matched via curly-quote normalization,
 * apply the same curly-quote style to new_string.
 */
export function preserveQuoteStyle(
  oldString: string,
  actualOldString: string,
  newString: string,
): string {
  if (oldString === actualOldString) return newString;

  const hasDouble =
    actualOldString.includes(LEFT_DOUBLE) ||
    actualOldString.includes(RIGHT_DOUBLE);
  const hasSingle =
    actualOldString.includes(LEFT_SINGLE) ||
    actualOldString.includes(RIGHT_SINGLE);

  if (!hasDouble && !hasSingle) return newString;

  let result = newString;

  if (hasDouble) {
    let out = '';
    for (let i = 0; i < result.length; i++) {
      if (result[i] === '"') {
        out += isOpeningContext(result, i) ? LEFT_DOUBLE : RIGHT_DOUBLE;
      } else {
        out += result[i];
      }
    }
    result = out;
  }

  if (hasSingle) {
    let out = '';
    for (let i = 0; i < result.length; i++) {
      if (result[i] === "'") {
        // Contraction detection: letter before and after
        const prev = i > 0 ? result[i - 1] : '';
        const next = i < result.length - 1 ? result[i + 1] : '';
        if (/\p{L}/u.test(prev) && /\p{L}/u.test(next)) {
          out += RIGHT_SINGLE; // apostrophe in contraction
        } else {
          out += isOpeningContext(result, i) ? LEFT_SINGLE : RIGHT_SINGLE;
        }
      } else {
        out += result[i];
      }
    }
    result = out;
  }

  return result;
}

// ─── Line range parsing ─────────────────────────────────────────────────────

/**
 * Parse file_path with optional #start-end suffix.
 * Returns { filePath, lineRange }.
 */
export function parseFilePath(raw: string): { filePath: string; lineRange: LineRange | null } {
  const hashIdx = raw.lastIndexOf('#');
  if (hashIdx === -1) return { filePath: raw, lineRange: null };

  const filePath = raw.substring(0, hashIdx);
  const rangeStr = raw.substring(hashIdx + 1);
  const parts = rangeStr.split('-');

  if (parts.length === 2) {
    const start = parseInt(parts[0], 10);
    const end = parseInt(parts[1], 10);
    if (!isNaN(start) && !isNaN(end) && start > 0 && end >= start) {
      return { filePath, lineRange: { start, end } };
    }
  } else if (parts.length === 1) {
    const line = parseInt(parts[0], 10);
    if (!isNaN(line) && line > 0) {
      return { filePath, lineRange: { start: line, end: line } };
    }
  }

  return { filePath, lineRange: null };
}

// ─── Encoding detection ─────────────────────────────────────────────────────

const MAX_EDIT_FILE_SIZE = 1024 * 1024 * 1024; // 1 GiB

/**
 * Read file with encoding detection (UTF-16LE BOM, default UTF-8).
 * Normalizes CRLF → LF on read.
 * Throws if file exceeds size limit.
 */
export function readFileWithEncoding(filePath: string): { content: string; encoding: FileEncoding } {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_EDIT_FILE_SIZE) {
    throw new Error(`File exceeds maximum edit size (1 GiB): ${filePath} (${(stat.size / 1024 / 1024).toFixed(1)} MiB)`);
  }

  const raw = fs.readFileSync(filePath);
  let charset: 'utf8' | 'utf16le' = 'utf8';
  let content: string;

  // Detect BOM: FF FE = UTF-16LE
  if (raw.length >= 2 && raw[0] === 0xFF && raw[1] === 0xFE) {
    charset = 'utf16le';
    content = raw.subarray(2).toString('utf16le');
  } else {
    content = raw.toString('utf8');
  }

  // Detect line endings
  const sample = content.substring(0, 4096);
  const crlfCount = (sample.match(/\r\n/g) || []).length;
  const lfCount = (sample.match(/(?<!\r)\n/g) || []).length;
  const lineEndings: 'lf' | 'crlf' = crlfCount > lfCount ? 'crlf' : 'lf';

  // Normalize to LF for processing
  if (lineEndings === 'crlf') {
    content = content.replace(/\r\n/g, '\n');
  }

  return { content, encoding: { charset, lineEndings } };
}

/**
 * Write content back with original encoding and line endings.
 */
export function writeFileWithEncoding(
  filePath: string,
  content: string,
  encoding: FileEncoding,
): void {
  let out = content;

  // Restore line endings
  if (encoding.lineEndings === 'crlf') {
    out = out.replace(/(?<!\r)\n/g, '\r\n');
  }

  // Encode
  const buf = encoding.charset === 'utf16le'
    ? Buffer.from('﻿' + out, 'utf16le')
    : Buffer.from(out, 'utf8');

  fs.writeFileSync(filePath, buf);
}

// ─── Extract content within line range ──────────────────────────────────────

/**
 * Extract lines within range (1-based, inclusive).
 * Returns the substring and its character offsets in the full content.
 */
export function extractLineRange(
  content: string,
  range: LineRange,
): { text: string; startOffset: number; endOffset: number } {
  const lines = content.split('\n');
  const startLine = Math.max(0, range.start - 1);
  const endLine = Math.min(lines.length - 1, range.end - 1);

  let startOffset = 0;
  for (let i = 0; i < startLine; i++) {
    startOffset += lines[i].length + 1; // +1 for \n
  }

  let endOffset = startOffset;
  for (let i = startLine; i <= endLine; i++) {
    endOffset += lines[i].length;
    if (i < endLine) endOffset += 1; // +1 for \n
  }

  return {
    text: lines.slice(startLine, endLine + 1).join('\n'),
    startOffset,
    endOffset,
  };
}

// ─── Unified diff generation ────────────────────────────────────────────────

/**
 * Generate a simple unified diff between old and new content.
 */
export function generateDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const diff: string[] = [];
  diff.push(`--- a/${filePath}`);
  diff.push(`+++ b/${filePath}`);

  // Simple line-by-line diff (not full Myers algorithm, but sufficient for tool output)
  // Find the common prefix and suffix
  let prefixLen = 0;
  while (
    prefixLen < oldLines.length &&
    prefixLen < newLines.length &&
    oldLines[prefixLen] === newLines[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldLines.length - prefixLen &&
    suffixLen < newLines.length - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const oldStart = Math.max(1, prefixLen - 2);
  const newStart = Math.max(1, prefixLen - 2);
  const oldChunk = oldLines.slice(prefixLen, oldLines.length - suffixLen);
  const newChunk = newLines.slice(prefixLen, newLines.length - suffixLen);
  const contextBefore = oldLines.slice(Math.max(0, prefixLen - 3), prefixLen);
  const contextAfter = oldLines.slice(oldLines.length - suffixLen, Math.min(oldLines.length, oldLines.length - suffixLen + 3));

  const hunkOldCount = contextBefore.length + oldChunk.length + contextAfter.length;
  const hunkNewCount = contextBefore.length + newChunk.length + contextAfter.length;

  diff.push(`@@ -${oldStart},${hunkOldCount} +${newStart},${hunkNewCount} @@`);
  for (const line of contextBefore) diff.push(` ${line}`);
  for (const line of oldChunk) diff.push(`-${line}`);
  for (const line of newChunk) diff.push(`+${line}`);
  for (const line of contextAfter) diff.push(` ${line}`);

  return diff.join('\n');
}

// ─── Extension → ast-grep Lang enum map ─────────────────────────────────────

// Maps file extensions to @ast-grep/napi Lang enum values (PascalCase).
const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'Tsx',
  '.js': 'JavaScript',
  '.jsx': 'Jsx',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.c': 'C',
  '.cpp': 'Cpp',
  '.cc': 'Cpp',
  '.h': 'C',
  '.hpp': 'Cpp',
  '.php': 'Php',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.swift': 'Swift',
  '.css': 'Css',
  '.html': 'Html',
  '.json': 'Json',
};

export function langForFile(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}
