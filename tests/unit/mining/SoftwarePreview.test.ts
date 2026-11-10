import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeHoleContext,
  readVoxelPrediction,
  predictFragmentation,
  getBlastBBox,
  forEachBBoxVoxel,
  previewPlanBands,
  PREVIEW_RADIUS,
  holeBandMixes,
  planBandShares,
  previewExplosiveBandShares,
  recommendedPowderFactors,
  stemmingSweepRangeM,
  holeCellOf,
  ownerHoleOf,
  type BandShares,
  type PlanBandCell,
  type PlanBandMap,
} from '../../../src/core/mining/SoftwarePreview.js';
import { buildPlanEnergyField, executeBlast } from '../../../src/core/mining/BlastExecution.js';
import { identifyFragmentedVoxels } from '../../../src/core/mining/VoxelFragmentation.js';
import { intensityAt } from '../../../src/core/mining/EnergyPropagation.js';
import { classifyFragmentationBand, fragmentationBandOf, FRAGMENTATION_BANDS } from '../../../src/core/mining/FragmentationBand.js';
import { VoxelGrid, firstEmptyLayerAboveGround } from '../../../src/core/world/VoxelGrid.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge, holeCellSize, powderFactor, fillChargeKg } from '../../../src/core/mining/ChargePlan.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import {
  RECOMMENDED_GOOD_SHARE_MIN, RECOMMENDED_RELATIVE_GOOD_SHARE, RECOMMENDED_SWEEP_STEPS, FRAGMENTATION_MULTIPLIER,
  FRAGMENTATION_BAND_FINES_MIN, FRAGMENTATION_BAND_DUST_MIN, CRACKED_VOXEL_ENERGY_RATIO,
  SEEDS_BASE, SEEDS_PER_INTENSITY, MAX_SEEDS_PER_VOXEL, OVERSIZED_FRAGMENT_THRESHOLD,
  MIN_STEMMING_M, MIN_CHARGE_COLUMN_M, STEMMING_FULL_DEPTH_FRACTION, DRILL_GRID_DEFAULT_SPACING_M,
} from '../../../src/core/config/balance.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { makeTestPlan } from './softwareTestFixtures.js';

const holeCounter = { nextHoleId: 1 };

beforeEach(() => { holeCounter.nextHoleId = 1; });

