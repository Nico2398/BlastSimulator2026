import { describe, it, expect } from 'vitest';
import { resolveFragmentLanding, type LandableFragment } from '../../../src/core/mining/BlastResolve.js';
import { groupProjectiles } from '../../../src/core/mining/ProjectileGrouping.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function fragment(
  id: number,
  pos: [number, number, number],
  vel: [number, number, number] = [0, 0, 0],
  volume = 0.25,
): LandableFragment {
  return {
    id,
    position: { x: pos[0], y: pos[1], z: pos[2] },
    volume,
    mass: volume * 2100,
    initialVelocity: { x: vel[0], y: vel[1], z: vel[2] },
    isProjection: Math.hypot(vel[0], vel[1], vel[2]) > 15,
  };
}

function resolve(fragments: LandableFragment[], grid = flatGround()) {
  const projectiles = groupProjectiles(fragments.filter(f => f.isProjection));
  return resolveFragmentLanding(fragments, projectiles, grid);
}

// ── Collapse ──────────────────────────────────────────────────────────────────

describe('BlastResolve — rock that simply drops', () => {
  it('falls to the ground beneath it', () => {
    const f = fragment(0, [10, 12, 10]);
    resolve([f]);

    // Ground tops out at y=4, so rock rests just above it.
    expect(f.position.y).toBeGreaterThan(4);
    expect(f.position.y).toBeLessThan(7);
    expect(f.position.x).toBe(10);
    expect(f.position.z).toBe(10);
  });

  it('does not move sideways', () => {
    const f = fragment(0, [7.25, 15, 3.75]);
    resolve([f]);

    expect(f.position.x).toBeCloseTo(7.25, 6);
    expect(f.position.z).toBeCloseTo(3.75, 6);
  });

  it('reports a flight that starts high and ends low', () => {
    const f = fragment(0, [10, 14, 10]);
    const { flights } = resolve([f]);

    expect(flights).toHaveLength(1);
    expect(flights[0]!.from.y).toBe(14);
    expect(flights[0]!.to.y).toBeLessThan(14);
    expect(flights[0]!.thrown).toBe(false);
    expect(flights[0]!.durationS).toBeGreaterThan(0);
  });

  it('takes longer to fall from higher up', () => {
    const low = fragment(0, [4, 7, 4]);
    const high = fragment(1, [12, 18, 12]);
    const { flights } = resolve([low, high]);

    const byId = new Map(flights.map(f => [f.fragmentId, f]));
    expect(byId.get(1)!.durationS).toBeGreaterThan(byId.get(0)!.durationS);
  });

  it('staggers the collapse so low rock gives way before the burden above it', () => {
    const low = fragment(0, [10, 6, 10]);
    const high = fragment(1, [11, 16, 11]);
    const { flights } = resolve([low, high]);

    const byId = new Map(flights.map(f => [f.fragmentId, f]));
    expect(byId.get(0)!.delayS).toBeLessThan(byId.get(1)!.delayS);
  });
});

// ── Stacking ──────────────────────────────────────────────────────────────────

describe('BlastResolve — piling up', () => {
  it('stacks rock landing in the same column instead of burying it in itself', () => {
    const a = fragment(0, [10, 8, 10]);
    const b = fragment(1, [10, 10, 10]);
    const c = fragment(2, [10, 12, 10]);
    resolve([a, b, c]);

    const heights = [a.position.y, b.position.y, c.position.y].sort((p, q) => p - q);
    expect(heights[1]).toBeGreaterThan(heights[0]!);
    expect(heights[2]).toBeGreaterThan(heights[1]!);
  });

  it('a bigger fragment raises the pile more than a small one', () => {
    // Rise comes from the volume a fragment adds, so a boulder stands higher out
    // of flat ground than a chip does.
    const small = fragment(0, [5, 9, 5], [0, 0, 0], 0.05);
    const big = fragment(1, [15, 9, 15], [0, 0, 0], 2.0);
    resolve([small, big]);

    expect(big.position.y).toBeGreaterThan(small.position.y);
  });

  it('raises a column by the rock it holds, not by the number of pieces', () => {
    // 40 chips of 0.1 m³ is 4 m³ of rock; bulked, that is a few metres of muck.
    // Raising the column per *piece* instead is what once stacked gravel into a
    // tower tens of metres tall.
    const chips = Array.from({ length: 40 }, (_, i) => fragment(i, [10, 8 + i * 0.01, 10], [0, 0, 0], 0.1));
    resolve(chips, flatGround(40, 4));

    const top = Math.max(...chips.map(f => f.position.y));
    expect(top - 5).toBeLessThan(8);
  });

  it('spreads a heap sideways once it passes its angle of repose', () => {
    const many = Array.from({ length: 60 }, (_, i) => fragment(i, [20, 10 + i * 0.01, 20], [0, 0, 0], 0.3));
    resolve(many, flatGround(40, 4));

    const columns = new Set(many.map(f => `${Math.floor(f.position.x)},${Math.floor(f.position.z)}`));
    expect(columns.size).toBeGreaterThan(1);
  });

  it('leaves rock in different columns at the same height on flat ground', () => {
    const a = fragment(0, [4, 9, 4]);
    const b = fragment(1, [14, 9, 14]);
    resolve([a, b]);

    expect(a.position.y).toBeCloseTo(b.position.y, 6);
  });
});

// ── Thrown rock ───────────────────────────────────────────────────────────────

