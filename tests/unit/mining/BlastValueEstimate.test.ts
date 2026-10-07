// BlastSimulator2026 — estimateBlastOreValue unit tests

import { describe, it, expect } from 'vitest';
import { estimateBlastOreValue } from '../../../src/core/mining/BlastValueEstimate.js';
import type { BlastPlan } from '../../../src/core/mining/BlastPlan.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import type { SurveyResult } from '../../../src/core/mining/SurveyCalc.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { executeBlast } from '../../../src/core/mining/BlastExecution.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { getOre } from '../../../src/core/world/OreCatalog.js';
import { ORE_DENSITY_KG_M3, BLAST_ESTIMATE_BREAK_RADIUS_M } from '../../../src/core/config/balance.js';

function makeHole(id: string, x: number, z: number, depth = 8): DrillHole {
  return { id, x, z, depth, diameter: 0.15 };
}

function makePlan(holes: DrillHole[]): BlastPlan {
  return { holes, charges: {} };
}

function makeSurvey(
  estimates: Record<string, Record<string, number>>,
  confidence = 1.0,
  completedTick = 10,
): SurveyResult {
  return {
    id: 1,
    method: 'seismic',
    centerX: 10,
    centerZ: 10,
    completedTick,
    surveyorId: 1,
    estimates,
    confidence,
  };
}

/** Survey whose estimates cover every column in [min, max]² with the same ore densities. */
function makeUniformSurvey(
  min: number, max: number, ores: Record<string, number>, confidence = 1.0, completedTick = 10,
): SurveyResult {
  const estimates: Record<string, Record<string, number>> = {};
  for (let x = min; x <= max; x++) {
    for (let z = min; z <= max; z++) estimates[`${x},${z}`] = { ...ores };
  }
  return makeSurvey(estimates, confidence, completedTick);
}

/** Old (pre-#1354) single-column value: depth × 1 m² × density × ORE_DENSITY × $/kg. */
function oldColumnValue(depth: number, density: number, oreId: string): number {
  return depth * 1 * density * ORE_DENSITY_KG_M3 * getOre(oreId)!.valuePerKg;
}

