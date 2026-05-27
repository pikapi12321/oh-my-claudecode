/**
 * Wiki Types
 *
 * Type definitions for the LLM Wiki knowledge layer.
 * Inspired by Karpathy's LLM Wiki concept — persistent, self-maintained
 * markdown knowledge base that compounds over time.
 */
// ============================================================================
// Page Schema
// ============================================================================
/** Current schema version for wiki pages. Bump on breaking frontmatter changes. */
export const WIKI_SCHEMA_VERSION = 1;
// ============================================================================
// Configuration
// ============================================================================
/**
 * Maps legacy category names to their canonical replacements.
 * Used to migrate existing wiki pages written before the 7-category taxonomy.
 */
export const LEGACY_CATEGORY_MAP = {
    'debugging': 'finding',
    'pattern': 'guide',
    'convention': 'guide',
    'environment': 'setup',
    'session-log': 'log',
};
/** Valid canonical category names for fast lookup. */
const CANONICAL_CATEGORIES = new Set([
    'architecture', 'decision', 'guide', 'setup', 'finding', 'reference', 'log',
]);
/**
 * Normalize a category string, mapping legacy names to current canonical ones.
 * Falls back to 'reference' for unrecognized values to avoid invalid category data.
 */
export function normalizeCategory(cat) {
    if (LEGACY_CATEGORY_MAP[cat])
        return LEGACY_CATEGORY_MAP[cat];
    if (CANONICAL_CATEGORIES.has(cat))
        return cat;
    return 'reference';
}
/** Default wiki configuration. */
export const DEFAULT_WIKI_CONFIG = {
    autoCapture: true,
    staleDays: 30,
    maxPageSize: 10_240, // 10KB
};
//# sourceMappingURL=types.js.map