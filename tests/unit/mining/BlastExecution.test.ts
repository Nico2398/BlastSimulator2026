// BlastSimulator2026 — BlastExecution unit tests
// Focused on the shape of the hole a blast leaves in the terrain: a charge with
// enough energy for its burden must break through to the surface, one buried too
// deep must not, and neither may touch rock outside the blast zone.

import { describe, it, expect, beforeEach } from 'vitest';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import { createGridPlan, resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../../src/core/mining/ChargePlan.js';
import { autoVPattern } from '../../../src/core/mining/Sequence.js';
import { assembleBlastPlan } from '../../../src/core/mining/BlastPlan.js';
import { executeBlast } from '../../../src/core/mining/BlastExecution.js';

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

describe('executeBlast — crater', () => {
  it('breaks through to the surface, so the blast leaves a visible crater', () => {
    const grid = new VoxelGrid(40, 20, 40);
    fillRegion(grid, 'molite', 5, 25, 0, 10, 5, 25, 'blingite', 0.2);

    // 2×3 grid, spacing 4, origin (12,12) — holes at x∈{12,16,20}, z∈{12,16}.
    const holes = createGridPlan({ x: 12, z: 12 }, 2, 3, 4, 8, 0.15);
    const holeIds = holes.map(h => h.id);
    const holeDepths: Record<string, number> = {};
    for (const h of holes) holeDepths[h.id] = h.depth;

    const { charges } = batchCharge(holeIds, holeDepths, 'boomite', 8, 2);
    const delays = autoVPattern(holes, 25);
    const plan = assembleBlastPlan(holes, charges, delays);

    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();
    expect(result!.clearedVoxels).toBeGreaterThan(0);

    // The charges sit at the bottom of the holes, so a blast that only broke
    // rock around them would leave a sealed cavity under intact ground — the
    // player would see nothing happen. The burden above has to come out too.
    let surfaceOpened = 0;
    for (let z = 5; z <= 25; z++) {
      for (let x = 5; x <= 25; x++) {
        if (grid.densityAt(x, 10, z) === 0) surfaceOpened++;
      }
    }
    expect(surfaceOpened, 'no surface voxel was removed — the crater is buried').toBeGreaterThan(0);

    // And the ground directly over a hole is gone.
    expect(grid.densityAt(12, 10, 12)).toBe(0);
  });

  it('leaves rock standing where the charge is buried too deep to break out', () => {
    // A single small charge at the bottom of a very deep hole: it breaks rock
    // around itself, but the burden above is far too thick to lift.
    const grid = new VoxelGrid(40, 40, 40);
    fillRegion(grid, 'molite', 5, 25, 0, 30, 5, 25);

    const holes = createGridPlan({ x: 15, z: 15 }, 1, 1, 4, 28, 0.15);
    const holeDepths: Record<string, number> = { [holes[0]!.id]: holes[0]!.depth };
    const { charges } = batchCharge([holes[0]!.id], holeDepths, 'boomite', 2, 2);
    const plan = assembleBlastPlan(holes, charges, autoVPattern(holes, 25));

    const result = executeBlast(plan, grid, []);
    expect(result).not.toBeNull();
    expect(result!.clearedVoxels).toBeGreaterThan(0);

    // The surface over the hole survives: too much burden to break out.
    expect(grid.densityAt(15, 30, 15)).toBeGreaterThan(0);
  });

  it('does not excavate voxels far outside the blast zone', () => {
    const grid = new VoxelGrid(60, 15, 60);
    fillRegion(grid, 'molite', 5, 25, 0, 10, 5, 25, 'blingite', 0.2);
    // Solid column far from the drill grid — outside the energy bbox
    // (BLAST_ZONE_RADIUS), so nothing should touch it.
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
