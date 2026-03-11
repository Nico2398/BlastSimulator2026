import { describe, it, expect, beforeEach } from 'vitest';
import { validateBlastPlan, assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { createGridPlan, resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { autoVPattern } from '../../../src/core/mining/Sequence.js';

beforeEach(() => resetHoleIds());

describe('BlastPlan', () => {
  it('complete plan passes validation', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 2, 2, 3, 8, 0.15);
    const depths = Object.fromEntries(holes.map(h => [h.id, h.depth]));
    const { charges } = batchCharge(holes.map(h => h.id), depths, 'pop_rock', 2, 1.5);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);
    const errors = validateBlastPlan(plan);
    expect(errors.length).toBe(0);
  });

  it('validation fails if a hole is missing a charge', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 2, 2, 3, 8, 0.15);
    const delays = autoVPattern(holes, 25);
    // No charges at all
    const plan = assembleBlastPlan(holes, {}, delays);
    const errors = validateBlastPlan(plan);
    expect(errors.length).toBe(4); // all 4 holes missing charges
    expect(errors[0]!.issue).toContain('charge');
  });

  it('validation fails if a hole is missing a sequence delay', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 2, 2, 3, 8, 0.15);
    const depths = Object.fromEntries(holes.map(h => [h.id, h.depth]));
    const { charges } = batchCharge(holes.map(h => h.id), depths, 'pop_rock', 2, 1.5);
    // No delays
    const plan = assembleBlastPlan(holes, charges, {});
    const errors = validateBlastPlan(plan);
    expect(errors.length).toBe(4); // all 4 holes missing delays
    expect(errors[0]!.issue).toContain('delay');
  });
});
