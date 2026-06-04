/**
 * Batch Read Tool — Types & Zod Schemas
 */

import { z } from 'zod';

/** Detail level for read output. */
export const DetailLevel = z.enum(['full', 'signatures', 'overview']);
export type DetailLevel = z.infer<typeof DetailLevel>;

/** Single file read request. */
export const ReadOp = z.object({
  file_path: z.string().describe('Target file path, optionally with #start-end line range suffix (e.g. src/foo.ts#50-100)'),
  detail: DetailLevel.optional().default('full').describe('Detail level: full (raw content), signatures (function/type signatures only), overview (export/import/top-level declarations)'),
});
export type ReadOp = z.infer<typeof ReadOp>;

/** Top-level input schema for batch_read tool. */
export const BatchReadInput = z.object({
  files: z.array(ReadOp).min(1).describe('Array of file read operations'),
});
export type BatchReadInput = z.infer<typeof BatchReadInput>;

/** Session-scoped dedup entry. */
export interface ReadDedupEntry {
  /** File content hash (mtime + size). */
  mtimeMs: number;
  size: number;
  /** Detail level used. */
  detail: string;
  /** Line range if specified. */
  lineRangeKey: string | null;
}

/** Result for a single file read. */
export interface FileReadResult {
  file_path: string;
  detail: DetailLevel;
  lines: number;
  /** Output text block for this file. */
  block: string;
  /** Whether this was a dedup hit. */
  deduplicated: boolean;
  /** Whether this file produced an error (not-found or read failure). */
  error: boolean;
}
