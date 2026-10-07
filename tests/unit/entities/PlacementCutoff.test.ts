// BlastSimulator2026 — Unit tests: placement cutoff (#1391)
//
// computePlacementCutoff answers "what ground reachable from the crew now would
// this footprint strand?" with two flood fills: A (as is) and B (new footprint
// blocked, old footprint freed). Cut off = in A, not in B, not under the footprint.

import { describe, it, expect } from 'vitest';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { computePlacementCutoff } from '../../../src/core/entities/Building.js';
import { PLACEMENT_CUTOFF_MIN_CELLS } from '../../../src/core/config/balance.js';

const W = 30;
const H = 10;
const NO_TARGETS = { holes: [], orders: [] };
const CREW = [{ x: 3, z: 3 }];

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
const rect = (minX: number, minZ: number, maxX: number, maxZ: number) => ({ minX, minZ, maxX, maxZ });

/** Wall at x=10 with a single open cell at z=5; region east of it (x>10) sits on bench 1. */
const corridor = (x: number, z: number): Partial<NavCell> | null => {
  if (x === 10) return z === 5 ? null : BLOCKED;
  if (x > 10) return { benchLevel: 1 };
  return null;
};

/** East region size: x 11..29 across 10 rows. */
const EAST_CELLS = 19 * 10;

describe('computePlacementCutoff (#1391)', () => {
  it('PLACEMENT_CUTOFF_MIN_CELLS is a positive count', () => {
    expect(PLACEMENT_CUTOFF_MIN_CELLS).toBeGreaterThanOrEqual(1);
  });

  it('open ground: a footprint strands nothing', () => {
    const grid = makeGrid();
    expect(computePlacementCutoff(grid, CREW, rect(14, 4, 17, 7), undefined, NO_TARGETS)).toBeNull();
  });

  it('a footprint sealing the one-cell corridor strands the whole far side', () => {
    const grid = makeGrid(corridor);
    const result = computePlacementCutoff(grid, CREW, rect(10, 5, 11, 6), undefined, NO_TARGETS);
    expect(result).not.toBeNull();
    expect(result!.cells).toBe(EAST_CELLS);
    expect(result!.benches).toBe(1);
    expect(result!.holes).toBe(0);
    expect(result!.orders).toBe(0);
  });

  it('counts only the holes and queued orders on the stranded side', () => {
    const grid = makeGrid(corridor);
    const targets = {
      holes: [{ x: 15, z: 2 }, { x: 25, z: 8 }, { x: 4, z: 4 }],
      orders: [{ x: 20, z: 5 }, { x: 2, z: 2 }],
    };
    const result = computePlacementCutoff(grid, CREW, rect(10, 5, 11, 6), undefined, targets);
    expect(result!.holes).toBe(2);
    expect(result!.orders).toBe(1);
  });

  it('benches counts distinct bench levels among the stranded cells', () => {
    const grid = makeGrid((x, z) => {
      const base = corridor(x, z);
      if (x > 20) return { ...base, benchLevel: 2 };
      return base;
    });
    const result = computePlacementCutoff(grid, CREW, rect(10, 5, 11, 6), undefined, NO_TARGETS);
    expect(result!.benches).toBe(2);
  });

  it('a footprint next to the corridor, not on it, strands nothing', () => {
    const grid = makeGrid(corridor);
    expect(computePlacementCutoff(grid, CREW, rect(8, 6, 10, 8), undefined, NO_TARGETS)).toBeNull();
  });

  it('a footprint on the corridor but beyond the crew side of a second route strands nothing', () => {
    const grid = makeGrid((x, z) => (x === 10 && z !== 5 && z !== 8 ? BLOCKED : null));
    expect(computePlacementCutoff(grid, CREW, rect(10, 5, 11, 6), undefined, NO_TARGETS)).toBeNull();
  });

  it('rect is min-inclusive, max-exclusive: ending at the corridor cell leaves it open', () => {
    const grid = makeGrid(corridor);
    expect(computePlacementCutoff(grid, CREW, rect(8, 4, 10, 6), undefined, NO_TARGETS)).toBeNull();
    expect(computePlacementCutoff(grid, CREW, rect(10, 5, 11, 6), undefined, NO_TARGETS)).not.toBeNull();
  });

  it('cells under the footprint itself are not counted as cut off', () => {
    const grid = makeGrid(corridor);
    const result = computePlacementCutoff(grid, CREW, rect(10, 5, 12, 6), undefined, NO_TARGETS);
    // (10,5) and (11,5) are covered; (11,5) must not count as stranded.
    expect(result!.cells).toBe(EAST_CELLS - 1);
  });

  it('ground already unreachable from the crew is not counted', () => {
    const grid = makeGrid((x, z) => (x === 20 ? BLOCKED : corridor(x, z)));
    const result = computePlacementCutoff(grid, CREW, rect(10, 5, 11, 6), undefined, {
      holes: [{ x: 25, z: 5 }, { x: 15, z: 5 }],
      orders: [{ x: 25, z: 2 }],
    });
    expect(result!.cells).toBe(9 * 10);
    expect(result!.holes).toBe(1);
    expect(result!.orders).toBe(0);
  });

  it('no crew: nothing is reachable, so nothing is lost', () => {
    const grid = makeGrid(corridor);
    expect(computePlacementCutoff(grid, [], rect(10, 5, 11, 6), undefined, NO_TARGETS)).toBeNull();
  });

  it('a move away from a choke frees the old footprint: no cutoff', () => {
    // Old building plugs the corridor cell (blocked in the grid); the far side is already cut off.
    const grid = makeGrid((x, z) => (x === 10 && z === 5 ? BLOCKED : corridor(x, z)));
    const result = computePlacementCutoff(grid, CREW, rect(2, 2, 4, 4), rect(10, 5, 11, 6), NO_TARGETS);
    expect(result).toBeNull();
  });

  it('a move onto the choke strands the far side even though the old footprint is freed', () => {
    const grid = makeGrid((x, z) => (x === 2 && z === 2 ? BLOCKED : corridor(x, z)));
    const result = computePlacementCutoff(grid, CREW, rect(10, 5, 11, 6), rect(2, 2, 3, 3), NO_TARGETS);
    expect(result).not.toBeNull();
    expect(result!.cells).toBe(EAST_CELLS);
  });

  it('a move that unblocks one choke while blocking another reports the net loss', () => {
    // Route 1 at z=5 is plugged by the old building; route 2 at z=8 is open. New footprint plugs route 2.
    const grid = makeGrid((x, z) => (x === 10 && z !== 8 ? BLOCKED : null));
    // Old building at (10,5) is just a blocked cell here, so freeing it reopens route 1: no loss.
    expect(computePlacementCutoff(grid, CREW, rect(10, 8, 11, 9), rect(10, 5, 11, 6), NO_TARGETS)).toBeNull();
  });

  it('does not mutate the NavGrid', () => {
    const grid = makeGrid(corridor);
    const snapshot = () => {
      const out: string[] = [];
      for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) out.push(JSON.stringify(grid.cellAt(x, z)));
      return out;
    };
    const before = snapshot();
    computePlacementCutoff(grid, CREW, rect(10, 5, 11, 6), rect(2, 2, 4, 4), NO_TARGETS);
    expect(snapshot()).toEqual(before);
  });
});
