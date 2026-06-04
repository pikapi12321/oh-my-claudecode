/**
 * Tests for OMC_DISABLE_TOOLS env var support
 *
 * Verifies that parseDisabledGroups() correctly maps user-facing group names
 * to ToolCategory values, and that the filtering logic works as expected.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseDisabledGroups, DISABLE_TOOLS_GROUP_MAP } from '../mcp/omc-tools-server.js';
import { TOOL_CATEGORIES } from '../constants/index.js';

describe('OMC_DISABLE_TOOLS', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.OMC_DISABLE_TOOLS;
    delete process.env.OMC_DISABLE_TOOLS;
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env.OMC_DISABLE_TOOLS = savedEnv;
    } else {
      delete process.env.OMC_DISABLE_TOOLS;
    }
  });

  describe('parseDisabledGroups()', () => {
    describe('env var not set', () => {
      it('returns empty set when env var is absent', () => {
        const result = parseDisabledGroups();
        expect(result.size).toBe(0);
      });

      it('returns empty set when called with empty string', () => {
        const result = parseDisabledGroups('');
        expect(result.size).toBe(0);
      });

      it('returns empty set when called with whitespace only', () => {
        const result = parseDisabledGroups('   ');
        expect(result.size).toBe(0);
      });
    });

    describe('single group names', () => {
      it('disables state group', () => {
        const result = parseDisabledGroups('state');
        expect(result.has(TOOL_CATEGORIES.STATE)).toBe(true);
      });

      it('disables notepad group', () => {
        const result = parseDisabledGroups('notepad');
        expect(result.has(TOOL_CATEGORIES.NOTEPAD)).toBe(true);
      });

      it('disables interop group', () => {
        const result = parseDisabledGroups('interop');
        expect(result.has(TOOL_CATEGORIES.INTEROP)).toBe(true);
      });

      it('accepts codex group (reserved, no tools in t server)', () => {
        const result = parseDisabledGroups('codex');
        expect(result.has(TOOL_CATEGORIES.CODEX)).toBe(true);
      });

      it('accepts gemini group (reserved, no tools in t server)', () => {
        const result = parseDisabledGroups('gemini');
        expect(result.has(TOOL_CATEGORIES.GEMINI)).toBe(true);
      });

      it('disables wiki group', () => {
        const result = parseDisabledGroups('wiki');
        expect(result.has(TOOL_CATEGORIES.WIKI)).toBe(true);
      });
    });

    describe('multiple groups', () => {
      it('disables multiple groups from comma-separated list', () => {
        const result = parseDisabledGroups('state,notepad');
        expect(result.has(TOOL_CATEGORIES.STATE)).toBe(true);
        expect(result.has(TOOL_CATEGORIES.NOTEPAD)).toBe(true);
        expect(result.size).toBe(2);
      });

      it('disables many groups at once', () => {
        const result = parseDisabledGroups('gemini,codex,state,notepad,wiki');
        expect(result.has(TOOL_CATEGORIES.GEMINI)).toBe(true);
        expect(result.has(TOOL_CATEGORIES.CODEX)).toBe(true);
        expect(result.has(TOOL_CATEGORIES.STATE)).toBe(true);
        expect(result.has(TOOL_CATEGORIES.NOTEPAD)).toBe(true);
        expect(result.has(TOOL_CATEGORIES.WIKI)).toBe(true);
      });
    });

    describe('robustness', () => {
      it('is case-insensitive', () => {
        const result = parseDisabledGroups('STATE,WIKI');
        expect(result.has(TOOL_CATEGORIES.STATE)).toBe(true);
        expect(result.has(TOOL_CATEGORIES.WIKI)).toBe(true);
      });

      it('trims whitespace around group names', () => {
        const result = parseDisabledGroups('  state , wiki  ');
        expect(result.has(TOOL_CATEGORIES.STATE)).toBe(true);
        expect(result.has(TOOL_CATEGORIES.WIKI)).toBe(true);
      });

      it('ignores empty segments from trailing/double commas', () => {
        const result = parseDisabledGroups('state,,wiki,');
        expect(result.has(TOOL_CATEGORIES.STATE)).toBe(true);
        expect(result.has(TOOL_CATEGORIES.WIKI)).toBe(true);
        expect(result.size).toBe(2);
      });

      it('silently ignores unknown group names', () => {
        const result = parseDisabledGroups('unknown-group,state');
        expect(result.has(TOOL_CATEGORIES.STATE)).toBe(true);
        expect(result.size).toBe(1);
      });

      it('returns empty set when all names are unknown', () => {
        const result = parseDisabledGroups('foo,bar,baz');
        expect(result.size).toBe(0);
      });

      it('reads from process.env.OMC_DISABLE_TOOLS when no argument given', () => {
        process.env.OMC_DISABLE_TOOLS = 'state,wiki';
        const result = parseDisabledGroups();
        expect(result.has(TOOL_CATEGORIES.STATE)).toBe(true);
        expect(result.has(TOOL_CATEGORIES.WIKI)).toBe(true);
      });

      it('explicit argument takes precedence over env var', () => {
        process.env.OMC_DISABLE_TOOLS = 'state';
        const result = parseDisabledGroups('wiki');
        expect(result.has(TOOL_CATEGORIES.WIKI)).toBe(true);
        expect(result.has(TOOL_CATEGORIES.STATE)).toBe(false);
      });
    });
  });

  describe('DISABLE_TOOLS_GROUP_MAP', () => {
    it('contains current group names', () => {
      const requiredGroups = ['gemini', 'codex', 'state', 'notepad', 'interop', 'wiki'];
      for (const group of requiredGroups) {
        expect(DISABLE_TOOLS_GROUP_MAP).toHaveProperty(group);
      }
    });

    it('maps to valid ToolCategory values', () => {
      const validCategories = new Set(Object.values(TOOL_CATEGORIES));
      for (const [name, category] of Object.entries(DISABLE_TOOLS_GROUP_MAP)) {
        expect(validCategories.has(category), `${name} should map to a valid ToolCategory`).toBe(true);
      }
    });
  });
});
