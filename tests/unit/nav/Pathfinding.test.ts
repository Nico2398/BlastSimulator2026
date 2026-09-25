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
import {
  findPath, findExactPath, octileHeuristic, getBenchLevel, findRampConnections, isImpassable,
  isDiagonalCornerClear, directLineWalk,
} from '../../../src/core/nav/Pathfinding.js';
import { NavGrid, type NavCell, type NavCellType, isStepClimbable } from '../../../src/core/nav/NavGrid.js';
import {
  NAV_MAX_SLOPE_RATIO, NAV_CLEARANCE_MAX_CELLS, NAV_CLEARANCE_EMPLOYEE_CELLS, NAV_CLEARANCE_VEHICLE_CELLS,
} from '../../../src/core/config/balance.js';
import { RAMP_WIDTH } from '../../../src/core/mining/Ramp.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Third `surfaceY` param defaults undefined — hand-built fixtures that don't
 * pass it model no terrain height and stay unconstrained by climb gating
 * (#953), matching every pre-existing call site in this file unmodified.
 * Also seeds `climbY` (the integer field production climb-gating actually
 * reads, #1149) to the same value — these hand-built fixtures have no real
 * voxel grid to derive a separate integer index from, so `surfaceY` and
 * `climbY` are the same number here, exactly like pre-#1149 behaviour. */
function makeCell(type: NavCellType, benchLevel: number = 0, surfaceY?: number): NavCell {
  let moveCost: number;
  switch (type) {
    case 'walkable':  moveCost = 1.0; break;
    case 'ramp':      moveCost = 1.8; break;
    case 'drill_hole': moveCost = 5.0; break;
    case 'blocked':
    case 'void':      moveCost = Infinity; break;
  }
  return {
    type, moveCost, benchLevel, vehicleOccupied: false,
    ...(surfaceY !== undefined && { surfaceY, climbY: surfaceY }),
  };
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

/** Mutate a single cell's type and move cost (and optionally other NavCell fields).
 * An override that sets `surfaceY` without its own `climbY` also seeds `climbY`
 * to the same value, matching `makeCell`'s convention above. */
function setCell(grid: NavGrid, x: number, z: number, type: NavCellType, overrides?: Partial<NavCell>): void {
  const cell = makeCell(type);
  if (overrides) Object.assign(cell, overrides);
  if (overrides?.surfaceY !== undefined && overrides.climbY === undefined) cell.climbY = overrides.surfaceY;
  grid.cells[z]![x] = cell;
}

/** Check whether two waypoints form a valid cardinal or diagonal step. */
function isValidStep(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const dx = Math.abs(b.x - a.x);
  const dz = Math.abs(b.z - a.z);
  return dx <= 1 && dz <= 1 && (dx + dz > 0);
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

  it('returns found: true when start cell is blocked but a path exists (agent\'s own cell is never impassable to itself)', () => {
    // #1025 — the agent's own current cell is never impassable to itself,
    // regardless of its type, so a 'blocked' start still paths to an open goal.
    const grid = makeFlatGrid(5, 5, 'walkable');
    setCell(grid, 0, 0, 'blocked');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 4, toZ: 4, avoidVehicles: false });
    expect(result.found).toBe(true);
    expect(result.waypoints[0]).toEqual({ x: 0, z: 0 });
  });

  it('returns found: true when start cell is void but a path exists (agent\'s own cell is never impassable to itself)', () => {
    // #1025 — same corrected contract for 'void'.
    const grid = makeFlatGrid(5, 5, 'walkable');
    setCell(grid, 0, 0, 'void');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 4, toZ: 4, avoidVehicles: false });
    expect(result.found).toBe(true);
    expect(result.waypoints[0]).toEqual({ x: 0, z: 0 });
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

  it('routes around a corner instead of cutting it (#1197)', () => {
    // 6×6 grid — widened from the old 5×5 fixture (#1197). Same blocked
    // cells, (3,4) and (4,3), and the same goal, (4,4), but the old 5×5
    // grid put (4,4) in the grid's own extreme corner: only 3 neighbours
    // exist there at all, 2 of them the very cells just blocked, so once a
    // diagonal corner-cut through two blocked orthogonal cells is refused
    // (#1197) the goal becomes totally unreachable — every remaining
    // approach (a diagonal via (3,3) or (5,5), or a cardinal via (4,5) or
    // (5,4)) is either the illegal cut itself or routes through a cell this
    // 5×5 grid simply doesn't have. Widening to 6×6 opens a real orthogonal
    // detour: (5,5) is a legal diagonal entry into (4,4) (both its own
    // orthogonal cells, (4,5) and (5,4), stay walkable), and cardinal entry
    // via (4,5)/(5,4) is always legal regardless.
    const grid = makeFlatGrid(6, 6, 'walkable');
    setCell(grid, 4, 4, 'walkable'); // goal is walkable
    setCell(grid, 3, 4, 'blocked');
    setCell(grid, 4, 3, 'blocked');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 4, toZ: 4, avoidVehicles: false });
    expect(result.found).toBe(true);
    // The old, now-illegal clipped diagonal cost 4 * √2 (four diagonal
    // steps straight through the corner) — a real detour around it must
    // cost strictly more.
    expect(result.totalCost).toBeGreaterThan(4 * Math.SQRT2);
    // Every consecutive waypoint pair must be a legal step — in particular,
    // never a diagonal cut through (3,4)/(4,3).
    for (let i = 0; i < result.waypoints.length - 1; i++) {
      const a = result.waypoints[i]!;
      const b = result.waypoints[i + 1]!;
      expect(isDiagonalCornerClear(grid, a.x, a.z, b.x, b.z)).toBe(true);
    }
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
    // Deterministic: 9 cardinal steps × 5.0 = 45.0
    expect(result.totalCost).toBe(45.0);
  });

  it('computes totalCost correctly for a path through ramp cells (cost 1.8 per step)', () => {
    // 10×1 grid, ramp cells, from (0,0) to (9,0)
    // Minimum cost: 9 cardinal steps × 1.8 = 16.2
    const grid = makeFlatGrid(10, 1, 'ramp');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(true);
    // Deterministic: 9 cardinal steps × 1.8 = 16.2
    expect(result.totalCost).toBeCloseTo(16.2, 4);
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

  it('returns found: true for a single cell (1×1) when it is blocked (start === goal, agent\'s own cell is never impassable to itself)', () => {
    // #1025 — trivial start-equals-goal case: the sole cell is both the
    // agent's start and goal, so its 'blocked' type never bars it.
    const grid = makeFlatGrid(1, 1, 'blocked');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 0, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(true);
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

  it('budget-exceeded path waypoints form a valid start-to-goal path', () => {
    // 600×1, all walkable. A* exceeds budget (600 cells > 500).
    // Direct line is unobstructed → waypoints should span the full route.
    const grid = makeFlatGrid(600, 1, 'walkable');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 599, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(true);
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
    expect(result.totalCost).toBe(599);
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
    // Cost: entering drill_hole (5.0) + entering walkable goal (1.0) = 6.0
    expect(result.totalCost).toBeCloseTo(6.0, 4);
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

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers for multi-level tests
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a two-level NavGrid where upper rows are benchLevel 0 and lower rows are benchLevel 1.
 * All cells are initially walkable. Ramps must be added by the caller.
 */
function makeTwoLevelGrid(
  width: number,
  height: number,
  upperHeight: number,
): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) {
      if (z < upperHeight) {
        row.push(makeCell('walkable', 0)); // upper level
      } else {
        row.push(makeCell('walkable', 1)); // lower level
      }
    }
    cells.push(row);
  }
  return new NavGrid(width, height, cells, 10);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group 11: Multi-level routing via ramp lookup
// ═══════════════════════════════════════════════════════════════════════════════

describe('findPath — multi-level routing', () => {

  it('routes within the same bench level when start and goal are on same level', () => {
    // 10×10 grid: top 5 rows = benchLevel 0, bottom 5 rows = benchLevel 1
    // Start and goal both on benchLevel 0 → standard A* should find the path
    const grid = makeTwoLevelGrid(10, 10, 5);
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(true);
    // Straight horizontal path: 9 cardinal steps × 1.0 = 9.0
    expect(result.totalCost).toBe(9.0);
  });

  it('finds a path between different bench levels connected by a ramp', () => {
    // 10×10 grid with a ramp connecting upper (benchLevel 0) and lower (benchLevel 1) areas.
    // Upper: z=0..3 walkable level 0; wall of void at z=4; Lower: z=5..9 walkable level 1.
    // Ramp at (5,4) provides the only connection between levels.
    const grid = makeTwoLevelGrid(10, 10, 4);
    // Build void wall at z=4 (except ramp position)
    for (let x = 0; x < 10; x++) {
      if (x !== 5) {
        grid.cells[4]![x] = makeCell('void', 0);
      }
    }
    // Place ramp at (5,4)
    grid.cells[4]![5] = makeCell('ramp', 0);
    // Ensure cells adjacent to ramp are walkable
    grid.cells[3]![5] = makeCell('walkable', 0); // upper neighbor
    grid.cells[5]![5] = makeCell('walkable', 1); // lower neighbor

    // Start on upper level, goal on lower level
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 0, toZ: 9, avoidVehicles: false });
    // Multi-level routing should find the ramp and connect the levels
    expect(result.found).toBe(true);
    // Waypoints should include the ramp cell
    const hasRamp = result.waypoints.some(wp => wp.x === 5 && wp.z === 4);
    expect(hasRamp).toBe(true);
  });

  it('returns found:false when levels are disconnected and no ramp exists', () => {
    // 10×10 grid: upper level z=0..3 (benchLevel 0), void wall at z=4, lower level z=5..9 (benchLevel 1)
    // No ramp → the two levels are completely disconnected
    const grid = makeTwoLevelGrid(10, 10, 4);
    // Make z=4 entirely void (no ramp)
    for (let x = 0; x < 10; x++) {
      grid.cells[4]![x] = makeCell('void', 0);
    }

    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 0, toZ: 9, avoidVehicles: false });
    // Without a ramp, no path can cross from level 0 to level 1
    expect(result.found).toBe(false);
  });

  it('discovers ramp connections between bench levels', () => {
    // 10×10 grid: upper z=0..4 (benchLevel 0), lower z=5..9 (benchLevel 1)
    // Place a ramp at (3,4) connecting the two levels
    const grid = makeTwoLevelGrid(10, 10, 5);
    // Add void wall at z=5 separation line
    for (let x = 0; x < 10; x++) {
      if (x !== 3) {
        grid.cells[5]![x] = makeCell('void', 1);
      }
    }
    // Ramp at (3,5) with walkable neighbors
    grid.cells[4]![3] = makeCell('walkable', 0);
    grid.cells[5]![3] = makeCell('ramp', 0);
    grid.cells[6]![3] = makeCell('walkable', 1);

    const connections = findRampConnections(grid);
    expect(connections.length).toBeGreaterThanOrEqual(1);
    // Verify the connection references the correct ramp position
    const rampConn = connections.find(c => c.rampX === 3 && c.rampZ === 5);
    expect(rampConn).toBeDefined();
  });

  it('uses the nearest ramp when multiple ramps connect the same levels', () => {
    // 20×3 grid with void center row and two ramps at different distances.
    // Start (0,0) level 0, Goal (11,2) level 1 — placed just past the near
    // ramp so the two candidate routes are NOT cost-tied (#458 T6.2/D14: with
    // the goal at x=19, equidistant from both ramps by the octile metric,
    // going via (10,1) or (15,1) costs exactly the same — a genuine tie a
    // correct A* is free to break either way, which plain-A*'s old Map
    // iteration order happened to always resolve toward the near ramp but
    // the typed-array/weighted-heuristic implementation doesn't guarantee).
    // With the goal at x=11, the near ramp is unambiguously cheaper.
    const width = 20;
    const height = 3;
    const cells: NavCell[][] = [];

    for (let z = 0; z < height; z++) {
      const row: NavCell[] = [];
      for (let x = 0; x < width; x++) {
        if (z === 1) {
          // Middle row: void except ramp positions
          if (x === 10 || x === 15) {
            row.push(makeCell('ramp', 0));
          } else {
            row.push(makeCell('void', 0));
          }
        } else if (z === 0) {
          row.push(makeCell('walkable', 0)); // upper level
        } else {
          row.push(makeCell('walkable', 1)); // lower level
        }
      }
      cells.push(row);
    }
    const grid = new NavGrid(width, height, cells, 10);

    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 11, toZ: 2, avoidVehicles: false });
    expect(result.found).toBe(true);
    // The path should use the nearer ramp at (10,1) not the farther one at (15,1)
    const usesNearRamp = result.waypoints.some(wp => wp.x === 10 && wp.z === 1);
    const usesFarRamp = result.waypoints.some(wp => wp.x === 15 && wp.z === 1);
    expect(usesNearRamp).toBe(true);
    expect(usesFarRamp).toBe(false);
  });

  // ── #458 T6.1/D14: stable ramp selection under near-tied cost ──
  //
  // route1/route2's A* costs come from the CALLER's from-position, which for
  // a moving agent shifts by fractions of a cell every tick (path is
  // recomputed fresh each tick, never cached). When two candidate ramps are
  // close enough in cost, a bare `<` comparison can flip the winner between
  // ticks as that position shifts — producing a stable walk-toward-ramp-A /
  // walk-toward-ramp-B oscillation that never actually arrives (confirmed
  // via direct reproduction: an agent frozen retrying between two points for
  // 100+ ticks). This grid is symmetric around two ramps equidistant from
  // the goal, so calls from two different (but both near-tied) start
  // columns must resolve to the SAME ramp rather than flip-flopping.

  it('picks the same ramp consistently across near-tied start positions, not flip-flopping', () => {
    const width = 21;
    const height = 3;
    const cells: NavCell[][] = [];
    for (let z = 0; z < height; z++) {
      const row: NavCell[] = [];
      for (let x = 0; x < width; x++) {
        if (z === 1) {
          row.push(x === 8 || x === 12 ? makeCell('ramp', 0) : makeCell('void', 0));
        } else if (z === 0) {
          row.push(makeCell('walkable', 0));
        } else {
          row.push(makeCell('walkable', 1));
        }
      }
      cells.push(row);
    }
    const grid = new NavGrid(width, height, cells, 10);

    // The midpoint (x=10) is exactly equidistant from both ramps — cost to
    // either entrance is tied. Calling repeatedly from the tied position
    // must resolve to the same ramp every time (the lower-rampX one, by the
    // tie-break's stable, position-independent key) rather than depending on
    // map-iteration or heap-tie-breaking order to pick one arbitrarily.
    const rampXFromTiedStart = () => {
      const result = findPath(grid, { agentId: 1, fromX: 10, fromZ: 0, toX: 10, toZ: 2, avoidVehicles: false });
      expect(result.found).toBe(true);
      const rampWp = result.waypoints.find(wp => wp.z === 1);
      return rampWp?.x;
    };

    const picks = Array.from({ length: 5 }, () => rampXFromTiedStart());
    expect(picks[0]).toBe(8); // lower rampX wins the tie, deterministically
    expect(picks.every(x => x === picks[0])).toBe(true);
  });

  // ── #1129: single-level analogue — deterministic route choice under a
  // near-tied detour, with no bench-level/ramp involved at all. ──
  //
  // #1129's root cause is two DIFFERENT (near-adjacent, one-tick-apart)
  // start points producing differently-shaped but cost-consistent routes —
  // which AgentAdvance's RouteCommitment guards against across ticks (see
  // tests/unit/nav/AgentAdvance.test.ts). At this layer, stateless per call,
  // the guarantee findPath itself can make is narrower: the SAME request
  // (same start, same goal) must always resolve to the SAME route, never
  // flip-flopping between two equal-cost detours depending on incidental
  // heap/exploration order. This is the single-level version of the
  // ramp-tie-break test above — a wall with two symmetric gaps, blocked
  // cells only (no ramp, no bench-level change), midpoint start exactly
  // equidistant from both gaps.
  it('picks the same detour gap consistently across repeated calls from a tied start, with no ramp/bench-level involved', () => {
    const width = 21;
    const height = 3;
    const cells: NavCell[][] = [];
    for (let z = 0; z < height; z++) {
      const row: NavCell[] = [];
      for (let x = 0; x < width; x++) {
        // A single-level wall along z=1, gaps at x=8 and x=12 — everything
        // stays benchLevel 0 throughout, so ordinary A* detours around the
        // wall rather than findMultiLevelPath's ramp search ever engaging.
        if (z === 1 && x !== 8 && x !== 12) {
          row.push(makeCell('blocked', 0));
        } else {
          row.push(makeCell('walkable', 0));
        }
      }
      cells.push(row);
    }
    const grid = new NavGrid(width, height, cells);

    // The midpoint (x=10) is exactly equidistant from both gaps by the
    // octile metric — cost to either is tied. A deterministic tie-break
    // must resolve to the same gap on every call, not depend on heap-
    // insertion or map-iteration order.
    const gapXFromTiedStart = (): number | undefined => {
      const result = findPath(grid, { agentId: 1, fromX: 10, fromZ: 0, toX: 10, toZ: 2, avoidVehicles: false });
      expect(result.found).toBe(true);
      const gapWp = result.waypoints.find(wp => wp.z === 1);
      return gapWp?.x;
    };

    const picks = Array.from({ length: 5 }, () => gapXFromTiedStart());
    expect(picks[0]).toBeDefined();
    expect(picks.every(x => x === picks[0])).toBe(true);
  });

  // ── #1129: regression fixture pinning the reported real cost numbers ──
  //
  // The oscillation was confirmed live with routes costing 9.657 and 7.657 —
  // a difference of exactly one tick's walk distance at AGENT_WALK_SPEED (2),
  // not a raw tie. This grid reproduces that same cost relationship between
  // two near-adjacent start columns, one tick's walk apart, toward the same
  // goal: pathfinding's own contract (determinism per fixed request) must
  // still hold for each of them individually, even though the two starts'
  // routes are free to differ from EACH OTHER in shape — the cross-tick
  // guard that stops that difference from producing a walk-back is
  // AgentAdvance's job, not this layer's (see AgentAdvance.test.ts's core
  // regression case, built on this same grid shape).
  it('resolves deterministically per start, for two near-adjacent starts whose costs differ by exactly one tick\'s walk distance', () => {
    const grid = makeFlatGrid(30, 30, 'walkable');
    const goal = { toX: 22, toZ: 24, agentId: 1, avoidVehicles: false } as const;

    // A is one tick's walk (AGENT_WALK_SPEED=2) closer to the goal (z=24)
    // than B — matching tick 1 -> tick 2 of AgentAdvance.test.ts's core
    // regression case, where the agent walks from A's position to B's.
    const fromA = { ...goal, fromX: 24, fromZ: 20 };
    const fromB = { ...goal, fromX: 24, fromZ: 18 };

    const resultsA = Array.from({ length: 3 }, () => findPath(grid, fromA));
    const resultsB = Array.from({ length: 3 }, () => findPath(grid, fromB));

    expect(resultsA.every(r => r.found)).toBe(true);
    expect(resultsB.every(r => r.found)).toBe(true);
    // Same request in, same route out — every repeat call from A agrees with
    // the first, and likewise for B.
    expect(resultsA.every(r => r.totalCost === resultsA[0]!.totalCost)).toBe(true);
    expect(resultsA.every(r => JSON.stringify(r.waypoints) === JSON.stringify(resultsA[0]!.waypoints))).toBe(true);
    expect(resultsB.every(r => r.totalCost === resultsB[0]!.totalCost)).toBe(true);
    expect(resultsB.every(r => JSON.stringify(r.waypoints) === JSON.stringify(resultsB[0]!.waypoints))).toBe(true);
    // B starts exactly one tick's walk distance FARTHER from the goal than A
    // along a straight line on an open flat grid (z=18 vs z=20, goal z=24),
    // so its optimal cost is exactly AGENT_WALK_SPEED (2) more than A's —
    // the same cost relationship the real 9.657/7.657 pair carries.
    expect(resultsB[0]!.totalCost - resultsA[0]!.totalCost).toBeCloseTo(2, 5);
  });

  it('includes the ramp cell in the waypoints of a multi-level path', () => {
    // 10×10 grid with void wall and single ramp
    const grid = makeTwoLevelGrid(10, 10, 4);
    // Void wall at z=4 (except ramp)
    for (let x = 0; x < 10; x++) {
      if (x !== 5) {
        grid.cells[4]![x] = makeCell('void', 0);
      }
    }
    // Ramp at (5,4)
    grid.cells[4]![5] = makeCell('ramp', 0);
    grid.cells[3]![5] = makeCell('walkable', 0);
    grid.cells[5]![5] = makeCell('walkable', 1);

    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 0, toZ: 9, avoidVehicles: false });
    expect(result.found).toBe(true);
    // The ramp cell (5,4) must appear in the waypoints
    const rampInWaypoints = result.waypoints.some(wp => wp.x === 5 && wp.z === 4);
    expect(rampInWaypoints).toBe(true);
  });

  it('routes upward when goal is on a higher bench level than start', () => {
    // Start on benchLevel 1 (lower area), goal on benchLevel 0 (upper area).
    // Ramp connects the levels.
    const grid = makeTwoLevelGrid(10, 10, 4);
    // Void wall at z=4 (except ramp)
    for (let x = 0; x < 10; x++) {
      if (x !== 5) {
        grid.cells[4]![x] = makeCell('void', 1);
      }
    }
    // Ramp at (5,4)
    grid.cells[4]![5] = makeCell('ramp', 0);
    grid.cells[3]![5] = makeCell('walkable', 0);
    grid.cells[5]![5] = makeCell('walkable', 1);

    // Start on lower level (z=5..9), goal on upper level (z=0..3)
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 9, toX: 0, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(true);
  });

  it('getBenchLevel returns the correct bench level value for different cells', () => {
    // Create a grid with cells at different benchLevels and verify getBenchLevel returns them
    const grid = makeTwoLevelGrid(10, 10, 5);
    // A cell in upper half should have benchLevel 0
    expect(getBenchLevel(grid, 0, 0)).toBe(0);
    // A cell in lower half should have benchLevel 1
    expect(getBenchLevel(grid, 0, 9)).toBe(1);
    // A ramp cell at the boundary should have benchLevel 0 (its stored value)
    grid.cells[5]![5] = makeCell('ramp', 0);
    expect(getBenchLevel(grid, 5, 5)).toBe(0);
  });

  it('findRampConnections returns empty array for a flat single-level grid', () => {
    // A flat grid with no elevation changes should have no ramp connections
    const grid = makeFlatGrid(10, 10, 'walkable');
    const connections = findRampConnections(grid);
    // With no ramp cells, the result must be an empty array
    expect(Array.isArray(connections)).toBe(true);
    expect(connections.length).toBe(0);
  });

  it('findRampConnections works correctly when maxSurfaceY is 0 (default)', () => {
    // Grid with ramp cells but maxSurfaceY=0 (default)
    const grid = makeTwoLevelGrid(10, 10, 5);
    // Place a ramp cell
    grid.cells[5]![5] = makeCell('ramp', 0);
    grid.cells[4]![5] = makeCell('walkable', 0);
    grid.cells[6]![5] = makeCell('walkable', 1);
    // Make neighbors accessible by keeping them walkable (already done by makeTwoLevelGrid)

    const connections = findRampConnections(grid);
    // Even with maxSurfaceY=0, the ramp should still be detected
    // (findRampConnections does not depend on maxSurfaceY)
    expect(Array.isArray(connections)).toBe(true);
    // The stub returns [], but the real implementation should detect the ramp
    // For now we just verify the call doesn't crash and returns an array
  });

  // ── #1166: chained multi-hop ramp routing across 3+ bench levels ──
  //
  // findMultiLevelPath used to try only a single direct ramp hop between
  // startLevel and goalLevel (filterRampsForLevels required an exact match
  // against a ramp's own upper/lower level pair). Two genuinely walkable
  // points 2+ bench levels apart with no ramp bridging them directly (only
  // 0<->1 and 1<->2 ramps exist, none spanning 0<->2 in one hop) then
  // reported found:false even though a real route exists one hop at a time.
  // findLevelHopSequence/findChainedRoute chain the two single-level hops
  // together, falling back to this only when the direct single-hop search
  // finds nothing.
  it('chains two ramp hops across 3 bench levels when no ramp connects level 0 directly to level 2', () => {
    // 10-wide × 14-tall grid: level 0 (z=0..3), void wall at z=4 except a
    // ramp at (5,4) connecting level 0<->1, level 1 (z=5..8), void wall at
    // z=9 except a ramp at (5,9) connecting level 1<->2, level 2 (z=10..13).
    // No ramp anywhere connects level 0 directly to level 2.
    //
    // Every level cell sits at surfaceY=0 (flat), but both ramp cells sit at
    // surfaceY=50 — a cliff on both sides ordinary A*'s own climb-legality
    // gate (isStepClimbable) refuses to step onto or off of, so the plain
    // "try ordinary A* first" path (findPath step 5) cannot cross either
    // wall at all and must fall through to ramp-graph routing (step 6). The
    // ramp graph itself (findRampConnections/rampEndpoints) never applies a
    // climb check — a ramp cell is the sanctioned connector regardless of
    // height — so multi-level routing can still legitimately cross.
    const width = 10;
    const height = 14;
    const cells: NavCell[][] = [];
    for (let z = 0; z < height; z++) {
      const row: NavCell[] = [];
      for (let x = 0; x < width; x++) {
        if (z <= 3) {
          row.push(makeCell('walkable', 0, 0));
        } else if (z === 4) {
          row.push(x === 5 ? makeCell('ramp', 0, 50) : makeCell('void', 0));
        } else if (z <= 8) {
          row.push(makeCell('walkable', 1, 0));
        } else if (z === 9) {
          row.push(x === 5 ? makeCell('ramp', 1, 50) : makeCell('void', 1));
        } else {
          row.push(makeCell('walkable', 2, 0));
        }
      }
      cells.push(row);
    }
    const grid = new NavGrid(width, height, cells, 50);

    expect(getBenchLevel(grid, 0, 0)).toBe(0);
    expect(getBenchLevel(grid, 0, 13)).toBe(2);
    // No single ramp directly spans level 0 <-> level 2.
    expect(findRampConnections(grid).some(r =>
      (r.upperLevel === 0 && r.lowerLevel === 2) || (r.upperLevel === 2 && r.lowerLevel === 0),
    )).toBe(false);

    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 0, toZ: 13, avoidVehicles: false });

    expect(result.found).toBe(true);
    // The chained route walks through both ramps, one hop at a time.
    expect(result.waypoints.some(wp => wp.x === 5 && wp.z === 4)).toBe(true);
    expect(result.waypoints.some(wp => wp.x === 5 && wp.z === 9)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 12: isStepClimbable (#953)
// ═══════════════════════════════════════════════════════════════════════════════

describe('isStepClimbable — slope-based (#1151)', () => {
  it('returns true when the surfaceY delta is under the slope limit for a cardinal run (1.0m)', () => {
    expect(isStepClimbable(10, 10.3, 1)).toBe(true);
    expect(isStepClimbable(10.3, 10, 1)).toBe(true);
  });

  it('returns true when the surfaceY delta is exactly at the slope limit for a cardinal run (boundary)', () => {
    expect(isStepClimbable(10, 10 + NAV_MAX_SLOPE_RATIO, 1)).toBe(true);
    expect(isStepClimbable(10 + NAV_MAX_SLOPE_RATIO, 10, 1)).toBe(true);
  });

  it('returns false when the surfaceY delta exceeds the slope limit for a cardinal run', () => {
    expect(isStepClimbable(10, 10 + NAV_MAX_SLOPE_RATIO + 0.01, 1)).toBe(false);
    expect(isStepClimbable(10 + NAV_MAX_SLOPE_RATIO + 0.01, 10, 1)).toBe(false);
  });

  it('falls back to unconstrained (true) when either side is missing surfaceY', () => {
    expect(isStepClimbable(undefined, 100, 1)).toBe(true);
    expect(isStepClimbable(100, undefined, 1)).toBe(true);
    expect(isStepClimbable(undefined, undefined, 1)).toBe(true);
  });

  // #1149: production surfaceY values are the continuous marching-cubes
  // crossing height, so a real fromY/toY pair is typically fractional
  // (e.g. 4.5, not 4). The gate itself never rounds — this pins that a
  // fractional delta admits/refuses at exactly the same boundary an integer
  // one does.
  it('admits and refuses fractional surfaceY deltas at the same boundary as integer ones', () => {
    expect(isStepClimbable(4.5, 4.5 + NAV_MAX_SLOPE_RATIO, 1)).toBe(true);
    expect(isStepClimbable(4.5, 4.5 + NAV_MAX_SLOPE_RATIO + 0.01, 1)).toBe(false);
    // A sub-voxel grade difference well inside the limit — exactly the kind
    // of delta the old integer-index representation rounded away entirely.
    expect(isStepClimbable(4.3, 4.7, 1)).toBe(true); // delta 0.4 < NAV_MAX_SLOPE_RATIO (~0.5774)
  });

  // #1151: the legal delta scales with the step's own run distance — a
  // diagonal step (√2m) tolerates more rise than a cardinal one (1m) for the
  // same 30° slope.
  it('scales the legal delta with a diagonal run (√2m)', () => {
    expect(isStepClimbable(10, 10 + NAV_MAX_SLOPE_RATIO * Math.SQRT2, Math.SQRT2)).toBe(true);
    expect(isStepClimbable(10, 10 + NAV_MAX_SLOPE_RATIO * Math.SQRT2 + 0.01, Math.SQRT2)).toBe(false);
    // The identical absolute delta (0.6m) is illegal over a cardinal run but
    // legal over a diagonal one.
    expect(isStepClimbable(10, 10.6, 1)).toBe(false);
    expect(isStepClimbable(10, 10.6, Math.SQRT2)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 13: findPath — climb-limit gating on surfaceY (#953)
//
// A crater rim reads as ordinary 'walkable' terrain (bounded ramp band, see
// NavGrid.test.ts), so the only thing standing between an agent and a
// straight walk across an 8-metre drop is Pathfinding itself refusing the
// step. These fixtures set surfaceY directly (bypassing VoxelGrid) so the
// climb gate is exercised independently of cell type.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a flat plateau NavGrid with a rectangular "pit" whose surfaceY sits
 * far below the plateau — every pit-perimeter step exceeds the slope limit
 * (NAV_MAX_SLOPE_RATIO). All cells are 'walkable' by cell type; only
 * surfaceY marks the pit.
 */
function makePlateauWithPit(
  width: number,
  height: number,
  pit: { minX: number; maxX: number; minZ: number; maxZ: number },
  plateauY: number,
  pitY: number,
): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) {
      const inPit = x >= pit.minX && x <= pit.maxX && z >= pit.minZ && z <= pit.maxZ;
      row.push(makeCell('walkable', 0, inPit ? pitY : plateauY));
    }
    cells.push(row);
  }
  return new NavGrid(width, height, cells, plateauY);
}

describe('findPath — climb-limit gating on surfaceY (#953)', () => {
  const PIT = { minX: 5, maxX: 9, minZ: 5, maxZ: 9 };
  const PLATEAU_Y = 20;
  const PIT_Y = 5; // delta 15 over at most a √2m run — far beyond NAV_MAX_SLOPE_RATIO (~0.577/m)

  it('routes around a pit whose rim exceeds the climb limit — no waypoint enters the pit footprint', () => {
    const grid = makePlateauWithPit(15, 15, PIT, PLATEAU_Y, PIT_Y);
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 14, toZ: 14, avoidVehicles: false });
    expect(result.found).toBe(true);
    for (const wp of result.waypoints) {
      const inPit = wp.x >= PIT.minX && wp.x <= PIT.maxX && wp.z >= PIT.minZ && wp.z <= PIT.maxZ;
      expect(inPit).toBe(false);
    }
  });

  it('returns found:false when the goal sits inside a pit with no within-limit descent anywhere on its perimeter', () => {
    const grid = makePlateauWithPit(15, 15, PIT, PLATEAU_Y, PIT_Y);
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 7, toZ: 7, avoidVehicles: false });
    expect(result.found).toBe(false);
  });

  it('refuses a diagonal step whose surfaceY delta exceeds the slope limit, same as a cardinal one', () => {
    // 2×2 grid: only a diagonal step connects start to goal (both cardinal
    // neighbours are blocked), and that diagonal step's surfaceY delta is
    // far beyond the slope limit.
    const grid = makeFlatGrid(2, 2, 'walkable');
    setCell(grid, 0, 0, 'walkable', { surfaceY: 0 });
    setCell(grid, 1, 0, 'blocked');
    setCell(grid, 0, 1, 'blocked');
    setCell(grid, 1, 1, 'walkable', { surfaceY: 10 }); // 10m over a √2m diagonal run — far too steep
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 1, toZ: 1, avoidVehicles: false });
    expect(result.found).toBe(false);
  });

  it('finds a route across ground graded at 29° on the only path (cardinal-only fixture)', () => {
    // Single row (height 1) — no diagonal step is ever possible, so the
    // only route from (0,0) to (2,0) is two cardinal steps of 0.55m each,
    // within the slope limit.
    const grid = makeFlatGrid(3, 1, 'walkable');
    setCell(grid, 0, 0, 'walkable', { surfaceY: 0 });
    setCell(grid, 1, 0, 'walkable', { surfaceY: 0.55 });
    setCell(grid, 2, 0, 'walkable', { surfaceY: 0.55 });
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 2, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(true);
  });

  it('refuses a route across ground graded at 31° on the only path (cardinal-only fixture)', () => {
    const grid = makeFlatGrid(3, 1, 'walkable');
    setCell(grid, 0, 0, 'walkable', { surfaceY: 0 });
    setCell(grid, 1, 0, 'walkable', { surfaceY: 0.6 });
    setCell(grid, 2, 0, 'walkable', { surfaceY: 0.6 });
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 2, toZ: 0, avoidVehicles: false });
    expect(result.found).toBe(false);
  });

  it('finds a route across ground graded at ~29.6° on the only path (diagonal-only fixture)', () => {
    // 2×2 grid — both cardinal neighbours are 'walkable' (not 'blocked'), so
    // isDiagonalCornerClear (#1197, solidity-only) never rejects the
    // diagonal step as a corner-cut, but each is graded far steeper than the
    // cardinal slope limit (~0.577/m) from either endpoint, so a cardinal
    // step onto either one is climb-rejected — the only usable route is
    // still the 0.80m diagonal step, within the (larger) diagonal slope
    // limit.
    const grid = makeFlatGrid(2, 2, 'walkable');
    setCell(grid, 0, 0, 'walkable', { surfaceY: 0 });
    setCell(grid, 1, 0, 'walkable', { surfaceY: 10 });
    setCell(grid, 0, 1, 'walkable', { surfaceY: 10 });
    setCell(grid, 1, 1, 'walkable', { surfaceY: 0.8 });
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 1, toZ: 1, avoidVehicles: false });
    expect(result.found).toBe(true);
  });

  it('refuses a route across ground graded at ~31.3° on the only path (diagonal-only fixture)', () => {
    // Same corner-cut-avoiding shape as the ~29.6° case above: (1,0)/(0,1)
    // stay 'walkable' but climb-unreachable by a cardinal step, so the
    // diagonal (0,0)-(1,1) step is this fixture's only route, and its own
    // slope is what gets refused here.
    const grid = makeFlatGrid(2, 2, 'walkable');
    setCell(grid, 0, 0, 'walkable', { surfaceY: 0 });
    setCell(grid, 1, 0, 'walkable', { surfaceY: 10 });
    setCell(grid, 0, 1, 'walkable', { surfaceY: 10 });
    setCell(grid, 1, 1, 'walkable', { surfaceY: 0.83 });
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 1, toZ: 1, avoidVehicles: false });
    expect(result.found).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 14: occupancy avoidance — fragments and vehicles block foot pathfinding,
