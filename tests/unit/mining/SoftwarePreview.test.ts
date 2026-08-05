import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeHoleContext,
  readVoxelPrediction,
  predictFragmentation,
  getBlastBBox,
  PREVIEW_RADIUS,
} from '../../../src/core/mining/SoftwarePreview.js';
import { buildPlanEnergyField } from '../../../src/core/mining/BlastExecution.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { createGridPlan, resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { vec3 } from '../../../src/core/math/Vec3.js';
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
    const plan = assembleBlastPlan(holes, {}, []);
    const ctx = computeHoleContext(plan, grid);
    expect(ctx.holeSurfaceYs[holes[0]!.id]).toBe(0);
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
    expect(bbox.minY).toBeGreaterThanOrEqual(0);
  });
});
