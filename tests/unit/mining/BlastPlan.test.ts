import { describe, it, expect, beforeEach } from 'vitest';
import { validateBlastPlan, assembleBlastPlan, coveredByFootprint } from '../../../src/core/mining/BlastPlan.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';

const holeCounter = { nextHoleId: 1 };

beforeEach(() => { holeCounter.nextHoleId = 1; });

describe('BlastPlan', () => {
  it('complete plan passes validation', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 2, 2, 3, 8, 0.15);
    const depths = Object.fromEntries(holes.map(h => [h.id, h.depth]));
    const { charges } = batchCharge(holes.map(h => h.id), depths, 'pop_rock', 2, 1.5);
    const plan = assembleBlastPlan(holes, charges);
    const errors = validateBlastPlan(plan);
    expect(errors.length).toBe(0);
  });

  // #633: .issue must carry a translation key, not English prose, so that
  // display sites (blastFooter.ts, console/commands/mining.ts) can resolve
  // it through t() at the point of display rather than baking English into
  // the model layer.
  it('validation fails if a hole is missing a charge', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 2, 2, 3, 8, 0.15);
    // No charges at all
    const plan = assembleBlastPlan(holes, {});
    const errors = validateBlastPlan(plan);
    expect(errors.length).toBe(4); // all 4 holes missing charges
    expect(errors[0]!.issue).toBe('blast.validation.missing_charge');
  });

  it('a fully charged plan with no delays validates clean', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 2, 2, 3, 8, 0.15);
    const depths = Object.fromEntries(holes.map(h => [h.id, h.depth]));
    const { charges } = batchCharge(holes.map(h => h.id), depths, 'pop_rock', 2, 1.5);
    const plan = assembleBlastPlan(holes, charges);
    expect(validateBlastPlan(plan)).toEqual([]);
  });

  it('assembleBlastPlan returns exactly holes and charges (no delays field)', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 1, 2, 3, 8, 0.15);
    const plan = assembleBlastPlan(holes, {});
    expect(Object.keys(plan).sort()).toEqual(['charges', 'holes']);
  });

  it('a plan only produces charge errors (missing or loading), never a delay error', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 2, 2, 3, 8, 0.15);
    const errors = validateBlastPlan(assembleBlastPlan(holes, {}), new Set([holes[0]!.id]));
    expect(errors.map(e => e.issue).every(i => i === 'blast.validation.missing_charge' || i === 'blast.validation.charge_loading')).toBe(true);
    expect(errors.some(e => e.issue === 'blast.validation.missing_delay')).toBe(false);
  });

  it('a hole whose charge order is outstanding (loading) gets a distinct key from a hole with no charge order at all', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 1, 1, 3, 8, 0.15);
    const plan = assembleBlastPlan(holes, {});
    const loadingHoleIds = new Set([holes[0]!.id]);

    const errors = validateBlastPlan(plan, loadingHoleIds);

    const chargeError = errors.find(e => e.holeId === holes[0]!.id);
    expect(chargeError).toBeDefined();
    expect(chargeError!.issue).toBe('blast.validation.charge_loading');
    expect(chargeError!.issue).not.toBe('blast.validation.missing_charge');
  });
});

describe('coveredByFootprint', () => {
  const cells = [{ id: 'a', x: 0.5, z: 0.5 }, { id: 'b', x: 50, z: 50 }];

  it('returns an empty set when there are no occupants', () => {
    expect(coveredByFootprint(cells, []).size).toBe(0);
  });

  it('returns only ids of cells under an occupant footprint', () => {
    const covered = coveredByFootprint(cells, [{ type: 'management_office', tier: 1, x: 0, z: 0 }]);
    expect([...covered]).toEqual(['a']);
  });
});

describe('validateBlastPlan delivery wait (#1966)', () => {
  const AWAIT = 'blast.validation.charge_awaiting_delivery';

  it('a hole whose explosives are in transit gets the awaiting key with its arrival tick', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 1, 1, 3, 8, 0.15);
    const id = holes[0]!.id;
    const errors = validateBlastPlan(assembleBlastPlan(holes, {}), new Set([id]), new Map([[id, 680]]));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.holeId).toBe(id);
    expect(errors[0]!.issue).toBe(AWAIT);
    expect(errors[0]!.arrivalTick).toBe(680);
  });

  it('the delivery wait wins over charge_loading when a hole is in both sets', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 1, 1, 3, 8, 0.15);
    const id = holes[0]!.id;
    const errors = validateBlastPlan(assembleBlastPlan(holes, {}), new Set([id]), new Map([[id, 10]]));
    expect(errors[0]!.issue).toBe(AWAIT);
  });

  it('a delivery-map hole outside the loading set is still awaiting delivery', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 1, 1, 3, 8, 0.15);
    const id = holes[0]!.id;
    const errors = validateBlastPlan(assembleBlastPlan(holes, {}), undefined, new Map([[id, 10]]));
    expect(errors[0]!.issue).toBe(AWAIT);
  });

  it('a really loading hole (not in the delivery map) keeps charge_loading and has no arrivalTick', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 2, 1, 3, 8, 0.15);
    const [a, b] = [holes[0]!.id, holes[1]!.id];
    const errors = validateBlastPlan(assembleBlastPlan(holes, {}), new Set([a, b]), new Map([[b, 99]]));
    const ea = errors.find(e => e.holeId === a)!;
    const eb = errors.find(e => e.holeId === b)!;
    expect(ea.issue).toBe('blast.validation.charge_loading');
    expect(ea.arrivalTick).toBeUndefined();
    expect(eb.issue).toBe(AWAIT);
  });

  it('a hole in neither set stays missing_charge', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 2, 1, 3, 8, 0.15);
    const errors = validateBlastPlan(assembleBlastPlan(holes, {}), new Set(), new Map([[holes[0]!.id, 5]]));
    expect(errors.find(e => e.holeId === holes[1]!.id)!.issue).toBe('blast.validation.missing_charge');
  });

  it('a charged hole is never flagged, even if the delivery map names it', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 2, 2, 3, 8, 0.15);
    const depths = Object.fromEntries(holes.map(h => [h.id, h.depth]));
    const { charges } = batchCharge(holes.map(h => h.id), depths, 'pop_rock', 2, 1.5);
    const plan = assembleBlastPlan(holes, charges);
    expect(validateBlastPlan(plan, new Set(), new Map(holes.map(h => [h.id, 700] as [string, number])))).toEqual([]);
  });

  it('two-argument calls behave as before', () => {
    const holes = createGridPlan(holeCounter, { x: 0, z: 0 }, 1, 1, 3, 8, 0.15);
    const errors = validateBlastPlan(assembleBlastPlan(holes, {}), new Set([holes[0]!.id]));
    expect(errors[0]!.issue).toBe('blast.validation.charge_loading');
  });
});
