/**
 * Search MCP Tool
 *
 * Combines glob + grep + read into a single call.
 * Supports content regex matching with context lines, three output modes,
 * line-range scoping, and AST summary for supported languages.
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';
import {
  SearchInput,
  type OutputMode,
  type ContentMatch,
  type FileSearchResult,
  type SearchResult,
} from './types.js';
import { parseFilePath, readFileWithEncoding } from '../batch-edit/utils.js';
import { ToolDefinition } from '../types.js';

// ─── Smart defaults ─────────────────────────────────────────────────────────

const MAX_LINE_LENGTH = 1000;

// ─── Glob matching ──────────────────────────────────────────────────────────

/**
 * Expand glob patterns to matching file paths.
 * Uses recursive directory walk + minimatch.
 * Skips node_modules, .git, dist, and hidden directories.
 */
function expandGlobs(patterns: string[], cwd: string): string[] {
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', '__pycache__', '.omc']);
  const matched = new Set<string>();

  for (const pattern of patterns) {
    // Strip #line-range suffix for glob matching
    const hashIdx = pattern.lastIndexOf('#');
    const cleanPattern = hashIdx !== -1 ? pattern.substring(0, hashIdx) : pattern;

    // If pattern has no glob chars and file exists, use directly
    if (!cleanPattern.includes('*') && !cleanPattern.includes('?') && !cleanPattern.includes('{')) {
      const abs = path.resolve(cwd, cleanPattern);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        matched.add(abs);
      }
      continue;
    }

    // Recursive walk with minimatch filtering
    const baseDir = extractBaseDir(cleanPattern);
    const absBase = path.resolve(cwd, baseDir);

    if (!fs.existsSync(absBase) || !fs.statSync(absBase).isDirectory()) {
      continue;
    }

    walkDir(absBase, SKIP_DIRS, (filePath) => {
      const rel = path.relative(cwd, filePath);
      if (minimatch(rel, cleanPattern, { dot: true })) {
        matched.add(filePath);
      }
    });
  }

  return Array.from(matched);
}

/**
 * Extract the non-glob base directory from a pattern.
 * e.g. "src/tools/../*.ts" yields "src/tools"
 */
function extractBaseDir(pattern: string): string {
  const parts = pattern.split(path.sep);
  const baseParts: string[] = [];

  for (const part of parts) {
    if (part.includes('*') || part.includes('?') || part.includes('{')) {
      break;
    }
    baseParts.push(part);
  }

  return baseParts.join(path.sep) || '.';
}

/**
 * Recursively walk a directory, calling callback for each file.
 */
function walkDir(
  dir: string,
  skipDirs: Set<string>,
  callback: (filePath: string) => void,
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // permission denied or similar
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) {
        walkDir(fullPath, skipDirs, callback);
      }
    } else if (entry.isFile()) {
      callback(fullPath);
    }
  }
}

// ─── Content search ─────────────────────────────────────────────────────────

/**
 * Search file content for regex matches with context lines.
 */
