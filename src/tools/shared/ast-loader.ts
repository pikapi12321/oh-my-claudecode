/**
 * Shared AST-grep lazy loader
 *
 * Provides a single module-level lazy loader for @ast-grep/napi,
 * shared across batch-edit and batch-read tools.
 *
 * Uses boolean sentinel pattern: `let x: T | null = null` compiles to
 * `let x = null`, which breaks `x !== undefined` guards in emitted JS.
 */

let sgLoaded = false;
let sg: typeof import('@ast-grep/napi') | null = null;

/**
 * Lazy-load @ast-grep/napi. Returns the module or null if unavailable.
 * Safe to call repeatedly — only loads once.
 */
export function getSg(): typeof import('@ast-grep/napi') | null {
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

/**
 * Check if @ast-grep/napi is available without triggering a load.
 * Returns true if already loaded and available, false otherwise.
 * Use getSg() to actually load and check.
 */
export function isAstGrepLoaded(): boolean {
  return sgLoaded && sg !== null;
}
