import { describe, it, expect, beforeEach } from 'vitest';
import { validateBlastPlan, assembleBlastPlan, coveredByFootprint, holePatternSpacing, buildingsInBlastReach, checkProtectedPositions } from '../../../src/core/mining/BlastPlan.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { getBuildingDef } from '../../../src/core/entities/Building.js';
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

// ── #2021: pre-flight warning for buildings inside the blast's reach ─────────

type TestBuilding = Parameters<typeof buildingsInBlastReach>[1][number];

function bld(id: number, type: TestBuilding['type'], x: number, z: number, storedExplosives?: Record<string, number>): TestBuilding {
  return { id, type, tier: 1, x, z, ...(storedExplosives ? { storedExplosives } : {}) };
}

function gridHoles(x0: number, z0: number, n: number, spacing: number): Array<{ id: number; x: number; z: number }> {
  const out: Array<{ id: number; x: number; z: number }> = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push({ id: out.length + 1, x: x0 + i * spacing, z: z0 + j * spacing });
  return out;
}

describe('holePatternSpacing (#2021)', () => {
  it('returns the grid pitch of a spacing-4 grid', () => {
    expect(holePatternSpacing(gridHoles(12, 44, 3, 4))).toBe(4);
  });

  it('returns the grid pitch of a spacing-6 grid', () => {
    expect(holePatternSpacing(gridHoles(10, 10, 3, 6))).toBe(6);
  });

  it('falls back to the default spacing for a single hole', () => {
    expect(holePatternSpacing([{ x: 10, z: 10 }])).toBe(4);
  });

  it('falls back to the default spacing for no holes', () => {
    expect(holePatternSpacing([])).toBe(4);
  });

  it('uses the larger axis pitch when x and z gaps differ', () => {
    const holes = [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 0, z: 5 }, { x: 3, z: 5 }];
    expect(holePatternSpacing(holes)).toBe(5);
  });

  it('uses the one axis that has two distinct values for a single row', () => {
    expect(holePatternSpacing([{ x: 0, z: 7 }, { x: 6, z: 7 }, { x: 12, z: 7 }])).toBe(6);
  });

  it('takes the smallest gap between distinct values, ignoring duplicates', () => {
    const holes = [{ x: 0, z: 0 }, { x: 0, z: 4 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 10, z: 0 }];
    expect(holePatternSpacing(holes)).toBe(4);
  });

  it('tolerates float noise in hole coordinates', () => {
    const holes = [{ x: 0.1 + 0.2, z: 0 }, { x: 0.3 + 4, z: 0 }, { x: 0.3, z: 0 }];
    expect(holePatternSpacing(holes)).toBeCloseTo(4, 6);
  });
});

describe('buildingsInBlastReach (#2021)', () => {
  const holes = gridHoles(12, 44, 3, 4); // x 12/16/20, z 44/48/52

  it('reports the issue layout: office, freight and explosive warehouse, not the quarters', () => {
    const buildings = [
      bld(1, 'living_quarters', 30, 48),
      bld(2, 'explosive_warehouse', 22, 48, { krackle: 228 }),
      bld(3, 'management_office', 14, 48),
      bld(4, 'freight_warehouse', 14, 40),
    ];
    const result = buildingsInBlastReach(holes, buildings);
    expect(result.map(r => r.type)).toEqual(['explosive_warehouse', 'management_office', 'freight_warehouse']);
    expect(result.map(r => r.buildingId)).toEqual([2, 3, 4]);
    expect(result.some(r => r.type === 'living_quarters')).toBe(false);
  });

  it('carries id, type, position and stockKg', () => {
    const result = buildingsInBlastReach(holes, [bld(5, 'management_office', 14, 48)]);
    expect(result).toEqual([{ buildingId: 5, type: 'management_office', x: 14, z: 48, stockKg: 0 }]);
  });

  it('reports the stocked explosive warehouse stock summed over explosives', () => {
    const result = buildingsInBlastReach(holes, [bld(2, 'explosive_warehouse', 22, 48, { krackle: 200, boomite: 28 })]);
    expect(result[0]!.stockKg).toBe(228);
  });

  it('reports 0 stock for an empty explosive warehouse', () => {
    const result = buildingsInBlastReach(holes, [bld(2, 'explosive_warehouse', 22, 48)]);
    expect(result).toHaveLength(1);
    expect(result[0]!.stockKg).toBe(0);
  });

  it('orders results by buildingId regardless of input order', () => {
    const result = buildingsInBlastReach(holes, [
      bld(9, 'freight_warehouse', 14, 40),
      bld(3, 'management_office', 14, 48),
      bld(6, 'explosive_warehouse', 22, 48),
    ]);
    expect(result.map(r => r.buildingId)).toEqual([3, 6, 9]);
  });

  it('returns none for an empty site', () => {
    expect(buildingsInBlastReach(holes, [])).toEqual([]);
  });

  it('returns none when there are no holes', () => {
    expect(buildingsInBlastReach([], [bld(1, 'management_office', 14, 48)])).toEqual([]);
  });

  it('includes a cell exactly at maxX + margin and excludes the next cell out', () => {
    const fp = getBuildingDef('freight_warehouse', 1).footprint;
    const minDx = Math.min(...fp.map(f => f[0]));
    const minDz = Math.min(...fp.map(f => f[1]));
    const zIn = 48 - minDz;
    // bbox x 12..20 grown by explicit margin 4 -> 24 inclusive
    const edgeIn = buildingsInBlastReach(holes, [bld(1, 'freight_warehouse', 24 - minDx, zIn)], 4);
    const edgeOut = buildingsInBlastReach(holes, [bld(1, 'freight_warehouse', 25 - minDx, zIn)], 4);
    expect(edgeIn).toHaveLength(1);
    expect(edgeOut).toEqual([]);
  });

  it('defaults the margin to the hole pattern spacing', () => {
    const fp = getBuildingDef('freight_warehouse', 1).footprint;
    const minDx = Math.min(...fp.map(f => f[0]));
    const minDz = Math.min(...fp.map(f => f[1]));
    const zIn = 48 - minDz;
    expect(buildingsInBlastReach(holes, [bld(1, 'freight_warehouse', 24 - minDx, zIn)])).toHaveLength(1);
    expect(buildingsInBlastReach(holes, [bld(1, 'freight_warehouse', 25 - minDx, zIn)])).toEqual([]);
  });

  it('a wider explicit margin reaches the quarters 10 m away', () => {
    const quarters = bld(1, 'living_quarters', 30, 48);
    expect(buildingsInBlastReach(holes, [quarters])).toEqual([]);
    expect(buildingsInBlastReach(holes, [quarters], 12).map(r => r.type)).toEqual(['living_quarters']);
  });

  it('counts a building whose footprint only partly enters the box', () => {
    const fp = getBuildingDef('management_office', 1).footprint;
    const maxDx = Math.max(...fp.map(f => f[0]));
    // anchor left of the box so only the far cells reach in (needs a multi-cell footprint)
    const x = 8 - maxDx;
    const result = buildingsInBlastReach(holes, [bld(1, 'management_office', x, 48)], 4);
    expect(result).toHaveLength(1);
  });

  it('a building sitting on a hole footprint is reported by checkProtectedPositions AND the reach list', () => {
    const office = bld(1, 'management_office', 12, 44);
    const occupants = [{ type: office.type, tier: office.tier, x: office.x, z: office.z }];
    expect(checkProtectedPositions(holes, occupants).length).toBeGreaterThan(0);
    expect(buildingsInBlastReach(holes, [office]).map(r => r.buildingId)).toEqual([1]);
  });
});
