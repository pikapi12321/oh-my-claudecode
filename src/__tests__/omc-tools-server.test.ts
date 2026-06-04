import { describe, it, expect } from 'vitest';
import { omcToolsServer, omcToolNames, getOmcToolNames } from '../mcp/omc-tools-server.js';

const interopEnabled = process.env.OMC_INTEROP_TOOLS_ENABLED === '1';
const totalTools = interopEnabled ? 31 : 23;
const withoutLsp = interopEnabled ? 27 : 19;
const withoutAst = interopEnabled ? 30 : 22;
const withoutSkills = interopEnabled ? 28 : 20;

describe('omc-tools-server', () => {
  describe('omcToolNames', () => {
    it('should export expected tools total', () => {
      expect(omcToolNames).toHaveLength(totalTools);
    });

    it('should have 4 LSP tools', () => {
      const lspTools = omcToolNames.filter(n => n.includes('lsp_'));
      expect(lspTools).toHaveLength(4);
    });

    it('should have 1 AST tool', () => {
      const astTools = omcToolNames.filter(n => n.includes('ast_'));
      expect(astTools).toHaveLength(1);
    });

    it('should use correct MCP naming format', () => {
      omcToolNames.forEach(name => {
        expect(name).toMatch(/^mcp__t__/);
      });
    });
  });

  describe('getOmcToolNames', () => {
    it('should return all tools by default', () => {
      const tools = getOmcToolNames();
      expect(tools).toHaveLength(totalTools);
    });

    it('should filter out LSP tools when includeLsp is false', () => {
      const tools = getOmcToolNames({ includeLsp: false });
      expect(tools.some(t => t.includes('lsp_'))).toBe(false);
      expect(tools).toHaveLength(withoutLsp);
    });

    it('should filter out AST tools when includeAst is false', () => {
      const tools = getOmcToolNames({ includeAst: false });
      expect(tools.some(t => t.includes('ast_'))).toBe(false);
      expect(tools).toHaveLength(withoutAst);
    });

    it('should filter out skills tools', () => {
      const names = getOmcToolNames({ includeSkills: false });
      expect(names).toHaveLength(withoutSkills);
      expect(names.every(n => !n.includes('load_omc_skills') && !n.includes('list_omc_skills'))).toBe(true);
    });

    it('should have 3 skills tools', () => {
      const skillsTools = omcToolNames.filter(n => n.includes('load_omc_skills') || n.includes('list_omc_skills'));
      expect(skillsTools).toHaveLength(3);
    });

    it('supports includeInterop filter option', () => {
      const withInterop = getOmcToolNames({ includeInterop: true });
      const withoutInterop = getOmcToolNames({ includeInterop: false });

      if (interopEnabled) {
        expect(withInterop.some(n => n.includes('interop_'))).toBe(true);
      }
      expect(withoutInterop.some(n => n.includes('interop_'))).toBe(false);
    });
  });

  describe('omcToolsServer', () => {
    it('should be defined', () => {
      expect(omcToolsServer).toBeDefined();
    });
  });
});
