// BlastSimulator2026 — estimateBlastOreValue unit tests (#1703)
//
// The estimate values the voxels the plan's own energy field breaks, each from the
// survey's reading at that voxel's depth. It never reads the grid's real ore.

import { describe, it, expect, vi } from 'vitest';
import { estimateBlastOreValue } from '../../../src/core/mining/BlastValueEstimate.js';
import type { BlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import type { SurveyResult, SurveyMethod } from '../../../src/core/mining/SurveyCalc.js';
import type { SurveyDepthBand } from '../../../src/core/mining/SurveyDepthProfile.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { buildPlanEnergyField } from '../../../src/core/mining/BlastExecution.js';
import { identifyFragmentedVoxels, isFragmented } from '../../../src/core/mining/VoxelFragmentation.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { getOre } from '../../../src/core/world/OreCatalog.js';
import { ORE_DENSITY_KG_M3, SURVEY_DEPTH_BELOW_SURFACE } from '../../../src/core/config/balance.js';

const SURFACE_Y = 24;
const LO = 6;
const HI = 34;

function makeGrid(oreDensities: Record<string, number> = { blingite: 0.9 }): VoxelGrid {
  const grid = new VoxelGrid(40, 40);
  for (let z = LO; z <= HI; z++) {
    for (let y = 0; y <= SURFACE_Y; y++) {
      for (let x = LO; x <= HI; x++) {
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] },
          density: 1.0,
          oreDensities: { ...oreDensities },
          fractureModifier: 1.0,
        });
      }
    }
  }
  return grid;
}

function makeHole(id: string, x: number, z: number, depth = 8): DrillHole {
  return { id, x, z, depth, diameter: 0.15 };
}

function chargedPlan(holes: DrillHole[], kg = 8): BlastPlan {
  const depths: Record<string, number> = {};
  for (const h of holes) depths[h.id] = h.depth;
  const { charges } = batchCharge(holes.map(h => h.id), depths, 'krackle', kg, 2);
  return assembleBlastPlan(holes, charges);
}

const HOLE = makeHole('H1', 20, 20, 8);
const PLAN = chargedPlan([HOLE]);
const PRICE = getOre('blingite')!.valuePerKg;

interface SurveyOpts {
  method?: SurveyMethod;
  confidence?: number;
  completedTick?: number;
  id?: number;
  /** Bands applied to every column; omit for a legacy / aerial survey with no profile. */
  bands?: SurveyDepthBand[] | null;
  surfaceY?: number | null;
  density?: number;
  min?: number;
  max?: number;
}

function makeSurvey(opts: SurveyOpts = {}): SurveyResult {
  const {
    method = 'seismic', confidence = 1.0, completedTick = 10, id = 1,
    bands = [{ fromM: 0, toM: 25, ores: { blingite: 0.2 } }],
    surfaceY = SURFACE_Y, density = 0.2, min = 0, max = 39,
  } = opts;
  const estimates: Record<string, Record<string, number>> = {};
  const depthProfile: Record<string, SurveyDepthBand[]> = {};
  const surfaceYs: Record<string, number> = {};
  for (let x = min; x <= max; x++) {
    for (let z = min; z <= max; z++) {
      const key = `${x},${z}`;
      estimates[key] = { blingite: density };
      if (bands) depthProfile[key] = bands.map(b => ({ ...b, ores: { ...b.ores } }));
      if (surfaceY !== null) surfaceYs[key] = surfaceY;
    }
  }
  const survey: SurveyResult = { id, method, centerX: 20, centerZ: 20, completedTick, surveyorId: 1, estimates, confidence };
  if (bands) survey.depthProfile = depthProfile;
  if (surfaceY !== null) survey.surfaceYs = surfaceYs;
  return survey;
}

/** Independent re-derivation: sum over the voxels the plan's own field breaks. */
function expectedValue(
  plan: BlastPlan,
  grid: VoxelGrid,
  densityAt: (x: number, z: number, y: number) => number,
  confidence = 1.0,
  wet: ReadonlySet<string> = new Set(),
): number {
  const field = buildPlanEnergyField(plan, grid, wet);
  if (!field) return 0;
  const frag = identifyFragmentedVoxels(field, grid);
  let value = 0;
  const { box } = field;
  for (let z = box.minZ; z < box.maxZ; z++) {
    for (let y = box.minY; y < box.maxY; y++) {
      for (let x = box.minX; x < box.maxX; x++) {
        if (!isFragmented(frag, field, x, y, z)) continue;
        value += 1 * densityAt(x, z, y) * ORE_DENSITY_KG_M3 * PRICE * confidence;
      }
    }
  }
  return value;
}

