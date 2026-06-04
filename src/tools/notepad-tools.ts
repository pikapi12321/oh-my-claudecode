/**
 * Notepad MCP Tools
 *
 * Provides tools for reading and writing the notepad Priority Context section.
 */

import { z } from 'zod';
import {
  getWorktreeNotepadPath,
  ensureOmcDir,
  validateWorkingDirectory,
} from '../lib/worktree-paths.js';
import {
  getPriorityContext,
  getWorkingMemory,
  getManualSection,
  setPriorityContext,
  formatFullNotepad,
} from '../hooks/notepad/index.js';
import { ToolDefinition } from './types.js';

const SECTION_NAMES: [string, ...string[]] = ['all', 'priority', 'working', 'manual'];

// ============================================================================
// notepad_read - Read notepad content
// ============================================================================

export const notepadReadTool: ToolDefinition<{
  section: z.ZodOptional<z.ZodEnum<typeof SECTION_NAMES>>;
  workingDirectory: z.ZodOptional<z.ZodString>;
}> = {
  name: 'notepad_read',
  description: 'Read the notepad content. Can read the full notepad or a specific section (priority, working, manual).',
  schema: {
    section: z.enum(SECTION_NAMES).optional().describe('Section to read: "all" (default), "priority", "working", or "manual"'),
    workingDirectory: z.string().optional().describe('Working directory (defaults to cwd)'),
  },
  handler: async (args) => {
    const { section = 'all', workingDirectory } = args;

    try {
      const root = validateWorkingDirectory(workingDirectory);

      if (section === 'all') {
        const content = formatFullNotepad(root);
        if (!content) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Notepad does not exist. Use notepad_write_priority to create it.'
            }]
          };
        }
        return {
          content: [{
            type: 'text' as const,
            text: `## Notepad\n\nPath: ${getWorktreeNotepadPath(root)}\n\n${content}`
          }]
        };
      }

      let sectionContent: string | null = null;
      let sectionTitle = '';

      switch (section) {
        case 'priority':
          sectionContent = getPriorityContext(root);
          sectionTitle = 'Priority Context';
          break;
        case 'working':
          sectionContent = getWorkingMemory(root);
          sectionTitle = 'Working Memory';
          break;
        case 'manual':
          sectionContent = getManualSection(root);
          sectionTitle = 'MANUAL';
          break;
      }

      if (!sectionContent) {
        return {
          content: [{
            type: 'text' as const,
            text: `## ${sectionTitle}\n\n(Empty or notepad does not exist)`
          }]
        };
      }

      return {
        content: [{
          type: 'text' as const,
          text: `## ${sectionTitle}\n\n${sectionContent}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error reading notepad: ${error instanceof Error ? error.message : String(error)}`
        }]
      };
    }
  }
};

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
  notepadReadTool,
  notepadWritePriorityTool,
];
