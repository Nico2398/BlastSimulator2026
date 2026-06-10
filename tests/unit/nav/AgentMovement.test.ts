// BlastSimulator2026 — Unit tests: Agent per-tick path advancement
// Task 6.7: advanceAgent() movement along waypoint path
//
// Test breakdown:
//   Group 1 — Basic single-waypoint advancement (reach target, partial move)
//   Group 2 — Fractional walkSpeed (< 1)
//   Group 3 — Multiple waypoints consumed in one tick
//   Group 4 — Path completion
//   Group 5 — Diagonal movement
//   Group 6 — Edge cases (empty, past length, zero/negative speed)
//   Group 7 — Immutability (original AgentState not mutated)

import { describe, it, expect } from 'vitest';
import { advanceAgent, isPathBlocked, doesPathCrossRegion, requestReRoute } from '../../../src/core/nav/AgentMovement.js';
import type { AdvanceResult, AgentState, StaleCheckResult } from '../../../src/core/nav/AgentMovement.js';
import { AGENT_WALK_SPEED } from '../../../src/core/config/balance.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import type { NavCell } from '../../../src/core/nav/NavGrid.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Helper
// ═══════════════════════════════════════════════════════════════════════════════

function makeState(overrides?: Partial<AgentState>): AgentState {
  return {
    x: 0,
    z: 0,
    waypoints: [],
    waypointIndex: 0,
    walkSpeed: AGENT_WALK_SPEED,
    destinationX: 0,
    destinationZ: 0,
    ...overrides,
  };
}

/**
 * Create a small NavGrid with known cell types for deterministic tests.
 * Default is a 5×5 all-walkable grid unless overridden.
 */
function makeNavGrid(cells?: NavCell[][]): NavGrid {
  if (cells) return new NavGrid(cells[0]!.length, cells.length, cells);
  // Default: 5×5 walkable grid
  const defaultCells: NavCell[][] = [];
  for (let z = 0; z < 5; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < 5; x++) {
      row.push({ type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false });
    }
    defaultCells.push(row);
  }
  return new NavGrid(5, 5, defaultCells);
}

/**
 * Assert that an AdvanceResult matches expected values.
 * Uses toBeCloseTo for coordinates to handle floating-point comparisons.
 */
