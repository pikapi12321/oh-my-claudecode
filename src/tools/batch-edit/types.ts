/**
 * Batch Edit Tool — Types & Zod Schemas
 */

import { z } from 'zod';

/** Fuzzy matching mode for old_string resolution. */
export const FuzzyMode = z.enum(['ast', 'normalized', 'exact']);
export type FuzzyMode = z.infer<typeof FuzzyMode>;

/** Single edit operation. */
export const EditOp = z.object({
  file_path: z.string().describe('Target file path, optionally with #start-end line range suffix (e.g. src/foo.ts#100-200)'),
  old_string: z.string().nullable().optional().describe('Text to find. Null/omit = create new file with new_string as content'),
  new_string: z.string().describe('Replacement text. Empty string = delete old_string from file'),
  replace_all: z.boolean().optional().default(false).describe('Replace all occurrences (default false)')
});
export type EditOp = z.infer<typeof EditOp>;

/** Top-level input schema for batch_edit tool. */
export const BatchEditInput = z.object({
  edits: z.array(EditOp).min(1).describe('Array of edit operations, applied sequentially within each file'),
  fuzzy: FuzzyMode.optional().default('ast').describe('Matching strategy: ast (structural), normalized (whitespace), exact')
});
export type BatchEditInput = z.infer<typeof BatchEditInput>;

/** Result for a single edit. */
export interface EditResult {
  file_path: string;
  success: boolean;
  /** Number of replacements made. */
  replacements: number;
  /** Unified diff of the change (when successful). */
  diff?: string;
  /** Error message (when success=false). */
  error?: string;
}

/** Overall batch result. */
export interface BatchEditResult {
  edits: EditResult[];
  total_files_modified: number;
  total_replacements: number;
}

/** Metadata about a parsed line range. */
export interface LineRange {
  start: number; // 1-based inclusive
  end: number;   // 1-based inclusive
}

/** File encoding metadata. */
export interface FileEncoding {
  charset: 'utf8' | 'utf16le';
  lineEndings: 'lf' | 'crlf';
}
