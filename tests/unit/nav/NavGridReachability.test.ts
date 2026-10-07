// BlastSimulator2026 — Unit tests: multi-source climb-aware flood fill (#1306)
//
// computeClimbReachableSetFromSources answers "which cells can ANY of these
// sources reach" with a single fill, so the cost of judging a queued order
// is bounded by the grid, never by grid size x number of actors.

import { describe, it, expect } from 'vitest';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import {
  computeClimbReachableSet,
  computeClimbReachableSetFromSources,
  computeClimbComponents,
} from '../../../src/core/nav/NavGridReachability.js';
import { NAV_CLEARANCE_EMPLOYEE_CELLS, NAV_CLEARANCE_VEHICLE_CELLS } from '../../../src/core/config/balance.js';

const W = 30;
const H = 10;

type CellFn = (x: number, z: number) => Partial<NavCell> | null;

function makeGrid(cellFn: CellFn = () => null): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < H; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < W; x++) {
      row.push({ type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false, ...cellFn(x, z) });
    }
    cells.push(row);
  }
  return new NavGrid(W, H, cells);
}

const BLOCKED: Partial<NavCell> = { type: 'blocked', moveCost: Infinity };
/** Two full-height walls at x = 10 and x = 20 split the grid into regions A (<10), B (11..19), C (>20). */
const threeRegions = (x: number, _z: number): Partial<NavCell> | null => (x === 10 || x === 20 ? BLOCKED : null);

describe('computeClimbReachableSetFromSources (#1306)', () => {
  it('a single source gives the same set as computeClimbReachableSet from that anchor', () => {
    const grid = makeGrid(threeRegions);
    const single = computeClimbReachableSet(grid, 3, 3);
    const multi = computeClimbReachableSetFromSources(grid, [{ x: 3, z: 3 }]);
    expect(multi.size).toBe(single.size);
    for (let z = 0; z < H; z++) {
      for (let x = 0; x < W; x++) expect(multi.has(x, z)).toBe(single.has(x, z));
    }
  });

  it('is the union of the regions each source stands in', () => {
    const grid = makeGrid(threeRegions);
    const set = computeClimbReachableSetFromSources(grid, [{ x: 3, z: 3 }, { x: 25, z: 5 }]);
    expect(set.has(1, 1)).toBe(true);   // region A
    expect(set.has(27, 8)).toBe(true);  // region C
    expect(set.has(15, 5)).toBe(false); // region B: no source in it
    expect(set.has(10, 5)).toBe(false); // the wall itself
  });

  it('size counts every cell of the union exactly once', () => {
    const grid = makeGrid(threeRegions);
    const a = computeClimbReachableSet(grid, 3, 3).size;
    const c = computeClimbReachableSet(grid, 25, 5).size;
    const both = computeClimbReachableSetFromSources(grid, [{ x: 3, z: 3 }, { x: 25, z: 5 }]);
    expect(both.size).toBe(a + c);
  });

  it('two sources in the same region, or the same source twice, do not double count', () => {
    const grid = makeGrid(threeRegions);
    const one = computeClimbReachableSet(grid, 3, 3).size;
    expect(computeClimbReachableSetFromSources(grid, [{ x: 3, z: 3 }, { x: 5, z: 7 }]).size).toBe(one);
    expect(computeClimbReachableSetFromSources(grid, [{ x: 3, z: 3 }, { x: 3, z: 3 }]).size).toBe(one);
  });

  it('no sources gives an empty set', () => {
    const set = computeClimbReachableSetFromSources(makeGrid(), []);
    expect(set.size).toBe(0);
    expect(set.has(0, 0)).toBe(false);
  });

  it('a source outside the grid is ignored; in-bounds sources still count', () => {
    const grid = makeGrid(threeRegions);
    const set = computeClimbReachableSetFromSources(grid, [{ x: -50, z: 3 }, { x: 3, z: 3 }]);
    expect(set.has(1, 1)).toBe(true);
    expect(set.size).toBe(computeClimbReachableSet(grid, 3, 3).size);
  });

  it('a source whose own cell is blocked is still included (an agent can never be impassable to itself)', () => {
    const grid = makeGrid(threeRegions);
    const set = computeClimbReachableSetFromSources(grid, [{ x: 10, z: 5 }]);
    expect(set.has(10, 5)).toBe(true);
  });

  it('honours the required clearance: a corridor too narrow for a vehicle still admits a walker', () => {
    const narrow = (x: number): Partial<NavCell> | null => (x === 10 ? { clearance: NAV_CLEARANCE_EMPLOYEE_CELLS } : null);
    const grid = makeGrid(narrow);
    const walker = computeClimbReachableSetFromSources(grid, [{ x: 3, z: 3 }], NAV_CLEARANCE_EMPLOYEE_CELLS);
    const vehicle = computeClimbReachableSetFromSources(grid, [{ x: 3, z: 3 }], NAV_CLEARANCE_VEHICLE_CELLS);
    expect(walker.has(25, 5)).toBe(true);
    expect(vehicle.has(25, 5)).toBe(false);
    expect(vehicle.has(3, 5)).toBe(true);
  });

  it('is climb-aware: a face too steep to scale splits the grid even though every cell is walkable', () => {
    const cliff = (x: number): Partial<NavCell> | null => ({ surfaceY: x < 10 ? 0 : 40 });
    const grid = makeGrid(cliff);
    const set = computeClimbReachableSetFromSources(grid, [{ x: 3, z: 3 }]);
    expect(set.has(5, 5)).toBe(true);
    expect(set.has(15, 5)).toBe(false);
    // A source on each side reaches both.
    const both = computeClimbReachableSetFromSources(grid, [{ x: 3, z: 3 }, { x: 15, z: 3 }]);
    expect(both.has(5, 5)).toBe(true);
    expect(both.has(25, 5)).toBe(true);
  });

  it('returns an independent snapshot: a later fill does not change an earlier result', () => {
    const grid = makeGrid(threeRegions);
    const first = computeClimbReachableSetFromSources(grid, [{ x: 3, z: 3 }]);
    const sizeBefore = first.size;
    computeClimbReachableSetFromSources(grid, [{ x: 15, z: 3 }]);
    computeClimbReachableSet(grid, 25, 3);
    expect(first.size).toBe(sizeBefore);
    expect(first.has(1, 1)).toBe(true);
    expect(first.has(15, 3)).toBe(false);
  });

  it('has() is false for coordinates outside the grid', () => {
    const set = computeClimbReachableSetFromSources(makeGrid(), [{ x: 3, z: 3 }]);
    expect(set.has(-1, 0)).toBe(false);
    expect(set.has(W, 0)).toBe(false);
    expect(set.has(0, H)).toBe(false);
  });
});