describe('BlastResolve — rock that is thrown', () => {
  it('carries a fragment away from where it broke', () => {
    const f = fragment(0, [5, 8, 10], [25, 10, 0]);
    resolve([f]);

    expect(f.position.x).toBeGreaterThan(8);
  });

  it('reports how far the furthest rock travelled', () => {
    const near = fragment(0, [10, 8, 10]);
    const far = fragment(1, [5, 8, 10], [30, 12, 0]);
    const { maxThrowDistance } = resolve([near, far]);

    expect(maxThrowDistance).toBeGreaterThan(5);
  });

  it('a harder throw goes further', () => {
    // A wide world, so neither throw is cut short by the map edge.
    const gentle = fragment(0, [5, 8, 30], [16, 8, 0]);
    const gentleResult = resolve([gentle], flatGround(80, 4));
    const hard = fragment(0, [5, 8, 30], [40, 16, 0]);
    const hardResult = resolve([hard], flatGround(80, 4));

    expect(hardResult.maxThrowDistance).toBeGreaterThan(gentleResult.maxThrowDistance);
  });

  it('stops rock at the world edge rather than letting it leave the map', () => {
    const f = fragment(0, [5, 8, 10], [80, 5, 0]);
    const grid = flatGround(20, 4);
    resolveFragmentLanding([f], groupProjectiles([f]), grid);

    expect(f.position.x).toBeLessThanOrEqual(grid.maxX - 1);
  });

  it('lands thrown rock on the ground, not through it or floating above', () => {
    const f = fragment(0, [4, 8, 4], [22, 10, 0]);
    resolve([f]);

    expect(f.position.y).toBeGreaterThan(4);
    expect(f.position.y).toBeLessThan(8);
  });

  it('marks the flight as thrown and gives it a real airborne time', () => {
    const f = fragment(0, [4, 8, 4], [25, 15, 0]);
    const { flights } = resolve([f]);

    expect(flights[0]!.thrown).toBe(true);
    expect(flights[0]!.durationS).toBeGreaterThan(0.5);
    expect(flights[0]!.impactSpeed).toBeGreaterThan(0);
  });

  it('lands rock fired straight up at the speed cap instead of abandoning it in the sky', () => {
    // 80 m/s straight up is 16.3 s in the air — longer than the arc tracer used
    // to follow, which left the fastest rock hanging where it ran out of time.
    const f = fragment(0, [10, 8, 10], [0, 80, 0]);
    const grid = flatGround(20, 4);
    const { flights } = resolveFragmentLanding([f], groupProjectiles([f]), grid);

    expect(flights[0]!.durationS).toBeGreaterThan(16);
    expect(f.position.y).toBeLessThan(7);
  });

  it('never throws rock outside the world', () => {
    const f = fragment(0, [10, 10, 10], [80, 40, 80]);
    const grid = flatGround(20, 4);
    resolveFragmentLanding([f], groupProjectiles([f]), grid);

    expect(f.position.x).toBeGreaterThanOrEqual(grid.minX);
    expect(f.position.x).toBeLessThanOrEqual(grid.maxX);
    expect(f.position.z).toBeGreaterThanOrEqual(grid.minZ);
    expect(f.position.z).toBeLessThanOrEqual(grid.maxZ);
  });

  it('scatters a grouped projectile members instead of stacking them on one spot', () => {
    // One projectile carrying several fragments — they must not all land in a
    // single column.
    const members = Array.from({ length: 6 }, (_, i) => fragment(i, [5, 8, 5 + i * 0.1], [25, 12, 0]));
    resolveFragmentLanding(members, groupProjectiles(members), flatGround());

    const spots = new Set(members.map(m => `${m.position.x.toFixed(2)},${m.position.z.toFixed(2)}`));
    expect(spots.size).toBeGreaterThan(1);
  });
});

// ── General guarantees ────────────────────────────────────────────────────────

describe('BlastResolve — guarantees', () => {
  it('gives every fragment exactly one flight', () => {
    const fragments = [
      fragment(0, [10, 9, 10]),
      fragment(1, [11, 12, 11], [25, 10, 0]),
      fragment(2, [12, 8, 12]),
    ];
    const { flights } = resolve(fragments);

    expect(flights.map(f => f.fragmentId)).toEqual([0, 1, 2]);
  });

  it('leaves nothing below the ground', () => {
    const fragments = Array.from({ length: 30 }, (_, i) =>
      fragment(i, [5 + (i % 10), 8 + (i % 5), 5 + Math.floor(i / 10)], i % 3 === 0 ? [20, 10, 0] : [0, 0, 0]));
    resolve(fragments);

    for (const f of fragments) {
      expect(f.position.y, `fragment ${f.id} sank into the ground`).toBeGreaterThan(4);
    }
  });

  it('is deterministic', () => {
    const build = (): LandableFragment[] => [
      fragment(0, [10, 9, 10]),
      fragment(1, [11, 12, 11], [25, 10, 0]),
      fragment(2, [12, 8, 12], [18, 20, 3]),
    ];
    const a = build(); const ra = resolve(a);
    const b = build(); const rb = resolve(b);

    expect(b.map(f => f.position)).toEqual(a.map(f => f.position));
    expect(rb.flights).toEqual(ra.flights);
  });

  it('copes with an empty blast', () => {
    const { flights, maxThrowDistance } = resolve([]);
    expect(flights).toEqual([]);
    expect(maxThrowDistance).toBe(0);
  });
});
