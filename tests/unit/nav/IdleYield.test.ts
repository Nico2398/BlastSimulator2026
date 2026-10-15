// BlastSimulator2026 — Tests for pickYieldCell (src/core/nav/IdleYield.ts, #1696)
//
// An idle blocker in a narrow corridor steps aside to the nearest free cell
// that is NOT on the mover's remaining route (a merely-nearest free cell is
// just the next corridor cell, which nudges the blocker down the route).

import { describe, it, expect } from 'vitest';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { pickYieldCell } from '../../../src/core/nav/IdleYield.js';
import { IDLE_YIELD_SEARCH_RADIUS_CELLS } from '../../../src/core/config/balance.js';
import { Random } from '../../../src/core/math/Random.js';

function flatGrid(w: number, h: number): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < h; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < w; x++) row.push({ type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false });
    cells.push(row);
  }
  return new NavGrid(w, h, cells);
}

const key = (x: number, z: number) => `${x},${z}`;
const inBounds = (g: NavGrid, x: number, z: number) => x >= 0 && z >= 0 && x < g.width && z < g.height;
const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

describe('pickYieldCell', () => {
  it('returns a free cell off the route, nearest to the blocker', () => {
    const g = flatGrid(20, 20);
    const blocker = { x: 5, z: 5 };
    // Route covers the blocker's whole 3x3 neighbourhood.
    const route = new Set<string>();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) route.add(key(5 + dx, 5 + dz));
    const free = (x: number, z: number) => inBounds(g, x, z) && (key(x, z) === key(5, 3) || key(x, z) === key(9, 5));
    expect(pickYieldCell(g, blocker, route, free, IDLE_YIELD_SEARCH_RADIUS_CELLS)).toEqual({ x: 5, z: 3 });
  });

  it('skips a nearer free cell that lies on the route', () => {
    const g = flatGrid(20, 20);
    const route = new Set([key(6, 5)]);
    const free = (x: number, z: number) => inBounds(g, x, z) && key(x, z) !== key(5, 5) && (key(x, z) === key(6, 5) || key(x, z) === key(5, 8));
    expect(pickYieldCell(g, { x: 5, z: 5 }, route, free, 6)).toEqual({ x: 5, z: 8 });
  });

  it('picks a cell beside a 1-wide corridor rather than the next corridor cell', () => {
    // Corridor z=2, x=3..10; open room cells at x<=2. Blocker at (6,2), route runs along the corridor.
    const g = flatGrid(14, 5);
    const isCorridor = (x: number, z: number) => x >= 3 && x <= 10;
    const free = (x: number, z: number) => inBounds(g, x, z) && (!isCorridor(x, z) || z === 2) && !(x === 6 && z === 2);
    const route = new Set<string>();
    for (let x = 0; x <= 13; x++) route.add(key(x, 2));
    const picked = pickYieldCell(g, { x: 6, z: 2 }, route, free, IDLE_YIELD_SEARCH_RADIUS_CELLS);
    expect(picked).not.toBeNull();
    expect(route.has(key(picked!.x, picked!.z))).toBe(false);
    expect(picked!.z).not.toBe(2);
  });

  it('radius 0 yields nothing (the blocker cell itself is never a yield cell)', () => {
    const g = flatGrid(10, 10);
    expect(pickYieldCell(g, { x: 5, z: 5 }, new Set(), (x, z) => inBounds(g, x, z), 0)).toBeNull();
  });

  it('accepts a cell exactly at the radius and rejects one just past it', () => {
    const g = flatGrid(30, 30);
    const only = (cx: number, cz: number) => (x: number, z: number) => x === cx && z === cz;
    expect(pickYieldCell(g, { x: 10, z: 10 }, new Set(), only(16, 10), 6)).toEqual({ x: 16, z: 10 });
    expect(pickYieldCell(g, { x: 10, z: 10 }, new Set(), only(17, 10), 6)).toBeNull();
  });

  it('returns null when every cell in range is occupied (fully walled pocket)', () => {
    const g = flatGrid(10, 10);
    expect(pickYieldCell(g, { x: 5, z: 5 }, new Set(), () => false, 6)).toBeNull();
  });

  it('returns null when every free cell in range is on the route', () => {
    const g = flatGrid(10, 10);
    const route = new Set<string>();
    for (let x = 0; x < 10; x++) for (let z = 0; z < 10; z++) route.add(key(x, z));
    expect(pickYieldCell(g, { x: 5, z: 5 }, route, (x, z) => inBounds(g, x, z), 6)).toBeNull();
  });

  it('never returns a route cell, the blocker cell, or a cell beyond the radius (seeded random fields)', () => {
    const g = flatGrid(25, 25);
    const rng = new Random(42);
    for (let trial = 0; trial < 60; trial++) {
      const blocker = { x: rng.nextInt(0, 24), z: rng.nextInt(0, 24) };
      const route = new Set<string>();
      const freeSet = new Set<string>();
      for (let x = 0; x < 25; x++) for (let z = 0; z < 25; z++) {
        if (rng.next() < 0.3) route.add(key(x, z));
        if (rng.next() < 0.25) freeSet.add(key(x, z));
      }
      const radius = rng.nextInt(0, 8);
      const picked = pickYieldCell(g, blocker, route, (x, z) => freeSet.has(key(x, z)), radius);
      if (picked === null) continue;
      expect(route.has(key(picked.x, picked.z))).toBe(false);
      expect(freeSet.has(key(picked.x, picked.z))).toBe(true);
      expect(key(picked.x, picked.z)).not.toBe(key(blocker.x, blocker.z));
      expect(cheb(picked, blocker)).toBeLessThanOrEqual(radius);
    }
  });

  it('returns a cell whenever a qualifying one exists in range (never a false null)', () => {
    const g = flatGrid(25, 25);
    const blocker = { x: 12, z: 12 };
    const route = new Set([key(12, 12), key(13, 12), key(11, 12)]);
    const free = (x: number, z: number) => x === 12 && z === 14;
    expect(pickYieldCell(g, blocker, route, free, 3)).toEqual({ x: 12, z: 14 });
  });

  it('never answers with the blocker cell even when isFree accepts it', () => {
    const g = flatGrid(10, 10);
    // isFree says everything is free, including the blocker's own cell.
    const picked = pickYieldCell(g, { x: 5, z: 5 }, new Set(), () => true, 3);
    expect(picked).not.toBeNull();
    expect(picked).not.toEqual({ x: 5, z: 5 });
    expect(cheb(picked!, { x: 5, z: 5 })).toBe(1);
  });
});
