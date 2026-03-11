import { describe, it, expect, beforeEach } from 'vitest';
import { setDelay, autoVPattern } from '../../../src/core/mining/Sequence.js';
import { createGridPlan, resetHoleIds } from '../../../src/core/mining/DrillPlan.js';

beforeEach(() => resetHoleIds());

describe('Sequence', () => {
  it('setDelay stores delays correctly', () => {
    const delays: Record<string, number> = {};
    setDelay(delays, 'H1', 0);
    setDelay(delays, 'H2', 25);
    expect(delays['H1']).toBe(0);
    expect(delays['H2']).toBe(25);
  });

  it('auto V-pattern generates increasing delays from free face', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 3, 4, 3, 8, 0.15);
    const delays = autoVPattern(holes, 25);
    // First row (z=0) should have lowest delays
    const firstRowHoles = holes.filter(h => h.z === 0);
    const lastRowHoles = holes.filter(h => h.z === 6);
    const firstMax = Math.max(...firstRowHoles.map(h => delays[h.id]!));
    const lastMin = Math.min(...lastRowHoles.map(h => delays[h.id]!));
    expect(lastMin).toBeGreaterThan(firstMax);
  });

  it('auto sequence with delay_step:25ms for 3x4 grid has correct timing', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 3, 4, 3, 8, 0.15);
    const delays = autoVPattern(holes, 25);
    // All 12 holes should have delays
    expect(Object.keys(delays).length).toBe(12);
    // All delays should be non-negative
    for (const d of Object.values(delays)) {
      expect(d).toBeGreaterThanOrEqual(0);
    }
    // Max delay should be > 0
    const maxDelay = Math.max(...Object.values(delays));
    expect(maxDelay).toBeGreaterThan(0);
  });
});
