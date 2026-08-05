import { describe, it, expect } from 'vitest';
import { groupProjectiles, type ThrowableFragment } from '../../../src/core/mining/ProjectileGrouping.js';
import { MAX_ACTIVE_PROJECTILES } from '../../../src/core/config/balance.js';

function frag(
  id: number,
  pos: [number, number, number],
  vel: [number, number, number],
  mass = 1000,
): ThrowableFragment {
  return {
    id,
    position: { x: pos[0], y: pos[1], z: pos[2] },
    mass,
    initialVelocity: { x: vel[0], y: vel[1], z: vel[2] },
  };
}

/** A crowd of fragments all heading the same way from the same place. */
function crowd(count: number): ThrowableFragment[] {
  return Array.from({ length: count }, (_, i) =>
    frag(i, [i % 8, 0, Math.floor(i / 8) % 8], [10, 12, 0]));
}

const totalMass = (fs: readonly { mass: number }[]): number => fs.reduce((s, f) => s + f.mass, 0);

describe('ProjectileGrouping — below the cap', () => {
  it('flies every fragment on its own when there are few enough', () => {
    const fragments = crowd(10);
    const projectiles = groupProjectiles(fragments);

    expect(projectiles).toHaveLength(10);
    expect(projectiles.every(p => p.memberIds.length === 1)).toBe(true);
  });

  it('carries each fragment position and velocity through unchanged', () => {
    const projectiles = groupProjectiles([frag(4, [1, 2, 3], [5, 6, 7], 800)]);

    expect(projectiles[0]!.memberIds).toEqual([4]);
    expect(projectiles[0]!.origin).toEqual({ x: 1, y: 2, z: 3 });
    expect(projectiles[0]!.velocity).toEqual({ x: 5, y: 6, z: 7 });
    expect(projectiles[0]!.massKg).toBe(800);
  });

  it('handles an empty blast', () => {
    expect(groupProjectiles([])).toEqual([]);
  });
});

describe('ProjectileGrouping — above the cap', () => {
  it('never flies more bodies than the cap allows', () => {
    const projectiles = groupProjectiles(crowd(MAX_ACTIVE_PROJECTILES * 4));
    expect(projectiles.length).toBeLessThanOrEqual(MAX_ACTIVE_PROJECTILES);
  });

  it('keeps every fragment — grouping bounds the motion, never the rock', () => {
    const fragments = crowd(MAX_ACTIVE_PROJECTILES * 3 + 7);
    const projectiles = groupProjectiles(fragments);

    const carried = projectiles.flatMap(p => p.memberIds).sort((a, b) => a - b);
    expect(carried).toEqual(fragments.map(f => f.id));
  });

  it('conserves total mass across the grouping', () => {
    const fragments = crowd(MAX_ACTIVE_PROJECTILES * 2);
    const projectiles = groupProjectiles(fragments);

    expect(totalMass(projectiles.map(p => ({ mass: p.massKg })))).toBeCloseTo(totalMass(fragments), 3);
  });

  it('gives each fragment exactly one projectile', () => {
    const projectiles = groupProjectiles(crowd(MAX_ACTIVE_PROJECTILES * 2));
    const carried = projectiles.flatMap(p => p.memberIds);
    expect(new Set(carried).size).toBe(carried.length);
  });

  it('does not merge fragments flying in opposite directions', () => {
    // Two tight clusters far apart, heading away from each other, with enough
    // fragments to force grouping.
    const east = Array.from({ length: MAX_ACTIVE_PROJECTILES }, (_, i) =>
      frag(i, [0, 0, i % 4], [20, 5, 0]));
    const west = Array.from({ length: MAX_ACTIVE_PROJECTILES }, (_, i) =>
      frag(MAX_ACTIVE_PROJECTILES + i, [200, 0, i % 4], [-20, 5, 0]));

    const projectiles = groupProjectiles([...east, ...west]);

    for (const p of projectiles) {
      const headings = p.memberIds.map(id => (id < MAX_ACTIVE_PROJECTILES ? 'east' : 'west'));
      expect(new Set(headings).size, `projectile ${p.id} mixes headings`).toBe(1);
    }
  });

  it('averages a group velocity between its members', () => {
    const fragments = crowd(MAX_ACTIVE_PROJECTILES * 2);
    const projectiles = groupProjectiles(fragments);
    const grouped = projectiles.find(p => p.memberIds.length > 1)!;

    expect(grouped.velocity.x).toBeCloseTo(10, 6);
    expect(grouped.velocity.y).toBeCloseTo(12, 6);
  });

  it('is deterministic', () => {
    const fragments = crowd(MAX_ACTIVE_PROJECTILES * 2);
    const a = groupProjectiles(fragments);
    const b = groupProjectiles(fragments);

    expect(b.map(p => p.memberIds)).toEqual(a.map(p => p.memberIds));
  });

  it('gives the fastest rock its own truest trajectory rather than averaging it away', () => {
    // One fragment far faster than the rest: it should not be diluted into a
    // group of slow rock, because it is the one the player watches.
    const slow = Array.from({ length: MAX_ACTIVE_PROJECTILES * 2 }, (_, i) =>
      frag(i + 1, [i % 16, 0, Math.floor(i / 16) % 16], [1, 1, 0]));
    const fast = frag(0, [8, 0, 8], [40, 30, 0]);

    const projectiles = groupProjectiles([fast, ...slow]);
    const carrying = projectiles.find(p => p.memberIds.includes(0))!;

    expect(carrying.velocity.x).toBeGreaterThan(20);
  });
});
