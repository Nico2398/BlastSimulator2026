import { describe, it, expect, beforeEach } from 'vitest';
import { validateBlastPlan, assembleBlastPlan, coveredByFootprint, holePatternSpacing, buildingsInBlastReach, holeBlastReachM, checkProtectedPositions } from '../../../src/core/mining/BlastPlan.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { getBuildingDef } from '../../../src/core/entities/Building.js';
import { batchCharge, type HoleCharge } from '../../../src/core/mining/ChargePlan.js';
import { computeInitialEnergy } from '../../../src/core/mining/BlastCalc.js';
import { BLAST_REACH_M_PER_SQRT_ENERGY } from '../../../src/core/config/balance.js';

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

function gridHoles(x0: number, z0: number, n: number, spacing: number): Array<{ id: string; x: number; z: number; depth: number }> {
  const out: Array<{ id: string; x: number; z: number; depth: number }> = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push({ id: `h${out.length + 1}`, x: x0 + i * spacing, z: z0 + j * spacing, depth: 8 });
  return out;
}

/** Stemming of 30% of an 8 m hole: full stemming efficiency, so energy = energyPerKg * kg. */
const FULL_STEMMING_M = 2.4;

function chargeAll(holes: ReadonlyArray<{ id: string }>, explosiveId: string, amountKg: number, stemmingM = FULL_STEMMING_M): Record<string, HoleCharge> {
  const out: Record<string, HoleCharge> = {};
  for (const h of holes) out[h.id] = { explosiveId, amountKg, stemmingM };
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
  const strong = chargeAll(holes, 'dynatomics', 11); // reach ~5.4 m
  const none: Record<string, HoleCharge> = {};

  it('reports the issue layout: office, freight and explosive warehouse, not the quarters', () => {
    const buildings = [
      bld(1, 'living_quarters', 30, 48),
      bld(2, 'explosive_warehouse', 22, 48, { krackle: 228 }),
      bld(3, 'management_office', 14, 48),
      bld(4, 'freight_warehouse', 14, 40),
    ];
    const result = buildingsInBlastReach(holes, strong, buildings);
    expect(result.map(r => r.type)).toEqual(['explosive_warehouse', 'management_office', 'freight_warehouse']);
    expect(result.map(r => r.buildingId)).toEqual([2, 3, 4]);
    expect(result.some(r => r.type === 'living_quarters')).toBe(false);
  });

  it('carries id, type, position and stockKg', () => {
    const result = buildingsInBlastReach(holes, strong, [bld(5, 'management_office', 14, 48)]);
    expect(result).toEqual([{ buildingId: 5, type: 'management_office', x: 14, z: 48, stockKg: 0 }]);
  });

  it('reports the stocked explosive warehouse stock summed over explosives', () => {
    const result = buildingsInBlastReach(holes, strong, [bld(2, 'explosive_warehouse', 22, 48, { krackle: 200, boomite: 28 })]);
    expect(result[0]!.stockKg).toBe(228);
  });

  it('reports 0 stock for an empty explosive warehouse', () => {
    const result = buildingsInBlastReach(holes, strong, [bld(2, 'explosive_warehouse', 22, 48)]);
    expect(result).toHaveLength(1);
    expect(result[0]!.stockKg).toBe(0);
  });

  it('orders results by buildingId regardless of input order', () => {
    const result = buildingsInBlastReach(holes, strong, [
      bld(9, 'freight_warehouse', 14, 40),
      bld(3, 'management_office', 14, 48),
      bld(6, 'explosive_warehouse', 22, 48),
    ]);
    expect(result.map(r => r.buildingId)).toEqual([3, 6, 9]);
  });

  it('returns none for an empty site', () => {
    expect(buildingsInBlastReach(holes, strong, [])).toEqual([]);
  });

  it('returns none when there are no holes', () => {
    expect(buildingsInBlastReach([], {}, [bld(1, 'management_office', 14, 48)])).toEqual([]);
  });

  it('includes a cell exactly at maxX + margin and excludes the next cell out', () => {
    const fp = getBuildingDef('freight_warehouse', 1).footprint;
    const minDx = Math.min(...fp.map(f => f[0]));
    const minDz = Math.min(...fp.map(f => f[1]));
    const zIn = 48 - minDz;
    // bbox x 12..20 grown by explicit margin 4 -> 24 inclusive
    const edgeIn = buildingsInBlastReach(holes, none, [bld(1, 'freight_warehouse', 24 - minDx, zIn)], 4);
    const edgeOut = buildingsInBlastReach(holes, none, [bld(1, 'freight_warehouse', 25 - minDx, zIn)], 4);
    expect(edgeIn).toHaveLength(1);
    expect(edgeOut).toEqual([]);
  });

  it('an explicit margin overrides the charge-derived reach, in both directions', () => {
    const office = bld(1, 'management_office', 24, 48); // nearest cell 4 m from the bbox edge
    expect(buildingsInBlastReach(holes, strong, [office])).toHaveLength(1);
    expect(buildingsInBlastReach(holes, strong, [office], 3)).toEqual([]);
    const weak = chargeAll(holes, 'krackle', 8);
    expect(buildingsInBlastReach(holes, weak, [office])).toEqual([]);
    expect(buildingsInBlastReach(holes, weak, [office], 4)).toHaveLength(1);
  });

  it('a wider explicit margin reaches the quarters 10 m away', () => {
    const quarters = bld(1, 'living_quarters', 30, 48);
    expect(buildingsInBlastReach(holes, strong, [quarters])).toEqual([]);
    expect(buildingsInBlastReach(holes, strong, [quarters], 12).map(r => r.type)).toEqual(['living_quarters']);
  });

  it('counts a building whose footprint only partly enters the box', () => {
    const fp = getBuildingDef('management_office', 1).footprint;
    const maxDx = Math.max(...fp.map(f => f[0]));
    // anchor left of the box so only the far cells reach in (needs a multi-cell footprint)
    const x = 8 - maxDx;
    const result = buildingsInBlastReach(holes, none, [bld(1, 'management_office', x, 48)], 4);
    expect(result).toHaveLength(1);
  });

  it('a building sitting on a hole footprint is reported by checkProtectedPositions AND the reach list', () => {
    const office = bld(1, 'management_office', 12, 44);
    const occupants = [{ type: office.type, tier: office.tier, x: office.x, z: office.z }];
    expect(checkProtectedPositions(holes, occupants).length).toBeGreaterThan(0);
    expect(buildingsInBlastReach(holes, none, [office]).map(r => r.buildingId)).toEqual([1]);
  });
});

