// BlastSimulator2026 — Unit tests: A* Pathfinding over NavGrid
// Task 5.20: A* pathfinding with 8-directional movement and octile heuristic
//
// Test breakdown:
//   Group 1 — Happy path: straight, vertical, diagonal paths found
//   Group 2 — Obstacle avoidance: routing around blocked cells, start/goal blocked
//   Group 3 — Cell type costs: drill_hole, ramp, walkable move costs
//   Group 4 — Vehicle avoidance: avoidVehicles flag behaviour
//   Group 5 — Diagonal movement: 8-directional preference and costs
//   Group 6 — Edge cases: start==goal, OOB, zero-size, single cell
//   Group 7 — Budget fallback: 500-node cap, directLineWalk
//   Group 8 — Octile heuristic: correctness verification
//   Group 9 — Waypoint validity: contiguous, includes goal, no dup start

import { describe, it, expect } from 'vitest';
import { findPath, type PathRequest } from '../../../src/core/nav/Pathfinding.js';
import { NavGrid, type NavCell, type NavCellType } from '../../../src/core/nav/NavGrid.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function makeCell(type: NavCellType): NavCell {
  let moveCost: number;
  switch (type) {
    case 'walkable':  moveCost = 1.0; break;
    case 'ramp':      moveCost = 1.8; break;
    case 'drill_hole': moveCost = 5.0; break;
    case 'blocked':
    case 'void':      moveCost = Infinity; break;
  }
  return { type, moveCost, benchLevel: 0, vehicleOccupied: false };
}

/** Create a flat NavGrid where every cell has the given type (default 'walkable'). */
function makeFlatGrid(width: number, height: number, fillType: NavCellType = 'walkable'): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) {
      row.push(makeCell(fillType));
    }
    cells.push(row);
  }
  return new NavGrid(width, height, cells);
}

/** Mutate a single cell's type and move cost (and optionally other NavCell fields). */
function setCell(grid: NavGrid, x: number, z: number, type: NavCellType, overrides?: Partial<NavCell>): void {
  const cell = makeCell(type);
  if (overrides) Object.assign(cell, overrides);
  grid.cells[z]![x] = cell;
}

/** Check whether two waypoints form a valid cardinal or diagonal step. */
function isValidStep(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const dx = Math.abs(b.x - a.x);
  const dz = Math.abs(b.z - a.z);
  return dx <= 1 && dz <= 1 && (dx + dz > 0);
}

