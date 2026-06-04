/**
 * Notepad MCP Tools
 *
 * Provides tools for writing the notepad Priority Context section.
 */

import { z } from 'zod';
import {
  ensureOmcDir,
  validateWorkingDirectory,
} from '../lib/worktree-paths.js';
import {
  setPriorityContext,
} from '../hooks/notepad/index.js';
import { ToolDefinition } from './types.js';

// ============================================================================
// notepad_write_priority - Write to Priority Context
// ============================================================================

export const notepadWritePriorityTool: ToolDefinition<{
  content: z.ZodString;
  workingDirectory: z.ZodOptional<z.ZodString>;
}> = {
  name: 'notepad_write_priority',
  description: 'Write to the Priority Context section. This REPLACES the existing content. Keep under 500 chars - this is always loaded at session start.',
  schema: {
    content: z.string().max(2000).describe('Content to write (recommend under 500 chars)'),
    workingDirectory: z.string().optional().describe('Working directory (defaults to cwd)'),
  },
  handler: async (args) => {
    const { content, workingDirectory } = args;

    try {
      const root = validateWorkingDirectory(workingDirectory);

      ensureOmcDir('', root);

      const result = setPriorityContext(root, content);

      if (!result.success) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Failed to write to Priority Context. Check file permissions.'
          }]
        };
      }

      let response = `Successfully wrote to Priority Context (${content.length} chars)`;
      if (result.warning) {
        response += `\n\n**Warning:** ${result.warning}`;
      }

      return {
        content: [{
          type: 'text' as const,
          text: response
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error writing to Priority Context: ${error instanceof Error ? error.message : String(error)}`
        }]
      };
    }
  }
};

/**
 * All notepad tools for registration
 */
export const notepadTools = [
  notepadWritePriorityTool,
];