// ── #2030: the warning reach follows the charge ──────────────────────────────

describe('holeBlastReachM (#2030)', () => {
  const krackle = (kg: number): HoleCharge => ({ explosiveId: 'krackle', amountKg: kg, stemmingM: FULL_STEMMING_M });

  it('equals the scale constant times sqrt of the initial energy', () => {
    const c = krackle(8);
    expect(holeBlastReachM(c, 8)).toBeCloseTo(BLAST_REACH_M_PER_SQRT_ENERGY * Math.sqrt(computeInitialEnergy(c, 8)), 9);
    expect(holeBlastReachM(c, 8)).toBeGreaterThan(0);
  });

  it('grows with the kilograms loaded', () => {
    const reaches = [2, 4, 8, 11].map(kg => holeBlastReachM(krackle(kg), 8));
    for (let i = 1; i < reaches.length; i++) expect(reaches[i]!).toBeGreaterThan(reaches[i - 1]!);
  });

  it('grows with the explosive energy at equal kg', () => {
    const ids = ['pop_rock', 'boomite', 'krackle', 'shatternite', 'dynatomics'];
    const reaches = ids.map(id => holeBlastReachM({ explosiveId: id, amountKg: 8, stemmingM: FULL_STEMMING_M }, 8));
    for (let i = 1; i < reaches.length; i++) expect(reaches[i]!).toBeGreaterThan(reaches[i - 1]!);
  });

  it('shrinks when stemming is poor, matching computeInitialEnergy', () => {
    const tight = holeBlastReachM(krackle(8), 8);
    const loose = holeBlastReachM({ ...krackle(8), stemmingM: 0.5 }, 8);
    expect(loose).toBeLessThan(tight);
    expect(loose).toBeCloseTo(BLAST_REACH_M_PER_SQRT_ENERGY * Math.sqrt(computeInitialEnergy({ ...krackle(8), stemmingM: 0.5 }, 8)), 9);
  });

  it('is 0 for an undefined charge', () => {
    expect(holeBlastReachM(undefined, 8)).toBe(0);
  });

  it('is 0 for an unknown explosive', () => {
    expect(holeBlastReachM({ explosiveId: 'no_such_explosive', amountKg: 8, stemmingM: 2 }, 8)).toBe(0);
  });

  it('is 0 for zero kg', () => {
    expect(holeBlastReachM(krackle(0), 8)).toBe(0);
  });
});

