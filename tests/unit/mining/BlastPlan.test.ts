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

  // #633: .issue must carry a translation key, not English prose, so that
  // display sites (blastFooter.ts, console/commands/mining.ts) can resolve
  // it through t() at the point of display rather than baking English into
  // the model layer.
  it('validation fails if a hole is missing a charge', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 2, 2, 3, 8, 0.15);
    const delays = autoVPattern(holes, 25);
    // No charges at all
    const plan = assembleBlastPlan(holes, {}, delays);
    const errors = validateBlastPlan(plan);
    expect(errors.length).toBe(4); // all 4 holes missing charges
    expect(errors[0]!.issue).toBe('blast.validation.missing_charge');
  });

  it('validation fails if a hole is missing a sequence delay', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 2, 2, 3, 8, 0.15);
    const depths = Object.fromEntries(holes.map(h => [h.id, h.depth]));
    const { charges } = batchCharge(holes.map(h => h.id), depths, 'pop_rock', 2, 1.5);
    // No delays
    const plan = assembleBlastPlan(holes, charges, {});
    const errors = validateBlastPlan(plan);
    expect(errors.length).toBe(4); // all 4 holes missing delays
    expect(errors[0]!.issue).toBe('blast.validation.missing_delay');
  });

  it('a hole whose charge order is outstanding (loading) gets a distinct key from a hole with no charge order at all', () => {
    const holes = createGridPlan({ x: 0, z: 0 }, 1, 1, 3, 8, 0.15);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, {}, delays);
    const loadingHoleIds = new Set([holes[0]!.id]);

    const errors = validateBlastPlan(plan, loadingHoleIds);

    const chargeError = errors.find(e => e.holeId === holes[0]!.id);
    expect(chargeError).toBeDefined();
    expect(chargeError!.issue).toBe('blast.validation.charge_loading');
    expect(chargeError!.issue).not.toBe('blast.validation.missing_charge');
  });
});