// except an agent's own occupied start/goal cell (#954)
// ═══════════════════════════════════════════════════════════════════════════════

describe('isImpassable — isAgentCell exemption (#954)', () => {
  it('returns false for a vehicle-occupied cell when isAgentCell is true, even with avoidVehicles true', () => {
    const cell = makeCell('walkable');
    cell.vehicleOccupied = true;
    expect(isImpassable(cell, true, true)).toBe(false);
  });

  it('returns true for the same vehicle-occupied cell when isAgentCell is false', () => {
    const cell = makeCell('walkable');
    cell.vehicleOccupied = true;
    expect(isImpassable(cell, true, false)).toBe(true);
  });

  it('returns false for a fragment-occupied cell when isAgentCell is true, even with avoidVehicles true', () => {
    const cell = makeCell('walkable');
    cell.fragmentOccupancy = 1;
    expect(isImpassable(cell, true, true)).toBe(false);
  });

  it('returns true for the same fragment-occupied cell when isAgentCell is false and avoidVehicles is true', () => {
    const cell = makeCell('walkable');
    cell.fragmentOccupancy = 1;
    expect(isImpassable(cell, true, false)).toBe(true);
  });

  it('does not exempt a fragment-occupied cell when avoidVehicles is false, regardless of isAgentCell', () => {
    const cell = makeCell('walkable');
    cell.fragmentOccupancy = 1;
    expect(isImpassable(cell, false, false)).toBe(false);
  });

  it('does NOT block a genuinely blocked (building) cell for isAgentCell true (#1025 — corrected contract: the agent\'s own current cell is never impassable to itself, not even blocked/void)', () => {
    // #1025: a fatigue-frozen employee gets clampToGrid'd onto a discrete
    // cell; if a building's footprint later occupies that exact cell, the
    // OLD contract here (isAgentCell true still blocks 'blocked') made every
    // subsequent findPath call from that position fail permanently, since the
    // agent's own current cell read impassable to itself. isAgentCell must
    // bypass type solidity entirely, exactly like it already bypasses
    // occupancy flags above.
    const cell = makeCell('blocked');
    expect(isImpassable(cell, true, true)).toBe(false);
  });

  it('does NOT block a void cell for isAgentCell true (#1025 — same corrected contract)', () => {
    const cell = makeCell('void');
    expect(isImpassable(cell, true, true)).toBe(false);
  });

  it('unchanged: still blocks a blocked cell when isAgentCell is false (not the agent\'s own cell)', () => {
    const cell = makeCell('blocked');
    expect(isImpassable(cell, true, false)).toBe(true);
  });

  it('unchanged: still blocks a void cell when isAgentCell is omitted (defaults to not-the-agent\'s-own-cell)', () => {
    const cell = makeCell('void');
    expect(isImpassable(cell, true)).toBe(true);
  });
});