const byDepth = (bands: SurveyDepthBand[]) => (_x: number, _z: number, y: number): number => {
  const depth = SURFACE_Y - y;
  return bands.find(b => depth >= b.fromM && depth < b.toM)?.ores['blingite'] ?? 0;
};

describe('estimateBlastOreValue — broken voxels valued at their depth (#1703)', () => {
  it('equals the sum over the voxels the plan\'s own energy field breaks', () => {
    const grid = makeGrid();
    const bands = [{ fromM: 0, toM: 25, ores: { blingite: 0.2 } }];
    const expected = expectedValue(PLAN, grid, byDepth(bands));

    expect(expected).toBeGreaterThan(0);
    expect(estimateBlastOreValue(PLAN, [makeSurvey({ bands })], grid)).toBeCloseTo(expected, 4);
  });

  it('values a 3x3 pattern from the broken volume, not a fixed footprint', () => {
    const grid = makeGrid();
    const holes: DrillHole[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) holes.push(makeHole(`H${r}${c}`, 16 + 4 * c, 16 + 4 * r));
    const plan = chargedPlan(holes);
    const bands = [{ fromM: 0, toM: 25, ores: { blingite: 0.2 } }];

    expect(estimateBlastOreValue(plan, [makeSurvey({ bands })], grid))
      .toBeCloseTo(expectedValue(plan, grid, byDepth(bands)), 4);
  });

  it('ore surveyed below the broken depth adds nothing', () => {
    const grid = makeGrid();
    const shallowOnly = makeSurvey({ bands: [{ fromM: 0, toM: 5, ores: { blingite: 0.2 } }] });
    const deepOnly = makeSurvey({ bands: [{ fromM: 20, toM: 25, ores: { blingite: 0.9 } }] });

    expect(estimateBlastOreValue(PLAN, [shallowOnly], grid)).toBeGreaterThan(0);
    expect(estimateBlastOreValue(PLAN, [deepOnly], grid)).toBe(0);
  });

  it('adding deep ore to the survey leaves the estimate unchanged', () => {
    const grid = makeGrid();
    const shallow = [{ fromM: 0, toM: 5, ores: { blingite: 0.2 } }];
    const base = estimateBlastOreValue(PLAN, [makeSurvey({ bands: shallow })], grid);
    const withDeep = estimateBlastOreValue(PLAN, [makeSurvey({
      bands: [...shallow, { fromM: 20, toM: 25, ores: { blingite: 0.9 } }],
    })], grid);

    expect(withDeep).toBeCloseTo(base, 6);
  });

  it('ore inside the broken depth is not diluted by the rest of the window', () => {
    const grid = makeGrid();
    const rich = [{ fromM: 0, toM: 3, ores: { blingite: 0.6 } }];
    // Same shallow band, but the window-wide column average the old estimate used would be tiny.
    const diluted = makeSurvey({ bands: rich, density: 0.02 });
    const undiluted = makeSurvey({ bands: rich, density: 0.6 });

    const a = estimateBlastOreValue(PLAN, [diluted], grid);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeCloseTo(estimateBlastOreValue(PLAN, [undiluted], grid), 6);
    expect(a).toBeCloseTo(expectedValue(PLAN, grid, byDepth(rich)), 4);
  });

  it('depth bands with different densities value each broken voxel at its own depth', () => {
    const grid = makeGrid();
    const bands = [
      { fromM: 0, toM: 2, ores: { blingite: 0.1 } },
      { fromM: 2, toM: 5, ores: { blingite: 0.5 } },
      { fromM: 5, toM: 25, ores: { blingite: 0.3 } },
    ];

    expect(estimateBlastOreValue(PLAN, [makeSurvey({ bands })], grid))
      .toBeCloseTo(expectedValue(PLAN, grid, byDepth(bands)), 4);
  });

  it('a depth gap between bands is scanned rock without ore, worth nothing', () => {
    const grid = makeGrid();
    const bands = [{ fromM: 0, toM: 2, ores: { blingite: 0.4 } }, { fromM: 6, toM: 8, ores: { blingite: 0.4 } }];

    expect(estimateBlastOreValue(PLAN, [makeSurvey({ bands })], grid))
      .toBeCloseTo(expectedValue(PLAN, grid, byDepth(bands)), 4);
  });

  it('scales linearly with survey confidence', () => {
    const grid = makeGrid();
    const full = estimateBlastOreValue(PLAN, [makeSurvey({ confidence: 1.0 })], grid);
    const half = estimateBlastOreValue(PLAN, [makeSurvey({ confidence: 0.5 })], grid);

    expect(full).toBeGreaterThan(0);
    expect(half).toBeCloseTo(full * 0.5, 6);
  });

  it('scales linearly with surveyed ore density', () => {
    const grid = makeGrid();
    const lean = estimateBlastOreValue(PLAN, [makeSurvey({ bands: [{ fromM: 0, toM: 25, ores: { blingite: 0.1 } }] })], grid);
    const rich = estimateBlastOreValue(PLAN, [makeSurvey({ bands: [{ fromM: 0, toM: 25, ores: { blingite: 0.2 } }] })], grid);

    expect(lean).toBeGreaterThan(0);
    expect(rich).toBeCloseTo(lean * 2, 6);
  });

  it('grows with the charge: a bigger blast breaks more rock', () => {
    const grid = makeGrid();
    const survey = makeSurvey();
    const small = estimateBlastOreValue(chargedPlan([HOLE], 2), [survey], grid);
    const large = estimateBlastOreValue(chargedPlan([HOLE], 12), [survey], grid);

    expect(large).toBeGreaterThan(small);
  });

  it('ignores ore ids the catalog does not recognise', () => {
    const grid = makeGrid();
    const survey = makeSurvey({ bands: [{ fromM: 0, toM: 25, ores: { unobtainium: 0.5 } }] });

    expect(() => estimateBlastOreValue(PLAN, [survey], grid)).not.toThrow();
    expect(estimateBlastOreValue(PLAN, [survey], grid)).toBe(0);
  });

  it('is deterministic and mutates nothing', () => {
    const grid = makeGrid();
    const survey = makeSurvey();
    const planBefore = JSON.stringify(PLAN);
    const surveyBefore = JSON.stringify(survey);

    const a = estimateBlastOreValue(PLAN, [survey], grid);
    const b = estimateBlastOreValue(PLAN, [survey], grid);

    expect(a).toBe(b);
    expect(JSON.stringify(PLAN)).toBe(planBefore);
    expect(JSON.stringify(survey)).toBe(surveyBefore);
    expect(grid.densityAt(20, SURFACE_Y, 20)).toBe(1.0);
  });
});

