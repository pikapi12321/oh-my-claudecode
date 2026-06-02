/**
 * Tests for OMC_ROUTING_OMIT_MODEL_PIN environment variable support (issue #1135)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadEnvConfig } from '../config/loader.js';

describe('OMC_ROUTING_OMIT_MODEL_PIN env var', () => {
  let originalValue: string | undefined;

  beforeEach(() => {
    originalValue = process.env.OMC_ROUTING_OMIT_MODEL_PIN;
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.OMC_ROUTING_OMIT_MODEL_PIN;
    } else {
      process.env.OMC_ROUTING_OMIT_MODEL_PIN = originalValue;
    }
  });

  it('sets omitModelPin to true when env var is "true"', () => {
    process.env.OMC_ROUTING_OMIT_MODEL_PIN = 'true';
    const config = loadEnvConfig();
    expect(config.routing?.omitModelPin).toBe(true);
  });

  it('sets omitModelPin to false when env var is "false"', () => {
    process.env.OMC_ROUTING_OMIT_MODEL_PIN = 'false';
    const config = loadEnvConfig();
    expect(config.routing?.omitModelPin).toBe(false);
  });

  it('does not set omitModelPin when env var is not defined', () => {
    delete process.env.OMC_ROUTING_OMIT_MODEL_PIN;
    const config = loadEnvConfig();
    expect(config.routing?.omitModelPin).toBeUndefined();
  });
});
