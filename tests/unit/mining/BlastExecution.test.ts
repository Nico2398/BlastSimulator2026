// BlastSimulator2026 — BlastExecution unit tests
// Focused on the crater excavation guarantee pass (5a): after a successful blast,
// the surface column at the blast center must be cleared so the player always
// sees a visible crater, and excavation must not spread past the configured
// max radius (previously computed via a duplicate ad-hoc centroid instead of
// the shared calculateBlastCenter() helper).

import { describe, it, expect, beforeEach } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { createGridPlan, resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { autoVPattern } from '../../../src/core/mining/Sequence.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { executeBlast, buildBlastReport, type BlastResult } from '../../../src/core/mining/BlastExecution.js';
import { GRAVITY } from '../../../src/core/config/balance.js';

function fillRegion(
  grid: VoxelGrid,
  rock: string,
  minX: number, maxX: number,
  minY: number, maxY: number,
  minZ: number, maxZ: number,
  oreId?: string,
  oreDensity?: number,
) {
  for (let z = minZ; z <= maxZ; z++) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const ores: Record<string, number> = {};
        if (oreId && oreDensity) ores[oreId] = oreDensity;
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId: rock, coefficient: 1.0 }] },
          density: 1.0,
          oreDensities: ores,
          fractureModifier: 1.0,
        });
      }
    }
  }
}

beforeEach(() => resetHoleIds());

describe('executeBlast — crater excavation guarantee', () => {
  it('always clears the surface column at the blast center after a successful blast', () => {
    const grid = new VoxelGrid(40, 20, 40);
    fillRegion(grid, 'molite', 5, 25, 0, 10, 5, 25, 'blingite', 0.2);

    // Same fixture as the "well-designed plan" integration test: 2x3 grid,
    // spacing 4, origin (12,12) — blast center averages to (16, 14).
    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 2);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const beforeCenter = grid.getVoxel(16, 10, 14);
    expect(beforeCenter?.density).toBe(1.0);

    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();
    expect(result!.clearedVoxels).toBeGreaterThan(0);

    const afterCenter = grid.getVoxel(16, 10, 14);
    expect(afterCenter?.density).toBe(0);
  });

  it('does not excavate voxels far outside the blast zone and excavation radius', () => {
    const grid = new VoxelGrid(60, 15, 60);
    fillRegion(grid, 'molite', 5, 25, 0, 10, 5, 25, 'blingite', 0.2);
    // Solid column far from the drill grid — outside both the energy bbox
    // (BLAST_ZONE_RADIUS) and the crater excavation radius cap.
    fillRegion(grid, 'molite', 50, 55, 0, 10, 50, 55);

    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 2);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();

    const farVoxel = grid.getVoxel(52, 10, 52);
    expect(farVoxel?.density).toBe(1.0);
  });

  it('returns null and leaves terrain untouched for an invalid blast plan', () => {
    const grid = new VoxelGrid(20, 10, 20);
    const holes = createGridPlan({ x: 5, z: 5 }, 1, 1, 3, 6, 0.15);
    fillRegion(grid, 'cruite', 0, 19, 0, 5, 0, 19);
    const plan = assembleBlastPlan(holes, {}, {});

    const result = executeBlast(plan, grid, []);
    expect(result).toBeNull();
    expect(grid.getVoxel(5, 5, 5)?.density).toBe(1.0);
  });
});

describe('buildBlastReport', () => {
  it('carries the tick, rating, and per-blast totals straight from the result', () => {
    const grid = new VoxelGrid(40, 20, 40);
    fillRegion(grid, 'molite', 5, 25, 0, 10, 5, 25, 'blingite', 0.2);
    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;
    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 2);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();

    const report = buildBlastReport(result!, 42, 960);
    expect(report.tick).toBe(42);
    expect(report.spent).toBe(960);
    expect(report.rating).toBe(result!.rating);
    expect(report.clearedVoxels).toBe(result!.clearedVoxels);
    expect(report.crackedVoxels).toBe(result!.crackedVoxels);
    expect(report.fragmentCount).toBe(result!.fragmentCount);
    expect(report.oversizedFragments).toBe(result!.oversizedFragments);
    expect(report.totalRockVolume).toBe(result!.totalRockVolume);
    expect(report.projectionCount).toBe(result!.projectionCount);
    expect(report.totalOreValue).toBe(result!.totalOreValue);
    expect(report.destroyedBuildings).toBe(result!.destroyedBuildings);
  });

  it('estimates max projection distance as the 45°-launch range of the fastest projected fragment', () => {
    const grid = new VoxelGrid(40, 20, 40);
    fillRegion(grid, 'molite', 5, 25, 0, 10, 5, 25, 'blingite', 0.2);
    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;
    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 2);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);
    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();

    const report = buildBlastReport(result!, 0, 0);
    const expectedRange = (result!.maxProjectionSpeed * result!.maxProjectionSpeed) / Math.abs(GRAVITY);
    expect(report.maxProjectionDistanceM).toBeCloseTo(expectedRange, 6);
  });

  it('reports zero projection distance when nothing was projected', () => {
    // Hand-built minimal BlastResult rather than a real blast pipeline —
    // this is testing buildBlastReport's arithmetic in isolation, not
    // executeBlast's decision about when projection happens.
    const result: BlastResult = {
      fragments: [],
      fragmentCount: 0,
      averageFragmentSize: 0,
      oversizedFragments: 0,
      projectionCount: 0,
      maxProjectionSpeed: 0,
      vibrationAtVillages: [],
      totalRockVolume: 0,
      totalOreValue: 0,
      rating: 'mediocre',
      crackedVoxels: 0,
      clearedVoxels: 0,
      clearedRegion: { minX: 0, maxX: 0, minZ: 0, maxZ: 0 },
      destroyedBuildings: [],
      secondaryBlastEvents: [],
    };
    const report = buildBlastReport(result, 0, 0);
    expect(report.maxProjectionDistanceM).toBe(0);
  });
});
