import { describe, it, expect, beforeEach } from 'vitest';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { createGridPlan, resetHoleIds } from '../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../src/core/mining/ChargePlan.js';
import { autoVPattern } from '../../src/core/mining/Sequence.js';
import { assembleBlastPlan } from '../../src/core/mining/BlastPlan.js';
import { executeBlast } from '../../src/core/mining/BlastExecution.js';
import type { VillagePosition } from '../../src/core/mining/BlastExecution.js';
import { vec3 } from '../../src/core/math/Vec3.js';

// Helper: fill a region of the grid with a rock type
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
          rockId: rock,
          density: 1.0,
          oreDensities: ores,
          fractureModifier: 1.0,
        });
      }
    }
  }
}

const VILLAGE_FAR: VillagePosition[] = [
  { id: 'testville', position: vec3(200, 0, 200) },
];

beforeEach(() => resetHoleIds());

describe('Blast execution — integration', () => {
  it('well-designed plan on soft rock → fragments, good/perfect rating', () => {
    const grid = new VoxelGrid(40, 20, 40);
    // Fill with molite (tier 2, threshold=500) — medium rock
    fillRegion(grid, 'molite', 5, 25, 0, 10, 5, 25, 'blingite', 0.2);

    // Boomite 8kg (max): 340×8=2720E. Stemming 2m, depth 8: downward ≈ 2494E.
    // At hole pos (EPSILON=4): 2494/4 = 624. Ratio = 624/500 = 1.25 → good frag.
    // With neighbor contributions at midpoints, ratio ~1.5-2.5 → good to fine frag.
    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 2);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, VILLAGE_FAR);
    expect(result).not.toBeNull();
    expect(result!.fragmentCount).toBeGreaterThan(0);
    expect(result!.clearedVoxels).toBeGreaterThan(0);
    expect(result!.rating).toMatch(/perfect|good/);
  });

  it('overcharged blast on soft rock → projections, bad/catastrophic rating', () => {
    const grid = new VoxelGrid(40, 20, 40);
    fillRegion(grid, 'cruite', 5, 25, 0, 10, 5, 25);

    // Overcharge: dynatomics (1300 E/kg) × 25kg on soft cruite (threshold 200)
    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 3, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'dynatomics', 25, 1);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, VILLAGE_FAR);
    expect(result).not.toBeNull();
    expect(result!.projectionCount).toBeGreaterThan(0);
    expect(result!.rating).toMatch(/bad|catastrophic/);
  });

  it('undercharged blast on hard rock → mostly unaffected, bad rating', () => {
    const grid = new VoxelGrid(40, 20, 40);
    // Fill with titanite (tier 5, threshold=4000)
    fillRegion(grid, 'titanite', 5, 25, 0, 10, 5, 25);

    // Undercharge: pop_rock (200 E/kg) × 2kg — way too weak
    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 3, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'pop_rock', 2, 1);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, VILLAGE_FAR);
    expect(result).not.toBeNull();
    // Very few or no cleared voxels since energy < threshold
    expect(result!.clearedVoxels).toBeLessThan(20);
    expect(result!.rating).toBe('bad');
  });

  it('terrain voxels are cleared after blast', () => {
    const grid = new VoxelGrid(30, 15, 30);
    fillRegion(grid, 'cruite', 8, 20, 0, 8, 8, 20);

    // Verify voxels are solid before blast
    const beforeVoxel = grid.getVoxel(12, 2, 12);
    expect(beforeVoxel?.density).toBe(1.0);

    const holes = createGridPlan({ x: 12, z: 12 }, 2, 2, 3, 6, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 1.5);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();
    expect(result!.clearedVoxels).toBeGreaterThan(0);

    // Count cleared voxels near the blast center
    let clearedCount = 0;
    for (let z = 10; z <= 14; z++) {
      for (let y = 0; y <= 4; y++) {
        for (let x = 10; x <= 14; x++) {
          const v = grid.getVoxel(x, y, z);
          if (v && v.density === 0) clearedCount++;
        }
      }
    }
    expect(clearedCount).toBeGreaterThan(0);
  });

  it('fragment ore densities match parent voxels', () => {
    const grid = new VoxelGrid(30, 15, 30);
    fillRegion(grid, 'cruite', 8, 20, 0, 8, 8, 20, 'blingite', 0.5);

    const holes = createGridPlan({ x: 12, z: 12 }, 2, 2, 3, 6, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 5, 2);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();
    expect(result!.fragments.length).toBeGreaterThan(0);

    // All fragments from this blast should have blingite ore
    const withOre = result!.fragments.filter(f => (f.oreDensities['blingite'] ?? 0) > 0);
    expect(withOre.length).toBe(result!.fragments.length);
    expect(withOre[0]!.oreDensities['blingite']).toBe(0.5);
  });

  it('returns null for invalid blast plan', () => {
    const grid = new VoxelGrid(20, 10, 20);
    const holes = createGridPlan({ x: 5, z: 5 }, 1, 1, 3, 6, 0.15);
    // No charges → invalid
    const plan = assembleBlastPlan(holes, {}, {});
    const result = executeBlast(plan, grid, []);
    expect(result).toBeNull();
  });
});
