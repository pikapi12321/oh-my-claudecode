/**
 * Shared tool types
 *
 * Common types used across batch-edit, batch-read, and search tools.
 */

/** Metadata about a parsed line range. */
export interface LineRange {
  start: number; // 1-based inclusive
  end: number;   // 1-based inclusive
}
