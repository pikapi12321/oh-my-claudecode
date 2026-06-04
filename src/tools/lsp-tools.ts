/**
 * LSP (Language Server Protocol) Tools
 *
 * Provides IDE-like capabilities to agents via real LSP server integration:
 * - Go to definition
 * - Find references
 * - Document symbols
 * - Diagnostics
 */

import { z } from 'zod';
import {
  lspClientManager,
  getServerForFile,
  formatLocations,
  formatDocumentSymbols,
  formatDiagnostics,
} from './lsp/index.js';
import { ToolDefinition } from './types.js';

/**
 * Helper to handle LSP errors gracefully.
 * Uses runWithClientLease to protect the client from idle eviction
 * while the operation is in flight.
 */
async function withLspClient<T>(
  filePath: string,
  operation: string,
  fn: (client: NonNullable<Awaited<ReturnType<typeof lspClientManager.getClientForFile>>>) => Promise<T>
): Promise<{ isError?: true; content: Array<{ type: 'text'; text: string }> }> {
  try {
    const serverConfig = getServerForFile(filePath);
    if (!serverConfig) {
      return {
        isError: true as const,
        content: [{
          type: 'text' as const,
          text: `No language server available for file type: ${filePath}`
        }]
      };
    }

    const result = await lspClientManager.runWithClientLease(filePath, async (client) => {
      return fn(client);
    });
    return {
      content: [{
        type: 'text' as const,
        text: String(result)
      }]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('not found')) {
      return {
        isError: true as const,
        content: [{
          type: 'text' as const,
          text: `${message}`
        }]
      };
    }
    return {
      isError: true as const,
      content: [{
        type: 'text' as const,
        text: `Error in ${operation}: ${message}`
      }]
    };
  }
}

/**
 * LSP Go to Definition Tool - Jump to where a symbol is defined
 */
export const lspGotoDefinitionTool: ToolDefinition<{
  file: z.ZodString;
  line: z.ZodNumber;
  character: z.ZodNumber;
}> = {
  name: 'lsp_goto_definition',
  description: 'Find the definition location of a symbol (function, variable, class, etc.). Returns the file path and position where the symbol is defined.',
  schema: {
    file: z.string().describe('Path to the source file'),
    line: z.number().int().min(1).describe('Line number (1-indexed)'),
    character: z.number().int().min(0).describe('Character position in the line (0-indexed)')
  },
  handler: async (args) => {
    const { file, line, character } = args;
    return withLspClient(file, 'goto definition', async (client) => {
      const locations = await client!.definition(file, line - 1, character);
      return formatLocations(locations);
    });
  }
};

/**
 * LSP Find References Tool - Find all usages of a symbol
 */
export const lspFindReferencesTool: ToolDefinition<{
  file: z.ZodString;
  line: z.ZodNumber;
  character: z.ZodNumber;
  includeDeclaration: z.ZodOptional<z.ZodBoolean>;
}> = {
  name: 'lsp_find_references',
  description: 'Find all references to a symbol across the codebase. Useful for understanding usage patterns and impact of changes.',
  schema: {
    file: z.string().describe('Path to the source file'),
    line: z.number().int().min(1).describe('Line number (1-indexed)'),
    character: z.number().int().min(0).describe('Character position in the line (0-indexed)'),
    includeDeclaration: z.boolean().optional().describe('Include the declaration in results (default: true)')
  },
  handler: async (args) => {
    const { file, line, character, includeDeclaration = true } = args;
    return withLspClient(file, 'find references', async (client) => {
      const locations = await client!.references(file, line - 1, character, includeDeclaration);
      if (!locations || locations.length === 0) {
        return 'No references found';
      }
      return `Found ${locations.length} reference(s):\n\n${formatLocations(locations)}`;
    });
  }
};

/**
 * LSP Document Symbols Tool - Get outline of all symbols in a file
 */
export const lspDocumentSymbolsTool: ToolDefinition<{
  file: z.ZodString;
}> = {
  name: 'lsp_document_symbols',
  description: 'Get a hierarchical outline of all symbols in a file (functions, classes, variables, etc.). Useful for understanding file structure.',
  schema: {
    file: z.string().describe('Path to the source file')
  },
  handler: async (args) => {
    const { file } = args;
    return withLspClient(file, 'document symbols', async (client) => {
      const symbols = await client!.documentSymbols(file);
      return formatDocumentSymbols(symbols);
    });
  }
};

/**
 * LSP Diagnostics Tool - Get errors, warnings, and hints
 */
export const lspDiagnosticsTool: ToolDefinition<{
  file: z.ZodString;
  severity: z.ZodOptional<z.ZodEnum<['error', 'warning', 'info', 'hint']>>;
}> = {
  name: 'lsp_diagnostics',
  description: 'Get language server diagnostics (errors, warnings, hints) for a file. Useful for finding issues without running the compiler.',
  schema: {
    file: z.string().describe('Path to the source file'),
    severity: z.enum(['error', 'warning', 'info', 'hint']).optional().describe('Filter by severity level')
  },
  handler: async (args) => {
    const { file, severity } = args;
    return withLspClient(file, 'diagnostics', async (client) => {
      await client!.openDocument(file);

      let diagnostics;
      if (client!.supportsPullDiagnostics) {
        diagnostics = await client!.pullDiagnostics(file);
      } else {
        await client!.waitForDiagnostics(file, 30_000);
        diagnostics = client!.getDiagnostics(file);
      }

      if (severity) {
        const severityMap: Record<string, number> = {
          'error': 1,
          'warning': 2,
          'info': 3,
          'hint': 4
        };
        const severityNum = severityMap[severity];
        diagnostics = diagnostics.filter(d => d.severity === severityNum);
      }

      if (diagnostics.length === 0) {
        return severity
          ? `No ${severity} diagnostics in ${file}`
          : `No diagnostics in ${file}`;
      }

      return `Found ${diagnostics.length} diagnostic(s):\n\n${formatDiagnostics(diagnostics, file)}`;
    });
  }
};

/**
 * All LSP tools for registration
 */
export const lspTools = [
  lspGotoDefinitionTool,
  lspFindReferencesTool,
  lspDocumentSymbolsTool,
  lspDiagnosticsTool,
];