function searchContent(
  content: string,
  regex: RegExp,
  linesBefore: number,
  linesAfter: number,
  maxLineLength: number,
  linesPerFile: number,
  isMultiline: boolean,
): { matches: ContentMatch[]; truncated: boolean } {
  const lines = content.split('\n');
  const matches: ContentMatch[] = [];
  const reportedLines = new Set<number>();

  if (isMultiline) {
    // Multiline mode: search entire content, map char offsets to line numbers
    const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    let m: RegExpExecArray | null;

    while ((m = globalRegex.exec(content)) !== null) {
      if (matches.length >= linesPerFile) {
        return { matches, truncated: true };
      }

      // Find line number for match start
      let charCount = 0;
      let matchLine = 0;
      for (let i = 0; i < lines.length; i++) {
        if (charCount + lines[i].length >= m.index) {
          matchLine = i;
          break;
        }
        charCount += lines[i].length + 1; // +1 for \n
      }

      const lineNum = matchLine + 1; // 1-based
      if (reportedLines.has(lineNum)) continue;

      const before: string[] = [];
      for (let j = Math.max(0, matchLine - linesBefore); j < matchLine; j++) {
        before.push(truncateLine(lines[j], maxLineLength));
      }

      const after: string[] = [];
      for (let j = matchLine + 1; j <= Math.min(lines.length - 1, matchLine + linesAfter); j++) {
        after.push(truncateLine(lines[j], maxLineLength));
      }

      matches.push({
        lineNumber: lineNum,
        line: truncateLine(lines[matchLine], maxLineLength),
        before,
        after,
      });

      reportedLines.add(lineNum);

      // Prevent infinite loop on zero-length matches
      if (m[0].length === 0) globalRegex.lastIndex++;
    }

    return { matches, truncated: false };
  }

  // Single-line mode: test each line individually
  for (let i = 0; i < lines.length; i++) {
    if (matches.length >= linesPerFile) {
      return { matches, truncated: true };
    }

    const line = lines[i];
    if (!regex.test(line)) continue;

    // Reset lastIndex for global regex
    regex.lastIndex = 0;

    const lineNum = i + 1; // 1-based

    // Deduplicate overlapping matches
    if (reportedLines.has(lineNum)) continue;

    // Collect context before
    const before: string[] = [];
    for (let j = Math.max(0, i - linesBefore); j < i; j++) {
      before.push(truncateLine(lines[j], maxLineLength));
    }

    // Collect context after
    const after: string[] = [];
    for (let j = i + 1; j <= Math.min(lines.length - 1, i + linesAfter); j++) {
      after.push(truncateLine(lines[j], maxLineLength));
    }

    matches.push({
      lineNumber: lineNum,
      line: truncateLine(line, maxLineLength),
      before,
      after,
    });

    // Only mark the match line itself to prevent double-counting
    reportedLines.add(lineNum);
  }

  return { matches, truncated: false };
}

function truncateLine(line: string, maxLen: number): string {
  if (line.length <= maxLen) return line;
  return line.substring(0, maxLen) + '...';
}

// ─── Main handler ───────────────────────────────────────────────────────────