describe('estimateBlastOreValue', () => {
  it('values a single surveyed hole above the old one-column figure (footprint wider than one column)', () => {
    const plan = makePlan([makeHole('H1', 20, 20, 8)]);
    const survey = makeUniformSurvey(0, 40, { blingite: 0.2 });

    expect(estimateBlastOreValue(plan, [survey])).toBeGreaterThan(oldColumnValue(8, 0.2, 'blingite'));
  });

  it('counts only surveyed columns of the footprint', () => {
    const plan = makePlan([makeHole('H1', 20, 20, 8)]);
    const wide = makeUniformSurvey(0, 40, { blingite: 0.2 });
    const narrow = makeSurvey({ '20,20': { blingite: 0.2 } });

    const narrowValue = estimateBlastOreValue(plan, [narrow]);
    expect(narrowValue).toBeGreaterThan(0);
    expect(narrowValue).toBeLessThan(estimateBlastOreValue(plan, [wide]));
  });

  it('grows with hole depth', () => {
    const survey = makeUniformSurvey(0, 40, { blingite: 0.2 });
    const shallow = estimateBlastOreValue(makePlan([makeHole('H1', 20, 20, 4)]), [survey]);
    const deep = estimateBlastOreValue(makePlan([makeHole('H1', 20, 20, 8)]), [survey]);

    expect(deep).toBeGreaterThan(shallow);
  });

  it('scales linearly with survey confidence', () => {
    const plan = makePlan([makeHole('H1', 20, 20, 8)]);
    const full = estimateBlastOreValue(plan, [makeUniformSurvey(0, 40, { blingite: 0.2 }, 1.0)]);
    const half = estimateBlastOreValue(plan, [makeUniformSurvey(0, 40, { blingite: 0.2 }, 0.5)]);

    expect(full).toBeGreaterThan(0);
    expect(half).toBeCloseTo(full * 0.5, 6);
  });

  it('scales linearly with surveyed ore density', () => {
    const plan = makePlan([makeHole('H1', 20, 20, 8)]);
    const lean = estimateBlastOreValue(plan, [makeUniformSurvey(0, 40, { blingite: 0.1 })]);
    const rich = estimateBlastOreValue(plan, [makeUniformSurvey(0, 40, { blingite: 0.2 })]);

    expect(rich).toBeCloseTo(lean * 2, 6);
  });

  it('does not double-count columns shared by two overlapping holes', () => {
    const survey = makeUniformSurvey(0, 40, { blingite: 0.2 });
    const single = estimateBlastOreValue(makePlan([makeHole('H1', 20, 20, 8)]), [survey]);
    const pair = estimateBlastOreValue(
      makePlan([makeHole('H1', 20, 20, 8), makeHole('H2', 21, 20, 8)]), [survey],
    );

    expect(pair).toBeGreaterThan(single);
    expect(pair).toBeLessThan(2 * single);
  });

  it('counts two identical holes the same as one', () => {
    const survey = makeUniformSurvey(0, 40, { blingite: 0.2 });
    const single = estimateBlastOreValue(makePlan([makeHole('H1', 20, 20, 8)]), [survey]);
    const twin = estimateBlastOreValue(
      makePlan([makeHole('H1', 20, 20, 8), makeHole('H2', 20, 20, 8)]), [survey],
    );

    expect(twin).toBeCloseTo(single, 6);
  });

  it('sums holes whose footprints do not overlap to exactly twice the single-hole value', () => {
    const gap = Math.ceil(2 * BLAST_ESTIMATE_BREAK_RADIUS_M) + 4;
    const lo = 10;
    const hi = lo + gap;
    const survey = makeUniformSurvey(0, hi + 20, { blingite: 0.2 });
    const single = estimateBlastOreValue(makePlan([makeHole('H1', lo, lo, 8)]), [survey]);
    const far = estimateBlastOreValue(
      makePlan([makeHole('H1', lo, lo, 8), makeHole('H2', hi, hi, 8)]), [survey],
    );

    expect(single).toBeGreaterThan(0);
    expect(far).toBeCloseTo(2 * single, 6);
  });

  it('is deterministic and does not mutate its inputs', () => {
    const plan = makePlan([makeHole('H1', 20, 20, 8), makeHole('H2', 22, 21, 6)]);
    const survey = makeUniformSurvey(0, 40, { blingite: 0.2 });
    const planBefore = JSON.stringify(plan);
    const surveyBefore = JSON.stringify(survey);

    const a = estimateBlastOreValue(plan, [survey]);
    const b = estimateBlastOreValue(plan, [survey]);

    expect(a).toBe(b);
    expect(JSON.stringify(plan)).toBe(planBefore);
    expect(JSON.stringify(survey)).toBe(surveyBefore);
  });

  it('returns 0 when covered columns hold no ore', () => {
    const plan = makePlan([makeHole('H1', 20, 20, 8)]);

    expect(estimateBlastOreValue(plan, [makeUniformSurvey(0, 40, {})])).toBe(0);
    expect(estimateBlastOreValue(plan, [makeUniformSurvey(0, 40, { blingite: 0 })])).toBe(0);
  });

  it('returns 0 for a hole whose column no survey covers', () => {
    const plan = makePlan([makeHole('H1', 10, 10, 8)]);
    const survey = makeSurvey({ '99,99': { blingite: 0.2 } });

    expect(estimateBlastOreValue(plan, [survey])).toBe(0);
  });

  it('returns 0 when no surveys have been run', () => {
    const plan = makePlan([makeHole('H1', 10, 10, 8)]);

    expect(estimateBlastOreValue(plan, [])).toBe(0);
  });

  it('returns 0 for an empty plan', () => {
    const survey = makeSurvey({ '10,10': { blingite: 0.2 } });

    expect(estimateBlastOreValue(makePlan([]), [survey])).toBe(0);
  });

  it('skips ore IDs the catalog does not recognize instead of throwing', () => {
    const plan = makePlan([makeHole('H1', 10, 10, 8)]);
    const survey = makeUniformSurvey(0, 40, { unobtainium: 0.5 });
    const plan2 = makePlan([makeHole('H1', 20, 20, 8)]);

    expect(() => estimateBlastOreValue(plan, [survey])).not.toThrow();
    expect(estimateBlastOreValue(plan2, [survey])).toBe(0);
  });

  it('uses the most recently completed survey when several cover the same column', () => {
    const plan = makePlan([makeHole('H1', 10, 10, 8)]);
    const older = makeUniformSurvey(0, 40, { blingite: 0.8 }, 1.0, 1);
    const newer = makeUniformSurvey(0, 40, { blingite: 0.2 }, 1.0, 50);
    const newerOnly = estimateBlastOreValue(plan, [newer]);

    expect(newerOnly).toBeGreaterThan(0);
    expect(estimateBlastOreValue(plan, [older, newer])).toBeCloseTo(newerOnly, 6);
    expect(estimateBlastOreValue(plan, [newer, older])).toBeCloseTo(newerOnly, 6);
  });

  it('applies newest-survey-wins per column, not per plan', () => {
    const plan = makePlan([makeHole('H1', 20, 20, 8)]);
    const older = makeUniformSurvey(0, 40, { blingite: 0.8 }, 1.0, 1);
    const newerPatch = makeSurvey({ '20,20': { blingite: 0.2 } }, 1.0, 50);
    const newerAll = makeUniformSurvey(0, 40, { blingite: 0.2 }, 1.0, 50);
    const olderOnly = estimateBlastOreValue(plan, [older]);

    const mixed = estimateBlastOreValue(plan, [older, newerPatch]);
    expect(mixed).toBeLessThan(olderOnly);
    expect(mixed).toBeGreaterThan(estimateBlastOreValue(plan, [newerAll]));
  });
});

