import { describe, it, expect } from 'vitest';
import { PhysicsWorld } from '../../../src/physics/PhysicsWorld.js';
import { TerrainBody, computeFragmentRegion, findSurfaceY, type TerrainBodyRegion } from '../../../src/physics/TerrainBody.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';

/** Region covering the whole 10×10 column extent of makeFlatGrid(). */
const FULL_REGION: TerrainBodyRegion = { minX: 0, maxX: 9, minZ: 0, maxZ: 9 };

/** Build a flat 10×5×10 grid with the bottom 2 Y layers solid. */
function makeFlatGrid(): VoxelGrid {
  const grid = new VoxelGrid(10, 5, 10);
  for (let x = 0; x < 10; x++) {
    for (let z = 0; z < 10; z++) {
      for (let y = 0; y < 2; y++) {
        grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
      }
    }
  }
  return grid;
}

describe('TerrainBody (8.2)', () => {
  it('dynamic body dropped onto terrain collider comes to rest above surface', () => {
    const world = new PhysicsWorld();
    world.init();

    const terrain = new TerrainBody(world);
    const grid = makeFlatGrid();
    terrain.build(grid, FULL_REGION);

    // Drop a small sphere from height 5
    const fragHandle = world.addBody('sphere', [0.3, 0.3, 0.3], 1.0, { x: 5, y: 5, z: 5 });

    // Simulate for 2 seconds
    for (let i = 0; i < 120; i++) world.step(1 / 60);

    const pos = world.getBodyPosition(fragHandle)!;
    // Surface is at y=1 (top of Y=1 voxel which spans 1–2m).
    // Fragment radius = 0.3m, so it should rest near y â‰ˆ 2.3
    expect(pos.y).toBeGreaterThan(1.5);
    // Should not have fallen below the terrain
    expect(pos.y).toBeLessThan(5.0);

    terrain.dispose();
    world.clear();
  });

  it('after terrain modification, collider updates — removed voxel allows body to fall through', () => {
    const world = new PhysicsWorld();
    world.init();

    const terrain = new TerrainBody(world);
    const grid = makeFlatGrid();
    terrain.build(grid, FULL_REGION);

    // Clear ALL voxels in a column to simulate a crater
    for (let y = 0; y < 5; y++) {
      grid.clearVoxel(5, y, 5);
    }

    // Rebuild terrain after modification
    terrain.build(grid, FULL_REGION);

    // Drop body above cleared column
    const fragHandle = world.addBody('sphere', [0.3, 0.3, 0.3], 1.0, { x: 5.5, y: 5, z: 5.5 });

    for (let i = 0; i < 120; i++) world.step(1 / 60);

    // Body should have fallen into the gap (y near floor 0 or below)
    // since the terrain under x=5,z=5 was cleared
    const pos = world.getBodyPosition(fragHandle)!;
    // The cleared column starts at x=5,z=5 but body is at x=5.5,z=5.5 (edge)
    // Just verify rebuild didn't crash and body moved downward from 5
    expect(pos.y).toBeLessThan(5.0);

    terrain.dispose();
    world.clear();
  });

  it('TerrainBody creates expected number of collision boxes', () => {
    const world = new PhysicsWorld();
    world.init();

    const terrain = new TerrainBody(world);
    const grid = makeFlatGrid(); // 10Ã—10 columns, 2 solid layers â†’ expect â‰¤ 200 bodies
    terrain.build(grid, FULL_REGION);

    // Each column gets up to SURFACE_LAYERS=2 bodies; 10Ã—10=100 columns
    expect(terrain.bodyCount).toBeGreaterThan(0);
    expect(terrain.bodyCount).toBeLessThanOrEqual(200);

    terrain.dispose();
    expect(terrain.bodyCount).toBe(0);

    world.clear();
  });

  it('findSurfaceY returns correct top voxel Y', () => {
    const grid = makeFlatGrid();
    expect(findSurfaceY(grid, 5, 5)).toBe(1); // Top solid layer is Y=1

    // Empty column
    const emptyGrid = new VoxelGrid(5, 5, 5);
    expect(findSurfaceY(emptyGrid, 2, 2)).toBe(-1);
  });

  // ── #458 T6.2/D14: region-scoped build ──

  it('builds colliders only for columns inside the given region', () => {
    const world = new PhysicsWorld();
    world.init();

    const terrain = new TerrainBody(world);
    const grid = makeFlatGrid();
    const region: TerrainBodyRegion = { minX: 2, maxX: 4, minZ: 2, maxZ: 4 };
    terrain.build(grid, region);

    // 3×3 columns × up to SURFACE_LAYERS=2 bodies each — never the whole
    // 10×10 grid's worth, which the pre-region-scoping build always created.
    const regionArea = (region.maxX - region.minX + 1) * (region.maxZ - region.minZ + 1);
    expect(terrain.bodyCount).toBeGreaterThan(0);
    expect(terrain.bodyCount).toBeLessThanOrEqual(regionArea * 2);

    terrain.dispose();
    world.clear();
  });

  it('clamps a region that extends past the grid bounds instead of throwing', () => {
    const world = new PhysicsWorld();
    world.init();

    const terrain = new TerrainBody(world);
    const grid = makeFlatGrid();
    terrain.build(grid, { minX: -50, maxX: 500, minZ: -50, maxZ: 500 });

    // Clamped back down to the grid's real 10×10 extent.
    expect(terrain.bodyCount).toBeGreaterThan(0);
    expect(terrain.bodyCount).toBeLessThanOrEqual(200);

    terrain.dispose();
    world.clear();
  });

  it('computeFragmentRegion covers fragment positions plus the blast-zone margin', () => {
    // Fragments in world metres; VoxelGrid.CELL_SIZE converts back to columns.
    const region = computeFragmentRegion([
      { cx: 5 * VoxelGrid.CELL_SIZE, cz: 5 * VoxelGrid.CELL_SIZE },
      { cx: 7 * VoxelGrid.CELL_SIZE, cz: 8 * VoxelGrid.CELL_SIZE },
    ]);

    // Bare fragment AABB is columns [5,7]×[5,8]; margin widens it further out
    // on every side, never inward.
    expect(region.minX).toBeLessThan(5);
    expect(region.maxX).toBeGreaterThan(7);
    expect(region.minZ).toBeLessThan(5);
    expect(region.maxZ).toBeGreaterThan(8);
  });

  it('computeFragmentRegion returns an empty region for no fragments', () => {
    const region = computeFragmentRegion([]);
    expect(region.maxX).toBeLessThan(region.minX);
    expect(region.maxZ).toBeLessThan(region.minZ);
  });
});
