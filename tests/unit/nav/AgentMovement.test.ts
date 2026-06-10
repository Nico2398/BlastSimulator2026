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
import { advanceAgent } from '../../../src/core/nav/AgentMovement.js';
import type { AdvanceResult, AgentState } from '../../../src/core/nav/AgentMovement.js';
import { AGENT_WALK_SPEED } from '../../../src/core/config/balance.js';

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
    ...overrides,
  };
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