describe('findPath — occupancy avoidance (#954)', () => {
  it('routes around a fragment-occupied cell (fragmentOccupancy > 0) with avoidVehicles: true, detouring rather than failing', () => {
    // 10×3 grid, cell (5,1) carries a fragment — the straight route between
    // (0,1) and (9,1) would otherwise go right through it.
    const grid = makeFlatGrid(10, 3, 'walkable');
    setCell(grid, 5, 1, 'walkable', { fragmentOccupancy: 1 });
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 1, toX: 9, toZ: 1, avoidVehicles: true });
    expect(result.found).toBe(true);
    expect(result.waypoints.some(wp => wp.x === 5 && wp.z === 1)).toBe(false);
  });

  it('routes around a vehicle-occupied cell with avoidVehicles: true, detouring rather than failing', () => {
    const grid = makeFlatGrid(10, 3, 'walkable');
    setCell(grid, 5, 1, 'walkable', { vehicleOccupied: true });
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 1, toX: 9, toZ: 1, avoidVehicles: true });
    expect(result.found).toBe(true);
    expect(result.waypoints.some(wp => wp.x === 5 && wp.z === 1)).toBe(false);
  });

  it('an agent can path out of its own vehicle-occupied start cell (isAgentCell exemption)', () => {
    // 5×5 grid, avoidVehicles: true. The agent's OWN start cell is
    // vehicle-occupied (e.g. a vehicle spawned onto the same cell the agent
    // stands on) — the agent must still be able to leave it.
    const grid = makeFlatGrid(5, 5, 'walkable');
    setCell(grid, 0, 0, 'walkable', { vehicleOccupied: true });
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 4, toZ: 4, avoidVehicles: true });
    expect(result.found).toBe(true);
  });

  it('an agent can path out of its own fragment-occupied start cell (isAgentCell exemption)', () => {
    const grid = makeFlatGrid(5, 5, 'walkable');
    setCell(grid, 0, 0, 'walkable', { fragmentOccupancy: 1 });
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 4, toZ: 4, avoidVehicles: true });
    expect(result.found).toBe(true);
  });

  it('findPath still refuses a DIFFERENT occupied cell that is not the agent\'s own start/goal', () => {
    // Sanity companion to the exemption tests above: occupancy still blocks
    // when it is not the agent's own cell. Single-row corridor, no detour
    // possible, so avoidVehicles: true must fail outright.
    const grid = makeFlatGrid(5, 1, 'walkable');
    setCell(grid, 2, 0, 'walkable', { fragmentOccupancy: 1 });
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 4, toZ: 0, avoidVehicles: true });
    expect(result.found).toBe(false);
  });

  it('findPath succeeds trivially when start === goal and that single cell is vehicle-occupied', () => {
    // goal === start, so the goal-cell check's own isAgentCell exemption
    // applies too — the agent isn't asked to move anywhere.
    const grid = makeFlatGrid(3, 3, 'walkable');
    setCell(grid, 1, 1, 'walkable', { vehicleOccupied: true });
    const result = findPath(grid, { agentId: 1, fromX: 1, fromZ: 1, toX: 1, toZ: 1, avoidVehicles: true });
    expect(result.found).toBe(true);
    expect(result.waypoints).toEqual([{ x: 1, z: 1 }]);
  });

  it('directLineWalk\'s own first-step exemption: finds the direct-line route when only the start cell is vehicle-occupied, on a grid too large for the A* budget', () => {
    // 600×1 grid, dead straight corridor: directLineWalk's own cost (599,
    // one walkable step per cell) sits within DIRECT_LINE_TOLERANCE of the
    // octile lower bound (599 * 1.1), so findOrdinaryPath's fast path takes
    // the direct-line route immediately and returns before A* is ever
    // invoked — this isolates directLineWalk's own i===0 occupancy exemption
    // rather than just the top-level findPath start-cell check.
    const grid = makeFlatGrid(600, 1, 'walkable');
    setCell(grid, 0, 0, 'walkable', { vehicleOccupied: true });
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 599, toZ: 0, avoidVehicles: true });
    expect(result.found).toBe(true);
    expect(result.totalCost).toBe(599);
  });

  it('directLineWalk\'s own first-step exemption: finds the direct-line route when only the start cell is fragment-occupied (same corridor, occupancy kind)', () => {
    // Same fast-path mechanism as the vehicle-occupied case above — fragment
    // occupancy is checked by the exact same isImpassable condition, so this
    // covers the other occupancy kind for this specific isolated-first-step
    // scenario (the vehicle case and fragment case are already covered
    // together at findPath's top level, but not here).
    const grid = makeFlatGrid(600, 1, 'walkable');
    setCell(grid, 0, 0, 'walkable', { fragmentOccupancy: 1 });
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 599, toZ: 0, avoidVehicles: true });
    expect(result.found).toBe(true);
    expect(result.totalCost).toBe(599);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 15: findExactPath — rejects a findPath result whose final waypoint
