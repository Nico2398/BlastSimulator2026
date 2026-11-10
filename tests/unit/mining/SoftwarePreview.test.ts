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
  uniformChargePlan,
  previewExplosiveBandShares,
  recommendedPowderFactors,
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
import { batchCharge, chargeFitsHole, holeSpacingM, powderFactor, maxFittingChargeKg } from '../../../src/core/mining/ChargePlan.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import { RECOMMENDED_GOOD_SHARE_MIN, RECOMMENDED_RELATIVE_GOOD_SHARE, RECOMMENDED_SWEEP_STEPS, FRAGMENTATION_MULTIPLIER, FRAGMENTATION_BAND_FINES_MIN, FRAGMENTATION_BAND_DUST_MIN, CRACKED_VOXEL_ENERGY_RATIO } from '../../../src/core/config/balance.js';
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

  it('predicts pieces larger than a voxel where the rock barely broke', () => {
    // Under one seed per voxel the rock joins a neighbour, so the piece coming
    // out is bigger than the voxel it was measured in.
    expect(predictFragmentation(1).sizeM3).toBeGreaterThan(1);
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
    // The sandbox opening pattern in a deep bed: its undermined cap lifts and breaks out as blocks.
    const grid = bedGrid('molite', 24);
    const plan = uniformChargePlan(patternHoles(3, 3, 4, 8), 'krackle', 8, 2.5);
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
    const plan = uniformChargePlan(patternHoles(3, 3, 4, 8), 'krackle', 8, 2.5);
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

describe('SoftwarePreview — uniformChargePlan (#2203)', () => {
  it('charges every hole with the explosive, amount and stemming', () => {
    const holes = patternHoles(2, 2, 3, 8);
    const plan = uniformChargePlan(holes, 'krackle', 3, 2);
    expect(plan.holes).toEqual(holes);
    expect(Object.keys(plan.charges).sort()).toEqual(holes.map(h => h.id).sort());
    for (const h of holes) {
      expect(plan.charges[h.id]).toEqual({ explosiveId: 'krackle', amountKg: 3, stemmingM: 2 });
    }
  });

  it('caps the amount to what fits the hole under that stemming', () => {
    const holes = patternHoles(1, 2, 3, 4);
    const plan = uniformChargePlan(holes, 'boomite', 500, 2);
    for (const h of holes) {
      const charge = plan.charges[h.id]!;
      expect(charge.amountKg).toBeGreaterThan(0);
      expect(charge.amountKg).toBeLessThan(500);
      expect(chargeFitsHole(charge.amountKg, 2, h.depth, h.diameter)).toBe(true);
      expect(charge.explosiveId).toBe('boomite');
      expect(charge.stemmingM).toBe(2);
    }
  });

  it('caps each hole to its own depth', () => {
    const shallow = drillHole('H1', 10, 10, 4);
    const deep = drillHole('H2', 14, 10, 10);
    const plan = uniformChargePlan([shallow, deep], 'boomite', 500, 2);
    expect(plan.charges['H1']!.amountKg).toBeLessThan(plan.charges['H2']!.amountKg);
  });

  it('is an empty plan for no holes', () => {
    const plan = uniformChargePlan([], 'boomite', 3, 2);
    expect(plan.holes).toEqual([]);
    expect(plan.charges).toEqual({});
  });
});

describe('SoftwarePreview — previewExplosiveBandShares (#2203 C4)', () => {
  const holes = patternHoles(2, 2, 3, 6, 0.15);

  it('is null with no holes', () => {
    expect(previewExplosiveBandShares([], bedGrid(), 'boomite', 4, 2)).toBeNull();
  });

  it('is null when the pattern stands over no rock', () => {
    expect(previewExplosiveBandShares(holes, new VoxelGrid(40, 40), 'boomite', 4, 2)).toBeNull();
  });

  it('returns shares in 0..1 that sum to 1', () => {
    const shares = previewExplosiveBandShares(holes, bedGrid(), 'boomite', 5, 2)!;
    expect(shares).not.toBeNull();
    expect(sumShares(shares)).toBeCloseTo(1, 10);
    for (const b of FRAGMENTATION_BANDS) {
      expect(shares[b]).toBeGreaterThanOrEqual(0);
      expect(shares[b]).toBeLessThanOrEqual(1);
    }
  });

  it('is the pooled band shares of the uniform plan on the same field the heatmap reads', () => {
    const grid = bedGrid();
    const direct = planBandShares(previewPlanBands(uniformChargePlan(holes, 'boomite', 6, 2), grid), holes)!;
    const shares = previewExplosiveBandShares(holes, grid, 'boomite', 6, 2)!;
    for (const b of FRAGMENTATION_BANDS) expect(shares[b], b).toBeCloseTo(direct[b], 10);
  });

  it('a heavier charge crushes more of the rock to fines and dust', () => {
    const grid = bedGrid();
    const light = previewExplosiveBandShares(holes, grid, 'boomite', 4, 2)!;
    const heavy = previewExplosiveBandShares(holes, grid, 'boomite', 20, 2)!;
    expect(heavy.fines + heavy.dust).toBeGreaterThan(light.fines + light.dust);
    expect(heavy.intact).toBeLessThan(light.intact);
  });

  it('a stronger explosive at the same weight gives a different mix', () => {
    const grid = bedGrid();
    const weak = previewExplosiveBandShares(holes, grid, 'pop_rock', 3, 2)!;
    const strong = previewExplosiveBandShares(holes, grid, 'dynatomics', 3, 2)!;
    expect(strong).not.toEqual(weak);
    expect(strong.intact).toBeLessThan(weak.intact);
  });

  it('wet holes weaken a water-sensitive explosive and leave a resistant one alone', () => {
    const grid = bedGrid();
    const wet = new Set(holes.map(h => h.id));
    const sensitiveDry = previewExplosiveBandShares(holes, grid, 'big_bada_boom', 8, 1)!;
    const sensitiveWet = previewExplosiveBandShares(holes, grid, 'big_bada_boom', 8, 1, wet)!;
    expect(sensitiveWet).not.toEqual(sensitiveDry);
    expect(sensitiveWet.intact).toBeGreaterThan(sensitiveDry.intact);
    expect(previewExplosiveBandShares(holes, grid, 'krackle', 8, 1, wet)).toEqual(previewExplosiveBandShares(holes, grid, 'krackle', 8, 1));
  });

  it('an omitted wet set equals an explicit empty one', () => {
    const grid = bedGrid();
    expect(previewExplosiveBandShares(holes, grid, 'boomite', 5, 2, new Set())).toEqual(previewExplosiveBandShares(holes, grid, 'boomite', 5, 2));
  });
});

describe('SoftwarePreview — recommendedPowderFactors (#2203 C3)', () => {
  // Shallow 3 x 3 patterns, 3 m apart: small rock cells, so the good band covers a large share of them.
  const FIXTURES = [
    { rock: 'sandite', explosive: 'boomite', stemming: 1 },
    { rock: 'sandite', explosive: 'krackle', stemming: 2 },
    { rock: 'cruite', explosive: 'krackle', stemming: 2 },
  ];
  const holes = patternHoles(3, 3, 3, 3);

  it('answers for every hole, each a valid range or null', () => {
    const { rock, explosive, stemming } = FIXTURES[0]!;
    const ranges = recommendedPowderFactors(holes, bedGrid(rock, 14), explosive, stemming);
    expect(Object.keys(ranges).sort()).toEqual(holes.map(h => h.id).sort());
    for (const range of Object.values(ranges)) {
      if (range === null) continue;
      expect(range.minKgPerM3).toBeGreaterThan(0);
      expect(range.maxKgPerM3).toBeGreaterThanOrEqual(range.minKgPerM3);
    }
  });

  it('finds a range for at least one hole of the shallow fixtures', () => {
    const found = FIXTURES.some(({ rock, explosive, stemming }) => {
      const ranges = recommendedPowderFactors(holes, bedGrid(rock, 14), explosive, stemming);
      return Object.values(ranges).some(r => r !== null);
    });
    expect(found).toBe(true);
  });

  it('charging every hole at a powder factor inside its range gives that hole a good share of at least the minimum', () => {
    let checked = 0;
    for (const { rock, explosive, stemming } of FIXTURES) {
      const grid = bedGrid(rock, 14);
      const ranges = recommendedPowderFactors(holes, grid, explosive, stemming);
      for (const hole of holes) {
        const range = ranges[hole.id];
        if (!range) continue;
        const spacing = holeSpacingM(hole, holes);
        const pf = (range.minKgPerM3 + range.maxKgPerM3) / 2;
        const amountKg = pf * spacing * spacing * hole.depth;
        const plan = uniformChargePlan(holes, explosive, amountKg, stemming);
        const mix = holeBandMixes(previewPlanBands(plan, grid), holes)[hole.id]!;
        // Inside the range the good share stays near the best sample's, itself at least the minimum.
        expect(mix.good, `${rock}/${explosive} ${hole.id}`).toBeGreaterThanOrEqual(RECOMMENDED_GOOD_SHARE_MIN * RECOMMENDED_RELATIVE_GOOD_SHARE - 0.02);
        expect(powderFactor(plan.charges[hole.id]!.amountKg, hole.depth, spacing)).toBeCloseTo(pf, 6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('is null for every hole when the pattern stands over no rock', () => {
    const ranges = recommendedPowderFactors(holes, new VoxelGrid(40, 40), 'boomite', 1);
    expect(Object.keys(ranges).sort()).toEqual(holes.map(h => h.id).sort());
    for (const range of Object.values(ranges)) expect(range).toBeNull();
  });

  it('gives every hole of a standard pattern a range when the explosive suits the rock (regression: "No charge" everywhere)', () => {
    // The sandbox opening pattern: 3 x 3, 4 m apart, 8 m holes, 89 mm, 2.5 m stemming, in a deep bed.
    const standard = patternHoles(3, 3, 4, 8);
    for (const [rock, explosive] of [['molite', 'krackle'], ['cruite', 'boomite'], ['clunkite', 'shatternite']] as const) {
      const ranges = recommendedPowderFactors(standard, bedGrid(rock, 24), explosive, 2.5);
      for (const hole of standard) expect(ranges[hole.id], `${rock}/${explosive} ${hole.id}`).not.toBeNull();
    }
  });

  it('recommends the charges that fragment the rock nearly as well as the best one, the best included', () => {
    const standard = patternHoles(3, 3, 4, 8);
    const grid = bedGrid('molite', 24);
    const centre = standard[4]!;
    const range = recommendedPowderFactors(standard, grid, 'krackle', 2.5)[centre.id]!;
    const spacing = holeSpacingM(centre, standard);
    const fit = maxFittingChargeKg(centre.depth, 2.5, centre.diameter);
    const samples = Array.from({ length: RECOMMENDED_SWEEP_STEPS }, (_, i) => {
      const kg = fit * ((i + 1) / RECOMMENDED_SWEEP_STEPS);
      const mix = holeBandMixes(previewPlanBands(uniformChargePlan(standard, 'krackle', kg, 2.5), grid), standard)[centre.id]!;
      return { pf: powderFactor(kg, centre.depth, spacing), good: mix.good };
    });
    const best = samples.reduce((a, b) => (b.good > a.good ? b : a));
    expect(best.pf).toBeGreaterThanOrEqual(range.minKgPerM3 - 1e-9);
    expect(best.pf).toBeLessThanOrEqual(range.maxKgPerM3 + 1e-9);
    for (const sample of samples) {
      if (sample.pf < range.minKgPerM3 - 1e-9 || sample.pf > range.maxKgPerM3 + 1e-9) continue;
      expect(sample.good).toBeGreaterThanOrEqual(best.good * RECOMMENDED_RELATIVE_GOOD_SHARE - 1e-9);
    }
  });

  it('is null for a hole no charge of the explosive fragments well', () => {
    // Black powder in hard rock, holes 8 m apart: the good band never covers more than a sliver of the cell.
    const wide = patternHoles(1, 2, 8, 8);
    const ranges = recommendedPowderFactors(wide, bedGrid('titanite', 14), 'pop_rock', 2);
    for (const hole of wide) expect(ranges[hole.id]).toBeNull();
  });

  it('is empty with no holes', () => {
    expect(recommendedPowderFactors([], bedGrid(), 'boomite', 2)).toEqual({});
  });

  it('accepts the wet holes like the other previews', () => {
    const { rock, explosive, stemming } = FIXTURES[0]!;
    const grid = bedGrid(rock, 14);
    const dry = recommendedPowderFactors(holes, grid, explosive, stemming);
    expect(recommendedPowderFactors(holes, grid, explosive, stemming, new Set())).toEqual(dry);
    const wet = recommendedPowderFactors(holes, grid, explosive, stemming, new Set(holes.map(h => h.id)));
    expect(Object.keys(wet).sort()).toEqual(Object.keys(dry).sort());
  });
});