describe('estimateBlastOreValue — zero cases', () => {
  it('returns 0 when no surveys exist', () => {
    expect(estimateBlastOreValue(PLAN, [], makeGrid())).toBe(0);
  });

  it('returns 0 for an empty plan', () => {
    expect(estimateBlastOreValue(assembleBlastPlan([], {}), [makeSurvey()], makeGrid())).toBe(0);
  });

  it('returns 0 for holes with no charge (nothing breaks)', () => {
    expect(estimateBlastOreValue({ holes: [HOLE], charges: {} }, [makeSurvey()], makeGrid())).toBe(0);
  });

  it('returns 0 when the surveyed band holds no ore', () => {
    const survey = makeSurvey({ bands: [{ fromM: 0, toM: 25, ores: {} }], density: 0 });
    expect(estimateBlastOreValue(PLAN, [survey], makeGrid())).toBe(0);
  });

  it('returns 0 when no survey covers the blast columns', () => {
    const survey = makeSurvey({ min: 0, max: 3 });
    expect(estimateBlastOreValue(PLAN, [survey], makeGrid())).toBe(0);
  });

  it('counts only the covered columns when the survey covers part of the broken volume', () => {
    const grid = makeGrid();
    const part = estimateBlastOreValue(PLAN, [makeSurvey({ min: 20, max: 39 })], grid);
    const all = estimateBlastOreValue(PLAN, [makeSurvey()], grid);

    expect(part).toBeGreaterThan(0);
    expect(part).toBeLessThan(all);
  });
});

