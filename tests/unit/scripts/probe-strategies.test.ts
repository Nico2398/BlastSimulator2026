import { describe, it, expect } from 'vitest';
import { RELOAD_FRACTION, shouldReload } from '../../../scripts/shared/probe-strategies.js';

describe('probe reload gate', () => {
  it('RELOAD_FRACTION is one half', () => {
    expect(RELOAD_FRACTION).toBe(0.5);
  });

  it('reloads when haulable ore fell under half of the last yield', () => {
    expect(shouldReload(499, 1000)).toBe(true);
    expect(shouldReload(0, 1000)).toBe(true);
  });

  it('does not reload at exactly the boundary', () => {
    expect(shouldReload(500, 1000)).toBe(false);
  });

  it('does not reload above the boundary', () => {
    expect(shouldReload(501, 1000)).toBe(false);
    expect(shouldReload(5000, 1000)).toBe(false);
  });

  it('never reloads without a prior yield', () => {
    expect(shouldReload(0, 0)).toBe(false);
    expect(shouldReload(100, 0)).toBe(false);
    expect(shouldReload(0, -5)).toBe(false);
  });
});
