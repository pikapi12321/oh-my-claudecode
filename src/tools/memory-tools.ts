/**
 * Project Memory MCP Tools
 *
 * Provides tools for adding directives to project memory.
 */

import { z } from 'zod';
import { validateWorkingDirectory } from '../lib/worktree-paths.js';
import {
  loadProjectMemory,
  saveProjectMemory,
  addDirective,
  type UserDirective,
} from '../hooks/project-memory/index.js';
import { ToolDefinition } from './types.js';

// ============================================================================
// project_memory_add_directive - Add a user directive
// ============================================================================

export const projectMemoryAddDirectiveTool: ToolDefinition<{
  directive: z.ZodString;
  context: z.ZodOptional<z.ZodString>;
  priority: z.ZodOptional<z.ZodEnum<['high', 'normal']>>;
  workingDirectory: z.ZodOptional<z.ZodString>;
}> = {
  name: 'project_memory_add_directive',
  description: 'Add a user directive to project memory. Directives are instructions that persist across sessions and survive compaction.',
  schema: {
    directive: z.string().max(500).describe('The directive (e.g., "Always use TypeScript strict mode")'),
    context: z.string().max(500).optional().describe('Additional context for the directive'),
    priority: z.enum(['high', 'normal']).optional().describe('Priority level (default: normal)'),
    workingDirectory: z.string().optional().describe('Working directory (defaults to cwd)'),
  },
  handler: async (args) => {
    const { directive, context = '', priority = 'normal', workingDirectory } = args;

    try {
      const root = validateWorkingDirectory(workingDirectory);

      const memory = await loadProjectMemory(root);
      if (!memory) {
        return {
          content: [{
            type: 'text' as const,
            text: 'Project memory does not exist. Run a session first to auto-detect project environment.'
          }]
        };
      }

      const newDirective: UserDirective = {
        timestamp: Date.now(),
        directive,
        context,
        source: 'explicit',
        priority,
      };

      memory.userDirectives = addDirective(memory.userDirectives, newDirective);
      await saveProjectMemory(root, memory);

      return {
        content: [{
          type: 'text' as const,
          text: `Successfully added directive to project memory.\n\n- **Directive:** ${directive}\n- **Priority:** ${priority}\n- **Context:** ${context || '(none)'}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error adding directive: ${error instanceof Error ? error.message : String(error)}`
        }]
      };
    }
  }
};

/**
 * All memory tools for registration
 */
export const memoryTools = [
  projectMemoryAddDirectiveTool,
];
