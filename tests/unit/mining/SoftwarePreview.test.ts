import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeHoleContext,
  readVoxelPrediction,
  predictFragmentation,
  getBlastBBox,
  forEachBBoxVoxel,
  PREVIEW_RADIUS,
} from '../../../src/core/mining/SoftwarePreview.js';
import { buildPlanEnergyField } from '../../../src/core/mining/BlastExecution.js';
import { VoxelGrid, firstEmptyLayerAboveGround } from '../../../src/core/world/VoxelGrid.js';
import { createGridPlan, resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { autoVPattern } from '../../../src/core/mining/Sequence.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { makeTestPlan } from './softwareTestFixtures.js';

beforeEach(() => resetHoleIds());

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
    const grid = new VoxelGrid(5, 5, 5);
    const holes = createGridPlan({ x: 2, z: 2 }, 1, 1, 3, 2, 0.1);
    const plan = assembleBlastPlan(holes, {}, {});
    const ctx = computeHoleContext(plan, grid);
    expect(ctx.holeSurfaceYs[holes[0]!.id]).toBe(0);
  });

  // #1184: getHoleSurfaceYs must come from the shared column query
  // (computeVoxelColumnSurfaceY / firstEmptyLayerAboveGround), not a scan
  // fixed to [0, grid.sizeY) — a hole above a column whose surface sits
  // below y = 0 must report the true (negative) surface, not the fallback 0
  // a bounded scan would wrongly produce.
  it('#1184: reports the true surface Y for a hole above a column whose surface sits below y = 0', () => {
    const grid = new VoxelGrid(10, 5, 10);
    grid.setVoxel(3, -5, 3, {
      composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
    const holes = createGridPlan({ x: 3, z: 3 }, 1, 1, 3, 2, 0.1);
    const plan = assembleBlastPlan(holes, {}, {});

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
    const grid = new VoxelGrid(20, 5, 20);
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

    const holes = createGridPlan({ x: 10, z: 10 }, 1, 1, 3, 4, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;
    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 5, 2);
    const plan = assembleBlastPlan(holes, charges, autoVPattern(holes, 25));

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
    const grid = new VoxelGrid(16, 8, 16);
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

    const holes = createGridPlan({ x: -5, z: 5 }, 1, 1, 3, 4, 0.15);
    const plan = assembleBlastPlan(holes, {}, {});

    const ctx = computeHoleContext(plan, grid);
    expect(ctx.holeSurfaceYs[holes[0]!.id]).toBe(1);
  });
});
