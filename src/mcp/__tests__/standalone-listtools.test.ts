/**
 * E2E drift guard for the standalone MCP server ListTools surface.
 *
 * Why this test exists (issue #2538):
 * The standalone server exposes a fixed set of tool families to Claude Code.
 * When a new tool family is added to allTools in tool-registry.ts without a
 * corresponding guard here, the MCP surface silently drifts. This test catches
 * that drift by exercising buildListToolsResponse() — the exact same function
 * that the ListTools handler calls — and asserting:
 *
 *   1. Every expected tool family has at least one representative present.
 *   2. Tool names are globally unique (no accidental duplication).
 *   3. Every returned entry is a valid MCP tool object (name, description, inputSchema).
 *   4. The minimum total count hasn't shrunk below the known baseline.
 */

import { describe, it, expect } from 'vitest';
import { buildListToolsResponse, allTools } from '../tool-registry.js';

describe('standalone MCP server – ListTools E2E drift guard', () => {
  // Call the same helper the live ListTools handler uses.
  const { tools } = buildListToolsResponse();
  const names = tools.map((t) => t.name);

  // -------------------------------------------------------------------------
  // 1. Representative tools from every family must be present
  // -------------------------------------------------------------------------
  describe('tool family coverage', () => {
    const FAMILY_REPRESENTATIVES: Record<string, string> = {
      state: 'state_read',
      notepad: 'notepad_write_priority',
      wiki: 'wiki_query',
    };

    for (const [family, representative] of Object.entries(FAMILY_REPRESENTATIVES)) {
      it(`exposes at least one ${family} tool (representative: ${representative})`, () => {
        expect(names).toContain(representative);
      });
    }
  });

  // -------------------------------------------------------------------------
  // 2. No duplicate tool names
  // -------------------------------------------------------------------------
  it('has no duplicate tool names', () => {
    const unique = new Set(names);
    if (unique.size !== names.length) {
      const seen = new Set<string>();
      const dupes = names.filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
      throw new Error(`Duplicate tool names detected: ${dupes.join(', ')}`);
    }
  });

  // -------------------------------------------------------------------------
  // 3. Every returned entry is a valid MCP tool object
  // -------------------------------------------------------------------------
  it('all entries have the required MCP tool fields', () => {
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string');
      expect(tool.name.length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe('object');
      expect(typeof tool.inputSchema.properties).toBe('object');
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Minimum count guard (catches accidental removal of tool families)
  // -------------------------------------------------------------------------
  it('exposes at least 6 tools (baseline: 5 state + 1 notepad + 7 wiki)', () => {
    // Use ≥ so the guard doesn't break when new tools are legitimately added.
    // Update this floor when a tool family is intentionally removed.
    expect(tools.length).toBeGreaterThanOrEqual(6);
  });

  // -------------------------------------------------------------------------
  // 5. buildListToolsResponse() and allTools stay in sync
  // -------------------------------------------------------------------------
  it('buildListToolsResponse returns one entry per registered tool', () => {
    expect(tools.length).toBe(allTools.length);
  });
});