describe('SoftwarePreview — computeHoleContext', () => {
  it('maps every hole to its depth and a surface Y', () => {
    const { grid, plan } = makeTestPlan();
    const ctx = computeHoleContext(plan, grid);
    for (const hole of plan.holes) {
      expect(ctx.holeDepths[hole.id]).toBe(hole.depth);
      expect(ctx.holeSurfaceYs[hole.id]).toBeGreaterThan(0);
    }
  });

  it('surface Y is 0 for a hole above an empty column', () => {
    const grid = new VoxelGrid(5, 5);
    const holes = createGridPlan(holeCounter, { x: 2, z: 2 }, 1, 1, 3, 2, 0.1);
    const plan = assembleBlastPlan(holes, {});
    const ctx = computeHoleContext(plan, grid);
    expect(ctx.holeSurfaceYs[holes[0]!.id]).toBe(0);
  });

  // #1184: getHoleSurfaceYs must come from the shared column query
  // (computeVoxelColumnSurfaceY / firstEmptyLayerAboveGround), not a scan
  // fixed to [0, grid.sizeY) — a hole above a column whose surface sits
  // below y = 0 must report the true (negative) surface, not the fallback 0
  // a bounded scan would wrongly produce.
  it('#1184: reports the true surface Y for a hole above a column whose surface sits below y = 0', () => {
    const grid = new VoxelGrid(10, 10);
    grid.setVoxel(3, -5, 3, {
      composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    const holes = createGridPlan(holeCounter, { x: 3, z: 3 }, 1, 1, 3, 2, 0.1);
    const plan = assembleBlastPlan(holes, {});

    const ctx = computeHoleContext(plan, grid);

    expect(ctx.holeSurfaceYs[holes[0]!.id]).toBe(firstEmptyLayerAboveGround(grid, 3, 3));
    expect(ctx.holeSurfaceYs[holes[0]!.id]).toBe(-4);
  });
});

describe('SoftwarePreview — readVoxelPrediction', () => {
  it('reads a voxel prediction straight out of the propagated field', () => {
    const { grid, plan } = makeTestPlan();
    const field = buildPlanEnergyField(plan, grid)!;
    expect(field).not.toBeNull();

    const voxel = grid.getVoxel(10, 5, 10)!;
    const result = readVoxelPrediction(field, voxel, 10, 5, 10);

    expect(result).not.toBeNull();
    expect(result!.rock.id).toBe('molite');
    expect(result!.energy).toBeGreaterThanOrEqual(0);
    expect(result!.threshold).toBeGreaterThan(0);
    expect(result!.intensity).toBeGreaterThanOrEqual(0);
  });

  it('returns null for a voxel with no rock in it', () => {
    const { grid, plan } = makeTestPlan();
    const field = buildPlanEnergyField(plan, grid)!;

    const air = { composition: { rocks: [] }, density: 0, oreDensities: {}, fractureModifier: 1 };
    expect(readVoxelPrediction(field, air, 0, 14, 0)).toBeNull();
  });
});

describe('SoftwarePreview — predictFragmentation', () => {
  it('predicts nothing for rock that does not break', () => {
    expect(predictFragmentation(0.5).pieces).toBe(0);
  });

  it('predicts smaller pieces the harder the rock is hit', () => {
    expect(predictFragmentation(6).sizeM3).toBeLessThan(predictFragmentation(2).sizeM3);
  });

  it('where the rock barely broke, predicts SEEDS_BASE pieces: haulable, not oversized', () => {
    // Two seeds per voxel at the good bound give fragments of about 0.5 m3, the haul threshold.
    const barely = predictFragmentation(FRAGMENTATION_MULTIPLIER);
    expect(barely.pieces).toBeCloseTo(SEEDS_BASE, 12);
    expect(barely.sizeM3).toBeCloseTo(1 / SEEDS_BASE, 12);
    expect(barely.sizeM3).toBeLessThanOrEqual(OVERSIZED_FRAGMENT_THRESHOLD);
  });

  it('adds SEEDS_PER_INTENSITY pieces per unit of intensity above the break', () => {
    const atFines = predictFragmentation(FRAGMENTATION_BAND_FINES_MIN);
    expect(atFines.pieces).toBeCloseTo(SEEDS_BASE + SEEDS_PER_INTENSITY * (FRAGMENTATION_BAND_FINES_MIN - FRAGMENTATION_MULTIPLIER), 12);
    expect(atFines.sizeM3).toBeCloseTo(1 / atFines.pieces, 12);
  });

  it('caps the pieces at MAX_SEEDS_PER_VOXEL, however hard the rock is hit', () => {
    expect(predictFragmentation(FRAGMENTATION_BAND_DUST_MIN * 10).pieces).toBe(MAX_SEEDS_PER_VOXEL);
    expect(predictFragmentation(1_000).sizeM3).toBeCloseTo(1 / MAX_SEEDS_PER_VOXEL, 12);
  });
});
describe('SoftwarePreview — getBlastBBox', () => {
  it('bounds every hole with PREVIEW_RADIUS of margin', () => {
    const { grid, plan } = makeTestPlan();
    const ctx = computeHoleContext(plan, grid);
    const bbox = getBlastBBox(plan, ctx);
    for (const hole of plan.holes) {
      expect(hole.x).toBeGreaterThanOrEqual(bbox.minX);
      expect(hole.x).toBeLessThanOrEqual(bbox.maxX);
      expect(hole.z).toBeGreaterThanOrEqual(bbox.minZ);
      expect(hole.z).toBeLessThanOrEqual(bbox.maxZ);
    }
    const xs = plan.holes.map(h => h.x);
    expect(bbox.minX).toBeLessThanOrEqual(Math.min(...xs) - PREVIEW_RADIUS + 1);
    // #1186: makeTestPlan's surface (y=9) minus its max hole depth (6) minus
    // PREVIEW_RADIUS (5) is -2 — genuinely below y=0 once the floor is
    // removed, so this must no longer be clamped to >= 0.
    expect(bbox.minY).toBe(-2);
  });

  it('#1186: a hole whose surface sits below y=0 gets a bbox that actually covers it, not pulled back toward y=0', () => {
    const grid = new VoxelGrid(20, 20);
    for (let z = 5; z <= 15; z++) {
      for (let y = -14; y <= -8; y++) {
        for (let x = 5; x <= 15; x++) {
          grid.setVoxel(x, y, z, {
            composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] },
            density: 1.0,
            oreDensities: {},
            fractureModifier: 1.0,
          });
        }
      }
    }

    const holes = createGridPlan(holeCounter, { x: 10, z: 10 }, 1, 1, 3, 4, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;
    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 4, 2);
    const plan = assembleBlastPlan(holes, charges);

    const ctx = computeHoleContext(plan, grid);
    // Sanity: the surface really does sit below y=0.
    expect(ctx.holeSurfaceYs[holes[0]!.id]).toBeLessThan(0);

    const bbox = getBlastBBox(plan, ctx);
    // The old `maxSurfaceY = 0` seed and the `Math.max(0, ...)` minY floor
    // both wrongly pull this bbox back up toward y=0 even though the whole
    // hole sits well below it.
    expect(bbox.maxY).toBeLessThan(0);

    let solidFound = 0;
    forEachBBoxVoxel(grid, bbox, () => { solidFound++; });
    expect(solidFound).toBeGreaterThan(0);
  });

  it('#1186: a hole at negative x on a westward-expanded site resolves via clampToGridColumn, not snapped to x=0', () => {
    const grid = new VoxelGrid(16, 16);
    grid.addChunk(-1, 0);
    // Rock only at the negative-x column the hole is actually drilled at —
    // column x=0 (where the old hand-rolled clamp would wrongly snap to)
    // stays empty, so a wrong resolution reads it as bare ground (surfaceY=0).
    grid.setVoxel(-5, 0, 5, {
      composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });

    const holes = createGridPlan(holeCounter, { x: -5, z: 5 }, 1, 1, 3, 4, 0.15);
    const plan = assembleBlastPlan(holes, {});

    const ctx = computeHoleContext(plan, grid);
    expect(ctx.holeSurfaceYs[holes[0]!.id]).toBe(1);
  });
});


// ── previewPlanBands (#2200) ─────────────────────────────────────────────────

const ROCK = { composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };

/** One hole at (12,12), depth 8 in a solid block y=0..8, charged as given. */
function singleHolePlan(amountKg: number, stemmingM: number, explosiveId = 'boomite') {
  const grid = new VoxelGrid(30, 30);
  for (let z = 5; z <= 20; z++)
    for (let y = 0; y <= 8; y++)
      for (let x = 5; x <= 20; x++) grid.setVoxel(x, y, z, ROCK);
  const holes = createGridPlan(holeCounter, { x: 12, z: 12 }, 1, 1, 3, 8, 0.15);
  const depths: Record<string, number> = {};
  for (const h of holes) depths[h.id] = h.depth;
  const { charges } = batchCharge(holes.map(h => h.id), depths, explosiveId, amountKg, stemmingM);
  return { grid, plan: assembleBlastPlan(holes, charges), hole: holes[0]! };
}