/** Build the octile heuristic value between two cells. */
function octileHeuristic(ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group 1: Happy path — basic reachability
// ═══════════════════════════════════════════════════════════════════════════════

describe('findPath — happy path', () => {
  it('finds a straight horizontal path from (0,0) to (9,0) on a 10×1 grid', () => {
    const grid = makeFlatGrid(10, 1, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(true);
    expect(result.waypoints.length).toBeGreaterThanOrEqual(2);
    expect(result.totalCost).toBeGreaterThan(0);
  });

  it('finds a straight vertical path from (0,0) to (0,9) on a 1×10 grid', () => {
    const grid = makeFlatGrid(1, 10, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 0, toZ: 9, avoidVehicles: false });
    expect(result.found).toBe(true);
    expect(result.waypoints.length).toBeGreaterThanOrEqual(2);
  });

  it('finds a diagonal path from (0,0) to (9,9) on a 10×10 grid', () => {
    const grid = makeFlatGrid(10, 10, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 9, avoidVehicles: false });
    expect(result.found).toBe(true);
  });

  it('returns waypoints that start at fromX/fromZ and end at toX/toZ', () => {
    const grid = makeFlatGrid(10, 10, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 2, fromZ: 3, toX: 8, toZ: 7, avoidVehicles: false });
    expect(result.found).toBe(true);
    expect(result.waypoints[0]!.x).toBe(2);
    expect(result.waypoints[0]!.z).toBe(3);
    expect(result.waypoints[result.waypoints.length - 1]!.x).toBe(8);
    expect(result.waypoints[result.waypoints.length - 1]!.z).toBe(7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 2: Obstacle avoidance
// ═══════════════════════════════════════════════════════════════════════════════

describe('findPath — obstacle avoidance', () => {
  it('routes around a single blocked cell on an otherwise clear path', () => {
    // 10×3 grid, block the direct horizontal cell at (5,1)
    // Start (0,1), Goal (9,1) — must go around the blocked cell
    const grid = makeFlatGrid(10, 3, 'walkable');
    setCell(grid, 5, 1, 'blocked');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 1, toX: 9, toZ: 1, avoidVehicles: false });
    expect(result.found).toBe(true);
    // Path should not include the blocked cell
    for (const wp of result.waypoints) {
      expect(grid.cells[wp.z]![wp.x]!.type).not.toBe('blocked');
    }
  });

  it('returns found: false when start cell is blocked', () => {
    const grid = makeFlatGrid(5, 5, 'walkable');
    setCell(grid, 0, 0, 'blocked');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 4, toZ: 4, avoidVehicles: false });
    expect(result.found).toBe(false);
  });

  it('returns found: false when start cell is void', () => {
    const grid = makeFlatGrid(5, 5, 'walkable');
    setCell(grid, 0, 0, 'void');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 4, toZ: 4, avoidVehicles: false });
    expect(result.found).toBe(false);
  });

  it('returns found: false when goal cell is blocked', () => {
    const grid = makeFlatGrid(5, 5, 'walkable');
    setCell(grid, 4, 4, 'blocked');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 4, toZ: 4, avoidVehicles: false });
    expect(result.found).toBe(false);
  });

  it('returns found: false when goal cell is void', () => {
    const grid = makeFlatGrid(5, 5, 'walkable');
    setCell(grid, 4, 4, 'void');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 4, toZ: 4, avoidVehicles: false });
    expect(result.found).toBe(false);
  });

  it('returns found: false when no path exists (goal surrounded by blocked cells)', () => {
    // 5×5 grid, goal at (4,4) surrounded by blocked cells
    const grid = makeFlatGrid(5, 5, 'walkable');
    setCell(grid, 4, 4, 'walkable'); // goal is walkable but surrounded
    setCell(grid, 3, 4, 'blocked');
    setCell(grid, 4, 3, 'blocked');
    // (5,4) and (4,5) are out of bounds, so goal is unreachable
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 4, toZ: 4, avoidVehicles: false });
    expect(result.found).toBe(false);
  });

  it('routes around a wall of blocked cells forming a corridor', () => {
    // 10×5 grid with a vertical wall of blocked cells from (5,0) to (5,4) except (5,2)
    // Start (0,2), Goal (9,2) — must go through the gap at (5,2)
    const grid = makeFlatGrid(10, 5, 'walkable');
    // Build wall
    for (let z = 0; z < 5; z++) {
      if (z !== 2) setCell(grid, 5, z, 'blocked');
    }
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 2, toX: 9, toZ: 2, avoidVehicles: false });
    expect(result.found).toBe(true);
    // Path must go through the gap at (5,2)
    const hasGap = result.waypoints.some(wp => wp.x === 5 && wp.z === 2);
    expect(hasGap).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 3: Cell type costs
// ═══════════════════════════════════════════════════════════════════════════════