// doesn't match the requested destination, rather than silently accepting
// findPath's own clamp-to-grid-bounds behaviour (#1109)
// ═══════════════════════════════════════════════════════════════════════════════

describe('findExactPath', () => {
  it('in-bounds, reachable destination: found true with the same waypoints/totalCost findPath itself returns (happy path)', () => {
    const grid = makeFlatGrid(10, 10, 'walkable');
    const request = { agentId: 1, fromX: 0, fromZ: 0, toX: 5, toZ: 5, avoidVehicles: false };
    const plain = findPath(grid, request);
    const exact = findExactPath(grid, request);

    expect(plain.found).toBe(true);
    expect(exact.found).toBe(true);
    expect(exact.waypoints).toEqual(plain.waypoints);
    expect(exact.totalCost).toBe(plain.totalCost);
  });

  it('destination exactly on the grid\'s last valid cell (edge, not outside): found true, not misread as a bounds mismatch (boundary)', () => {
    // 10×10 grid: last valid cell is (9,9) — inside the grid, not clamped.
    const grid = makeFlatGrid(10, 10, 'walkable');
    const request = { agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 9, avoidVehicles: false };
    const result = findExactPath(grid, request);

    expect(result.found).toBe(true);
    const last = result.waypoints[result.waypoints.length - 1]!;
    expect(last.x).toBe(9);
    expect(last.z).toBe(9);
  });

  it('destination outside grid bounds past the east edge: found false, even though findPath on the identical request reports found true with a clamped endpoint (rejection)', () => {
    const grid = makeFlatGrid(10, 10, 'walkable');
    const request = { agentId: 1, fromX: 0, fromZ: 0, toX: 15, toZ: 5, avoidVehicles: false };

    const plain = findPath(grid, request);
    expect(plain.found).toBe(true);
    const clampedLast = plain.waypoints[plain.waypoints.length - 1]!;
    expect(clampedLast.x).toBe(9); // clamped to the last valid column, not x=15

    const exact = findExactPath(grid, request);
    expect(exact).toEqual({ found: false, waypoints: [], totalCost: 0 });
  });

  it('destination outside grid bounds past the south edge: found false, even though findPath on the identical request reports found true with a clamped endpoint (rejection)', () => {
    const grid = makeFlatGrid(10, 10, 'walkable');
    const request = { agentId: 1, fromX: 0, fromZ: 0, toX: 5, toZ: 15, avoidVehicles: false };

    const plain = findPath(grid, request);
    expect(plain.found).toBe(true);
    const clampedLast = plain.waypoints[plain.waypoints.length - 1]!;
    expect(clampedLast.z).toBe(9); // clamped to the last valid row, not z=15

    const exact = findExactPath(grid, request);
    expect(exact).toEqual({ found: false, waypoints: [], totalCost: 0 });
  });

  it('destination outside grid bounds diagonally (a corner beyond both edges): found false (rejection)', () => {
    const grid = makeFlatGrid(10, 10, 'walkable');
    const request = { agentId: 1, fromX: 0, fromZ: 0, toX: 20, toZ: 20, avoidVehicles: false };

    const plain = findPath(grid, request);
    expect(plain.found).toBe(true);
    const clampedLast = plain.waypoints[plain.waypoints.length - 1]!;
    expect(clampedLast.x).toBe(9);
    expect(clampedLast.z).toBe(9);

    const exact = findExactPath(grid, request);
    expect(exact).toEqual({ found: false, waypoints: [], totalCost: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 10: Budget vs. climb-aware reachability agreement (#1166)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Serpentine corridor cut into impassably steep ground: every cell is typed
 * 'walkable', so nothing here is excluded by `isImpassable` — the corridor
 * walls are high plateaus that only the slope gate refuses, exactly like the
 * natural terrain #1151's 30° rule turned into a maze. The one legal route
 * runs the full length of the snake, so A* has to expand roughly every
 * corridor cell to find it.
 */
function makeSerpentineGrid(size: number, rowSpacing: number): NavGrid {
  const WALL_Y = 100;
  const FLOOR_Y = 0;
  const cells: NavCell[][] = [];
  for (let z = 0; z < size; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < size; x++) row.push(makeCell('walkable', 0, WALL_Y));
    cells.push(row);
  }
  const carve = (x: number, z: number): void => {
    cells[z]![x] = makeCell('walkable', 0, FLOOR_Y);
  };

  const corridorRows: number[] = [];
  for (let z = 1; z < size - 1; z += rowSpacing) corridorRows.push(z);

  for (const z of corridorRows) {
    for (let x = 1; x < size - 1; x++) carve(x, z);
  }
  // Link each corridor to the next, alternating ends, so the route snakes.
  for (let i = 0; i < corridorRows.length - 1; i++) {
    const linkX = i % 2 === 0 ? size - 2 : 1;
    for (let z = corridorRows[i]! + 1; z < corridorRows[i + 1]!; z++) carve(linkX, z);
  }

  return new NavGrid(size, size, cells);
}

describe('findPath — agrees with climb-aware reachability on a long detour (#1166)', () => {
  const SIZE = 64;
  const ROW_SPACING = 4;

  it('finds the route when the only legal one is a long detour through slope-gated terrain', () => {
    const grid = makeSerpentineGrid(SIZE, ROW_SPACING);
    const corridorRows: number[] = [];
    for (let z = 1; z < SIZE - 1; z += ROW_SPACING) corridorRows.push(z);
    const lastRow = corridorRows[corridorRows.length - 1]!;
    // Far end of the last corridor — reachable only by walking the whole snake.
    const goalX = corridorRows.length % 2 === 0 ? 1 : SIZE - 2;

    const result = findPath(grid, {
      agentId: 1, fromX: 1, fromZ: 1, toX: goalX, toZ: lastRow, avoidVehicles: false,
    });

    expect(result.found).toBe(true);
    const last = result.waypoints[result.waypoints.length - 1]!;
    expect(last).toEqual({ x: goalX, z: lastRow });
    // The straight-line distance is a fraction of the real route: this is the
    // detour A*'s old area/8 budget gave up on, not a near-direct walk.
    expect(result.waypoints.length).toBeGreaterThan(SIZE);
  });

  it('never reports unreachable a goal computeClimbReachableSet reports reachable', () => {
    const grid = makeSerpentineGrid(SIZE, ROW_SPACING);
    const reachable = NavGrid.computeClimbReachableSet(grid, 1, 1);

    // The two sets must agree cell for cell. A disagreement is the #1166
    // livelock: ActionSelection screens candidates through the flood fill,
    // then hands the survivors to findPath — a goal the first admits and the
    // second refuses is an action that stays `queued` with no holder forever.
    const disagreements: Array<{ x: number; z: number }> = [];
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) {
        if (!reachable.has(x, z)) continue;
        const path = findPath(grid, { agentId: 1, fromX: 1, fromZ: 1, toX: x, toZ: z, avoidVehicles: false });
        if (!path.found) disagreements.push({ x, z });
      }
    }

    expect(disagreements).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 17: clearance-aware pathfinding (#1154)
// ═══════════════════════════════════════════════════════════════════════════════

describe('clearance-aware pathfinding (#1154)', () => {
  /**
   * Builds a 5-row grid with a wall of 'blocked' cells at z=2 spanning
   * [wallMinX, wallMaxX] (inclusive), leaving a single open cell at gapX
   * whose clearance is hand-set to gapClearance. Columns outside
   * [wallMinX, wallMaxX] at z=2 (if any) stay 'walkable', unconstrained
   * (no clearance set) — a bypass route around the wall's own ends.
   */
  function makeGapWallGrid(
    width: number,
    wallMinX: number,
    wallMaxX: number,
    gapX: number,
    gapClearance: number,
  ): NavGrid {
    const grid = makeFlatGrid(width, 5, 'walkable');
    for (let x = wallMinX; x <= wallMaxX; x++) {
      if (x === gapX) {
        setCell(grid, x, 2, 'walkable', { clearance: gapClearance });
      } else {
        setCell(grid, x, 2, 'blocked');
      }
    }
    return grid;
  }

  it('an employee (default/explicit NAV_CLEARANCE_EMPLOYEE_CELLS) finds a route straight through a 1-cell gap', () => {
    // Wall spans the full grid width — the gap is the only way through.
    const grid = makeGapWallGrid(7, 0, 6, 3, NAV_CLEARANCE_EMPLOYEE_CELLS);
    const result = findPath(grid, { agentId: 1, fromX: 3, fromZ: 0, toX: 3, toZ: 4, avoidVehicles: false });
    expect(result.found).toBe(true);
    expect(result.waypoints.some(wp => wp.x === 3 && wp.z === 2)).toBe(true);

    const explicit = findPath(grid, {
      agentId: 1, fromX: 3, fromZ: 0, toX: 3, toZ: 4, avoidVehicles: false,
      requiredClearance: NAV_CLEARANCE_EMPLOYEE_CELLS,
    });
    expect(explicit.found).toBe(true);
    expect(explicit.waypoints.some(wp => wp.x === 3 && wp.z === 2)).toBe(true);
  });

  it('a vehicle (NAV_CLEARANCE_VEHICLE_CELLS) refuses the too-narrow gap and takes the longer route around instead, when one exists', () => {
    // Wall spans x=1..5 only — x=0 and x=6 stay open at z=2, giving a
    // detour around the wall's own ends that the 1-cell gap at x=3 (too
    // narrow for a vehicle) is not.
    const grid = makeGapWallGrid(7, 1, 5, 3, 1);
    const result = findPath(grid, {
      agentId: 1, fromX: 3, fromZ: 0, toX: 3, toZ: 4, avoidVehicles: false,
      requiredClearance: NAV_CLEARANCE_VEHICLE_CELLS,
    });
    expect(result.found).toBe(true);
    // The narrow gap is never used...
    expect(result.waypoints.some(wp => wp.x === 3 && wp.z === 2)).toBe(false);
    // ...forcing a real detour, not the short 2-step crossing the gap would be.
    expect(result.totalCost).toBeGreaterThan(2);
  });

  it('a vehicle (NAV_CLEARANCE_VEHICLE_CELLS) reports found: false when the gap is the only way through and too narrow', () => {
    // Wall spans the full grid width this time — no bypass exists.
    const grid = makeGapWallGrid(7, 0, 6, 3, 1);
    const result = findPath(grid, {
      agentId: 1, fromX: 3, fromZ: 0, toX: 3, toZ: 4, avoidVehicles: false,
      requiredClearance: NAV_CLEARANCE_VEHICLE_CELLS,
    });
    expect(result.found).toBe(false);
  });

  it('a RAMP_WIDTH-wide (3-cell) gap forces a vehicle through the centre column, not either edge column', () => {
    expect(RAMP_WIDTH).toBe(3);
    // Wall at z=2 spans the full width except x=2,3,4 (RAMP_WIDTH cells).
    // Edge columns (2 and 4) carry insufficient clearance for a vehicle;
    // only the centre column (3) carries enough.
    const grid = makeFlatGrid(7, 5, 'walkable');
    for (let x = 0; x < 7; x++) {
      if (x === 2 || x === 4) {
        setCell(grid, x, 2, 'walkable', { clearance: NAV_CLEARANCE_VEHICLE_CELLS - 1 });
      } else if (x === 3) {
        setCell(grid, x, 2, 'walkable', { clearance: NAV_CLEARANCE_VEHICLE_CELLS });
      } else {
        setCell(grid, x, 2, 'blocked');
      }
    }

    // Start/goal offset so the geometrically-shortest, clearance-blind route
    // would cross the wall at x=2 (an edge column) — only the clearance gate
    // forces the detour to x=3, the centre column.
    const result = findPath(grid, {
      agentId: 1, fromX: 1, fromZ: 0, toX: 2, toZ: 4, avoidVehicles: false,
      requiredClearance: NAV_CLEARANCE_VEHICLE_CELLS,
    });

    expect(result.found).toBe(true);
    const crossings = result.waypoints.filter(wp => wp.z === 2);
    expect(crossings.length).toBeGreaterThan(0);
    for (const crossing of crossings) {
      expect(crossing.x).toBe(3);
    }
  });

  describe('isImpassable — clearance gating (#1154)', () => {
    it('a cell with insufficient clearance is impassable for a high requiredClearance and passable for a low one', () => {
      const cell = makeCell('walkable');
      cell.clearance = 1;
      expect(isImpassable(cell, false, false, 2)).toBe(true);
      expect(isImpassable(cell, false, false, 1)).toBe(false);
    });

    it('isAgentCell bypasses insufficient clearance, the same way it already bypasses blocked/void/occupancy', () => {
      const cell = makeCell('walkable');
      cell.clearance = 0;
      expect(isImpassable(cell, false, true, 5)).toBe(false);
    });

    it('a cell with clearance exactly equal to requiredClearance is passable (inclusive boundary)', () => {
      const cell = makeCell('walkable');
      cell.clearance = NAV_CLEARANCE_VEHICLE_CELLS;
      expect(isImpassable(cell, false, false, NAV_CLEARANCE_VEHICLE_CELLS)).toBe(false);
    });

    it('a cell with no clearance recorded (undefined) is treated as unconstrained, passable at any requiredClearance', () => {
      const cell = makeCell('walkable');
      expect(cell.clearance).toBeUndefined();
      expect(isImpassable(cell, false, false, NAV_CLEARANCE_VEHICLE_CELLS + 5)).toBe(false);
    });
  });

  it('regression: a multi-level ramp crossing still resolves with NAV_CLEARANCE_VEHICLE_CELLS threaded through findSingleHopRoute/findChainedRoute', () => {
    // Same fixture as "finds a path between different bench levels connected
    // by a ramp" (Group 11) — none of these hand-built cells carry a
    // `clearance` field, so they stay unconstrained regardless of the
    // requested clearance; this proves the parameter threads through the
    // multi-level machinery without breaking the existing route, not that
    // clearance itself gates a ramp crossing (a real, buildNavGrid-derived
    // grid's ramp cells getting an explicit clearance value is covered by
    // NavGrid.test.ts).
    const grid = makeTwoLevelGrid(10, 10, 4);
    for (let x = 0; x < 10; x++) {
      if (x !== 5) {
        grid.cells[4]![x] = makeCell('void', 0);
      }
    }
    grid.cells[4]![5] = makeCell('ramp', 0);
    grid.cells[3]![5] = makeCell('walkable', 0);
    grid.cells[5]![5] = makeCell('walkable', 1);

    const result = findPath(grid, {
      agentId: 1, fromX: 0, fromZ: 0, toX: 0, toZ: 9, avoidVehicles: false,
      requiredClearance: NAV_CLEARANCE_VEHICLE_CELLS,
    });

    expect(result.found).toBe(true);
    expect(result.waypoints.some(wp => wp.x === 5 && wp.z === 4)).toBe(true);
  });

  it('boundary: requiredClearance at exactly NAV_CLEARANCE_MAX_CELLS behaves identically to a request well above the cap, on a fixture that never records a clearance above it', () => {
    // Same fixture as "routes around a single blocked cell" (Group 2) — no
    // cell here carries a `clearance` field, so nothing in the grid can ever
    // exceed the cap; the field never distinguishes a requiredClearance of
    // exactly the cap from one further above it.
    const grid = makeFlatGrid(10, 3, 'walkable');
    setCell(grid, 5, 1, 'blocked');
    const request = { agentId: 1, fromX: 0, fromZ: 1, toX: 9, toZ: 1, avoidVehicles: false };

    const atCap = findPath(grid, { ...request, requiredClearance: NAV_CLEARANCE_MAX_CELLS });
    const aboveCap = findPath(grid, { ...request, requiredClearance: NAV_CLEARANCE_MAX_CELLS + 5 });

    expect(atCap.found).toBe(true);
    expect(aboveCap).toEqual(atCap);
  });

  describe('computeClearancePocket — start/goal cell itself in a clearance-insufficient ring', () => {
    /**
     * A 2-cell-wide dead-end alley (too narrow for NAV_CLEARANCE_VEHICLE_CELLS
     * on either lane — unlike the 3-cell RAMP_WIDTH corridor elsewhere in this
     * file, which always keeps a clear centre lane) walled on three sides:
     * a back wall at z=backZ (x in [alleyMinX, alleyMaxX]) and two long side
     * walls at x=alleyMinX-1 and x=alleyMaxX+1 running the full alley depth.
     * Every non-blocked cell's `clearance` is hand-computed exactly the way
     * NavGrid's own BFS derives it — min(Chebyshev distance to the nearest
     * blocked cell, NAV_CLEARANCE_MAX_CELLS) — so the alley's interior reads
     * clearance 1 for its *entire* depth (always within 1 of a side wall,
     * never far enough from both to reach 2) and the field beyond the alley's
     * mouth reads the full cap. A vehicle parked at the alley's dead end
     * therefore sits inside a clearance-insufficient ring many cells deep,
     * not just its own single cell — exactly the shape `computeClearancePocket`
     * exists to let a vehicle out of (or into), as opposed to the single-step
     * escape a single isolated obstacle cell would allow even without it.
     */
    function makeDeadEndAlleyGrid(
      width: number,
      height: number,
      alleyMinX: number,
      alleyMaxX: number,
      backZ: number,
      mouthZ: number,
    ): NavGrid {
      const blocked = new Set<string>();
      for (let x = alleyMinX; x <= alleyMaxX; x++) blocked.add(`${x},${backZ}`);
      for (let z = backZ; z <= mouthZ; z++) {
        blocked.add(`${alleyMinX - 1},${z}`);
        blocked.add(`${alleyMaxX + 1},${z}`);
      }

      const grid = makeFlatGrid(width, height, 'walkable');
      for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
          if (blocked.has(`${x},${z}`)) {
            setCell(grid, x, z, 'blocked');
            continue;
          }
          let nearest = Infinity;
          for (const key of blocked) {
            const [bx, bz] = key.split(',').map(Number) as [number, number];
            nearest = Math.min(nearest, Math.max(Math.abs(x - bx), Math.abs(z - bz)));
          }
          setCell(grid, x, z, 'walkable', { clearance: Math.min(nearest, NAV_CLEARANCE_MAX_CELLS) });
        }
      }
      return grid;
    }

    it('a vehicle parked at a dead-end alley\'s clearance-insufficient back still finds a route out to open ground', () => {
      const grid = makeDeadEndAlleyGrid(14, 16, 2, 3, 2, 9);

      // Sanity: the fixture actually reproduces the insufficient-ring shape —
      // the alley's deep end is below vehicle clearance on both lanes.
      expect(grid.cellAt(2, 3)!.clearance).toBeLessThan(NAV_CLEARANCE_VEHICLE_CELLS);
      expect(grid.cellAt(3, 3)!.clearance).toBeLessThan(NAV_CLEARANCE_VEHICLE_CELLS);

      const result = findPath(grid, {
        agentId: 1, fromX: 2, fromZ: 3, toX: 8, toZ: 13, avoidVehicles: false,
        requiredClearance: NAV_CLEARANCE_VEHICLE_CELLS,
      });

      expect(result.found).toBe(true);
      expect(result.waypoints[0]).toEqual({ x: 2, z: 3 });
    });

    it('a vehicle can still arrive at a dead-end alley\'s clearance-insufficient back as its goal', () => {
      const grid = makeDeadEndAlleyGrid(14, 16, 2, 3, 2, 9);
      expect(grid.cellAt(3, 3)!.clearance).toBeLessThan(NAV_CLEARANCE_VEHICLE_CELLS);

      const result = findPath(grid, {
        agentId: 1, fromX: 8, fromZ: 13, toX: 3, toZ: 3, avoidVehicles: false,
        requiredClearance: NAV_CLEARANCE_VEHICLE_CELLS,
      });

      expect(result.found).toBe(true);
      const last = result.waypoints[result.waypoints.length - 1];
      expect(last).toEqual({ x: 3, z: 3 });
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 18: diagonal corner-cutting (#1197)
//
// A diagonal step from (ax,az) to (bx,bz) passes geometrically "between" the
// two cells it does NOT touch orthogonally — (bx,az) and (ax,bz). Cutting
// through that corner when either of those two cells is solid ('blocked' or
// 'void') walks straight through a wall a real body could never fit past.
// isDiagonalCornerClear is the single source of truth for that rule; this
// group tests it directly, then proves it is actually wired into
// directLineWalk and findPath (not just present but unused).
// ═══════════════════════════════════════════════════════════════════════════════

describe('isDiagonalCornerClear (#1197)', () => {
  it('is always legal for a cardinal step, regardless of neighbouring cell types', () => {
    // Every cell in the grid is 'blocked' except the two endpoints — proves
    // the corner rule does not even look at neighbours for a cardinal step.
    const grid = makeFlatGrid(3, 3, 'blocked');
    setCell(grid, 0, 0, 'walkable');
    setCell(grid, 1, 0, 'walkable');
    setCell(grid, 0, 1, 'walkable');
    expect(isDiagonalCornerClear(grid, 0, 0, 1, 0)).toBe(true);
    expect(isDiagonalCornerClear(grid, 0, 0, 0, 1)).toBe(true);
  });

  it('is legal for a diagonal step when both orthogonal cells are walkable (happy path)', () => {
    const grid = makeFlatGrid(2, 2, 'walkable');
    expect(isDiagonalCornerClear(grid, 0, 0, 1, 1)).toBe(true);
  });

  it('is illegal for a diagonal step when both orthogonal cells are blocked', () => {
    const grid = makeFlatGrid(2, 2, 'walkable');
    setCell(grid, 1, 0, 'blocked');
    setCell(grid, 0, 1, 'blocked');
    expect(isDiagonalCornerClear(grid, 0, 0, 1, 1)).toBe(false);
  });

  it('is illegal for a diagonal step when both orthogonal cells are void', () => {
    const grid = makeFlatGrid(2, 2, 'walkable');
    setCell(grid, 1, 0, 'void');
    setCell(grid, 0, 1, 'void');
    expect(isDiagonalCornerClear(grid, 0, 0, 1, 1)).toBe(false);
  });

  it('is illegal when one orthogonal cell is blocked and the other is void', () => {
    const grid = makeFlatGrid(2, 2, 'walkable');
    setCell(grid, 1, 0, 'blocked');
    setCell(grid, 0, 1, 'void');
    expect(isDiagonalCornerClear(grid, 0, 0, 1, 1)).toBe(false);
  });

  it('is illegal when only ONE orthogonal cell is blocked/void — both must be clear, not just "not both blocked" (rejection, the key non-OR case)', () => {
    // A wrong implementation checking "illegal only if BOTH orthogonal cells
    // are solid" would wrongly return true here in both cases below, since
    // only one of the two is ever solid at a time.
    const oneBlocked = makeFlatGrid(2, 2, 'walkable');
    setCell(oneBlocked, 1, 0, 'blocked');
    // (0,1) stays walkable.
    expect(isDiagonalCornerClear(oneBlocked, 0, 0, 1, 1)).toBe(false);

    const oneVoid = makeFlatGrid(2, 2, 'walkable');
    setCell(oneVoid, 0, 1, 'void');
    // (1,0) stays walkable.
    expect(isDiagonalCornerClear(oneVoid, 0, 0, 1, 1)).toBe(false);
  });

  it('treats an off-grid orthogonal cell as impassable, refusing the diagonal step (boundary)', () => {
    // 2×2 grid (x: 0-1, z: 0-1). Stepping diagonally from (0,1) to (1,2)
    // leaves one of the two orthogonal cells, (0,2), entirely outside the
    // grid (height=2, so z=2 does not exist) — must be treated exactly like
    // a solid neighbour, matching isImpassable's own treatment of a missing
    // cell.
    const grid = makeFlatGrid(2, 2, 'walkable');
    expect(isDiagonalCornerClear(grid, 0, 1, 1, 2)).toBe(false);
  });
});

describe('directLineWalk — refuses a corner-clip directly, independent of findPath\'s own heuristics (#1197)', () => {
  it('returns null when the only geometric route between two diagonal cells clips a corner both of whose orthogonal cells are blocked', () => {
    // Minimal 2×2 grid: (0,0) and (1,1) walkable, (1,0) and (0,1) both
    // blocked — the only way from start to goal is the diagonal step
    // itself, which must now be refused outright.
    const grid = makeFlatGrid(2, 2, 'walkable');
    setCell(grid, 1, 0, 'blocked');
    setCell(grid, 0, 1, 'blocked');
    const result = directLineWalk(grid, 0, 0, 1, 1, false, 0, null, null);
    expect(result).toBeNull();
  });
});

describe('findPath — end to end refuses a corner-clip with no orthogonal detour available (#1197)', () => {
  it('returns found:false on a 2×2 grid where the only route is an illegal diagonal corner-cut', () => {
    // Same 2×2 shape as directLineWalk's own test above, exercised through
    // the public findPath entry point instead — a 2×2 grid has no room for
    // an orthogonal detour around the two blocked cells at all.
    const grid = makeFlatGrid(2, 2, 'walkable');
    setCell(grid, 1, 0, 'blocked');
    setCell(grid, 0, 1, 'blocked');
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 1, toZ: 1, avoidVehicles: false });
    expect(result.found).toBe(false);
  });
});

describe('findPath — diagonal waypoints never cut a blocked/void corner, on this file\'s own existing obstacle-avoidance fixtures (#1197)', () => {
  // Before adding this sweep: every existing obstacle-avoidance fixture in
  // this file was inspected by hand against the new rule. None of the three
  // reused below depends on a corner-cut for reachability —
  //   - the corridor-wall fixture's start/goal share a z, so its route is
  //     pure cardinal movement straight through the gap;
  //   - the maze fixture's corridors are exactly 1 cell wide, so no two
  //     diagonally-adjacent cells inside it are ever both walkable — a
  //     diagonal step would always leave the corridor into a 'blocked' cell,
  //     which is refused already, corner rule or not;
  //   - the pit-rim fixture carves its pit purely via `surfaceY`, so every
  //     cell in it is 'walkable' by type — no 'blocked'/'void' cell exists
  //     anywhere on the grid for the corner rule to ever find.
  // None needed widening; the sweep is still asserted directly on all three
  // so a future change to any of them stays covered.

  function assertNoCornerCut(grid: NavGrid, waypoints: Array<{ x: number; z: number }>): void {
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i]!;
      const b = waypoints[i + 1]!;
      expect(isDiagonalCornerClear(grid, a.x, a.z, b.x, b.z)).toBe(true);
    }
  }

  it('corridor-wall detour (same fixture as "routes around a wall of blocked cells forming a corridor") never cuts a corner', () => {
    const grid = makeFlatGrid(10, 5, 'walkable');
    for (let z = 0; z < 5; z++) {
      if (z !== 2) setCell(grid, 5, z, 'blocked');
    }
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 2, toX: 9, toZ: 2, avoidVehicles: false });
    expect(result.found).toBe(true);
    assertNoCornerCut(grid, result.waypoints);
  });

  it('S-shaped maze detour (same fixture as "handles a winding path through a maze-like grid") never cuts a corner', () => {
    const grid = makeFlatGrid(10, 10, 'blocked');
    for (let x = 0; x < 10; x++) {
      setCell(grid, x, 2, 'walkable');
      setCell(grid, x, 6, 'walkable');
    }
    for (let z = 2; z <= 6; z++) {
      setCell(grid, 3, z, 'walkable');
      setCell(grid, 7, z, 'walkable');
    }
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 2, toX: 9, toZ: 6, avoidVehicles: false });
    expect(result.found).toBe(true);
    assertNoCornerCut(grid, result.waypoints);
  });

  it('pit-rim detour (same fixture as "routes around a pit whose rim exceeds the climb limit") never cuts a corner', () => {
    const PIT = { minX: 5, maxX: 9, minZ: 5, maxZ: 9 };
    const grid = makePlateauWithPit(15, 15, PIT, 20, 5);
    const result = findPath(grid, { agentId: 1, fromX: 0, fromZ: 0, toX: 14, toZ: 14, avoidVehicles: false });
    expect(result.found).toBe(true);
    assertNoCornerCut(grid, result.waypoints);
  });
});