describe('SoftwarePreview — previewPlanBands', () => {
  it('reports each cell with the intensity of the blast\'s own energy field and its band given its fate', () => {
    const { grid, plan } = makeTestPlan();
    const field = buildPlanEnergyField(plan, grid)!;
    const broken = new Set(identifyFragmentedVoxels(field, grid, false).fragmented.map(v => `${v.x},${v.y},${v.z}`));
    const map = previewPlanBands(plan, grid);

    expect(map.cells.size).toBeGreaterThan(0);
    for (const [key, cell] of map.cells) {
      expect(key).toBe(`${cell.x},${cell.y},${cell.z}`);
      expect(cell.intensity).toBe(intensityAt(field, cell.x, cell.y, cell.z));
      expect(cell.band).toBe(fragmentationBandOf(cell.intensity, broken.has(key)));
    }
  });

  it('shows rock that breaks out without enough energy as coarse, never as rock that stays put', () => {
    // The sandbox opening pattern in a deep bed, filled with krackle up to 2.5 m of stemming:
    // its undermined cap lifts and breaks out as blocks.
    const grid = bedGrid('molite', 24);
    const plan = fillPlan(patternHoles(3, 3, 4, 8), 'krackle', 2.5);
    const field = buildPlanEnergyField(plan, grid)!;
    const fragmentation = identifyFragmentedVoxels(field, grid, false);
    expect(fragmentation.liftedCount).toBeGreaterThan(0);
    const broken = new Set(fragmentation.fragmented.map(v => `${v.x},${v.y},${v.z}`));
    const cells = [...previewPlanBands(plan, grid).cells.values()];
    const coarse = cells.filter(c => c.band === 'coarse');
    expect(coarse.length).toBeGreaterThan(0);
    for (const c of coarse) {
      expect(broken.has(`${c.x},${c.y},${c.z}`)).toBe(true);
      expect(c.intensity).toBeLessThan(FRAGMENTATION_MULTIPLIER);
    }
    for (const c of cells.filter(c => c.band === 'intact' || c.band === 'cracked')) {
      expect(broken.has(`${c.x},${c.y},${c.z}`)).toBe(false);
    }
  });

  it('counts as many coarse voxels as the blast itself reports in coarse volume', () => {
    const plan = fillPlan(patternHoles(3, 3, 4, 8), 'krackle', 2.5);
    const coarse = [...previewPlanBands(plan, bedGrid('molite', 24)).cells.values()].filter(c => c.band === 'coarse').length;
    expect(coarse).toBeGreaterThan(0);
    const result = executeBlast(plan, bedGrid('molite', 24), [])!;
    expect(result.bandVolumes.coarse).toBe(coarse);
  });

  it('with fate off, bands are intensity bands only and the good share is unchanged', () => {
    const { grid, plan, hole } = singleHolePlan(8, 3);
    const withFate = previewPlanBands(plan, grid);
    const without = previewPlanBands(plan, grid, new Set(), { fate: false });
    for (const c of without.cells.values()) expect(c.band).toBe(classifyFragmentationBand(c.intensity));
    expect(holeBandMixes(without, [hole])[hole.id]!.good).toBeCloseTo(holeBandMixes(withFate, [hole])[hole.id]!.good, 12);
  });

  it('covers every filled voxel of the plan\'s blast box and nothing else', () => {
    const { grid, plan } = makeTestPlan();
    const map = previewPlanBands(plan, grid);
    const bbox = getBlastBBox(plan, computeHoleContext(plan, grid));
    expect(map.bbox).toEqual(bbox);

    const filled = new Set<string>();
    forEachBBoxVoxel(grid, bbox, (x, y, z) => { filled.add(`${x},${y},${z}`); });
    expect(filled.size).toBeGreaterThan(0);
    expect(new Set(map.cells.keys())).toEqual(filled);
  });

  it('leaves air out: no cell above the surface', () => {
    const { grid, plan } = makeTestPlan();
    const map = previewPlanBands(plan, grid);
    for (const cell of map.cells.values()) {
      expect(grid.getVoxel(cell.x, cell.y, cell.z)!.density).toBeGreaterThan(0);
      expect(cell.y).toBeLessThanOrEqual(8);
    }
  });

  it('needs no software tier: the same call serves a fresh game', () => {
    const { grid, plan } = makeTestPlan();
    expect(() => previewPlanBands(plan, grid)).not.toThrow();
    expect(previewPlanBands(plan, grid).cells.size).toBeGreaterThan(0);
  });

  it('is empty for a plan with no holes', () => {
    const { grid } = makeTestPlan();
    const map = previewPlanBands(assembleBlastPlan([], {}), grid);
    expect(map.cells.size).toBe(0);
  });

  it('is empty for holes with no charge', () => {
    const { grid, plan } = makeTestPlan();
    const map = previewPlanBands(assembleBlastPlan(plan.holes, {}), grid);
    expect(map.cells.size).toBe(0);
  });

  it('every intensity is non-negative and every band is one of the six', () => {
    const { grid, plan } = makeTestPlan();
    for (const cell of previewPlanBands(plan, grid).cells.values()) {
      expect(cell.intensity).toBeGreaterThanOrEqual(0);
      expect(['intact', 'cracked', 'coarse', 'good', 'fines', 'dust']).toContain(cell.band);
    }
  });

  it('recomputes when the charge amount changes', () => {
    const light = singleHolePlan(3, 4);
    const heavy = singleHolePlan(8, 4);
    const peak = (m: ReturnType<typeof previewPlanBands>) => Math.max(...[...m.cells.values()].map(c => c.intensity));
    expect(peak(previewPlanBands(heavy.plan, heavy.grid))).toBeGreaterThan(peak(previewPlanBands(light.plan, light.grid)));
  });

  it('recomputes when stemming changes', () => {
    const tight = singleHolePlan(5, 4);
    const loose = singleHolePlan(5, 1);
    const a = previewPlanBands(tight.plan, tight.grid);
    const b = previewPlanBands(loose.plan, loose.grid);
    const intensities = (m: ReturnType<typeof previewPlanBands>) => [...m.cells.values()].map(c => c.intensity).join(',');
    expect(intensities(a)).not.toBe(intensities(b));
  });

  it('recomputes when the hole is wet and the explosive is water-sensitive', () => {
    const { grid, plan, hole } = singleHolePlan(8, 1, 'big_bada_boom');
    const dry = previewPlanBands(plan, grid);
    const wet = previewPlanBands(plan, grid, new Set([hole.id]));
    const total = (m: ReturnType<typeof previewPlanBands>) => [...m.cells.values()].reduce((a, c) => a + c.intensity, 0);
    expect(total(wet)).toBeLessThan(total(dry));
  });

  it('a water-resistant explosive reads the same wet or dry', () => {
    const { grid, plan, hole } = singleHolePlan(5, 2, 'krackle');
    const dry = previewPlanBands(plan, grid);
    const wet = previewPlanBands(plan, grid, new Set([hole.id]));
    expect([...wet.cells.values()]).toEqual([...dry.cells.values()]);
  });

  it('an omitted wet set equals an explicit empty one', () => {
    const { grid, plan } = makeTestPlan();
    expect([...previewPlanBands(plan, grid).cells.values()])
      .toEqual([...previewPlanBands(plan, grid, new Set()).cells.values()]);
  });

  it('#2200 C8: an overcharged hole under heavy stemming is fines or dust at the bottom of its column and intact or cracked near the collar', () => {
    const { grid, plan, hole } = singleHolePlan(8, 4);
    const map = previewPlanBands(plan, grid);
    const column = [...map.cells.values()].filter(c => c.x === hole.x && c.z === hole.z).sort((a, b) => a.y - b.y);
    expect(column.length).toBeGreaterThan(3);

    const bottom = column.find(c => c.y === 1)!;
    const collar = column[column.length - 1]!;
    expect(['fines', 'dust']).toContain(bottom.band);
    expect(['intact', 'cracked']).toContain(collar.band);
    expect(bottom.intensity).toBeGreaterThan(collar.intensity);
  });
});


