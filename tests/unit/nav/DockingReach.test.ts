// BlastSimulator2026 — Unit tests: docking cells beside a reachable set (#1840)
//
// A vehicle order aimed at the cell beside a building (clearance 1) is judged
// against clearance-2 components, which exclude that cell. withDockingCells
// widens a reachable set by the thin cells touching it.

import { describe, it, expect } from 'vitest';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { withDockingCells } from '../../../src/core/nav/DockingReach.js';

const W = 12;
const H = 12;

type CellFn = (x: number, z: number) => Partial<NavCell> | null;

function makeGrid(cellFn: CellFn = () => null): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < H; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < W; x++) {
      row.push({ type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false, clearance: 2, ...cellFn(x, z) });
    }
    cells.push(row);
  }
  return new NavGrid(W, H, cells);
}

/** Base set: the cells with x <= 4. */
const leftColumns: { has(x: number, z: number): boolean } = { has: (x, z) => x >= 0 && x <= 4 && z >= 0 && z < H };

describe('withDockingCells (#1840)', () => {
  it('holds every cell the base holds', () => {
    const grid = makeGrid();
    const set = withDockingCells(grid, leftColumns, 2);
    for (let z = 0; z < H; z++) for (let x = 0; x <= 4; x++) expect(set.has(x, z)).toBe(true);
  });

  it('adds a thin traversable cell touching the base', () => {
    const grid = makeGrid((x, z) => (x === 5 && z === 5 ? { clearance: 1 } : null));
    const set = withDockingCells(grid, leftColumns, 2);
    expect(set.has(5, 5)).toBe(true);
  });

  it('adds a thin cell touching the base only diagonally', () => {
    const grid = makeGrid((x, z) => (x === 5 && z === 5 ? { clearance: 1 } : null));
    const diagonalOnly = { has: (x: number, z: number) => x === 4 && z === 4 };
    expect(withDockingCells(grid, diagonalOnly, 2).has(5, 5)).toBe(true);
  });

  it('does not add a thin cell with no neighbour in the base', () => {
    const grid = makeGrid((x, z) => (x === 8 && z === 5 ? { clearance: 1 } : null));
    const set = withDockingCells(grid, leftColumns, 2);
    expect(set.has(8, 5)).toBe(false);
  });

  it('does not chain: a thin cell behind another thin cell stays out', () => {
    const grid = makeGrid((x, z) => (z === 5 && (x === 5 || x === 6) ? { clearance: 1 } : null));
    const set = withDockingCells(grid, leftColumns, 2);
    expect(set.has(5, 5)).toBe(true);
    expect(set.has(6, 5)).toBe(false);
  });

  it('does not add a blocked cell beside the base', () => {
    const grid = makeGrid((x, z) => (x === 5 && z === 5 ? { type: 'blocked', moveCost: Infinity, clearance: 0 } : null));
    expect(withDockingCells(grid, leftColumns, 2).has(5, 5)).toBe(false);
  });

  it('does not add a void cell beside the base', () => {
    const grid = makeGrid((x, z) => (x === 5 && z === 5 ? { type: 'void', moveCost: Infinity, clearance: 0 } : null));
    expect(withDockingCells(grid, leftColumns, 2).has(5, 5)).toBe(false);
  });

  it('does not add a cell whose clearance already meets the requirement', () => {
    // A roomy cell outside the base is cut off by something other than thinness (a climb wall).
    const grid = makeGrid();
    const set = withDockingCells(grid, leftColumns, 2);
    expect(set.has(5, 5)).toBe(false);
  });

  it('a cell with clearance 0 is below any requirement above 0', () => {
    const grid = makeGrid((x, z) => (x === 5 && z === 5 ? { clearance: 0 } : null));
    expect(withDockingCells(grid, leftColumns, 2).has(5, 5)).toBe(true);
  });

  it('a higher requirement admits cells with more clearance', () => {
    const grid = makeGrid((x, z) => (x === 5 && z === 5 ? { clearance: 2 } : null));
    expect(withDockingCells(grid, leftColumns, 2).has(5, 5)).toBe(false);
    expect(withDockingCells(grid, leftColumns, 3).has(5, 5)).toBe(true);
  });

  it('answers false for cells outside the grid, including at the border', () => {
    const grid = makeGrid();
    const wide = { has: (x: number, z: number) => x >= 0 && x < W && z >= 0 && z < H };
    const set = withDockingCells(grid, wide, 2);
    expect(set.has(-1, 0)).toBe(false);
    expect(set.has(0, -1)).toBe(false);
    expect(set.has(W, 3)).toBe(false);
    expect(set.has(3, H)).toBe(false);
  });

  it('a thin cell on the grid border still finds its in-grid neighbour', () => {
    const grid = makeGrid((x, z) => (x === 0 && z === 0 ? { clearance: 1 } : null));
    const base = { has: (x: number, z: number) => x === 1 && z === 1 };
    expect(withDockingCells(grid, base, 2).has(0, 0)).toBe(true);
  });

  it('an empty base yields an empty set', () => {
    const grid = makeGrid((x, z) => (x === 5 && z === 5 ? { clearance: 1 } : null));
    const set = withDockingCells(grid, { has: () => false }, 2);
    expect(set.has(5, 5)).toBe(false);
    expect(set.has(2, 2)).toBe(false);
  });
});
