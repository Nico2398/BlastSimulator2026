import { describe, it, expect } from 'vitest';
import { PhysicsWorld } from '../../../src/physics/PhysicsWorld.js';
import { TerrainBody } from '../../../src/physics/TerrainBody.js';
import { FragmentBody } from '../../../src/physics/FragmentBody.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';

function makeFloorGrid(): VoxelGrid {
  const grid = new VoxelGrid(20, 10, 20);
  // Solid floor at Y=0
  for (let x = 0; x < 20; x++) {
    for (let z = 0; z < 20; z++) {
      grid.setVoxel(x, 0, z, { rockId: 'cruite', density: 1.0, oreDensities: {}, fractureModifier: 1.0 });
    }
  }
  return grid;
}

function makeFragment(id: number, y: number, velY: number): FragmentData {
  return {
    id,
    position: { x: 10, y, z: 10 },
    volume: 1.0,
    mass: 50,
    rockId: 'cruite',
    oreDensities: {},
    initialVelocity: { x: 0, y: velY, z: 0 },
    isProjection: false,
  };
}

describe('FragmentBody (8.3)', () => {
  it('fragment with upward velocity follows ballistic arc (rises then falls)', () => {
    const world = new PhysicsWorld();
    world.init();

    const fb = new FragmentBody(world);
    const frag = makeFragment(1, 5, 10); // starts at y=5, vel=+10m/s
    fb.addFragments([frag]);

    // Step for 0.5s — should have risen
    for (let i = 0; i < 30; i++) world.step(1 / 60);
    const pos1 = world.getBodyPosition(fb['handles'].get(1)!)!;
    expect(pos1.y).toBeGreaterThan(5); // Rose above start

    // Step another 1.5s — should have come back down
    for (let i = 0; i < 90; i++) world.step(1 / 60);
    const pos2 = world.getBodyPosition(fb['handles'].get(1)!)!;
    expect(pos2.y).toBeLessThan(pos1.y); // Fell back down

    fb.dispose();
    world.clear();
  });

  it('fragment settles on terrain after simulation', () => {
    const world = new PhysicsWorld();
    world.init();

    const grid = makeFloorGrid();
    const terrain = new TerrainBody(world);
    terrain.build(grid);

    const fb = new FragmentBody(world);
    const frag = makeFragment(1, 5, 0); // Drops from y=5
    fb.addFragments([frag]);

    fb.simulate();

    const results = fb.getResults();
    expect(results).toHaveLength(1);
    // Fragment should be near the floor (y≈1.5 = floor y=0 + half-voxel 0.5 + fragment half 0.5)
    expect(results[0]!.finalPosition.y).toBeGreaterThan(0.5);
    expect(results[0]!.finalPosition.y).toBeLessThan(5.0);

    fb.dispose();
    terrain.dispose();
    world.clear();
  });

  it('fragment final position is stored back in FragmentData', () => {
    const world = new PhysicsWorld();
    world.init();

    const grid = makeFloorGrid();
    const terrain = new TerrainBody(world);
    terrain.build(grid);

    const fb = new FragmentBody(world);
    const frag = makeFragment(42, 4, 0);
    const originalY = frag.position.y;
    fb.addFragments([frag]);

    fb.simulate();
    fb.applyResults([frag]);

    // Position should have been updated (fallen from y=4)
    expect(frag.position.y).not.toBe(originalY);
    expect(frag.position.y).toBeLessThan(originalY);

    fb.dispose();
    terrain.dispose();
    world.clear();
  });

  it('multiple fragments are all tracked', () => {
    const world = new PhysicsWorld();
    world.init();

    const fb = new FragmentBody(world);
    const fragments = [
      makeFragment(1, 5, 3),
      makeFragment(2, 6, 5),
      makeFragment(3, 7, -1),
    ];
    fb.addFragments(fragments);

    expect(fb.bodyCount).toBe(3);

    fb.dispose();
    expect(fb.bodyCount).toBe(0);

    world.clear();
  });
});