// ── hole band mixes, uniform charge, recommended range (#2203) ───────────────

const I_INTACT = 0.1;
const I_CRACKED = (CRACKED_VOXEL_ENERGY_RATIO + FRAGMENTATION_MULTIPLIER) / 2;
const I_GOOD = (FRAGMENTATION_MULTIPLIER + FRAGMENTATION_BAND_FINES_MIN) / 2;
const I_FINES = (FRAGMENTATION_BAND_FINES_MIN + FRAGMENTATION_BAND_DUST_MIN) / 2;
const I_DUST = FRAGMENTATION_BAND_DUST_MIN * 3;

function cellAt(x: number, y: number, z: number, intensity: number): PlanBandCell {
  return { x, y, z, intensity, band: classifyFragmentationBand(intensity) };
}

function mapOfCells(cells: PlanBandCell[]): PlanBandMap {
  return {
    bbox: { minX: 0, maxX: 40, minY: 0, maxY: 20, minZ: 0, maxZ: 40 },
    cells: new Map(cells.map(c => [`${c.x},${c.y},${c.z}`, c])),
  };
}

const drillHole = (id: string, x: number, z: number, depth = 4): DrillHole => ({ id, x, z, depth, diameter: 0.089 });

const sumShares = (s: BandShares): number => FRAGMENTATION_BANDS.reduce((a, b) => a + s[b], 0);

/** Column of cells at (x, z) from y = top down, one per intensity. */
function column(x: number, z: number, top: number, intensities: number[]): PlanBandCell[] {
  return intensities.map((i, k) => cellAt(x, top - k, z, i));
}

