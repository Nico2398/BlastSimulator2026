import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeHoleContext,
  getVoxelEnergyThreshold,
  getBlastBBox,
  PREVIEW_RADIUS,
} from '../../../src/core/mining/SoftwarePreview.js';
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

describe('SoftwarePreview — getVoxelEnergyThreshold', () => {
  it('returns rock, energy and threshold for a filled voxel near the blast', () => {
    const { grid, plan } = makeTestPlan();
    const ctx = computeHoleContext(plan, grid);
    const result = getVoxelEnergyThreshold(grid, 10, 5, 10, vec3(10, 5, 10), plan, ctx);
    expect(result).not.toBeNull();
    expect(result!.rock.id).toBe('molite');
    expect(result!.energy).toBeGreaterThanOrEqual(0);
    expect(result!.threshold).toBeGreaterThan(0);
  });

  it('returns null for an empty voxel', () => {
    const { grid, plan } = makeTestPlan();
    const ctx = computeHoleContext(plan, grid);
    const result = getVoxelEnergyThreshold(grid, 0, 14, 0, vec3(0, 14, 0), plan, ctx);
    expect(result).toBeNull();
  });

  it('returns null for an out-of-bounds voxel', () => {
    const { grid, plan } = makeTestPlan();
    const ctx = computeHoleContext(plan, grid);
    const result = getVoxelEnergyThreshold(grid, -1, -1, -1, vec3(-1, -1, -1), plan, ctx);
    expect(result).toBeNull();
  });
});

describe('SoftwarePreview — getBlastBBox', () => {
  it('bounds every hole with PREVIEW_RADIUS of margin', () => {
    const { grid, plan } = makeTestPlan();
    const bbox = getBlastBBox(plan, grid);
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