describe('buildingsInBlastReach follows the charge (#2030)', () => {
  // holes x 36/40/44, z 32/36/40, 8 m deep; an office is 2x2 anchored at its min corner
  const holes = gridHoles(36, 32, 3, 4);
  const eastOffice = (d: number) => bld(1, 'management_office', 44 + d, 36);
  const southOffice = (d: number) => bld(1, 'management_office', 40, 40 + d);
  const flagged = (explosive: string, kg: number, office: TestBuilding) =>
    buildingsInBlastReach(holes, chargeAll(holes, explosive, kg), [office]).length === 1;

  it('Krackle 8 kg flags an office 1 m and 2 m east', () => {
    expect(flagged('krackle', 8, eastOffice(1))).toBe(true);
    expect(flagged('krackle', 8, eastOffice(2))).toBe(true);
  });

  it('Krackle 8 kg does not flag an office 3 m, 4 m or 5 m east', () => {
    for (const d of [3, 4, 5]) expect(flagged('krackle', 8, eastOffice(d))).toBe(false);
  });

  it('Krackle 8 kg matches on the south side', () => {
    expect(flagged('krackle', 8, southOffice(2))).toBe(true);
    expect(flagged('krackle', 8, southOffice(3))).toBe(false);
    expect(flagged('krackle', 8, southOffice(4))).toBe(false);
  });

  it('Shatternite 11 kg flags an office 3 m out but not 4 m or 5 m', () => {
    expect(flagged('shatternite', 11, eastOffice(2))).toBe(true);
    expect(flagged('shatternite', 11, eastOffice(3))).toBe(true);
    expect(flagged('shatternite', 11, eastOffice(4))).toBe(false);
    expect(flagged('shatternite', 11, eastOffice(5))).toBe(false);
  });

  it('Dynatomics 11 kg flags an office 2 to 5 m out but not 6 m', () => {
    for (const d of [2, 3, 4, 5]) expect(flagged('dynatomics', 11, eastOffice(d))).toBe(true);
    expect(flagged('dynatomics', 11, eastOffice(6))).toBe(false);
  });

  it('Dynatomics 11 kg flags an office 5 m south', () => {
    expect(flagged('dynatomics', 11, southOffice(5))).toBe(true);
  });

  it('reach scales with the charge: the same office is flagged by a stronger charge only', () => {
    const office = eastOffice(3);
    expect(flagged('krackle', 8, office)).toBe(false);
    expect(flagged('shatternite', 11, office)).toBe(true);
  });

  it('uncharged holes have zero reach: only buildings on the pattern box are flagged', () => {
    expect(buildingsInBlastReach(holes, {}, [eastOffice(1)])).toEqual([]);
    expect(buildingsInBlastReach(holes, {}, [bld(1, 'management_office', 40, 36)]).map(r => r.buildingId)).toEqual([1]);
  });

  it('the margin is the maximum over holes: one strong charged hole widens the whole box', () => {
    const charges: Record<string, HoleCharge> = {
      [holes[0]!.id]: { explosiveId: 'dynatomics', amountKg: 11, stemmingM: FULL_STEMMING_M },
      [holes[1]!.id]: { explosiveId: 'krackle', amountKg: 2, stemmingM: FULL_STEMMING_M },
    };
    expect(buildingsInBlastReach(holes, charges, [eastOffice(5)])).toHaveLength(1);
    expect(buildingsInBlastReach(holes, charges, [eastOffice(6)])).toEqual([]);
  });

  it('a weak charge on every hole does not shrink below the strong one', () => {
    const charges = chargeAll(holes, 'krackle', 8);
    charges[holes[8]!.id] = { explosiveId: 'dynatomics', amountKg: 11, stemmingM: FULL_STEMMING_M };
    expect(buildingsInBlastReach(holes, charges, [eastOffice(5)])).toHaveLength(1);
  });

  it('flags nothing on an empty site', () => {
    expect(buildingsInBlastReach(holes, chargeAll(holes, 'dynatomics', 11), [])).toEqual([]);
  });

  it('returns [] when there are no holes, whatever the charges', () => {
    expect(buildingsInBlastReach([], chargeAll(holes, 'dynatomics', 11), [eastOffice(1)])).toEqual([]);
  });

  it('reproduces #2021: warehouse, office and freight warehouse flagged, quarters not, sorted, stock kept', () => {
    const repro = gridHoles(12, 44, 3, 4);
    const charges = chargeAll(repro, 'dynatomics', 11);
    const result = buildingsInBlastReach(repro, charges, [
      bld(4, 'freight_warehouse', 14, 40),
      bld(1, 'living_quarters', 30, 48),
      bld(3, 'management_office', 14, 48),
      bld(2, 'explosive_warehouse', 22, 48, { krackle: 200, boomite: 28 }),
    ]);
    expect(result.map(r => r.buildingId)).toEqual([2, 3, 4]);
    expect(result.map(r => r.type)).toEqual(['explosive_warehouse', 'management_office', 'freight_warehouse']);
    expect(result[0]!.stockKg).toBe(228);
    expect(result[1]!.stockKg).toBe(0);
  });

  it('an explicit marginM still overrides the charge-derived reach', () => {
    const charges = chargeAll(holes, 'krackle', 8);
    expect(buildingsInBlastReach(holes, charges, [eastOffice(5)], 5)).toHaveLength(1);
    expect(buildingsInBlastReach(holes, chargeAll(holes, 'dynatomics', 11), [eastOffice(2)], 1)).toEqual([]);
  });
});