describe('estimateBlastOreValue — aerial surveys cover the top 2 m only (#1703)', () => {
  const window = SURVEY_DEPTH_BELOW_SURFACE.aerial;
  // Aerial anchors on the first empty layer above ground, so its depth 0 is that air layer.
  const AERIAL_ANCHOR = SURFACE_Y + 1;

  function aerial(opts: SurveyOpts = {}): SurveyResult {
    return makeSurvey({ method: 'aerial', bands: null, surfaceY: AERIAL_ANCHOR, density: 0.3, ...opts });
  }

  it('values only broken voxels shallower than the aerial window', () => {
    const grid = makeGrid();
    const expected = expectedValue(PLAN, grid, (_x, _z, y) => (AERIAL_ANCHOR - y < window ? 0.3 : 0));

    expect(expected).toBeGreaterThan(0);
    expect(estimateBlastOreValue(PLAN, [aerial()], grid)).toBeCloseTo(expected, 4);
  });

  it('is worth less than the same density read over the whole window by a seismic survey', () => {
    const grid = makeGrid();
    const seismic = makeSurvey({ bands: [{ fromM: 0, toM: 25, ores: { blingite: 0.3 } }], density: 0.3 });

    expect(estimateBlastOreValue(PLAN, [aerial()], grid)).toBeLessThan(estimateBlastOreValue(PLAN, [seismic], grid));
  });

  it('does not stretch the surface reading over the 8 m broken depth', () => {
    const grid = makeGrid();
    const full = expectedValue(PLAN, grid, () => 0.3);

    expect(estimateBlastOreValue(PLAN, [aerial()], grid)).toBeLessThan(full * 0.5);
  });

  it('an aerial survey of a column deeper than its window contributes nothing there', () => {
    // Surface recorded 10 m above the real rock: every broken voxel is >= window deep.
    const tooHigh = aerial({ surfaceY: AERIAL_ANCHOR + 30 });
    expect(estimateBlastOreValue(PLAN, [tooHigh], makeGrid())).toBe(0);
  });
});

describe('estimateBlastOreValue — survey selection', () => {
  it('uses the most recently completed survey covering the column, whatever the list order', () => {
    const grid = makeGrid();
    const older = makeSurvey({ id: 1, completedTick: 1, bands: [{ fromM: 0, toM: 25, ores: { blingite: 0.8 } }] });
    const newer = makeSurvey({ id: 2, completedTick: 50, bands: [{ fromM: 0, toM: 25, ores: { blingite: 0.2 } }] });
    const newerOnly = estimateBlastOreValue(PLAN, [newer], grid);

    expect(newerOnly).toBeGreaterThan(0);
    expect(estimateBlastOreValue(PLAN, [older, newer], grid)).toBeCloseTo(newerOnly, 6);
    expect(estimateBlastOreValue(PLAN, [newer, older], grid)).toBeCloseTo(newerOnly, 6);
  });

  it('applies newest-survey-wins per column, not per plan', () => {
    const grid = makeGrid();
    const older = makeSurvey({ id: 1, completedTick: 1, bands: [{ fromM: 0, toM: 25, ores: { blingite: 0.8 } }] });
    const newerPatch = makeSurvey({
      id: 2, completedTick: 50, min: 20, max: 20, bands: [{ fromM: 0, toM: 25, ores: { blingite: 0.2 } }],
    });
    const olderOnly = estimateBlastOreValue(PLAN, [older], grid);

    expect(estimateBlastOreValue(PLAN, [older, newerPatch], grid)).toBeLessThan(olderOnly);
  });

  it('prefers a fresh survey that scanned the depth over nothing', () => {
    const grid = makeGrid();
    expect(estimateBlastOreValue(PLAN, [makeSurvey({ id: 1 })], grid)).toBeGreaterThan(0);
  });
});

