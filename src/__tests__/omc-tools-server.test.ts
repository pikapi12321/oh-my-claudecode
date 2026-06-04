import { describe, it, expect } from 'vitest';
import { omcToolsServer, omcToolNames, getOmcToolNames } from '../mcp/omc-tools-server.js';

const interopEnabled = process.env.OMC_INTEROP_TOOLS_ENABLED === '1';
const totalTools = interopEnabled ? 15 : 8;

describe('omc-tools-server', () => {
  describe('omcToolNames', () => {
    it('should export expected tools total', () => {
      expect(omcToolNames).toHaveLength(totalTools);
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
