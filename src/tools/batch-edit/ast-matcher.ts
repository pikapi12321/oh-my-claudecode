/**
 * Batch Edit Tool — AST Fuzzy Matcher
 *
 * Uses @ast-grep/napi for structural code comparison.
 * Falls back to normalized matching for unsupported languages.
 */

import type { SgNode, SgRoot } from '@ast-grep/napi';
import { Lang } from '@ast-grep/napi';

// Lazy-load ast-grep to allow graceful degradation.
// Use boolean sentinel — `let x: T | null = null` compiles to `let x = null`,
// which breaks `x !== undefined` guards in the emitted JS.
let sgLoaded = false;
let sg: typeof import('@ast-grep/napi') | null = null;

function getSg(): typeof import('@ast-grep/napi') | null {
  if (sgLoaded) return sg;
  sgLoaded = true;
  try {
    sg = require('@ast-grep/napi');
    return sg;
  } catch {
    sg = null;
    return null;
  }
}

// ─── AST normalization for structural comparison ────────────────────────────

/**
 * Extract normalized AST leaf text: strips whitespace and comments.
 * Returns an ordered array of { text, start, end } for each leaf.
 */
interface Leaf { text: string; start: number; end: number }

function collectLeaves(node: SgNode, out: Leaf[]): void {
  if (node.kind().includes('comment')) return;

  const children = node.children();
  if (children.length === 0) {
    const t = node.text().replace(/\s+/g, ' ').trim();
    if (!t) return; // pure whitespace leaf
    const range = node.range();
    out.push({ text: t, start: range.start.index, end: range.end.index });
  } else {
    for (const child of children) {
      collectLeaves(child, out);
    }
  }
}

/** Build canonical text from leaves (space-joined). */
function leavesToNormText(leaves: Leaf[]): string {
  return leaves.map(l => l.text).join(' ');
}

/**
 * Check if old_string AST-structurally matches a substring of fileContent.
 * Returns the matched region's character range in fileContent, or null.
 */
export function astStructuralMatch(
  fileContent: string,
  searchString: string,
  language: string,
): { start: number; end: number } | null {
  const api = getSg();
  if (!api) return null;

  try {
    const searchRoot = api.parse(language as Lang, searchString);
    const fileRoot = api.parse(language as Lang, fileContent);

    const searchLeaves: Leaf[] = [];
    collectLeaves(searchRoot.root(), searchLeaves);
    const fileLeaves: Leaf[] = [];
    collectLeaves(fileRoot.root(), fileLeaves);

    if (searchLeaves.length === 0 || fileLeaves.length === 0) return null;

    const searchNorm = leavesToNormText(searchLeaves);
    const fileNorm = leavesToNormText(fileLeaves);

    const normIdx = fileNorm.indexOf(searchNorm);
    if (normIdx === -1) return null;

    // Map normalized position back to original character positions.
    // Walk file leaves, tracking the normalized text offset and
    // the separator position between consecutive non-empty leaves.
    let normPos = 0;         // current position in normalized text
    let origStart = -1;      // original file start of match
    let origEnd = -1;        // original file end of match

    for (let i = 0; i < fileLeaves.length; i++) {
      const leaf = fileLeaves[i];
      const leafStart = normPos;
      const leafEnd = normPos + leaf.text.length;

      // Does the match start within this leaf?
      if (origStart === -1 && normIdx >= leafStart && normIdx < leafEnd) {
        origStart = leaf.start;
      }

      // Does the match end within this leaf?
      const matchEndNorm = normIdx + searchNorm.length;
      if (origStart !== -1 && origEnd === -1 && matchEndNorm > leafStart && matchEndNorm <= leafEnd) {
        origEnd = leaf.end;
        break;
      }

      // Advance past this leaf + separator (space before next non-empty leaf)
      normPos = leafEnd;
      if (i < fileLeaves.length - 1) {
        normPos += 1; // space separator from join(' ')
      }
    }

    if (origStart !== -1 && origEnd !== -1) {
      return { start: origStart, end: origEnd };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Apply AST-aware matching: try structural match first, then fallback.
 * Returns match positions (start indices) in fileContent.
 */
export function findAstMatches(
  fileContent: string,
  searchString: string,
  language: string | null,
): number[] {
  if (!language) return [];

  const result = astStructuralMatch(fileContent, searchString, language);
  if (result) {
    const matched = fileContent.substring(result.start, result.end);
    const positions: number[] = [];
    let idx = 0;
    while (true) {
      idx = fileContent.indexOf(matched, idx);
      if (idx === -1) break;
      positions.push(idx);
      idx += 1;
    }
    return positions;
  }

  return [];
}

/**
 * Check if AST-grep is installed and available.
 */
export function hasAstGrep(): boolean {
  return getSg() !== null;
}