describe('computeClimbComponents (#1306)', () => {
  /** Walls, a cliff column, a low-clearance strip and a stranded cell, so every gate is exercised. */
  const mixed = (x: number, z: number): Partial<NavCell> | null => {
    if (x === 10 && z !== 4) return BLOCKED;
    if (x === 15) return { surfaceY: z < 5 ? 0 : 50 };
    if (x === 20) return { clearance: 0 };
    if (x === 5 && z === 5) return BLOCKED; // a stranded source stands here
    return x > 15 ? { surfaceY: 0 } : null;
  };

  it('answers every (source, target) pair exactly like computeClimbReachableSet from that source', () => {
    const grid = makeGrid(mixed);
    const components = computeClimbComponents(grid, NAV_CLEARANCE_EMPLOYEE_CELLS);
    for (const [sx, sz] of [[3, 3], [12, 8], [25, 1], [5, 5], [20, 2], [10, 0]] as const) {
      const set = computeClimbReachableSet(grid, sx, sz, NAV_CLEARANCE_EMPLOYEE_CELLS);
      for (let z = 0; z < H; z++) {
        for (let x = 0; x < W; x++) {
          expect(components.canReach(sx, sz, x, z), `from ${sx},${sz} to ${x},${z}`).toBe(set.has(x, z));
        }
      }
    }
  });

  it('a stranded source reaches its own cell and the ground it can step onto, nothing walled off', () => {
    const grid = makeGrid(threeRegions);
    const components = computeClimbComponents(grid);
    expect(components.canReach(10, 5, 10, 5)).toBe(true);
    expect(components.canReach(10, 5, 3, 3)).toBe(true);
    expect(components.canReach(10, 5, 15, 5)).toBe(true);
    expect(components.canReach(10, 5, 25, 5)).toBe(false);
  });

  it('rejects a target outside the grid', () => {
    const components = computeClimbComponents(makeGrid());
    expect(components.canReach(3, 3, -1, 3)).toBe(false);
    expect(components.canReach(3, 3, W, 3)).toBe(false);
  });
});

