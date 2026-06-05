/**
 * Wiki Session Hooks
 *
 * SessionStart: load wiki context, inject relevant pages, lazy index rebuild
 * SessionEnd: no-op
 * PreCompact: inject wiki summary for compaction survival
 */

import { existsSync, readFileSync } from 'fs';
import {
  getWikiDir,
  readIndex,
  readAllPages,
  listPages,
  withWikiLock,
  updateIndexUnsafe,
} from './storage.js';

/**
 * SessionStart hook: inject wiki context into session.
 *
 * 1. Read wiki index, rebuild if stale
 * 2. Rebuild wiki index if needed
 * 3. Return context summary for injection
 */
export function onSessionStart(data: { cwd?: string }): { additionalContext?: string } {
  try {
    const root = data.cwd || process.cwd();
    const wikiDir = getWikiDir(root);

    if (!existsSync(wikiDir)) {
      return {}; // No wiki yet, nothing to inject
    }

    // Lazy index rebuild
    const pages = listPages(root);
    if (pages.length > 0) {
      const indexContent = readIndex(root);
      if (!indexContent) {
        // Index missing — rebuild
        withWikiLock(root, () => { updateIndexUnsafe(root); });
      }
    }

    // Build context summary

    // Build context summary
    const index = readIndex(root);
    if (!index || pages.length === 0) return {};

    const summary = [
      `[LLM Wiki: ${pages.length} pages at .omc/wiki/]`,
      '',
      'Use wiki_query to search, wiki_list to browse, wiki_read to view pages.',
      '',
      index.split('\n').slice(0, 30).join('\n'), // First 30 lines of index
    ].join('\n');

    return { additionalContext: summary };
  } catch {
    return {};
  }
}

/** SessionEnd hook: no-op (auto-capture removed). */
export function onSessionEnd(_data: { cwd?: string; session_id?: string }): { continue: boolean } {
  return { continue: true };
}

/**
 * PreCompact hook: inject wiki summary for compaction survival.
 */
export function onPreCompact(data: { cwd?: string }): { additionalContext?: string } {
  try {
    const root = data.cwd || process.cwd();
    const pages = listPages(root);

    if (pages.length === 0) return {};

    const allPages = readAllPages(root);
    const categories = [...new Set(allPages.map(p => p.frontmatter.category))];
    const latestUpdate = allPages
      .map(p => p.frontmatter.updated)
      .sort()
      .reverse()[0] || 'unknown';

    return {
      additionalContext: `[Wiki: ${pages.length} pages | categories: ${categories.join(', ')} | last updated: ${latestUpdate}]`,
    };
  } catch {
    return {};
  }
}


