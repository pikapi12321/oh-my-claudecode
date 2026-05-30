import { describe, expect, it } from 'vitest';
import {
  AUTO_IMPROVE_SETUP_CONFIDENCE_THRESHOLD,
  buildSetupSandboxContent,
  parseAutoImproveSetupHandoffJson,
  validateAutoImproveSetupHandoff,
} from '../setup-contract.js';

describe('validateAutoImproveSetupHandoff', () => {
  it('accepts a launch-ready explicit evaluator handoff', () => {
    const result = validateAutoImproveSetupHandoff({
      missionText: 'Improve onboarding completion',
      evaluatorCommand: 'npm run eval:onboarding',
      evaluatorSource: 'user',
      confidence: 1,
      keepPolicy: 'pass_only',
      slug: 'Onboarding Goal',
      readyToLaunch: true,
    });

    expect(result.slug).toBe('onboarding-goal');
    expect(result.keepPolicy).toBe('pass_only');
  });

  it('rejects low-confidence inferred evaluators marked launch-ready', () => {
    expect(() => validateAutoImproveSetupHandoff({
      missionText: 'Investigate flaky tests',
      evaluatorCommand: 'npm test',
      evaluatorSource: 'inferred',
      confidence: AUTO_IMPROVE_SETUP_CONFIDENCE_THRESHOLD - 0.01,
      slug: 'flaky',
      readyToLaunch: true,
    })).toThrow(/low-confidence inferred evaluators cannot be marked readyToLaunch/i);
  });

  it('requires a clarification question when launch is blocked', () => {
    expect(() => validateAutoImproveSetupHandoff({
      missionText: 'Improve docs',
      evaluatorCommand: 'npm run lint',
      evaluatorSource: 'inferred',
      confidence: 0.4,
      slug: 'docs',
      readyToLaunch: false,
    })).toThrow(/clarificationQuestion/i);
  });
});

describe('parseAutoImproveSetupHandoffJson', () => {
  it('parses fenced JSON output', () => {
    const payload = [
      '```json',
      '{"missionText":"Ship release confidence","evaluatorCommand":"npm run test:run","evaluatorSource":"inferred","confidence":0.91,"slug":"release-confidence","readyToLaunch":true}',
      '```',
    ].join('\n');

    const result = parseAutoImproveSetupHandoffJson(payload);
    expect(result.evaluatorCommand).toBe('npm run test:run');
    expect(result.readyToLaunch).toBe(true);
  });
});

describe('buildSetupSandboxContent', () => {
  it('sanitizes newlines from evaluator commands', () => {
    const content = buildSetupSandboxContent('npm test\nrm -rf /', 'score_improvement');
    expect(content).toContain('command: npm test rm -rf /');
    expect(content).toContain('keep_policy: score_improvement');
  });
});
