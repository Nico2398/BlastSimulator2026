// BlastSimulator2026 — Unit tests for pure helpers in src/console/commands/world.ts (#1187)

import { describe, it, expect } from 'vitest';
import { formatVerticalExtent } from '../../../src/console/commands/world.js';

describe('formatVerticalExtent (#1187)', () => {
  it('formats a populated range including both the minY and maxY bounds', () => {
    const out = formatVerticalExtent({ minY: -12, maxY: 20 });
    expect(out).toContain('-12');
    expect(out).toContain('20');
  });

  it('formats a range sitting entirely below 0 with the negative sign preserved', () => {
    const out = formatVerticalExtent({ minY: -30, maxY: -3 });
    expect(out).toContain('-30');
    expect(out).toContain('-3');
  });

  it('formats null (no column in the site has ground) as a "no ground" message, not bogus numbers', () => {
    const out = formatVerticalExtent(null);
    expect(out.toLowerCase()).toContain('no ground');
    expect(out).not.toContain('null');
    expect(out).not.toContain('undefined');
  });
});