async function searchHandler(
  args: unknown,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const parsed = SearchInput.safeParse(args);
  if (!parsed.success) {
    return {
      content: [{ type: 'text', text: `Invalid input: ${parsed.error.message}` }],
      isError: true,
    };
  }

  const {
    file_glob_patterns,
    content_regex,
    output_mode,
    lines_before,
    lines_after,
    ignore_case,
    multiline,
    file_limit,
    lines_per_file,
  } = parsed.data;

  const cwd = process.cwd();

  // Expand glob patterns to file paths
  const filePaths = expandGlobs(file_glob_patterns, cwd);

  if (filePaths.length === 0) {
    return {
      content: [{ type: 'text', text: 'No files matched the given patterns.' }],
      isError: false,
    };
  }

  // Apply file limit
  const limitedPaths = filePaths.slice(0, file_limit);

  // Build regex if content_regex provided
  let regex: RegExp | null = null;
  if (content_regex) {
    try {
      let flags = '';
      if (ignore_case) flags += 'i';
      if (multiline) flags += 's';
      regex = new RegExp(content_regex, flags);
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Invalid regex: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }

  // Process each file
  const fileResults: FileSearchResult[] = [];

  for (const absPath of limitedPaths) {
    try {
      // Read file with encoding detection
      const { content } = readFileWithEncoding(absPath);
      const relPath = path.relative(cwd, absPath);

      // If content_regex is set, search for matches
      if (regex) {
        const { matches, truncated } = searchContent(
          content,
          regex,
          lines_before,
          lines_after,
          MAX_LINE_LENGTH,
          lines_per_file,
          multiline,
        );

        // Skip files with no matches in content/match_count modes
        if (matches.length === 0 && output_mode !== 'paths') {
          continue;
        }

        fileResults.push({
          file_path: relPath,
          matches,
          matchCount: matches.length,
          truncated,
        });
      } else {
        // No content regex — just list the file
        fileResults.push({
          file_path: relPath,
          matches: [],
          matchCount: 0,
          truncated: false,
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Build output based on mode
  const output = buildOutput(fileResults, output_mode, limitedPaths.length < filePaths.length, lines_per_file);

  return {
    content: [{ type: 'text', text: output }],
    isError: false,
  };
}

// ─── Output formatting ──────────────────────────────────────────────────────

function buildOutput(
  results: FileSearchResult[],
  mode: OutputMode,
  fileLimitHit: boolean,
  linesPerFile: number,
): string {
  const totalMatches = results.reduce((sum, r) => sum + r.matchCount, 0);

  const limitWarning = fileLimitHit
    ? `\n⚠️ File limit reached — results may be incomplete. Increase file_limit or narrow glob patterns.`
    : '';

  if (mode === 'paths') {
    const lines = results.map(r => r.file_path);
    const footer = `\n${results.length} files${limitWarning}`;
    return lines.join('\n') + footer;
  }

  if (mode === 'match_count') {
    const lines = results.map(r => `${r.file_path}: ${r.matchCount} match(es)`);
    const footer = `\n${results.length} files, ${totalMatches} matches${limitWarning}`;
    return lines.join('\n') + footer;
  }

  // content mode
  const blocks: string[] = [];

  for (const file of results) {
    if (file.matches.length === 0) {
      // No content regex or no matches — show file path only
      blocks.push(`=== ${file.file_path} ===`);
      continue;
    }

    const header = `=== ${file.file_path} ===`;
    const matchLines: string[] = [];

    for (const match of file.matches) {
      // Context before
      for (let i = 0; i < match.before.length; i++) {
        const ctxLineNum = match.lineNumber - match.before.length + i;
        matchLines.push(`[${ctxLineNum}] ${match.before[i]}`);
      }

      // Match line with marker
      matchLines.push(`[${match.lineNumber}] ${match.line}  ← match`);

      // Context after
      for (let i = 0; i < match.after.length; i++) {
        matchLines.push(`[${match.lineNumber + i + 1}] ${match.after[i]}`);
      }

      matchLines.push(''); // blank line between matches
    }

    if (file.truncated) {
      matchLines.push(`... (truncated at ${linesPerFile} matches)`);
    }

    blocks.push(header + '\n' + matchLines.join('\n').trimEnd());
  }

  const footer = `\n${results.length} files, ${totalMatches} matches${limitWarning}`;

  if (blocks.length === 0) {
    return 'No matches found.' + footer;
  }

  return blocks.join('\n\n') + footer;
}

// ─── Schema for ToolDefinition generic ──────────────────────────────────────

const searchSchema = {
  file_glob_patterns: SearchInput.shape.file_glob_patterns,
  content_regex: SearchInput.shape.content_regex,
  output_mode: SearchInput.shape.output_mode,
  lines_before: SearchInput.shape.lines_before,
  lines_after: SearchInput.shape.lines_after,
  ignore_case: SearchInput.shape.ignore_case,
  multiline: SearchInput.shape.multiline,
  file_limit: SearchInput.shape.file_limit,
  lines_per_file: SearchInput.shape.lines_per_file,
};

// ─── Tool definition export ─────────────────────────────────────────────────

export const searchTool: ToolDefinition<typeof searchSchema> = {
  name: 'search',
  description: `Combine glob + grep + read in a single call. Search files by pattern and optionally match content with regex.
- file_glob_patterns: glob patterns or paths to match files (required)
- content_regex: optional regex to search within matched files
- output_mode: "content" (matches with context), "paths" (file list only), "match_count" (files with match counts)
- Supports context lines (lines_before/after), case-insensitive and multiline regex
- file_limit: max files to process (default 200, max 500)
- lines_per_file: max matches per file before truncation (default 100, max 10000)
- Max line length: 1000 chars`,
  schema: searchSchema,
  handler: searchHandler,
  annotations: {
    readOnlyHint: true,
  },
};

export { searchTool as default };