describe('estimateBlastOreValue — stale surveys (#1356)', () => {
  it('returns 0 for columns covered only by a stale survey', () => {
    const stale = { ...makeSurvey(), stale: true };
    expect(estimateBlastOreValue(PLAN, [stale], makeGrid())).toBe(0);
  });

  it('stale:false counts as fresh', () => {
    const survey = { ...makeSurvey(), stale: false };
    expect(estimateBlastOreValue(PLAN, [survey], makeGrid())).toBeGreaterThan(0);
  });

  it('falls back to an older fresh survey when the newest covering survey is stale', () => {
    const grid = makeGrid();
    const older = makeSurvey({ id: 1, completedTick: 10, bands: [{ fromM: 0, toM: 25, ores: { blingite: 0.2 } }] });
    const newerStale = { ...makeSurvey({ id: 2, completedTick: 50, bands: [{ fromM: 0, toM: 25, ores: { blingite: 0.9 } }] }), stale: true };
    const olderOnly = estimateBlastOreValue(PLAN, [older], grid);

    expect(olderOnly).toBeGreaterThan(0);
    expect(estimateBlastOreValue(PLAN, [older, newerStale], grid)).toBeCloseTo(olderOnly, 6);
    expect(estimateBlastOreValue(PLAN, [newerStale, older], grid)).toBeCloseTo(olderOnly, 6);
  });

  it('a stale survey only silences the columns it covers', () => {
    const grid = makeGrid();
    const staleHere = { ...makeSurvey({ id: 1, completedTick: 50, min: 20, max: 20 }), stale: true };
    const freshElsewhere = makeSurvey({ id: 2, completedTick: 10, min: 21, max: 39 });
    const onlyFresh = estimateBlastOreValue(PLAN, [freshElsewhere], grid);

    expect(onlyFresh).toBeGreaterThan(0);
    expect(estimateBlastOreValue(PLAN, [staleHere, freshElsewhere], grid)).toBeCloseTo(onlyFresh, 6);
  });
});

describe('estimateBlastOreValue — legacy surveys without depth data (#1703)', () => {
  it('falls back to the whole-window column estimate for every broken voxel', () => {
    const grid = makeGrid();
    const legacy = makeSurvey({ bands: null, surfaceY: null, density: 0.25 });

    expect(legacy.depthProfile).toBeUndefined();
    expect(legacy.surfaceYs).toBeUndefined();
    const expected = expectedValue(PLAN, grid, () => 0.25);
    expect(expected).toBeGreaterThan(0);
    expect(estimateBlastOreValue(PLAN, [legacy], grid)).toBeCloseTo(expected, 4);
  });

  it('a legacy survey still honours confidence and staleness', () => {
    const grid = makeGrid();
    const full = estimateBlastOreValue(PLAN, [makeSurvey({ bands: null, surfaceY: null })], grid);
    const half = estimateBlastOreValue(PLAN, [makeSurvey({ bands: null, surfaceY: null, confidence: 0.5 })], grid);
    const stale = { ...makeSurvey({ bands: null, surfaceY: null }), stale: true };

    expect(half).toBeCloseTo(full * 0.5, 6);
    expect(estimateBlastOreValue(PLAN, [stale], grid)).toBe(0);
  });
});

describe('estimateBlastOreValue — wet holes', () => {
  it('uses the energy field the blast would build with those holes wet', () => {
    const grid = makeGrid();
    const wet = new Set(['H1']);
    const bands = [{ fromM: 0, toM: 25, ores: { blingite: 0.2 } }];
    const survey = makeSurvey({ bands });

    expect(estimateBlastOreValue(PLAN, [survey], grid, wet))
      .toBeCloseTo(expectedValue(PLAN, grid, byDepth(bands), 1.0, wet), 4);
    expect(estimateBlastOreValue(PLAN, [survey], grid, wet))
      .toBeLessThanOrEqual(estimateBlastOreValue(PLAN, [survey], grid));
  });
});

describe('estimateBlastOreValue — never reads ground truth (#1703)', () => {
  it('does not call grid.oresAt', () => {
    const grid = makeGrid();
    const spy = vi.spyOn(grid, 'oresAt');

    estimateBlastOreValue(PLAN, [makeSurvey()], grid);

    expect(spy).not.toHaveBeenCalled();
  });

  it('gives the same answer whatever ore the real grid holds', () => {
    const rich = makeGrid({ blingite: 0.95, sparkium: 0.5 });
    const barren = makeGrid({});
    const survey = makeSurvey();

    expect(estimateBlastOreValue(PLAN, [survey], rich)).toBeGreaterThan(0);
    expect(estimateBlastOreValue(PLAN, [survey], rich)).toBe(estimateBlastOreValue(PLAN, [survey], barren));
  });
});
