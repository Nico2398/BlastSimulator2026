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
import type { AgentState } from '../../../src/core/nav/AgentMovement.js';
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

// ═══════════════════════════════════════════════════════════════════════════════
// Group 1: Basic single-waypoint advancement
// ═══════════════════════════════════════════════════════════════════════════════

describe('advanceAgent — single waypoint', () => {
  it('reaches the target when walkSpeed >= distance', () => {
    const state = makeState({ x: 0, z: 0, waypoints: [{ x: 2, z: 0 }], waypointIndex: 0, walkSpeed: 2 });
    const result = advanceAgent(state);
    expect(result.x).toBe(2);
    expect(result.z).toBe(0);
    expect(result.waypointIndex).toBe(1);
    expect(result.pathComplete).toBe(true);
  });

  it('moves partially toward target when walkSpeed < distance', () => {
    const state = makeState({ x: 0, z: 0, waypoints: [{ x: 3, z: 0 }], waypointIndex: 0, walkSpeed: 1 });
    const result = advanceAgent(state);
    expect(result.x).toBe(1);
    expect(result.z).toBe(0);
    expect(result.waypointIndex).toBe(0);
    expect(result.pathComplete).toBe(false);
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
    expect(result.x).toBeCloseTo(0.5, 6);
    expect(result.z).toBe(0);
    expect(result.waypointIndex).toBe(0);
    expect(result.pathComplete).toBe(false);
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
    expect(result.x).toBe(3);
    expect(result.z).toBe(0);
    expect(result.waypointIndex).toBe(3);
    // Still one waypoint remaining (at index 3, there are 4 waypoints total)
    expect(result.pathComplete).toBe(false);
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
    expect(result.x).toBe(4);
    expect(result.z).toBe(0);
    expect(result.waypointIndex).toBe(4);
    expect(result.pathComplete).toBe(true);
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
    expect(result.x).toBe(2);
    expect(result.z).toBe(0);
    expect(result.waypointIndex).toBe(2);
    expect(result.pathComplete).toBe(true);
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
    expect(result.x).toBe(2);
    expect(result.z).toBe(0);
    expect(result.waypointIndex).toBe(1);
    expect(result.pathComplete).toBe(true);
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
    expect(result.x).toBe(2);
    expect(result.z).toBe(2);
    expect(result.waypointIndex).toBe(1);
    expect(result.pathComplete).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Group 6: Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('advanceAgent — edge cases', () => {
  it('returns pathComplete=true when waypoints array is empty', () => {
    const state = makeState({ x: 5, z: 3, waypoints: [], waypointIndex: 0, walkSpeed: 2 });
    const result = advanceAgent(state);
    expect(result.x).toBe(5);
    expect(result.z).toBe(3);
    expect(result.waypointIndex).toBe(0);
    expect(result.pathComplete).toBe(true);
  });

  it('returns pathComplete=true when waypointIndex is past the array length', () => {
    const state = makeState({
      x: 5, z: 3,
      waypoints: [{ x: 1, z: 0 }, { x: 2, z: 0 }],
      waypointIndex: 5,
      walkSpeed: 2,
    });
    const result = advanceAgent(state);
    expect(result.x).toBe(5);
    expect(result.z).toBe(3);
    expect(result.waypointIndex).toBe(5);
    expect(result.pathComplete).toBe(true);
  });

  it('does not move and pathComplete is false when walkSpeed is 0 and waypoints exist', () => {
    // walkSpeed=0 means no movement budget; waypoints remain unconsumed
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 1, z: 0 }],
      waypointIndex: 0,
      walkSpeed: 0,
    });
    const result = advanceAgent(state);
    expect(result.x).toBe(0);
    expect(result.z).toBe(0);
    expect(result.waypointIndex).toBe(0);
    // pathComplete should be false because we haven't reached the end
    expect(result.pathComplete).toBe(false);
  });

  it('treats negative walkSpeed as 0 (no movement, no progress)', () => {
    const state = makeState({
      x: 0, z: 0,
      waypoints: [{ x: 1, z: 0 }],
      waypointIndex: 0,
      walkSpeed: -5,
    });
    const result = advanceAgent(state);
    expect(result.x).toBe(0);
    expect(result.z).toBe(0);
    expect(result.waypointIndex).toBe(0);
    expect(result.pathComplete).toBe(false);
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
