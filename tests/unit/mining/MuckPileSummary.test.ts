import { describe, it, expect } from 'vitest';
import { summariseMuckPile, fragmentClearances } from '../../../src/core/mining/MuckPileSummary.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';

/** Flat ground: solid up to `groundTop` inclusive, air above. */
function flatGround(size = 20, groundTop = 4): VoxelGrid {
  const grid = new VoxelGrid(size, size, size);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y <= groundTop; y++) {
      for (let x = 0; x < size; x++) {
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId: 'cruite', coefficient: 1 }] },
          density: 1,
          oreDensities: {},
          fractureModifier: 1,
        });
      }
    }
  }
  return grid;
}

let nextId = 0;

function fragment(
  pos: [number, number, number],
  half = 0.25,
  vel: [number, number, number] = [0, 0, 0],
): FragmentData {
  return {
    id: nextId++,
    rockId: 'cruite',
    position: { x: pos[0], y: pos[1], z: pos[2] },
    volume: (half * 2) ** 3,
    mass: 2100 * (half * 2) ** 3,
    composition: { rocks: [{ rockId: 'cruite', coefficient: 1 }] },
    oreDensities: {},
    initialVelocity: { x: vel[0], y: vel[1], z: vel[2] },
    isProjection: false,
    halfExtents: { x: half, y: half, z: half },
    shapeSeed: 0,
  } as FragmentData;
}

describe('MuckPileSummary — clearance', () => {
  it('reads rock resting on the ground as resting', () => {
    const grid = flatGround();
    const f = fragment([10, 5.25, 10]);

    expect(fragmentClearances([f], grid)[0]).toBeCloseTo(0, 6);
  });

  it('reads rock stacked on other rock as resting, not floating', () => {
    const grid = flatGround();
    const bottom = fragment([10, 5.25, 10]);
    const middle = fragment([10, 5.75, 10]);
    const top = fragment([10, 6.25, 10]);

    const summary = summariseMuckPile([top, bottom, middle], grid);
    expect(summary.floating).toBe(0);
    expect(summary.maxClearance).toBeCloseTo(0, 2);
  });

  it('catches rock left hanging with nothing under it', () => {
    const grid = flatGround();
    const hanging = fragment([10, 22, 10]);

    const summary = summariseMuckPile([hanging], grid);
    expect(summary.floating).toBe(1);
    expect(summary.maxClearance).toBeGreaterThan(15);
  });

  it('measures each column on its own', () => {
    const grid = flatGround();
    const resting = fragment([4, 5.25, 4]);
    const hanging = fragment([14, 18, 14]);

    expect(summariseMuckPile([resting, hanging], grid).floating).toBe(1);
  });
});

describe('MuckPileSummary — spreads', () => {
  it('reports fragment count, size and speed', () => {
    const grid = flatGround();
    const small = fragment([4, 5.25, 4], 0.25);
    const big = fragment([6, 6, 6], 1.0, [0, 0, 30]);

    const summary = summariseMuckPile([small, big], grid);
    expect(summary.fragments).toBe(2);
    expect(summary.volume.max).toBeGreaterThan(summary.volume.min);
    expect(summary.speed.max).toBeCloseTo(30, 3);
    expect(summary.highestY).toBeCloseTo(6, 3);
  });

  it('copes with a blast that produced nothing', () => {
    const summary = summariseMuckPile([], flatGround());
    expect(summary).toEqual({
      fragments: 0,
      volume: { min: 0, median: 0, p90: 0, max: 0 },
      speed: { min: 0, median: 0, p90: 0, max: 0 },
      maxClearance: 0,
      floating: 0,
      highestY: 0,
    });
  });
});
