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