function expectResult(
  result: AdvanceResult,
  expected: { x?: number; z?: number; waypointIndex?: number; isPathComplete?: boolean },
): void {
  if (expected.x !== undefined) expect(result.x).toBeCloseTo(expected.x, 6);
  if (expected.z !== undefined) expect(result.z).toBeCloseTo(expected.z, 6);
  if (expected.waypointIndex !== undefined) expect(result.waypointIndex).toBe(expected.waypointIndex);
  if (expected.isPathComplete !== undefined) expect(result.isPathComplete).toBe(expected.isPathComplete);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Group 1: Basic single-waypoint advancement
// ═══════════════════════════════════════════════════════════════════════════════

describe('advanceAgent — single waypoint', () => {
  it('reaches the target when walkSpeed >= distance', () => {
    const state = makeState({ x: 0, z: 0, waypoints: [{ x: 2, z: 0 }], waypointIndex: 0, walkSpeed: 2 });
    const result = advanceAgent(state);
    expectResult(result, { x: 2, z: 0, waypointIndex: 1, isPathComplete: true });
  });

  it('moves partially toward target when walkSpeed < distance', () => {
    const state = makeState({ x: 0, z: 0, waypoints: [{ x: 3, z: 0 }], waypointIndex: 0, walkSpeed: 1 });
    const result = advanceAgent(state);
    expectResult(result, { x: 1, z: 0, waypointIndex: 0, isPathComplete: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 2: Fractional walkSpeed (< 1)
// ═══════════════════════════════════════════════════════════════════════════════

describe('advanceAgent — fractional walkSpeed', () => {
  it('moves fractionally toward target with walkSpeed 0.5', () => {
    const state = makeState({ x: 0, z: 0, waypoints: [{ x: 2, z: 0 }], waypointIndex: 0, walkSpeed: 0.5 });
    const result = advanceAgent(state);
    // Moves 0.5 units toward (2,0) from (0,0)
    expectResult(result, { x: 0.5, z: 0, waypointIndex: 0, isPathComplete: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 3: Multiple waypoints consumed in one tick
// ═══════════════════════════════════════════════════════════════════════════════

describe('advanceAgent — multiple waypoints consumed in one tick', () => {
  it('consumes waypoints until walkSpeed runs out, ending mid-path', () => {
    // walkSpeed=3 on a path of 4 waypoints spaced 1 unit apart
    // Should consume first 3 waypoints and stop at (3,0), index=3
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 1, z: 0 }, { x: 2, z: 0 }, { x: 3, z: 0 }, { x: 4, z: 0 }],
      waypointIndex: 0,
      walkSpeed: 3,
    });
    const result = advanceAgent(state);
    // Still one waypoint remaining (at index 3, there are 4 waypoints total)
    expectResult(result, { x: 3, z: 0, waypointIndex: 3, isPathComplete: false });
  });

  it('consumes all waypoints when walkSpeed is sufficient for the entire path', () => {
    // walkSpeed=4 on a path of 4 waypoints spaced 1 unit apart
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 1, z: 0 }, { x: 2, z: 0 }, { x: 3, z: 0 }, { x: 4, z: 0 }],
      waypointIndex: 0,
      walkSpeed: 4,
    });
    const result = advanceAgent(state);
    expectResult(result, { x: 4, z: 0, waypointIndex: 4, isPathComplete: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 4: Path completion
// ═══════════════════════════════════════════════════════════════════════════════

describe('advanceAgent — path completion', () => {
  it('completes a multi-waypoint path exactly when walkSpeed matches total distance', () => {
    // Two waypoints, each 1 unit apart, total distance = 2, walkSpeed = 2
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 1, z: 0 }, { x: 2, z: 0 }],
      waypointIndex: 0,
      walkSpeed: 2,
    });
    const result = advanceAgent(state);
    expectResult(result, { x: 2, z: 0, waypointIndex: 2, isPathComplete: true });
  });

  it('completes immediately when already at the final waypoint', () => {
    // Agent is already at the target waypoint
    const state = makeState({
      x: 2, z: 0,
      waypoints: [{ x: 2, z: 0 }],
      waypointIndex: 0,
      walkSpeed: 1,
    });
    const result = advanceAgent(state);
    expectResult(result, { x: 2, z: 0, waypointIndex: 1, isPathComplete: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 5: Diagonal movement
// ═══════════════════════════════════════════════════════════════════════════════

describe('advanceAgent — diagonal movement', () => {
  it('reaches a diagonal waypoint when walkSpeed >= distance', () => {
    // Distance from (0,0) to (2,2) = sqrt(8) ≈ 2.828
    // walkSpeed=3 >= 2.828 → reaches the target
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 2, z: 2 }],
      waypointIndex: 0,
      walkSpeed: 3,
    });
    const result = advanceAgent(state);
    expectResult(result, { x: 2, z: 2, waypointIndex: 1, isPathComplete: true });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 6: Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('advanceAgent — edge cases', () => {
  it('returns isPathComplete=true when waypoints array is empty', () => {
    const state = makeState({ x: 5, z: 3, waypoints: [], waypointIndex: 0, walkSpeed: 2 });
    const result = advanceAgent(state);
    expectResult(result, { x: 5, z: 3, waypointIndex: 0, isPathComplete: true });
  });

  it('returns isPathComplete=true when waypointIndex is past the array length', () => {
    const state = makeState({
      x: 5, z: 3,
      waypoints: [{ x: 1, z: 0 }, { x: 2, z: 0 }],
      waypointIndex: 5,
      walkSpeed: 2,
    });
    const result = advanceAgent(state);
    expectResult(result, { x: 5, z: 3, waypointIndex: 5, isPathComplete: true });
  });

  it('does not move and isPathComplete is false when walkSpeed is 0 and waypoints exist', () => {
    // walkSpeed=0 means no movement budget; waypoints remain unconsumed
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 1, z: 0 }],
      waypointIndex: 0,
      walkSpeed: 0,
    });
    const result = advanceAgent(state);
    // isPathComplete should be false because we haven't reached the end
    expectResult(result, { x: 0, z: 0, waypointIndex: 0, isPathComplete: false });
  });

  it('treats negative walkSpeed as 0 (no movement, no progress)', () => {
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 1, z: 0 }],
      waypointIndex: 0,
      walkSpeed: -5,
    });
    const result = advanceAgent(state);
    expectResult(result, { x: 0, z: 0, waypointIndex: 0, isPathComplete: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 7: Immutability
// ═══════════════════════════════════════════════════════════════════════════════

describe('advanceAgent — immutability', () => {
  it('does not mutate the original AgentState object', () => {
    const original: AgentState = {
      x: 0,
      z: 0,
      waypoints: [{ x: 3, z: 0 }, { x: 6, z: 0 }],
      waypointIndex: 0,
      walkSpeed: 2,
    };
    // Snapshot original values
    const origX = original.x;
    const origZ = original.z;
    const origIndex = original.waypointIndex;
    const origWaypointsLength = original.waypoints.length;
    const origWaypoints = [...original.waypoints];

    const result = advanceAgent(original);

    // Verify original state fields are unchanged
    expect(original.x).toBe(origX);
    expect(original.z).toBe(origZ);
    expect(original.waypointIndex).toBe(origIndex);
    expect(original.waypoints.length).toBe(origWaypointsLength);
    expect(original.waypoints[0]!.x).toBe(origWaypoints[0]!.x);
    expect(original.waypoints[0]!.z).toBe(origWaypoints[0]!.z);
    expect(original.waypoints[1]!.x).toBe(origWaypoints[1]!.x);
    expect(original.waypoints[1]!.z).toBe(origWaypoints[1]!.z);

    // Returned object should be a different reference
    expect(result).not.toBe(original);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 8: isPathBlocked — stale-path detection via blocked waypoints
// ═══════════════════════════════════════════════════════════════════════════════

describe('isPathBlocked — blocked waypoint detection', () => {
  it('returns true when the next remaining waypoint is blocked', () => {
    const grid = makeNavGrid([
      [{ type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false }, { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false }],
      [{ type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false }, { type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false }],
    ]);
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 1, z: 0 }],
      waypointIndex: 0,
      walkSpeed: 1,
      destinationX: 1, destinationZ: 0,
    });
    expect(isPathBlocked(state, grid, false)).toBe(true);
  });

  it('returns true when a later remaining waypoint is blocked (not just the next one)', () => {
    // Create a 3×1 grid: row 0 = [walkable, walkable, blocked]
    const cells: NavCell[][] = [
      [
        { type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false },
        { type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false },
        { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false },
      ],
    ];
    const grid = makeNavGrid(cells);
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }],
      waypointIndex: 0,
      walkSpeed: 1,
      destinationX: 2, destinationZ: 0,
    });
    expect(isPathBlocked(state, grid, false)).toBe(true);
  });

  it('returns true when avoidVehicles is true and a waypoint is vehicleOccupied', () => {
    const grid = makeNavGrid([
      [
        { type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: true },
        { type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false },
      ],
      [
        { type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false },
        { type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false },
      ],
    ]);
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 0, z: 0 }],
      waypointIndex: 0,
      walkSpeed: 1,
      destinationX: 0, destinationZ: 0,
    });
    expect(isPathBlocked(state, grid, true)).toBe(true);
  });

  it('returns false when avoidVehicles is false and a waypoint is vehicleOccupied', () => {
    const grid = makeNavGrid([
      [
        { type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: true },
        { type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false },
      ],
      [
        { type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false },
        { type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false },
      ],
    ]);
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 0, z: 0 }],
      waypointIndex: 0,
      walkSpeed: 1,
      destinationX: 0, destinationZ: 0,
    });
    expect(isPathBlocked(state, grid, false)).toBe(false);
  });

  it('returns false when all remaining waypoints are walkable', () => {
    const grid = makeNavGrid(); // Default 5×5 all-walkable
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 2, z: 2 }, { x: 4, z: 4 }],
      waypointIndex: 0,
      walkSpeed: 1,
      destinationX: 4, destinationZ: 4,
    });
    expect(isPathBlocked(state, grid, false)).toBe(false);
  });

  it('returns false when waypoints array is empty', () => {
    const grid = makeNavGrid();
    const state = makeState({
      x: 0, z: 0,
      waypoints: [],
      waypointIndex: 0,
      walkSpeed: 1,
      destinationX: 0, destinationZ: 0,
    });
    expect(isPathBlocked(state, grid, false)).toBe(false);
  });

  it('returns false when waypointIndex is past the end of waypoints', () => {
    const grid = makeNavGrid();
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 2, z: 0 }],
      waypointIndex: 5,
      walkSpeed: 1,
      destinationX: 2, destinationZ: 0,
    });
    expect(isPathBlocked(state, grid, false)).toBe(false);
  });

  it('does not mutate the input AgentState', () => {
    const grid = makeNavGrid([
      [{ type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false }, { type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false }],
      [{ type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false }, { type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false }],
    ]);
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 0, z: 0 }],
      waypointIndex: 0,
      walkSpeed: 1,
      destinationX: 0, destinationZ: 0,
    });
    const snapshot = { ...state, waypoints: [...state.waypoints] };

    isPathBlocked(state, grid, false);

    expect(state.x).toBe(snapshot.x);
    expect(state.z).toBe(snapshot.z);
    expect(state.waypointIndex).toBe(snapshot.waypointIndex);
    expect(state.walkSpeed).toBe(snapshot.walkSpeed);
    expect(state.destinationX).toBe(snapshot.destinationX);
    expect(state.destinationZ).toBe(snapshot.destinationZ);
    expect(state.waypoints.length).toBe(snapshot.waypoints.length);
    expect(state.waypoints[0]!.x).toBe(snapshot.waypoints[0]!.x);
    expect(state.waypoints[0]!.z).toBe(snapshot.waypoints[0]!.z);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 9: doesPathCrossRegion — stale-path detection via updated regions