describe('findPath — cell type costs', () => {
  it('computes totalCost correctly for a path through walkable cells (cost 1.0 per step)', () => {
    // 10×1 grid, walkable, from (0,0) to (9,0)
    // Minimum cost: 9 cardinal steps × 1.0 = 9.0
    const grid = makeFlatGrid(10, 1, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(true);
    expect(result.totalCost).toBe(9.0);
  });

  it('computes totalCost correctly for a path through drill_hole cells (cost 5.0 per step)', () => {
    // 10×1 grid, drill_hole cells, from (0,0) to (9,0)
    // Minimum cost: 9 cardinal steps × 5.0 = 45.0
    const grid = makeFlatGrid(10, 1, 'drill_hole');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(true);
    // Cost per step should be 5.0 (not 1.0)
    expect(result.totalCost).toBeGreaterThan(20);
    expect(result.totalCost).toBeLessThanOrEqual(9 * 5.0);
  });

  it('computes totalCost correctly for a path through ramp cells (cost 1.8 per step)', () => {
    // 10×1 grid, ramp cells, from (0,0) to (9,0)
    // Minimum cost: 9 cardinal steps × 1.8 = 16.2
    const grid = makeFlatGrid(10, 1, 'ramp');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(true);
    expect(result.totalCost).toBeGreaterThan(9);
    expect(result.totalCost).toBeLessThanOrEqual(9 * 1.8 + 0.01);
  });

  it('prefers a walkable path over a drill_hole path when both exist (lower cost)', () => {
    // 10×3 grid, top and bottom rows walkable, middle row drill_hole
    // Start (0,1), Goal (9,1)
    // The pathfinder should route via row 0 or 2 (walkable) rather than go
    // straight through drill_hole cells (cost 5.0 vs 1.0)
    const grid = makeFlatGrid(10, 3, 'walkable');
    // Set the entire middle row to drill_hole
    for (let x = 0; x < 10; x++) {
      setCell(grid, x, 1, 'drill_hole');
    }
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 1, toX: 9, toZ: 1, avoidVehicles: false });
    expect(result.found).toBe(true);
    // A path staying in the drill_hole row would cost 9 * 5.0 = 45.0
    // A detour via walkable rows would cost much less
    expect(result.totalCost).toBeLessThan(25);
    // Path should NOT stay in the drill_hole row
    const onlyDrillHole = result.waypoints.every(wp => wp.z === 1);
    expect(onlyDrillHole).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 4: Vehicle avoidance
// ═══════════════════════════════════════════════════════════════════════════════

describe('findPath — vehicle avoidance', () => {
  it('routes around a vehicleOccupied cell when avoidVehicles=true', () => {
    // 10×3 grid, cell (5,1) is vehicleOccupied
    // Start (0,1), Goal (9,1)
    const grid = makeFlatGrid(10, 3, 'walkable');
    setCell(grid, 5, 1, 'walkable', { vehicleOccupied: true });
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 1, toX: 9, toZ: 1, avoidVehicles: true });
    expect(result.found).toBe(true);
    // Path should avoid the vehicleOccupied cell
    for (const wp of result.waypoints) {
      if (wp.x === 5 && wp.z === 1) {
        // If we're at (5,1), it must be a non-occupied cell pass-through
        // But since we set it to occupied, this would be wrong
      }
      expect(!(wp.x === 5 && wp.z === 1)).toBe(true); // Should not visit (5,1)
    }
  });

  it('passes through vehicleOccupied cell at normal cost when avoidVehicles=false', () => {
    // 10×1 grid, all cells walkable but some occupied
    // avoidVehicles=false should ignore occupancy
    const grid = makeFlatGrid(10, 1, 'walkable');
    setCell(grid, 5, 0, 'walkable', { vehicleOccupied: true });
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(true);
    // The path should go straight through, including the occupied cell
    const passesThrough = result.waypoints.some(wp => wp.x === 5 && wp.z === 0);
    expect(passesThrough).toBe(true);
    expect(result.totalCost).toBe(9.0);
  });

  it('returns found: false when avoidVehicles=true and all viable paths are blocked by vehicleOccupied cells', () => {
    // 10×1 grid, cell (5,0) is the only route and is vehicleOccupied
    // avoidVehicles=true means the path cannot go through it
    const grid = makeFlatGrid(10, 1, 'walkable');
    setCell(grid, 5, 0, 'walkable', { vehicleOccupied: true });
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 0, avoidVehicles: true });
    expect(result.found).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 5: Diagonal movement
// ═══════════════════════════════════════════════════════════════════════════════

describe('findPath — diagonal movement', () => {
  it('prefers diagonal movement when it reduces path length', () => {
    // 10×10 grid, start (0,0), goal (9,9)
    // Pure diagonal path is 9 steps vs 18 cardinal steps
    const grid = makeFlatGrid(10, 10, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 9, avoidVehicles: false });
    expect(result.found).toBe(true);
    // Optimal path length is 9 diagonal steps = 9 waypoints (including start)
    // A cardinal-only path would have 19 waypoints
    // A diagonal path should have ~10 waypoints (9 steps + start)
    expect(result.waypoints.length).toBeLessThan(15);
  });

  it('applies Math.SQRT2 cost for diagonal steps', () => {
    // 10×10 grid, start (0,0), goal (9,9), all walkable
    // Optimal totalCost: 9 diagonal steps × 1.0 × √2 = 9 * √2 ≈ 12.7279
    const grid = makeFlatGrid(10, 10, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 9, avoidVehicles: false });
    expect(result.found).toBe(true);
    const optimal = 9 * Math.SQRT2;
    // Allow small floating point tolerance
    expect(result.totalCost).toBeCloseTo(optimal, 4);
  });

  it('uses cell.moveCost directly for cardinal steps', () => {
    // 10×1 grid, start (0,0), goal (9,0)
    // 9 cardinal steps, each costing 1.0 = 9.0
    const grid = makeFlatGrid(10, 1, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(true);
    expect(result.totalCost).toBe(9.0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 6: Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('findPath — edge cases', () => {
  it('returns found: true with single waypoint and totalCost 0 when start equals goal', () => {
    const grid = makeFlatGrid(10, 10, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 5, fromZ: 5, toX: 5, toZ: 5, avoidVehicles: false });
    expect(result.found).toBe(true);
    expect(result.waypoints.length).toBe(1);
    expect(result.waypoints[0]!.x).toBe(5);
    expect(result.waypoints[0]!.z).toBe(5);
    expect(result.totalCost).toBe(0);
  });

  it('clamps out-of-bounds start coordinates to grid limits', () => {
    // Start at (-5, -5) should be clamped to (0, 0)
    const grid = makeFlatGrid(10, 10, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: -5, fromZ: -5, toX: 5, toZ: 5, avoidVehicles: false });
    expect(result.found).toBe(true);
    // Path should start at (0,0) after clamping
    expect(result.waypoints[0]!.x).toBe(0);
    expect(result.waypoints[0]!.z).toBe(0);
  });

  it('clamps out-of-bounds goal coordinates to grid limits', () => {
    // Goal at (15, 15) should be clamped to (9, 9) on a 10×10 grid
    const grid = makeFlatGrid(10, 10, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 15, toZ: 15, avoidVehicles: false });
    expect(result.found).toBe(true);
    // Path should end at (9,9) after clamping
    const last = result.waypoints[result.waypoints.length - 1]!;
    expect(last.x).toBe(9);
    expect(last.z).toBe(9);
  });

  it('returns found: false for a grid with 0 width', () => {
    const grid = new NavGrid(0, 10, []);
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 0, toZ: 5, avoidVehicles: false });
    expect(result.found).toBe(false);
  });

  it('returns found: false for a grid with 0 height', () => {
    const grid = new NavGrid(10, 0, []);
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 5, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(false);
  });

  it('works with a single cell (1×1) where start equals goal', () => {
    const grid = makeFlatGrid(1, 1, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 0, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(true);
    expect(result.waypoints.length).toBe(1);
    expect(result.totalCost).toBe(0);
  });

  it('returns found: false for a single cell (1×1) when it is blocked', () => {
    const grid = makeFlatGrid(1, 1, 'blocked');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 0, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 7: Budget fallback (500 node cap)
// ═══════════════════════════════════════════════════════════════════════════════

describe('findPath — budget fallback (500 node cap)', () => {
  it('falls back to directLineWalk when A* would explore more than 500 nodes', () => {
    // 600×1 grid forces A* to expand 600 cells to reach the goal, exceeding the 500 budget.
    // The direct line is all walkable, so the fallback should succeed.
    const grid = makeFlatGrid(600, 1, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 599, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(true);
  });

  it('returns found:true when budget is exceeded but the direct line is clear', () => {
    // 600×1, all walkable. A* exceeds budget (600 cells > 500).
    // Direct line is unobstructed → found: true
    const grid = makeFlatGrid(600, 1, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 599, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(true);
    // Waypoints should still form a valid start-to-goal path
    expect(result.waypoints.length).toBeGreaterThanOrEqual(2);
    expect(result.waypoints[0]!.x).toBe(0);
    expect(result.waypoints[0]!.z).toBe(0);
    expect(result.waypoints[result.waypoints.length - 1]!.x).toBe(599);
    expect(result.waypoints[result.waypoints.length - 1]!.z).toBe(0);
  });

  it('returns found:false when budget is exceeded and the direct line is blocked', () => {
    // 600×1 grid, cell (598,0) is blocked.
    // A* would explore up to 600 cells (> 500 budget) before discovering
    // the goal is unreachable. Fallback to directLineWalk: the line from
    // (0,0) to (599,0) passes through (598,0) which is blocked → found: false.
    const grid = makeFlatGrid(600, 1, 'walkable');
    setCell(grid, 598, 0, 'blocked');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 599, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(false);
  });

  it('budget-exceeded path has valid totalCost for the direct line', () => {
    // 600×1, all walkable. Budget exceeded, direct line clear.
    // Cost should reflect the direct line path (599 steps × 1.0 for walkable)
    const grid = makeFlatGrid(600, 1, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 599, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(true);
    expect(result.totalCost).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 8: Octile heuristic
// ═══════════════════════════════════════════════════════════════════════════════

describe('findPath — octile heuristic', () => {
  it('computes correct heuristic value: h = max(|dx|,|dz|) + (√2-1) * min(|dx|,|dz|)', () => {
    // Direct test of the octile formula for several coordinate pairs
    // (0,0) → (5,0): dx=5, dz=0, h = max(5,0) + (√2-1)*min(5,0) = 5
    expect(octileHeuristic(0, 0, 5, 0)).toBe(5);
    expect(octileHeuristic(0, 0, 0, 5)).toBe(5);
    // (0,0) → (5,5): dx=5, dz=5, h = max(5,5) + (√2-1)*min(5,5) = 5 + (√2-1)*5 = 5√2
    expect(octileHeuristic(0, 0, 5, 5)).toBeCloseTo(5 * Math.SQRT2, 6);
    // (0,0) → (7,3): dx=7, dz=3, h = max(7,3) + (√2-1)*min(7,3) = 7 + (√2-1)*3
    const expected = 7 + (Math.SQRT2 - 1) * 3;
    expect(octileHeuristic(0, 0, 7, 3)).toBeCloseTo(expected, 6);
    // (2,5) → (8,1): dx=6, dz=4, h = max(6,4) + (√2-1)*min(6,4) = 6 + (√2-1)*4
    const expected2 = 6 + (Math.SQRT2 - 1) * 4;
    expect(octileHeuristic(2, 5, 8, 1)).toBeCloseTo(expected2, 6);
    // Same point: h = 0
    expect(octileHeuristic(3, 3, 3, 3)).toBe(0);
  });

  it('uses octile heuristic to guide the search towards the goal', () => {
    // Create a grid with two possible paths of different lengths.
    // The heuristic should guide A* to find the shorter (diagonal) path.
    // 10×10 grid, start (0,0), goal (9,9).
    // Pure diagonal = 9 steps; pure cardinal = 18 steps.
    const grid = makeFlatGrid(10, 10, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 9, avoidVehicles: false });
    expect(result.found).toBe(true);
    // Verify the heuristic gives admissible (non-overestimating) costs
    // The path cost should be >= octile distance
    const heuristicDistance = octileHeuristic(0, 0, 9, 9);
    expect(result.totalCost).toBeGreaterThanOrEqual(heuristicDistance - 0.001);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 9: Waypoint validity
// ═══════════════════════════════════════════════════════════════════════════════

describe('findPath — waypoint validity', () => {
  it('waypoints array forms a valid contiguous path (each consecutive waypoint is a neighbor)', () => {
    const grid = makeFlatGrid(10, 10, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 9, avoidVehicles: false });
    expect(result.found).toBe(true);
    for (let i = 0; i < result.waypoints.length - 1; i++) {
      expect(isValidStep(result.waypoints[i]!, result.waypoints[i + 1]!)).toBe(true);
    }
  });

  it('waypoints includes the goal cell', () => {
    const grid = makeFlatGrid(10, 10, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 9, avoidVehicles: false });
    expect(result.found).toBe(true);
    const last = result.waypoints[result.waypoints.length - 1]!;
    expect(last.x).toBe(9);
    expect(last.z).toBe(9);
  });

  it('waypoints does not duplicate the start cell (unless start==goal)', () => {
    const grid = makeFlatGrid(10, 10, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 9, avoidVehicles: false });
    expect(result.found).toBe(true);
    // Count occurrences of the start cell in waypoints
    const startCount = result.waypoints.filter(wp => wp.x === 0 && wp.z === 0).length;
    expect(startCount).toBe(1);
  });

  it('does not include unreachable (blocked/void) cells in the waypoints', () => {
    // Create a grid with obstacles and verify no waypoint is on a blocked cell
    const grid = makeFlatGrid(10, 5, 'walkable');
    setCell(grid, 3, 1, 'blocked');
    setCell(grid, 3, 2, 'blocked');
    setCell(grid, 3, 3, 'blocked');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 2, toX: 9, toZ: 2, avoidVehicles: false });
    if (result.found) {
      for (const wp of result.waypoints) {
        const cell = grid.cells[wp.z]![wp.x]!;
        expect(cell.type).not.toBe('blocked');
        expect(cell.type).not.toBe('void');
      }
    }
  });

  it('waypoints have monotonically non-decreasing distance to goal for a simple open grid', () => {
    // On a simple open grid, A* should find a path where each step
    // brings us closer (or stays same distance) to the goal
    const grid = makeFlatGrid(10, 10, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 9, avoidVehicles: false });
    expect(result.found).toBe(true);
    for (let i = 0; i < result.waypoints.length - 1; i++) {
      const curr = result.waypoints[i]!;
      const next = result.waypoints[i + 1]!;
      // Each step should not increase the octile distance to goal
      const currDist = octileHeuristic(curr.x, curr.z, 9, 9);
      const nextDist = octileHeuristic(next.x, next.z, 9, 9);
      expect(nextDist).toBeLessThanOrEqual(currDist + 0.001);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 10: Complex scenarios (additional coverage)
// ═══════════════════════════════════════════════════════════════════════════════

describe('findPath — complex scenarios', () => {
  it('finds a path through a mixed grid of walkable and ramp cells', () => {
    // 5×5 grid with a mix of walkable and ramp cells
    const grid = makeFlatGrid(5, 5, 'walkable');
    setCell(grid, 1, 1, 'ramp');
    setCell(grid, 2, 1, 'ramp');
    setCell(grid, 3, 1, 'ramp');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 1, toX: 4, toZ: 1, avoidVehicles: false });
    expect(result.found).toBe(true);
    // Cost should reflect ramp cells when they are used
    expect(result.totalCost).toBeGreaterThan(4); // at least 4 cells
  });

  it('avoids vehicles when avoidVehicles=true even on a narrow corridor', () => {
    // 5×1 grid (single row), all walkable, cell (2,0) occupied
    // avoidVehicles=true but there's no alternate route — single row
    // The only path goes through the occupied cell
    const grid = makeFlatGrid(5, 1, 'walkable');
    setCell(grid, 2, 0, 'walkable', { vehicleOccupied: true });
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 4, toZ: 0, avoidVehicles: true });
    // Since there's no alternate route through a different row, the path should fail
    expect(result.found).toBe(false);
  });

  it('uses drill_hole cells only when no walkable alternative exists', () => {
    // 3×3 grid, start at (0,1), goal at (2,1)
    // Middle cell (1,1) is drill_hole
    // Top and bottom rows offer walkable alternatives
    const grid = makeFlatGrid(3, 3, 'walkable');
    setCell(grid, 1, 0, 'blocked'); // block the top detour
    setCell(grid, 1, 2, 'blocked'); // block the bottom detour
    setCell(grid, 1, 1, 'drill_hole'); // middle is drill_hole
    // Now the only way from (0,1) to (2,1) is through (1,1) drill_hole
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 1, toX: 2, toZ: 1, avoidVehicles: false });
    expect(result.found).toBe(true);
    // Path must pass through (1,1) which is drill_hole
    const passesDrill = result.waypoints.some(wp => wp.x === 1 && wp.z === 1);
    expect(passesDrill).toBe(true);
    // Cost reflects drill_hole: 2 cells × 5.0 = 10.0
    expect(result.totalCost).toBeCloseTo(10.0, 4);
  });

  it('handles a winding path through a maze-like grid', () => {
    // Create a simple S-shaped corridor in a 10×10 grid
    const grid = makeFlatGrid(10, 10, 'blocked');
    // Clear a winding path: horizontal corridors at z=2 and z=6,
    // connected by vertical corridors at x=3 and x=7
    for (let x = 0; x < 10; x++) {
      setCell(grid, x, 2, 'walkable'); // top horizontal
      setCell(grid, x, 6, 'walkable'); // bottom horizontal
    }
    for (let z = 2; z <= 6; z++) {
      setCell(grid, 3, z, 'walkable'); // left vertical connector
      setCell(grid, 7, z, 'walkable'); // right vertical connector
    }
    // Start at (0,2), Goal at (9,6)
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 2, toX: 9, toZ: 6, avoidVehicles: false });
    expect(result.found).toBe(true);
    // Path must exist and not use blocked cells
    for (const wp of result.waypoints) {
      expect(grid.cells[wp.z]![wp.x]!.type).not.toBe('blocked');
    }
  });
});
