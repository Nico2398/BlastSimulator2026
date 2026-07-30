// BlastSimulator2026 — Unit tests: advanceAlongPath (shared find-path/stuck/advance skeleton)
// Extracted from EntityMovementTick.ts's tickVehicleOnNavGrid and tickEmployeeMovement, which
// duplicated this sequence end to end (#407 review round 2).

import { describe, it, expect } from 'vitest';
import { advanceAlongPath, type AdvanceAlongPathInput } from '../../../src/core/nav/AgentAdvance.js';
import { AGENT_WALK_SPEED, STUCK_THRESHOLD } from '../../../src/core/config/balance.js';

function baseInput(overrides?: Partial<AdvanceAlongPathInput>): AdvanceAlongPathInput {
  return {
    x: 0,
    z: 0,
    walkSpeed: AGENT_WALK_SPEED,
    destinationX: 10,
    destinationZ: 0,
    consecutiveFailures: 0,
    isStuck: false,
    path: { found: true, waypoints: [{ x: 10, z: 0 }] },
    ...overrides,
  };
}

describe('advanceAlongPath', () => {
  it('advances toward the next waypoint on a found path', () => {
    const result = advanceAlongPath(baseInput());

    expect(result.pathFound).toBe(true);
    expect(result.x).toBeCloseTo(AGENT_WALK_SPEED, 5);
    expect(result.z).toBe(0);
    expect(result.isPathComplete).toBe(false);
    expect(result.consecutiveFailures).toBe(0);
    expect(result.isStuck).toBe(false);
    expect(result.becameStuck).toBe(false);
  });

  it('reaches the destination in one tick when within walking speed', () => {
    const result = advanceAlongPath(baseInput({
      destinationX: 1,
      path: { found: true, waypoints: [{ x: 1, z: 0 }] },
    }));

    expect(result.isPathComplete).toBe(true);
    expect(result.x).toBe(1);
    expect(result.z).toBe(0);
  });

  it('resets stuck-tracking fields when a path is found after prior failures', () => {
    const result = advanceAlongPath(baseInput({
      consecutiveFailures: STUCK_THRESHOLD - 1,
      isStuck: false,
    }));

    expect(result.consecutiveFailures).toBe(0);
    expect(result.isStuck).toBe(false);
  });

  it('records a failed attempt and reports no movement when no path was found', () => {
    const result = advanceAlongPath(baseInput({
      x: 5,
      z: 5,
      path: { found: false, waypoints: [] },
    }));

    expect(result.pathFound).toBe(false);
    expect(result.x).toBe(5);
    expect(result.z).toBe(5);
    expect(result.consecutiveFailures).toBe(1);
    expect(result.isStuck).toBe(false);
    expect(result.becameStuck).toBe(false);
    expect(result.isPathComplete).toBe(false);
  });

  it('crosses STUCK_THRESHOLD and reports becameStuck exactly on the falling edge', () => {
    let consecutiveFailures = 0;
    let isStuck = false;
    const becameStuckTicks: boolean[] = [];

    for (let i = 0; i < STUCK_THRESHOLD + 2; i++) {
      const result = advanceAlongPath(baseInput({
        consecutiveFailures,
        isStuck,
        path: { found: false, waypoints: [] },
      }));
      consecutiveFailures = result.consecutiveFailures;
      isStuck = result.isStuck;
      becameStuckTicks.push(result.becameStuck);
    }

    expect(consecutiveFailures).toBe(STUCK_THRESHOLD + 2);
    expect(isStuck).toBe(true);
    // becameStuck true exactly once — on the tick consecutiveFailures first reaches STUCK_THRESHOLD.
    expect(becameStuckTicks.filter(Boolean)).toHaveLength(1);
    expect(becameStuckTicks[STUCK_THRESHOLD - 1]).toBe(true);
  });
});
