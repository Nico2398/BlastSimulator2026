import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeHoleContext,
  readVoxelPrediction,
  predictFragmentation,
  getBlastBBox,
  forEachBBoxVoxel,
  previewPlanBands,
  PREVIEW_RADIUS,
} from '../../../src/core/mining/SoftwarePreview.js';
import { buildPlanEnergyField } from '../../../src/core/mining/BlastExecution.js';
import { intensityAt } from '../../../src/core/mining/EnergyPropagation.js';
import { classifyFragmentationBand } from '../../../src/core/mining/FragmentationBand.js';
import { VoxelGrid, firstEmptyLayerAboveGround } from '../../../src/core/world/VoxelGrid.js';
import { createGridPlan } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
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
  it('reports each cell with the intensity of the blast\'s own energy field and its classified band', () => {
    const { grid, plan } = makeTestPlan();
    const field = buildPlanEnergyField(plan, grid)!;
    const map = previewPlanBands(plan, grid);

    expect(map.cells.size).toBeGreaterThan(0);
    for (const [key, cell] of map.cells) {
      expect(key).toBe(`${cell.x},${cell.y},${cell.z}`);
      expect(cell.intensity).toBe(intensityAt(field, cell.x, cell.y, cell.z));
      expect(cell.band).toBe(classifyFragmentationBand(cell.intensity));
    }
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

  it('every intensity is non-negative and every band is one of the five', () => {
    const { grid, plan } = makeTestPlan();
    for (const cell of previewPlanBands(plan, grid).cells.values()) {
      expect(cell.intensity).toBeGreaterThanOrEqual(0);
      expect(['intact', 'cracked', 'good', 'fines', 'dust']).toContain(cell.band);
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