describe('computeClimbReachableSetFromSources fill overrides (#1391)', () => {
  const rect = (minX: number, minZ: number, maxX: number, maxZ: number) => ({ minX, minZ, maxX, maxZ });
  /** Wall at x=10 with one open cell at z=5. */
  const gap = (x: number, z: number): Partial<NavCell> | null => (x === 10 && z !== 5 ? BLOCKED : null);
  const src = [{ x: 3, z: 3 }];

  it('no overrides behaves as before', () => {
    const grid = makeGrid(gap);
    const plain = computeClimbReachableSetFromSources(grid, src);
    const empty = computeClimbReachableSetFromSources(grid, src, NAV_CLEARANCE_EMPLOYEE_CELLS, {});
    expect(empty.size).toBe(plain.size);
    expect(plain.has(25, 5)).toBe(true);
  });

  it('block makes cells impassable: blocking the gap seals the far side', () => {
    const grid = makeGrid(gap);
    const set = computeClimbReachableSetFromSources(grid, src, NAV_CLEARANCE_EMPLOYEE_CELLS, { block: rect(10, 5, 11, 6) });
    expect(set.has(10, 5)).toBe(false);
    expect(set.has(25, 5)).toBe(false);
    expect(set.has(3, 5)).toBe(true);
  });

  it('block is min-inclusive, max-exclusive', () => {
    const grid = makeGrid();
    const set = computeClimbReachableSetFromSources(grid, src, NAV_CLEARANCE_EMPLOYEE_CELLS, { block: rect(5, 5, 7, 6) });
    expect(set.has(5, 5)).toBe(false);
    expect(set.has(6, 5)).toBe(false);
    expect(set.has(7, 5)).toBe(true);
    expect(set.has(5, 6)).toBe(true);
    expect(set.has(5, 4)).toBe(true);
  });

  it('block shrinks the set by exactly the covered reachable cells on open ground', () => {
    const grid = makeGrid();
    const plain = computeClimbReachableSetFromSources(grid, src).size;
    const blocked = computeClimbReachableSetFromSources(grid, src, NAV_CLEARANCE_EMPLOYEE_CELLS, { block: rect(12, 2, 15, 4) });
    expect(blocked.size).toBe(plain - 6);
  });

  it('free makes blocked cells passable: freeing the wall gap opens the far side', () => {
    const grid = makeGrid((x, z) => (x === 10 ? BLOCKED : null));
    expect(computeClimbReachableSetFromSources(grid, src).has(25, 5)).toBe(false);
    const set = computeClimbReachableSetFromSources(grid, src, NAV_CLEARANCE_EMPLOYEE_CELLS, { free: rect(10, 5, 11, 6) });
    expect(set.has(10, 5)).toBe(true);
    expect(set.has(25, 5)).toBe(true);
    expect(set.has(10, 4)).toBe(false);
  });

  it('block wins over free where they overlap', () => {
    const grid = makeGrid((x, z) => (x === 10 ? BLOCKED : null));
    const set = computeClimbReachableSetFromSources(grid, src, NAV_CLEARANCE_EMPLOYEE_CELLS, {
      free: rect(10, 5, 11, 6),
      block: rect(10, 5, 11, 6),
    });
    expect(set.has(10, 5)).toBe(false);
    expect(set.has(25, 5)).toBe(false);
  });

  it('block and free together: move the plug from one gap to another', () => {
    const grid = makeGrid((x, z) => (x === 10 && z !== 8 ? BLOCKED : null));
    const set = computeClimbReachableSetFromSources(grid, src, NAV_CLEARANCE_EMPLOYEE_CELLS, {
      free: rect(10, 5, 11, 6),
      block: rect(10, 8, 11, 9),
    });
    expect(set.has(25, 5)).toBe(true);
    expect(set.has(10, 8)).toBe(false);
  });

  it('does not mutate the grid', () => {
    const grid = makeGrid(gap);
    computeClimbReachableSetFromSources(grid, src, NAV_CLEARANCE_EMPLOYEE_CELLS, {
      block: rect(10, 5, 11, 6),
      free: rect(10, 0, 11, 2),
    });
    expect(grid.cellAt(10, 5)!.type).toBe('walkable');
    expect(grid.cellAt(10, 0)!.type).toBe('blocked');
    expect(computeClimbReachableSetFromSources(grid, src).has(25, 5)).toBe(true);
  });
});