describe('SoftwarePreview — holeBandMixes (#2203 C2)', () => {
  // H1 and H2 are 4 m apart, so each owns the columns within 2 m of its own.
  const h1 = drillHole('H1', 10, 10);
  const h2 = drillHole('H2', 14, 10);
  const cells = [
    ...column(10, 10, 8, [I_GOOD, I_GOOD, I_DUST, I_INTACT]),  // H1's own column, y 8..5
    cellAt(11, 8, 10, I_FINES),                                  // one column east of H1 (3 from H2)
    ...column(14, 10, 8, [I_CRACKED, I_CRACKED, I_CRACKED, I_CRACKED]),
    cellAt(13, 8, 10, I_INTACT),                                 // one column west of H2
  ];

  it('gives each hole the shares of its own cell, by band', () => {
    const mixes = holeBandMixes(mapOfCells(cells), [h1, h2]);
    expect(mixes['H1']!.intact).toBeCloseTo(0.2, 10);
    expect(mixes['H1']!.cracked).toBeCloseTo(0, 10);
    expect(mixes['H1']!.good).toBeCloseTo(0.4, 10);
    expect(mixes['H1']!.fines).toBeCloseTo(0.2, 10);
    expect(mixes['H1']!.dust).toBeCloseTo(0.2, 10);
    expect(mixes['H2']!.cracked).toBeCloseTo(0.8, 10);
    expect(mixes['H2']!.intact).toBeCloseTo(0.2, 10);
  });

  it('shares sum to 1 for every hole', () => {
    const mixes = holeBandMixes(mapOfCells(cells), [h1, h2]);
    for (const id of ['H1', 'H2']) expect(sumShares(mixes[id]!)).toBeCloseTo(1, 10);
  });

  it('a voxel belongs to the nearest hole', () => {
    const map = mapOfCells([...column(10, 10, 8, [I_GOOD]), ...column(14, 10, 8, [I_GOOD]), cellAt(11, 8, 10, I_DUST), cellAt(13, 8, 10, I_INTACT)]);
    const mixes = holeBandMixes(map, [h1, h2]);
    expect(mixes['H1']!.dust).toBeCloseTo(0.5, 10);
    expect(mixes['H1']!.intact).toBeCloseTo(0, 10);
    expect(mixes['H2']!.intact).toBeCloseTo(0.5, 10);
    expect(mixes['H2']!.dust).toBeCloseTo(0, 10);
  });

  it('leaves out voxels farther than half the hole spacing from the nearest hole', () => {
    const far = [cellAt(7, 8, 10, I_DUST), cellAt(10, 8, 13, I_DUST), cellAt(10, 8, 7, I_DUST)];
    const withFar = holeBandMixes(mapOfCells([...cells, ...far]), [h1, h2]);
    const without = holeBandMixes(mapOfCells(cells), [h1, h2]);
    expect(withFar['H1']).toEqual(without['H1']);
    expect(withFar['H2']).toEqual(without['H2']);
  });

  it('keeps only the voxels within the hole\'s depth below the top of its column', () => {
    const deep = [cellAt(10, 2, 10, I_DUST), cellAt(10, 1, 10, I_DUST), cellAt(10, 0, 10, I_DUST)];
    const withDeep = holeBandMixes(mapOfCells([...cells, ...deep]), [h1, h2]);
    const without = holeBandMixes(mapOfCells(cells), [h1, h2]);
    expect(withDeep['H1']).toEqual(without['H1']);
  });

  it('a grid hole\'s cell is its spacing x burden: a voxel along the burden past half the spacing still counts', () => {
    // Spacing 2 m along x, burden 6 m between rows: H1 at (10, 10) works x 9..11 and z 7..13.
    const grid = createGridPlan({ nextHoleId: 1 }, { x: 10, z: 10 }, 2, 2, 2, 4, 0.089, 6);
    const map = mapOfCells([
      ...column(10, 10, 8, [I_GOOD]), cellAt(10, 8, 12, I_DUST),
      ...column(12, 10, 8, [I_GOOD]), ...column(10, 16, 8, [I_GOOD]), ...column(12, 16, 8, [I_GOOD]),
    ]);
    const mixes = holeBandMixes(map, grid);
    expect(mixes['H1']!.dust).toBeCloseTo(0.5, 10);
    expect(mixes['H3']!.dust).toBeCloseTo(0, 10);
  });

  it('reads a hole at a fractional position from the cell of its floored coordinates', () => {
    const h3 = drillHole('H3', 20.7, 10.4);
    const map = mapOfCells([...column(20, 10, 8, [I_GOOD, I_GOOD, I_GOOD, I_GOOD]), ...cells]);
    const mixes = holeBandMixes(map, [h1, h2, h3]);
    expect(mixes['H3']!.good).toBeCloseTo(1, 10);
  });

  it('leaves a hole with no rock in its cell out of the result', () => {
    const lonely = drillHole('H4', 30, 30);
    const mixes = holeBandMixes(mapOfCells(cells), [h1, h2, lonely]);
    expect(Object.keys(mixes).sort()).toEqual(['H1', 'H2']);
    expect(mixes['H4']).toBeUndefined();
  });

  it('is empty for an empty map and for no holes', () => {
    expect(holeBandMixes(mapOfCells([]), [h1, h2])).toEqual({});
    expect(holeBandMixes(mapOfCells(cells), [])).toEqual({});
  });

  it('reads the real heatmap field: every charged hole of a pattern gets shares in 0..1 summing to 1', () => {
    const { grid, plan } = makeTestPlan();
    const mixes = holeBandMixes(previewPlanBands(plan, grid), plan.holes);
    expect(Object.keys(mixes).sort()).toEqual(plan.holes.map(h => h.id).sort());
    for (const shares of Object.values(mixes)) {
      expect(sumShares(shares)).toBeCloseTo(1, 10);
      for (const b of FRAGMENTATION_BANDS) {
        expect(shares[b]).toBeGreaterThanOrEqual(0);
        expect(shares[b]).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('SoftwarePreview — planBandShares (#2203 C2)', () => {
  const h1 = drillHole('H1', 10, 10);
  const h2 = drillHole('H2', 14, 10);

  it('pools the cells of every hole', () => {
    const map = mapOfCells([
      ...column(10, 10, 8, [I_GOOD, I_GOOD, I_DUST, I_INTACT]),
      ...column(14, 10, 8, [I_CRACKED, I_CRACKED, I_CRACKED, I_CRACKED]),
    ]);
    const shares = planBandShares(map, [h1, h2])!;
    expect(shares.intact).toBeCloseTo(0.125, 10);
    expect(shares.cracked).toBeCloseTo(0.5, 10);
    expect(shares.good).toBeCloseTo(0.25, 10);
    expect(shares.fines).toBeCloseTo(0, 10);
    expect(shares.dust).toBeCloseTo(0.125, 10);
    expect(sumShares(shares)).toBeCloseTo(1, 10);
  });

  it('weights a hole by how many voxels its cell holds, not equally per hole', () => {
    const map = mapOfCells([
      ...column(10, 10, 8, [I_GOOD]),
      ...column(14, 10, 8, [I_DUST, I_DUST, I_DUST]),
    ]);
    const shares = planBandShares(map, [h1, h2])!;
    expect(shares.good).toBeCloseTo(0.25, 10);
    expect(shares.dust).toBeCloseTo(0.75, 10);
  });

  it('is null when no hole has a voxel in its cell', () => {
    expect(planBandShares(mapOfCells([]), [h1, h2])).toBeNull();
    expect(planBandShares(mapOfCells(column(30, 30, 8, [I_GOOD])), [h1, h2])).toBeNull();
  });

  it('is null with no holes', () => {
    expect(planBandShares(mapOfCells(column(10, 10, 8, [I_GOOD])), [])).toBeNull();
  });

  it('a single-band map reads 1 for that band', () => {
    const shares = planBandShares(mapOfCells(column(10, 10, 8, [I_FINES, I_FINES])), [h1])!;
    expect(shares.fines).toBeCloseTo(1, 10);
  });
});

const BED = { composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };

function bedGrid(rockId = 'molite', top = 8): VoxelGrid {
  const grid = new VoxelGrid(40, 40);
  const voxel = { ...BED, composition: { rocks: [{ rockId, coefficient: 1.0 }] } };
  for (let z = 3; z <= 34; z++)
    for (let y = 0; y <= top; y++)
      for (let x = 3; x <= 34; x++) grid.setVoxel(x, y, z, voxel);
  return grid;
}

function patternHoles(rows: number, cols: number, spacing: number, depth: number, diameter = 0.089): DrillHole[] {
  const counter = { nextHoleId: 1 };
  return createGridPlan(counter, { x: 10, z: 10 }, rows, cols, spacing, depth, diameter);
}

/** Every hole filled with the explosive up to `stemmingM`, the way Charge All does it (batchCharge in fill mode). */
function fillPlan(holes: readonly DrillHole[], explosiveId: string, stemmingM: number) {
  const depths: Record<string, number> = {};
  const diameters: Record<string, number> = {};
  for (const h of holes) { depths[h.id] = h.depth; diameters[h.id] = h.diameter; }
  const { charges } = batchCharge(holes.map(h => h.id), depths, explosiveId, null, stemmingM, diameters);
  return assembleBlastPlan([...holes], charges);
}

/** Stemming of sweep sample `i` of `steps` for a hole, as the recommended-range sweep spaces them (most explosive first). */
function sweepStemmingM(depth: number, i: number, steps: number): number {
  const range = stemmingSweepRangeM(depth)!;
  return Math.round((range.lo + (range.hi - range.lo) * (i / (steps - 1))) * 10) / 10;
}

/** Powder factor of `hole` filled with the explosive up to `stemmingM`, over its own pattern cell. */
function fillPowderFactor(hole: DrillHole, holes: readonly DrillHole[], explosiveId: string, stemmingM: number): number {
  const cell = holeCellSize(hole, holes);
  return powderFactor(fillChargeKg(hole.depth, stemmingM, hole.diameter, explosiveId), hole.depth, cell.spacingM, cell.burdenM);
}

describe('SoftwarePreview — stemmingSweepRangeM', () => {
  it('runs from the full-stemming length (a fraction of the depth) to leaving the shortest charge column', () => {
    const range = stemmingSweepRangeM(8)!;
    expect(range.lo).toBeCloseTo(8 * STEMMING_FULL_DEPTH_FRACTION, 12);
    expect(range.hi).toBeCloseTo(8 - MIN_CHARGE_COLUMN_M, 12);
  });

  it('never starts below the minimum stemming in a shallow hole', () => {
    const range = stemmingSweepRangeM(1.5)!;
    expect(1.5 * STEMMING_FULL_DEPTH_FRACTION).toBeLessThan(MIN_STEMMING_M);
    expect(range.lo).toBe(MIN_STEMMING_M);
    expect(range.hi).toBeCloseTo(1.5 - MIN_CHARGE_COLUMN_M, 12);
  });

  it('widens with the depth of the hole', () => {
    const a = stemmingSweepRangeM(4)!;
    const b = stemmingSweepRangeM(12)!;
    expect(b.hi - b.lo).toBeGreaterThan(a.hi - a.lo);
  });

  it('boundary: a hole just deep enough for the minimum stemming and the shortest column sweeps one stemming', () => {
    const depth = MIN_STEMMING_M + MIN_CHARGE_COLUMN_M;
    const range = stemmingSweepRangeM(depth)!;
    expect(range.lo).toBeCloseTo(range.hi, 12);
  });

  it('rejection: null for a hole too shallow to hold both', () => {
    expect(stemmingSweepRangeM(MIN_STEMMING_M + MIN_CHARGE_COLUMN_M - 0.1)).toBeNull();
    expect(stemmingSweepRangeM(0)).toBeNull();
  });

  it('every stemming in the range leaves explosive in the hole', () => {
    for (const depth of [1, 3, 6, 8, 15]) {
      const range = stemmingSweepRangeM(depth)!;
      for (const stemming of [range.lo, range.hi]) {
        expect(fillChargeKg(depth, stemming, 0.089, 'pop_rock'), `${depth} m @ ${stemming}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('SoftwarePreview — holeCellOf and ownerHoleOf', () => {
  it('a grid hole\'s footprint is its column and half its spacing (x) and burden (z)', () => {
    const holes = createGridPlan({ nextHoleId: 1 }, { x: 10, z: 10 }, 2, 2, 4, 8, 0.089, 6);
    expect(holeCellOf(holes[0]!, holes)).toEqual({ cx: 10, cz: 10, halfX: 2, halfZ: 3 });
  });

  it('a hand-placed hole gets half its nearest-neighbour square, and a fractional position floors to its column', () => {
    const a = drillHole('H1', 10.7, 10.2);
    const b = drillHole('H2', 13.7, 10.2);
    expect(holeCellOf(a, [a, b])).toEqual({ cx: 10, cz: 10, halfX: 1.5, halfZ: 1.5 });
  });

  it('a lone hand-placed hole gets half the default grid spacing', () => {
    const a = drillHole('H1', 5, 5);
    expect(holeCellOf(a, [a])).toEqual({ cx: 5, cz: 5, halfX: DRILL_GRID_DEFAULT_SPACING_M / 2, halfZ: DRILL_GRID_DEFAULT_SPACING_M / 2 });
  });

  const cellAtHole = (id: string, cx: number, cz: number, halfX: number, halfZ: number) => ({ id, cx, cz, halfX, halfZ });

  it('ownerHoleOf: a column inside a rectangular cell belongs to it along the long side, not past it along the short one', () => {
    const cells = [cellAtHole('A', 10, 10, 1, 3)];
    expect(ownerHoleOf(10, 13, cells)?.id).toBe('A');
    expect(ownerHoleOf(11, 10, cells)?.id).toBe('A');
    expect(ownerHoleOf(12, 10, cells)).toBeNull();
    expect(ownerHoleOf(10, 14, cells)).toBeNull();
  });

  it('ownerHoleOf: the cell the column sits deepest inside wins (distance relative to each half-cell)', () => {
    // 2 m from A along x is the edge of its 2 m half-cell; 2 m from B along z is a third of its 6 m half-cell.
    const cells = [cellAtHole('A', 10, 10, 2, 2), cellAtHole('B', 12, 8, 6, 6)];
    expect(ownerHoleOf(12, 10, cells)?.id).toBe('B');
  });

  it('ownerHoleOf: between equal relative distances, the nearer hole wins', () => {
    const cells = [cellAtHole('A', 10, 10, 4, 2), cellAtHole('B', 13, 10, 2, 1)];
    // (12, 10): A at dx 2 of 4 -> 0.5; B at dx 1 of 2 -> 0.5; B is nearer.
    expect(ownerHoleOf(12, 10, cells)?.id).toBe('B');
    expect(ownerHoleOf(12, 10, [...cells].reverse())?.id).toBe('B');
  });

  it('ownerHoleOf: null when no cell reaches the column, or with no cells', () => {
    expect(ownerHoleOf(30, 30, [cellAtHole('A', 10, 10, 2, 2)])).toBeNull();
    expect(ownerHoleOf(10, 10, [])).toBeNull();
  });
});

describe('SoftwarePreview — previewExplosiveBandShares (#2203 C4)', () => {
  // 150 mm holes 3 m apart, 6 m deep: the sweep range of each hole runs 1.8 m to 5.5 m of stemming.
  const holes = patternHoles(2, 2, 3, 6, 0.15);

  it('is null with no holes', () => {
    expect(previewExplosiveBandShares([], bedGrid(), 'boomite', 2)).toBeNull();
  });

  it('is null when the pattern stands over no rock', () => {
    expect(previewExplosiveBandShares(holes, new VoxelGrid(40, 40), 'boomite', 2)).toBeNull();
  });

  it('returns shares in 0..1 that sum to 1', () => {
    const shares = previewExplosiveBandShares(holes, bedGrid(), 'boomite', 3)!;
    expect(shares).not.toBeNull();
    expect(sumShares(shares)).toBeCloseTo(1, 10);
    for (const b of FRAGMENTATION_BANDS) {
      expect(shares[b]).toBeGreaterThanOrEqual(0);
      expect(shares[b]).toBeLessThanOrEqual(1);
    }
  });

  it('is the pooled band shares of every hole filled to the stemming, on the same field the heatmap reads', () => {
    const grid = bedGrid();
    const direct = planBandShares(previewPlanBands(fillPlan(holes, 'boomite', 3), grid), holes)!;
    const shares = previewExplosiveBandShares(holes, grid, 'boomite', 3)!;
    for (const b of FRAGMENTATION_BANDS) expect(shares[b], b).toBeCloseTo(direct[b], 10);
  });

  it('fills each hole to its own depth, leaving out a hole the stemming leaves no room in', () => {
    const grid = bedGrid();
    const mixed = [drillHole('H1', 10, 10, 6), drillHole('H2', 13, 10, 4), drillHole('H3', 10, 13, 2)];
    // 2.5 m of stemming fills H1 and H2 (to their own depths) and leaves no room in H3, which stays uncharged.
    const plan = fillPlan(mixed, 'krackle', 2.5);
    expect(Object.keys(plan.charges).sort()).toEqual(['H1', 'H2']);
    expect(plan.charges['H1']!.amountKg).toBeGreaterThan(plan.charges['H2']!.amountKg);
    const direct = planBandShares(previewPlanBands(plan, grid), mixed)!;
    expect(previewExplosiveBandShares(mixed, grid, 'krackle', 2.5)).toEqual(direct);
  });

  it('less stemming fills more explosive and crushes more of the rock to fines and dust', () => {
    const grid = bedGrid();
    const heavy = previewExplosiveBandShares(holes, grid, 'boomite', 2)!;
    const light = previewExplosiveBandShares(holes, grid, 'boomite', 5)!;
    expect(heavy.fines + heavy.dust).toBeGreaterThan(light.fines + light.dust);
    expect(heavy.intact).toBeLessThan(light.intact);
  });

  it('a stronger, denser explosive filled to the same stemming gives a different, finer mix', () => {
    const grid = bedGrid();
    const weak = previewExplosiveBandShares(holes, grid, 'pop_rock', 4.5)!;
    const strong = previewExplosiveBandShares(holes, grid, 'dynatomics', 4.5)!;
    expect(strong).not.toEqual(weak);
    expect(strong.intact).toBeLessThan(weak.intact);
    expect(strong.fines + strong.dust).toBeGreaterThan(weak.fines + weak.dust);
  });

  it('wet holes weaken a water-sensitive explosive and leave a resistant one alone', () => {
    const grid = bedGrid();
    const wet = new Set(holes.map(h => h.id));
    const sensitiveDry = previewExplosiveBandShares(holes, grid, 'big_bada_boom', 3)!;
    const sensitiveWet = previewExplosiveBandShares(holes, grid, 'big_bada_boom', 3, wet)!;
    expect(sensitiveWet).not.toEqual(sensitiveDry);
    expect(sensitiveWet.intact).toBeGreaterThan(sensitiveDry.intact);
    expect(sensitiveWet.fines + sensitiveWet.dust).toBeLessThan(sensitiveDry.fines + sensitiveDry.dust);
    expect(previewExplosiveBandShares(holes, grid, 'krackle', 3, wet)).toEqual(previewExplosiveBandShares(holes, grid, 'krackle', 3));
  });

  it('an omitted wet set equals an explicit empty one', () => {
    const grid = bedGrid();
    expect(previewExplosiveBandShares(holes, grid, 'boomite', 3, new Set())).toEqual(previewExplosiveBandShares(holes, grid, 'boomite', 3));
  });
});

describe('SoftwarePreview — recommendedPowderFactors (#2203 C3)', () => {
  // Shallow 3 x 3 patterns, 3 m apart: small rock cells, so the good band covers a large share of them.
  const FIXTURES = [
    { rock: 'sandite', explosive: 'boomite' },
    { rock: 'sandite', explosive: 'krackle' },
    { rock: 'cruite', explosive: 'krackle' },
  ];
  const holes = patternHoles(3, 3, 3, 3);

  it('answers for every hole, each a valid range or null', () => {
    for (const { rock, explosive } of FIXTURES) {
      const ranges = recommendedPowderFactors(holes, bedGrid(rock, 14), explosive);
      expect(Object.keys(ranges).sort()).toEqual(holes.map(h => h.id).sort());
      for (const [id, range] of Object.entries(ranges)) {
        if (range === null) continue;
        const sweep = stemmingSweepRangeM(3)!;
        expect(range.minKgPerM3, id).toBeGreaterThan(0);
        expect(range.maxKgPerM3, id).toBeGreaterThanOrEqual(range.minKgPerM3);
        expect(range.maxStemmingM, id).toBeGreaterThanOrEqual(range.minStemmingM);
        // Swept stemmings are rounded to the 0.1 m the panel steps in.
        expect(range.minStemmingM, id).toBeGreaterThanOrEqual(sweep.lo - 0.05);
        expect(range.maxStemmingM, id).toBeLessThanOrEqual(sweep.hi + 0.05);
      }
    }
  });

  it('pairs the stemmings with the powder factors they fill to: least stemming, most explosive', () => {
    for (const { rock, explosive } of FIXTURES) {
      const ranges = recommendedPowderFactors(holes, bedGrid(rock, 14), explosive);
      for (const hole of holes) {
        const range = ranges[hole.id];
        if (!range) continue;
        expect(fillPowderFactor(hole, holes, explosive, range.minStemmingM), hole.id).toBeCloseTo(range.maxKgPerM3, 12);
        expect(fillPowderFactor(hole, holes, explosive, range.maxStemmingM), hole.id).toBeCloseTo(range.minKgPerM3, 12);
      }
    }
  });

  it('finds a range for at least one hole of the shallow fixtures', () => {
    const found = FIXTURES.some(({ rock, explosive }) => {
      const ranges = recommendedPowderFactors(holes, bedGrid(rock, 14), explosive);
      return Object.values(ranges).some(r => r !== null);
    });
    expect(found).toBe(true);
  });

  it('filling every hole at a stemming inside its range gives that hole a good share of at least the minimum', () => {
    let checked = 0;
    for (const { rock, explosive } of FIXTURES) {
      const grid = bedGrid(rock, 14);
      const ranges = recommendedPowderFactors(holes, grid, explosive);
      for (const hole of holes) {
        const range = ranges[hole.id];
        if (!range) continue;
        const stemming = Math.round(((range.minStemmingM + range.maxStemmingM) / 2) * 10) / 10;
        const mix = holeBandMixes(previewPlanBands(fillPlan(holes, explosive, stemming), grid), holes)[hole.id]!;
        // Inside the range the good share stays near the best sample's, itself at least the minimum.
        expect(mix.good, `${rock}/${explosive} ${hole.id}`).toBeGreaterThanOrEqual(RECOMMENDED_GOOD_SHARE_MIN * RECOMMENDED_RELATIVE_GOOD_SHARE - 0.02);
        const pf = fillPowderFactor(hole, holes, explosive, stemming);
        expect(pf).toBeGreaterThanOrEqual(range.minKgPerM3 - 1e-9);
        expect(pf).toBeLessThanOrEqual(range.maxKgPerM3 + 1e-9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('is null for every hole when the pattern stands over no rock', () => {
    const ranges = recommendedPowderFactors(holes, new VoxelGrid(40, 40), 'boomite');
    expect(Object.keys(ranges).sort()).toEqual(holes.map(h => h.id).sort());
    for (const range of Object.values(ranges)) expect(range).toBeNull();
  });

  it('is null for every hole for an unknown explosive', () => {
    const ranges = recommendedPowderFactors(holes, bedGrid('sandite', 14), 'nonexistent');
    expect(Object.keys(ranges).sort()).toEqual(holes.map(h => h.id).sort());
    for (const range of Object.values(ranges)) expect(range).toBeNull();
  });

  it('gives every hole of a standard pattern a range when the explosive suits the rock (regression: "No charge" everywhere)', () => {
    // The sandbox opening pattern: 3 x 3, 4 m apart, 8 m holes, 89 mm, in a deep bed.
    const standard = patternHoles(3, 3, 4, 8);
    for (const [rock, explosive] of [['molite', 'krackle'], ['cruite', 'boomite'], ['clunkite', 'shatternite']] as const) {
      const ranges = recommendedPowderFactors(standard, bedGrid(rock, 24), explosive);
      for (const hole of standard) expect(ranges[hole.id], `${rock}/${explosive} ${hole.id}`).not.toBeNull();
    }
  });

  it('recommends the stemmings that fragment the rock nearly as well as the best one, the best included', () => {
    const standard = patternHoles(3, 3, 4, 8);
    const grid = bedGrid('molite', 24);
    const centre = standard[4]!;
    const range = recommendedPowderFactors(standard, grid, 'krackle')[centre.id]!;
    expect(range).not.toBeNull();
    const samples = Array.from({ length: RECOMMENDED_SWEEP_STEPS }, (_, i) => {
      const stemming = sweepStemmingM(centre.depth, i, RECOMMENDED_SWEEP_STEPS);
      const mix = holeBandMixes(previewPlanBands(fillPlan(standard, 'krackle', stemming), grid), standard)[centre.id]!;
      return { stemming, pf: fillPowderFactor(centre, standard, 'krackle', stemming), good: mix.good };
    });
    const best = samples.reduce((a, b) => (b.good > a.good ? b : a));
    expect(best.stemming).toBeGreaterThanOrEqual(range.minStemmingM);
    expect(best.stemming).toBeLessThanOrEqual(range.maxStemmingM);
    expect(best.pf).toBeGreaterThanOrEqual(range.minKgPerM3 - 1e-9);
    expect(best.pf).toBeLessThanOrEqual(range.maxKgPerM3 + 1e-9);
    for (const sample of samples) {
      if (sample.stemming < range.minStemmingM || sample.stemming > range.maxStemmingM) continue;
      expect(sample.good).toBeGreaterThanOrEqual(best.good * RECOMMENDED_RELATIVE_GOOD_SHARE - 1e-9);
    }
    // The run's ends are swept samples: what the panel shows can be dialled in exactly.
    expect(samples.map(x => x.stemming)).toContain(range.minStemmingM);
    expect(samples.map(x => x.stemming)).toContain(range.maxStemmingM);
  });

  it('is null for a hole no charge of the explosive fragments well', () => {
    // Black powder in hard rock, holes 8 m apart: the good band never covers more than a sliver of the cell.
    const wide = patternHoles(1, 2, 8, 8);
    const ranges = recommendedPowderFactors(wide, bedGrid('titanite', 14), 'pop_rock');
    for (const hole of wide) expect(ranges[hole.id]).toBeNull();
  });

  it('is null for a hole too shallow to sweep, and still answers for the others', () => {
    const grid = bedGrid('sandite', 14);
    const mixed = [...holes, drillHole('HX', 20, 20, MIN_STEMMING_M + MIN_CHARGE_COLUMN_M - 0.2)];
    const ranges = recommendedPowderFactors(mixed, grid, 'boomite');
    expect(ranges['HX']).toBeNull();
    expect(Object.keys(ranges).sort()).toEqual(mixed.map(h => h.id).sort());
  });

  it('is empty with no holes', () => {
    expect(recommendedPowderFactors([], bedGrid(), 'boomite')).toEqual({});
  });

  it('accepts the wet holes like the other previews', () => {
    const { rock, explosive } = FIXTURES[0]!;
    const grid = bedGrid(rock, 14);
    const dry = recommendedPowderFactors(holes, grid, explosive);
    expect(recommendedPowderFactors(holes, grid, explosive, new Set())).toEqual(dry);
    const wet = recommendedPowderFactors(holes, grid, explosive, new Set(holes.map(h => h.id)));
    expect(Object.keys(wet).sort()).toEqual(Object.keys(dry).sort());
  });
});
