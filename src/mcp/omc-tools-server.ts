/**
 * OMC Tools Server - In-process MCP server for custom tools
 *
 * Exposes the trimmed set of custom tools (state, notepad, wiki, interop)
 * via the Claude Agent SDK's createSdkMcpServer helper
 * for use by subagents.
 */

import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { stateTools } from "../tools/state-tools.js";
import { notepadTools } from "../tools/notepad-tools.js";
import { getInteropTools } from "../interop/mcp-bridge.js";
import { wikiTools } from "../tools/wiki-tools.js";
import { batchEditTool } from "../tools/batch-edit/index.js";
import { batchReadTool } from "../tools/batch-read/index.js";
import { searchTool } from "../tools/search/index.js";
import { TOOL_CATEGORIES, type ToolCategory } from "../constants/index.js";

// Type for our tool definitions
interface ToolDef {
  name: string;
  description: string;
  category?: ToolCategory;
  schema: Record<string, unknown>;
  handler: (args: unknown) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}

// Tag each tool array with its category before aggregation
function tagCategory<T extends { name: string }>(tools: T[], category: ToolCategory): (T & { category: ToolCategory })[] {
  return tools.map(t => ({ ...t, category }));
}

/**
 * Map from user-facing OMC_DISABLE_TOOLS group names to ToolCategory values.
 * Supports both canonical names and common aliases.
 */
export const DISABLE_TOOLS_GROUP_MAP: Record<string, ToolCategory> = {
  'state': TOOL_CATEGORIES.STATE,
  'notepad': TOOL_CATEGORIES.NOTEPAD,
  'interop': TOOL_CATEGORIES.INTEROP,
  'codex': TOOL_CATEGORIES.CODEX,
  'gemini': TOOL_CATEGORIES.GEMINI,
  'wiki': TOOL_CATEGORIES.WIKI,
  'edit': TOOL_CATEGORIES.EDIT,
  'read': TOOL_CATEGORIES.READ,
  'search': TOOL_CATEGORIES.SEARCH,
};

/**
 * Parse OMC_DISABLE_TOOLS env var value into a Set of disabled ToolCategory values.
 *
 * Accepts a comma-separated list of group names (case-insensitive).
 * Unknown names are silently ignored.
 *
 * @param envValue - The env var value to parse. Defaults to process.env.OMC_DISABLE_TOOLS.
 * @returns Set of ToolCategory values that should be disabled.
 *
 * @example
 * // OMC_DISABLE_TOOLS=lsp
 * parseDisabledGroups(); // Set { 'lsp', 'memory' }
 */
export function parseDisabledGroups(envValue?: string): Set<ToolCategory> {
  const disabled = new Set<ToolCategory>();
  const value = envValue ?? process.env.OMC_DISABLE_TOOLS;
  if (!value || !value.trim()) return disabled;

  for (const name of value.split(',')) {
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) continue;
    const category = DISABLE_TOOLS_GROUP_MAP[trimmed];
    if (category !== undefined) {
      disabled.add(category);
    }
  }
  return disabled;
}

// Aggregate all custom tools with category metadata (full list, unfiltered)
const interopToolsEnabled = process.env.OMC_INTEROP_TOOLS_ENABLED === '1';
const interopTools: ToolDef[] = interopToolsEnabled
  ? tagCategory(getInteropTools() as unknown as ToolDef[], TOOL_CATEGORIES.INTEROP)
  : [];

const allTools: ToolDef[] = [
  ...tagCategory(stateTools as unknown as ToolDef[], TOOL_CATEGORIES.STATE),
  ...tagCategory(notepadTools as unknown as ToolDef[], TOOL_CATEGORIES.NOTEPAD),
  ...tagCategory(wikiTools as unknown as ToolDef[], TOOL_CATEGORIES.WIKI),
  ...tagCategory([batchEditTool] as unknown as ToolDef[], TOOL_CATEGORIES.EDIT),
  ...tagCategory([batchReadTool] as unknown as ToolDef[], TOOL_CATEGORIES.READ),
  ...tagCategory([searchTool] as unknown as ToolDef[], TOOL_CATEGORIES.SEARCH),
  ...interopTools,
];

// Read OMC_DISABLE_TOOLS once at startup and filter tools accordingly
const _startupDisabledGroups = parseDisabledGroups();
const enabledTools: ToolDef[] = _startupDisabledGroups.size === 0
  ? allTools
  : allTools.filter(t => !t.category || !_startupDisabledGroups.has(t.category));

// Convert to SDK tool format
// The SDK's tool() expects a ZodRawShape directly (not wrapped in z.object())
const sdkTools = enabledTools.map(t =>
  tool(
    t.name,
    t.description,
    t.schema as Parameters<typeof tool>[2],
    async (args: unknown) => await t.handler(args)
  )
);

/**
 * In-process MCP server exposing all OMC custom tools
 *
 * Tools will be available as mcp__t__<tool_name>.
 * Tools in disabled groups (via OMC_DISABLE_TOOLS) are excluded at startup.
 */
export const omcToolsServer = createSdkMcpServer({
  name: "t",
  version: "1.0.0",
  tools: sdkTools
});

/**
 * Tool names in MCP format for allowedTools configuration.
 * Only includes tools that are enabled (not disabled via OMC_DISABLE_TOOLS).
 */
export const omcToolNames = enabledTools.map(t => `mcp__t__${t.name}`);

// Build a map from MCP tool name to category for efficient lookup
// Built from allTools so getOmcToolNames() category filtering works correctly
const toolCategoryMap = new Map<string, ToolCategory>(
  allTools.map(t => [`mcp__t__${t.name}`, t.category!])
);

interface ToolNameFilterOptions {
  includeState?: boolean;
  includeNotepad?: boolean;
  includeInterop?: boolean;
  includeWiki?: boolean;
}

function getExcludedCategories(options?: ToolNameFilterOptions): Set<ToolCategory> {
  const {
    includeState = true,
    includeNotepad = true,
    includeInterop = true,
    includeWiki = true,
  } = options || {};

  const excludedCategories = new Set<ToolCategory>();
  if (!includeState) excludedCategories.add(TOOL_CATEGORIES.STATE);
  if (!includeNotepad) excludedCategories.add(TOOL_CATEGORIES.NOTEPAD);
  if (!includeInterop) excludedCategories.add(TOOL_CATEGORIES.INTEROP);
  if (!includeWiki) excludedCategories.add(TOOL_CATEGORIES.WIKI);
  return excludedCategories;
}

function filterToolNames(
  names: string[],
  categoriesByName: Map<string, ToolCategory>,
  options?: ToolNameFilterOptions,
): string[] {
  const excludedCategories = getExcludedCategories(options);
  if (excludedCategories.size === 0) return [...names];

  return names.filter(name => {
    const category = categoriesByName.get(name);
    return !category || !excludedCategories.has(category);
  });
}

/**
 * Get tool names filtered by category.
 * Uses category metadata instead of string heuristics.
 */
export function getOmcToolNames(options?: ToolNameFilterOptions): string[] {
  return filterToolNames(omcToolNames, toolCategoryMap, options);
}

/**
 * Test-only helper for deterministic category-filter verification independent of env startup state.
 */
export function _getAllToolNamesForTests(options?: ToolNameFilterOptions): string[] {
  const allToolNames = allTools.map(t => `mcp__t__${t.name}`);
  return filterToolNames(allToolNames, toolCategoryMap, options);
}
