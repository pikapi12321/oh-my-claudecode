import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autoImproveCommand, normalizeAutoImproveClaudeArgs, parseAutoImproveArgs, AUTO_IMPROVE_HELP } from '../auto-improve.js';

describe('normalizeAutoImproveClaudeArgs', () => {
  it('returns the provided args unchanged for the deprecated shim', () => {
    expect(normalizeAutoImproveClaudeArgs(['--model', 'opus'])).toEqual(['--model', 'opus']);
  });
});

describe('parseAutoImproveArgs', () => {
  it('marks empty invocation as deprecated', () => {
    expect(parseAutoImproveArgs([])).toEqual({ args: [], deprecated: true });
  });

  it('preserves arbitrary legacy args without attempting runtime parsing', () => {
    expect(parseAutoImproveArgs(['--mission', 'Improve onboarding', '--eval', 'npm run eval'])).toEqual({
      args: ['--mission', 'Improve onboarding', '--eval', 'npm run eval'],
      deprecated: true,
    });
  });

  it('publishes hard-deprecation guidance', () => {
    expect(AUTO_IMPROVE_HELP).toContain('HARD DEPRECATED');
    expect(AUTO_IMPROVE_HELP).toContain('/deep-interview --auto-improve');
    expect(AUTO_IMPROVE_HELP).toContain('/oh-my-claudecode:auto-improve');
    expect(AUTO_IMPROVE_HELP).toContain('single-mission only');
    expect(AUTO_IMPROVE_HELP).toContain('max-runtime ceiling');
  });
});

describe('autoImproveCommand', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('prints the deprecation message for no args', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await autoImproveCommand([]);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0]).toContain('HARD DEPRECATED');
  });

  it('prints the deprecation message and echoes received legacy args', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await autoImproveCommand(['--resume', 'old-run']);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[0]).toContain('Received legacy arguments: --resume old-run');
    expect(logSpy.mock.calls[0]?.[0]).toContain('/oh-my-claudecode:auto-improve');
  });
});
