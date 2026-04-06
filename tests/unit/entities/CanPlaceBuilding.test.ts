// canPlaceBuilding() unit tests — bounds, overlap, and flat-surface checks

import { describe, it, expect } from 'vitest';
import {
  BUSY,
  canPlaceBuilding,
  type CanPlaceBuildingResult,
  type PlacementCell,
  type PlacementGrid,
} from '../../../src/core/entities/Building.js';

// ── Test helper ───────────────────────────────────────────────────────────────

/**
 * Build a synthetic PlacementGrid with uniform surfaceY.
 * Avoids VoxelGrid scanning — keeps tests fully deterministic and fast.
 */
function makeFlatGrid(sizeX: number, sizeZ: number, surfaceY: number): PlacementGrid {
  const grid: PlacementGrid = [];
  for (let z = 0; z < sizeZ; z++) {
    const row: PlacementCell[] = [];
    for (let x = 0; x < sizeX; x++) {
      row.push({ worldX: x, worldZ: z, surfaceY });
    }
    grid.push(row);
  }
  return grid;
}

// ── canPlaceBuilding ──────────────────────────────────────────────────────────

describe('canPlaceBuilding', () => {

  it('returns { valid: true } for a flat, unoccupied, in-bounds placement', () => {
    // management_office T1 has a 2×2 footprint; a 10×10 flat grid easily contains it
    const grid = makeFlatGrid(10, 10, 5);

    const result: CanPlaceBuildingResult = canPlaceBuilding(grid, 'management_office', 0, 0);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns invalid with "Out of bounds" when x is negative', () => {
    const grid = makeFlatGrid(10, 10, 5);

    const result = canPlaceBuilding(grid, 'management_office', -1, 0);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Out of bounds');
  });

  it('returns invalid with "Out of bounds" when z is negative', () => {
    const grid = makeFlatGrid(10, 10, 5);

    const result = canPlaceBuilding(grid, 'management_office', 0, -1);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Out of bounds');
  });

  it('returns invalid with "Out of bounds" when footprint extends beyond grid width', () => {
    // management_office T1: 2 cells wide; at x=9 on a 10-wide grid col 10 is out of bounds
    const grid = makeFlatGrid(10, 10, 5);

    const result = canPlaceBuilding(grid, 'management_office', 9, 0);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Out of bounds');
  });

  it('returns invalid with "Out of bounds" when footprint extends beyond grid depth', () => {
    // management_office T1: 2 cells deep; at z=9 on a 10-deep grid row 10 is out of bounds
    const grid = makeFlatGrid(10, 10, 5);

    const result = canPlaceBuilding(grid, 'management_office', 0, 9);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Out of bounds');
  });

  it('returns invalid with "Space is occupied" when any footprint cell is BUSY', () => {
    // management_office T1 (2×2) at (0,0) — footprint covers (0,0),(1,0),(0,1),(1,1)
    const grid = makeFlatGrid(10, 10, 5);
    grid[1]![1]!.surfaceY = BUSY;

    const result = canPlaceBuilding(grid, 'management_office', 0, 0);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Space is occupied');
  });

  it('returns valid when the BUSY cell lies outside the footprint', () => {
    // BUSY at (4,4) — well outside a 2×2 footprint placed at (0,0)
    const grid = makeFlatGrid(10, 10, 5);
    grid[4]![4]!.surfaceY = BUSY;

    const result = canPlaceBuilding(grid, 'management_office', 0, 0);

    expect(result.valid).toBe(true);
  });

  it('returns invalid with "Uneven surface" when footprint cells have different surfaceY values', () => {
    // 10×10 grid: rows z=0 at surfaceY=3, rows z=1 at surfaceY=4
    const grid = makeFlatGrid(10, 10, 3);
    for (let x = 0; x < 10; x++) {
      grid[1]![x]!.surfaceY = 4;
    }

    // management_office T1 (2×2) at (0,0) → cells (0,0),(1,0) are y=3; (0,1),(1,1) are y=4
    const result = canPlaceBuilding(grid, 'management_office', 0, 0);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Uneven surface');
  });

  it('returns valid when all footprint cells share a non-zero surfaceY', () => {
    // Uniformly elevated surface (e.g. bench level 7)
    const grid = makeFlatGrid(10, 10, 7);

    const result = canPlaceBuilding(grid, 'management_office', 3, 3);

    expect(result.valid).toBe(true);
  });

  it('accepts a valid tier-3 placement on a sufficiently large flat grid', () => {
    // living_quarters T3: footprint rect(5,4) = 20 cells; 20×20 flat grid has plenty of room
    const grid = makeFlatGrid(20, 20, 2);

    const result = canPlaceBuilding(grid, 'living_quarters', 0, 0, 3);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('tier-3 valid placement succeeds when origin is away from the edges', () => {
    // living_quarters T3 (5 wide × 4 deep) placed at (5,5) on a 20×20 grid
    // → rightmost column: 5+4=9 < 20, bottom row: 5+3=8 < 20 → fully in bounds
    const grid = makeFlatGrid(20, 20, 2);

    const result = canPlaceBuilding(grid, 'living_quarters', 5, 5, 3);

    expect(result.valid).toBe(true);
  });

  it('returns invalid with "Out of bounds" when tier-3 footprint exceeds grid width', () => {
    // living_quarters T3: 5 cells wide; at x=7 on a 10-wide grid → needs cols 7–11, max is 9
    const grid = makeFlatGrid(10, 10, 2);

    const result = canPlaceBuilding(grid, 'living_quarters', 7, 0, 3);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Out of bounds');
  });

  it('returns invalid with "Out of bounds" when tier-3 footprint exceeds grid depth', () => {
    // living_quarters T3: 4 cells deep; at z=8 on a 10-deep grid → needs rows 8–11, max is 9
    const grid = makeFlatGrid(10, 10, 2);

    const result = canPlaceBuilding(grid, 'living_quarters', 0, 8, 3);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Out of bounds');
  });

  // ── L-shape BUSY region — verifies per-cell checking, not bounding-box overlap

  it('rejects placement when footprint cells intersect the L-shaped BUSY region', () => {
    //  x: 0  1  2  3 …
    //  z=0: B  .  .  .
    //  z=1: B  .  .  .
    //  z=2: B  B  .  .
    //  z=3: .  .  .  .
    const grid = makeFlatGrid(8, 8, 3);
    grid[0]![0]!.surfaceY = BUSY; // (x=0, z=0)
    grid[1]![0]!.surfaceY = BUSY; // (x=0, z=1)
    grid[2]![0]!.surfaceY = BUSY; // (x=0, z=2)
    grid[2]![1]!.surfaceY = BUSY; // (x=1, z=2)

    // management_office T1 (2×2) at (0,0) → footprint covers (0,0),(1,0),(0,1),(1,1)
    // → hits BUSY at (0,0) and (0,1) → must fail
    const overlapResult = canPlaceBuilding(grid, 'management_office', 0, 0);
    expect(overlapResult.valid).toBe(false);
    expect(overlapResult.reason).toBe('Space is occupied');
  });

  it('accepts placement when footprint falls in the gap of the L-shaped BUSY region', () => {
    // Same L-shaped BUSY grid as above
    const grid = makeFlatGrid(8, 8, 3);
    grid[0]![0]!.surfaceY = BUSY;
    grid[1]![0]!.surfaceY = BUSY;
    grid[2]![0]!.surfaceY = BUSY;
    grid[2]![1]!.surfaceY = BUSY;

    // management_office T1 (2×2) at (2,0) → footprint covers (2,0),(3,0),(2,1),(3,1)
    // → none of these are BUSY → must pass
    const clearResult = canPlaceBuilding(grid, 'management_office', 2, 0);
    expect(clearResult.valid).toBe(true);
  });

  it('detects overlap when only the L-arm tip cell intersects the footprint', () => {
    // 8×8 flat grid; only the L-arm tip is BUSY: cell (x=1, z=2)
    const grid = makeFlatGrid(8, 8, 3);
    grid[2]![1]!.surfaceY = BUSY; // (x=1, z=2) — the lone arm cell

    // management_office T1 (2×2) at (1,2) → footprint covers (1,2),(2,2),(1,3),(2,3)
    // → hits BUSY at (1,2) → must fail
    const overlapResult = canPlaceBuilding(grid, 'management_office', 1, 2);
    expect(overlapResult.valid).toBe(false);
    expect(overlapResult.reason).toBe('Space is occupied');

    // management_office T1 (2×2) at (2,2) → footprint covers (2,2),(3,2),(2,3),(3,3)
    // → none are BUSY → must pass
    const clearResult = canPlaceBuilding(grid, 'management_office', 2, 2);
    expect(clearResult.valid).toBe(true);
  });

  it('accepts placement when building footprint exactly fills the available grid area', () => {
    // management_office T1: 2×2 footprint; 2×2 grid → footprint exactly fills it
    const grid = makeFlatGrid(2, 2, 5);

    const result = canPlaceBuilding(grid, 'management_office', 0, 0);

    expect(result.valid).toBe(true);
  });

  it('rejects placement on a 1×1 grid (all catalog buildings are larger than 1 cell)', () => {
    // The smallest T1 footprints are 2×2; a 1×1 grid is always out of bounds
    const grid = makeFlatGrid(1, 1, 5);

    const result = canPlaceBuilding(grid, 'management_office', 0, 0);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Out of bounds');
  });

  it('rejects placement when a single BUSY cell is the only obstacle in a 2×2 grid', () => {
    // 2×2 flat grid; bottom-right cell (x=1,z=1) is BUSY
    // management_office T1 (2×2) at (0,0) covers all 4 cells → hits the single BUSY cell
    const grid = makeFlatGrid(2, 2, 5);
    grid[1]![1]!.surfaceY = BUSY;

    const result = canPlaceBuilding(grid, 'management_office', 0, 0);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Space is occupied');
  });

  // ── Check priority: bounds before BUSY, BUSY before uneven-surface ─────────

  it('reports "Out of bounds" even when the origin also contains a BUSY cell', () => {
    // If bounds and BUSY both apply, the bounds error must be returned first
    const grid = makeFlatGrid(10, 10, 5);
    grid[0]![0]!.surfaceY = BUSY;

    const result = canPlaceBuilding(grid, 'management_office', -1, 0);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Out of bounds');
  });

  it('reports "Out of bounds" even when the surface is also uneven at the target', () => {
    // OOB check fires before uneven-surface check
    const grid = makeFlatGrid(10, 10, 3);
    grid[0]![0]!.surfaceY = 7; // makes the surface uneven at (0,0)

    const result = canPlaceBuilding(grid, 'management_office', -1, 0);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Out of bounds');
  });

  // ── Tier defaults to 1 when omitted ───────────────────────────────────────

  it('uses the tier-1 footprint when the tier parameter is omitted', () => {
    // management_office T1: 2×2; T3: 3×3
    // A 2×2 grid fits T1 exactly but not T3
    const grid = makeFlatGrid(2, 2, 5);

    const implicitTier = canPlaceBuilding(grid, 'management_office', 0, 0);
    const explicitTier1 = canPlaceBuilding(grid, 'management_office', 0, 0, 1);

    // Both must be valid (T1 fits) and identical in outcome
    expect(implicitTier.valid).toBe(true);
    expect(explicitTier1.valid).toBe(true);
  });

  it('uses a larger footprint when tier 3 is explicitly requested', () => {
    // management_office T3: 3×3 footprint; a 2×2 grid cannot accommodate it
    const grid = makeFlatGrid(2, 2, 5);

    const result = canPlaceBuilding(grid, 'management_office', 0, 0, 3);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Out of bounds');
  });

});