// ═══════════════════════════════════════════════════════════════════════════════

describe('doesPathCrossRegion — region intersection', () => {
  const region = { minX: 1, maxX: 3, minZ: 1, maxZ: 3 };

  it('returns true when a waypoint falls inside the region', () => {
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 2, z: 2 }],
      waypointIndex: 0,
      walkSpeed: 1,
      destinationX: 2, destinationZ: 2,
    });
    expect(doesPathCrossRegion(state, region)).toBe(true);
  });

  it('returns true when a waypoint is exactly on a region boundary (inclusive)', () => {
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 1, z: 1 }],
      waypointIndex: 0,
      walkSpeed: 1,
      destinationX: 1, destinationZ: 1,
    });
    expect(doesPathCrossRegion(state, region)).toBe(true);
  });

  it('returns false when no waypoint is inside the region', () => {
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 4, z: 4 }],
      waypointIndex: 0,
      walkSpeed: 1,
      destinationX: 4, destinationZ: 4,
    });
    expect(doesPathCrossRegion(state, region)).toBe(false);
  });

  it('returns false when the region is empty (minX > maxX)', () => {
    const emptyRegion = { minX: 5, maxX: 3, minZ: 1, maxZ: 3 };
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 2, z: 2 }],
      waypointIndex: 0,
      walkSpeed: 1,
      destinationX: 2, destinationZ: 2,
    });
    expect(doesPathCrossRegion(state, emptyRegion)).toBe(false);
  });

  it('returns false when the region is empty (minZ > maxZ)', () => {
    const emptyRegion = { minX: 1, maxX: 3, minZ: 5, maxZ: 3 };
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 2, z: 2 }],
      waypointIndex: 0,
      walkSpeed: 1,
      destinationX: 2, destinationZ: 2,
    });
    expect(doesPathCrossRegion(state, emptyRegion)).toBe(false);
  });

  it('returns false when waypoints array is empty', () => {
    const state = makeState({
      x: 0, z: 0,
      waypoints: [],
      waypointIndex: 0,
      walkSpeed: 1,
      destinationX: 0, destinationZ: 0,
    });
    expect(doesPathCrossRegion(state, region)).toBe(false);
  });

  it('returns false when waypointIndex is past the end', () => {
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 2, z: 2 }],
      waypointIndex: 5,
      walkSpeed: 1,
      destinationX: 2, destinationZ: 2,
    });
    expect(doesPathCrossRegion(state, region)).toBe(false);
  });

  it('does not mutate the input AgentState', () => {
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 2, z: 2 }],
      waypointIndex: 0,
      walkSpeed: 1,
      destinationX: 2, destinationZ: 2,
    });
    const snapshot = { ...state, waypoints: [...state.waypoints] };

    doesPathCrossRegion(state, region);

    expect(state.x).toBe(snapshot.x);
    expect(state.z).toBe(snapshot.z);
    expect(state.waypointIndex).toBe(snapshot.waypointIndex);
    expect(state.walkSpeed).toBe(snapshot.walkSpeed);
    expect(state.destinationX).toBe(snapshot.destinationX);
    expect(state.destinationZ).toBe(snapshot.destinationZ);
    expect(state.waypoints.length).toBe(snapshot.waypoints.length);
    expect(state.waypoints[0]!.x).toBe(snapshot.waypoints[0]!.x);
    expect(state.waypoints[0]!.z).toBe(snapshot.waypoints[0]!.z);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 10: requestReRoute — clearing waypoints for re-routing
