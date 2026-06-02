/**
 * Tests for routing.omitModelPin feature (issue #1135)
 *
 * When routing.omitModelPin is true, all agents should inherit the parent
 * model instead of using OMC's per-agent model routing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  routeTask,
  getModelForTask,
} from '../features/model-routing/router.js';
import {
  enforceModel,
  processPreToolUse,
  type AgentInput,
} from '../features/delegation-enforcer.js';

// Mock loadConfig to control omitModelPin
vi.mock('../config/loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../config/loader.js')>();
  return {
    ...actual,
    loadConfig: vi.fn(() => ({
      ...actual.DEFAULT_CONFIG,
      routing: {
        ...actual.DEFAULT_CONFIG.routing,
        omitModelPin: false,
      },
    })),
  };
});

import { loadConfig, DEFAULT_CONFIG } from '../config/loader.js';

const mockedLoadConfig = vi.mocked(loadConfig);

describe('routing.omitModelPin (issue #1135)', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.OMC_ROUTING_OMIT_MODEL_PIN;
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.OMC_ROUTING_OMIT_MODEL_PIN;
    } else {
      process.env.OMC_ROUTING_OMIT_MODEL_PIN = originalEnv;
    }
  });

  describe('routeTask with omitModelPin', () => {
    it('returns inherit model type when omitModelPin is true', () => {
      const result = routeTask(
        { taskPrompt: 'Find all files', agentType: 'explore' },
        { enabled: true, defaultTier: 'MEDIUM', omitModelPin: true, escalationEnabled: false, maxEscalations: 0, tierModels: { LOW: 'haiku', MEDIUM: 'sonnet', HIGH: 'opus' } }
      );

      expect(result.model).toBe('inherit');
      expect(result.modelType).toBe('inherit');
      expect(result.reasons).toContain('omitModelPin enabled: agents inherit parent model');
      expect(result.confidence).toBe(1.0);
    });

    it('bypasses agent-specific overrides when omitModelPin is true', () => {
      const result = routeTask(
        { taskPrompt: 'Design system architecture', agentType: 'architect' },
        {
          enabled: true,
          defaultTier: 'MEDIUM',
          omitModelPin: true,
          escalationEnabled: false,
          maxEscalations: 0,
          tierModels: { LOW: 'haiku', MEDIUM: 'sonnet', HIGH: 'opus' },
          agentOverrides: {
            architect: { tier: 'HIGH', reason: 'Advisory agent requires deep reasoning' },
          },
        }
      );

      expect(result.model).toBe('inherit');
      expect(result.modelType).toBe('inherit');
    });

    it('bypasses complexity-based routing when omitModelPin is true', () => {
      const result = routeTask(
        {
          taskPrompt: 'Refactor the entire authentication architecture with security review and data migration',
          agentType: 'executor',
        },
        { enabled: true, defaultTier: 'MEDIUM', omitModelPin: true, escalationEnabled: false, maxEscalations: 0, tierModels: { LOW: 'haiku', MEDIUM: 'sonnet', HIGH: 'opus' } }
      );

      expect(result.model).toBe('inherit');
      expect(result.modelType).toBe('inherit');
    });

    it('routes normally when omitModelPin is false', () => {
      const result = routeTask(
        { taskPrompt: 'Find all files', agentType: 'explore' },
        { enabled: true, defaultTier: 'MEDIUM', omitModelPin: false, escalationEnabled: false, maxEscalations: 0, tierModels: { LOW: 'haiku', MEDIUM: 'sonnet', HIGH: 'opus' } }
      );

      expect(result.model).not.toBe('inherit');
    });

    it('routes normally when omitModelPin is undefined', () => {
      const result = routeTask(
        { taskPrompt: 'Find all files', agentType: 'explore' },
        { enabled: true, defaultTier: 'MEDIUM', escalationEnabled: false, maxEscalations: 0, tierModels: { LOW: 'haiku', MEDIUM: 'sonnet', HIGH: 'opus' } }
      );

      expect(result.model).not.toBe('inherit');
    });
  });

  describe('getModelForTask with omitModelPin', () => {
    it('returns inherit for all agent types when omitModelPin is true', () => {
      const config = { enabled: true, defaultTier: 'MEDIUM' as const, omitModelPin: true, escalationEnabled: false, maxEscalations: 0, tierModels: { LOW: 'haiku', MEDIUM: 'sonnet', HIGH: 'opus' } };

      const agents = ['architect', 'executor', 'explore', 'writer', 'debugger', 'verifier'];
      for (const agent of agents) {
        const result = getModelForTask(agent, 'test task', config);
        expect(result.model).toBe('inherit');
      }
    });
  });

  describe('enforceModel with omitModelPin', () => {
    it('strips model when omitModelPin is true', () => {
      mockedLoadConfig.mockReturnValue({
        routing: { omitModelPin: true },
      } as ReturnType<typeof loadConfig>);

      const input: AgentInput = {
        description: 'Test task',
        prompt: 'Do something',
        subagent_type: 'oh-my-claudecode:executor',
        model: 'opus',
      };

      const result = enforceModel(input);

      expect(result.modifiedInput.model).toBeUndefined();
      expect(result.injected).toBe(false);
      expect(result.model).toBe('inherit');
    });

    it('does not inject model when omitModelPin is true and no model specified', () => {
      mockedLoadConfig.mockReturnValue({
        routing: { omitModelPin: true },
      } as ReturnType<typeof loadConfig>);

      const input: AgentInput = {
        description: 'Test task',
        prompt: 'Do something',
        subagent_type: 'oh-my-claudecode:executor',
      };

      const result = enforceModel(input);

      expect(result.modifiedInput.model).toBeUndefined();
      expect(result.injected).toBe(false);
    });

    it('injects model normally when omitModelPin is false', () => {
      mockedLoadConfig.mockReturnValue({
        routing: { omitModelPin: false },
      } as ReturnType<typeof loadConfig>);

      const input: AgentInput = {
        description: 'Test task',
        prompt: 'Do something',
        subagent_type: 'oh-my-claudecode:executor',
      };

      const result = enforceModel(input);

      expect(result.modifiedInput.model).toBe('sonnet');
      expect(result.injected).toBe(true);
    });
  });

  describe('config defaults', () => {
    it('DEFAULT_CONFIG has omitModelPin set to false', () => {
      expect(DEFAULT_CONFIG.routing?.omitModelPin).toBe(false);
    });
  });

  describe('processPreToolUse with omitModelPin', () => {
    it('strips model from Task calls when omitModelPin is true', () => {
      mockedLoadConfig.mockReturnValue({
        routing: { omitModelPin: true },
      } as ReturnType<typeof loadConfig>);

      const toolInput: AgentInput = {
        description: 'Test task',
        prompt: 'Do something',
        subagent_type: 'oh-my-claudecode:executor',
        model: 'opus',
      };

      const result = processPreToolUse('Task', toolInput);
      const modified = result.modifiedInput as AgentInput;

      expect(modified.model).toBeUndefined();
      expect(modified.prompt).toBe('Do something');
      expect(modified.subagent_type).toBe('oh-my-claudecode:executor');
    });

    it('strips model from Agent calls when omitModelPin is true', () => {
      mockedLoadConfig.mockReturnValue({
        routing: { omitModelPin: true },
      } as ReturnType<typeof loadConfig>);

      const toolInput: AgentInput = {
        description: 'Test task',
        prompt: 'Do something',
        subagent_type: 'oh-my-claudecode:executor',
        model: 'opus',
      };

      const result = processPreToolUse('Agent', toolInput);
      const modified = result.modifiedInput as AgentInput;

      expect(modified.model).toBeUndefined();
      expect(modified.prompt).toBe('Do something');
      expect(modified.subagent_type).toBe('oh-my-claudecode:executor');
    });

    it('strips model from lowercase agent calls when omitModelPin is true', () => {
      mockedLoadConfig.mockReturnValue({
        routing: { omitModelPin: true },
      } as ReturnType<typeof loadConfig>);

      const toolInput: AgentInput = {
        description: 'Test task',
        prompt: 'Do something',
        subagent_type: 'oh-my-claudecode:executor',
        model: 'opus',
      };

      const result = processPreToolUse('agent', toolInput);
      const modified = result.modifiedInput as AgentInput;

      expect(modified.model).toBeUndefined();
      expect(modified.subagent_type).toBe('oh-my-claudecode:executor');
    });

    it('does not strip model when omitModelPin is false', () => {
      mockedLoadConfig.mockReturnValue({
        routing: { omitModelPin: false },
      } as ReturnType<typeof loadConfig>);

      const toolInput: AgentInput = {
        description: 'Test task',
        prompt: 'Do something',
        subagent_type: 'oh-my-claudecode:executor',
        model: 'haiku',
      };

      const result = processPreToolUse('Task', toolInput);
      const modified = result.modifiedInput as AgentInput;

      // Should preserve the explicit model (enforceModel preserves explicit)
      expect(modified.model).toBe('haiku');
    });

    it('does not affect non-Task tool calls', () => {
      mockedLoadConfig.mockReturnValue({
        routing: { omitModelPin: true },
      } as ReturnType<typeof loadConfig>);

      const toolInput = { command: 'ls -la' };
      const result = processPreToolUse('Bash', toolInput);

      expect(result.modifiedInput).toEqual(toolInput);
    });
  });
});
