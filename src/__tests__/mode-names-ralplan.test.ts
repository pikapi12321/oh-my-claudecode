import { describe, it, expect } from 'vitest';
import {
  MODE_NAMES,
  ALL_MODE_NAMES,
  MODE_STATE_FILE_MAP,
  SESSION_END_MODE_STATE_FILES,
  SESSION_METRICS_MODE_FILES,
} from '../lib/mode-names.js';

describe('mode-names auto-improve', () => {
  it('MODE_NAMES should include AUTO_IMPROVE', () => {
    expect(MODE_NAMES.AUTO_IMPROVE).toBe('auto-improve');
  });

  it('ALL_MODE_NAMES should include auto-improve', () => {
    expect(ALL_MODE_NAMES).toContain('auto-improve');
  });

  it('MODE_STATE_FILE_MAP should have auto-improve entry', () => {
    expect(MODE_STATE_FILE_MAP['auto-improve']).toBe('auto-improve-state.json');
  });

  it('SESSION_END_MODE_STATE_FILES should include auto-improve', () => {
    const entry = SESSION_END_MODE_STATE_FILES.find(
      item => item.mode === 'auto-improve'
    );
    expect(entry).toBeDefined();
    expect(entry!.file).toBe('auto-improve-state.json');
  });

  it('SESSION_METRICS_MODE_FILES should include auto-improve', () => {
    const entry = SESSION_METRICS_MODE_FILES.find(
      item => item.mode === 'auto-improve'
    );
    expect(entry).toBeDefined();
    expect(entry!.file).toBe('auto-improve-state.json');
  });

  it('total mode count should be consistent', () => {
    const modeCount = Object.keys(MODE_NAMES).length;
    expect(ALL_MODE_NAMES.length).toBe(modeCount);
    expect(Object.keys(MODE_STATE_FILE_MAP).length).toBe(modeCount);
  });
});
