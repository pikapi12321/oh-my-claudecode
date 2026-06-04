/**
 * Search Tool — Types & Zod Schemas
 */

import { z } from 'zod';

/** Output mode for search results. */
export const OutputMode = z.enum(['content', 'paths', 'match_count']);
export type OutputMode = z.infer<typeof OutputMode>;

/** Top-level input schema for search tool. */
export const SearchInput = z.object({
  file_glob_patterns: z.array(z.string()).min(1).describe('Glob patterns or exact paths to search. Supports #line-range suffix (e.g. src/foo.ts#50-100)'),
  content_regex: z.string().optional().describe('Regex pattern to search file content. Omit to only list/read matched files'),
  output_mode: OutputMode.optional().default('content').describe('content: discover+read, paths: file paths only, match_count: paths with per-file match counts'),
  lines_before: z.number().int().min(0).optional().default(2).describe('Context lines before each match'),
  lines_after: z.number().int().min(0).optional().default(2).describe('Context lines after each match'),
  ignore_case: z.boolean().optional().default(false).describe('Case-insensitive regex matching'),
  multiline: z.boolean().optional().default(false).describe('Dot matches newline, enable cross-line regex'),
  file_limit: z.number().int().min(1).max(200).optional().default(20).describe('Max number of files to process'),
  lines_per_file: z.number().int().min(1).max(10000).optional().default(500).describe('Max matches per file before truncation'),
});
export type SearchInput = z.infer<typeof SearchInput>;

/** Match info within a file. */
export interface ContentMatch {
  /** 1-based line number of the match. */
  lineNumber: number;
  /** The matched line text. */
  line: string;
  /** Context lines before. */
  before: string[];
  /** Context lines after. */
  after: string[];
}

/** Result for a single file. */
export interface FileSearchResult {
  file_path: string;
  matches: ContentMatch[];
  matchCount: number;
  /** Whether file was skipped due to file_limit or lines_per_file. */
  truncated: boolean;
}

/** Overall search result. */
export interface SearchResult {
  files: FileSearchResult[];
  totalFiles: number;
  totalMatches: number;
}