// ═══════════════════════════════════════════════════════════════════════════════

describe('requestReRoute — clear waypoints for re-routing', () => {
  it('returns a new AgentState with empty waypoints and waypointIndex 0', () => {
    const state = makeState({
      x: 10, z: 20,
      waypoints: [{ x: 15, z: 25 }, { x: 30, z: 40 }],
      waypointIndex: 1,
      walkSpeed: 2,
      destinationX: 30, destinationZ: 40,
    });
    const result = requestReRoute(state);
    expect(result.waypoints).toEqual([]);
    expect(result.waypointIndex).toBe(0);
  });

  it('preserves x, z, walkSpeed, destinationX, destinationZ', () => {
    const state = makeState({
      x: 10, z: 20,
      waypoints: [{ x: 15, z: 25 }],
      waypointIndex: 0,
      walkSpeed: 3,
      destinationX: 15, destinationZ: 25,
    });
    const result = requestReRoute(state);
    expect(result.x).toBe(10);
    expect(result.z).toBe(20);
    expect(result.walkSpeed).toBe(3);
    expect(result.destinationX).toBe(15);
    expect(result.destinationZ).toBe(25);
  });

  it('does not mutate the input AgentState', () => {
    const state = makeState({
      x: 10, z: 20,
      waypoints: [{ x: 15, z: 25 }],
      waypointIndex: 0,
      walkSpeed: 3,
      destinationX: 15, destinationZ: 25,
    });
    const snapshot = { ...state, waypoints: [...state.waypoints] };

    requestReRoute(state);

    expect(state.x).toBe(snapshot.x);
    expect(state.z).toBe(snapshot.z);
    expect(state.waypointIndex).toBe(snapshot.waypointIndex);
    expect(state.walkSpeed).toBe(snapshot.walkSpeed);
    expect(state.destinationX).toBe(snapshot.destinationX);
    expect(state.destinationZ).toBe(snapshot.destinationZ);
    expect(state.waypoints.length).toBe(snapshot.waypoints.length);
    expect(state.waypoints[0]!.x).toBe(snapshot.waypoints[0]!.x);
    expect(state.waypoints[0]!.z).toBe(snapshot.waypoints[0]!.z);
  });

  it('works when destination equals current position', () => {
    const state = makeState({
      x: 5, z: 5,
      waypoints: [{ x: 5, z: 5 }],
      waypointIndex: 0,
      walkSpeed: 1,
      destinationX: 5, destinationZ: 5,
    });
    const result = requestReRoute(state);
    expect(result.waypoints).toEqual([]);
    expect(result.waypointIndex).toBe(0);
    expect(result.x).toBe(5);
    expect(result.z).toBe(5);
    expect(result.destinationX).toBe(5);
    expect(result.destinationZ).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 11: StaleCheckResult — type shape validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('StaleCheckResult — type shape', () => {
  it('creates a stale result with BLOCKED_WAYPOINT reason', () => {
    const result: StaleCheckResult = { isStale: true, reason: 'BLOCKED_WAYPOINT' };
    expect(result.isStale).toBe(true);
    expect(result.reason).toBe('BLOCKED_WAYPOINT');
  });

  it('creates a stale result with CROSSES_UPDATED_REGION reason', () => {
    const result: StaleCheckResult = { isStale: true, reason: 'CROSSES_UPDATED_REGION' };
    expect(result.isStale).toBe(true);
    expect(result.reason).toBe('CROSSES_UPDATED_REGION');
  });

  it('creates a non-stale result with no reason', () => {
    const result: StaleCheckResult = { isStale: false };
    expect(result.isStale).toBe(false);
    expect(result.reason).toBeUndefined();
  });
});