describe('estimateBlastOreValue vs executeBlast (seed 42 reference pattern, #1354)', () => {
  it('lands within [0.5x, 2x] of the realised total ore value on a surveyed 3x3 pattern', () => {
    const grid = new VoxelGrid(40, 40);
    const oreId = 'blingite';
    const density = 0.2;
    const estimates: Record<string, Record<string, number>> = {};
    for (let z = 5; z <= 25; z++) {
      for (let y = 0; y <= 10; y++) {
        for (let x = 5; x <= 25; x++) {
          grid.setVoxel(x, y, z, {
            composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] },
            density: 1.0,
            oreDensities: { [oreId]: density },
            fractureModifier: 1.0,
          });
        }
      }
    }
    for (let x = 5; x <= 25; x++) for (let z = 5; z <= 25; z++) estimates[`${x},${z}`] = { [oreId]: density };
    const survey = makeSurvey(estimates, 1.0, 10);

    const counter = { nextHoleId: 1 };
    const holes = createGridPlan(counter, { x: 12, z: 12 }, 3, 3, 4, 8, 0.15);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;
    const { charges } = batchCharge(holes.map(h => h.id), holeDepths, 'krackle', 8, 2);
    const plan = assembleBlastPlan(holes, charges);

    const estimate = estimateBlastOreValue(plan, [survey]);
    const result = executeBlast(plan, grid, []);

    expect(result).not.toBeNull();
    expect(result!.totalOreValue).toBeGreaterThan(0);
    expect(estimate).toBeGreaterThanOrEqual(0.5 * result!.totalOreValue);
    expect(estimate).toBeLessThanOrEqual(2 * result!.totalOreValue);
  });
});

describe('estimateBlastOreValue — stale surveys (#1356)', () => {
  const plan = makePlan([makeHole('H1', 20, 20, 8)]);

  it('returns 0 for columns covered only by a stale survey', () => {
    const stale = { ...makeUniformSurvey(0, 40, { blingite: 0.2 }), stale: true };
    expect(estimateBlastOreValue(plan, [stale])).toBe(0);
  });

  it('the same survey, once fresh, yields a positive value', () => {
    const fresh = makeUniformSurvey(0, 40, { blingite: 0.2 });
    expect(estimateBlastOreValue(plan, [fresh])).toBeGreaterThan(0);
  });

  it('stale:false counts as fresh', () => {
    const survey = { ...makeUniformSurvey(0, 40, { blingite: 0.2 }), stale: false };
    expect(estimateBlastOreValue(plan, [survey])).toBeGreaterThan(0);
  });

  it('falls back to an older fresh survey when the newest covering survey is stale', () => {
    const older = makeUniformSurvey(0, 40, { blingite: 0.2 }, 1.0, 10);
    const newerStale = { ...makeUniformSurvey(0, 40, { blingite: 0.9 }, 1.0, 50), stale: true };
    expect(estimateBlastOreValue(plan, [older, newerStale]))
      .toBeCloseTo(estimateBlastOreValue(plan, [older]), 6);
    expect(estimateBlastOreValue(plan, [newerStale, older]))
      .toBeCloseTo(estimateBlastOreValue(plan, [older]), 6);
  });

  it('a newer fresh survey still wins over an older fresh one', () => {
    const older = makeUniformSurvey(0, 40, { blingite: 0.2 }, 1.0, 10);
    const newer = makeUniformSurvey(0, 40, { blingite: 0.4 }, 1.0, 50);
    expect(estimateBlastOreValue(plan, [older, newer]))
      .toBeCloseTo(estimateBlastOreValue(plan, [newer]), 6);
    expect(estimateBlastOreValue(plan, [newer])).toBeGreaterThan(estimateBlastOreValue(plan, [older]));
  });

  it('stale survey only silences the columns it covers; fresh survey elsewhere still counts', () => {
    const staleHere = { ...makeSurvey({ '20,20': { blingite: 0.5 } }), stale: true };
    const freshElsewhere = makeSurvey({ '21,20': { blingite: 0.2 } });
    const onlyFresh = estimateBlastOreValue(plan, [freshElsewhere]);
    expect(onlyFresh).toBeGreaterThan(0);
    expect(estimateBlastOreValue(plan, [staleHere, freshElsewhere])).toBeCloseTo(onlyFresh, 6);
  });
});
