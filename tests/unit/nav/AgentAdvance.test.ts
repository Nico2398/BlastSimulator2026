// BlastSimulator2026 — Unit tests: advanceAlongPath (shared find-path/stuck/advance skeleton)
// Extracted from EntityMovementTick.ts's tickVehicleOnNavGrid and tickEmployeeMovement, which
// duplicated this sequence end to end (#407 review round 2).

import { describe, it, expect } from 'vitest';
import {
  advanceAlongPath, NULL_ROUTE_COMMITMENT, type AdvanceAlongPathInput, type RouteCommitment,
} from '../../../src/core/nav/AgentAdvance.js';
import { AGENT_WALK_SPEED, NAV_MAX_CLIMB_HEIGHT, STUCK_THRESHOLD } from '../../../src/core/config/balance.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';

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
    // #1129: AdvanceAlongPathInput now carries a mandatory route-commitment
    // baseline (RouteCommitment) across ticks. NULL_ROUTE_COMMITMENT is the
    // "no commitment yet" default every pre-existing test in this file
    // implicitly wants — none of them exercise the commitment guard itself.
    committed: NULL_ROUTE_COMMITMENT,
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

  // ── #458 T6.1/D14: skip the self-echo start waypoint ──
  //
  // findPath's own waypoint lists (both the A* reconstruction and the
  // direct-line fallback) always include the agent's own floor-rounded
  // starting cell as waypoints[0] — every path is freshly recomputed each
  // tick, so index 0 is never a real step to walk toward. Left unskipped,
  // an agent standing at a fractional position (e.g. x=4.6) would spend part
  // of its movement budget snapping onto the rounded echo of itself (x=4)
  // before making real progress — usually just a wasted fraction of a step,
  // but a stable source of tick-to-tick position "drag" near any decision
  // point where the correct next hop is sensitive to exact position.

  it('does not waste movement budget snapping onto a self-echo start waypoint', () => {
    const result = advanceAlongPath(baseInput({
      x: 4.6,
      z: 0,
      destinationX: 10,
      // Realistic findPath()-shaped waypoint list: [self-echo start, ...real steps].
      path: { found: true, waypoints: [{ x: 4, z: 0 }, { x: 6, z: 0 }, { x: 10, z: 0 }] },
    }));

    // AGENT_WALK_SPEED (2) of forward progress from x=4.6, not (partly)
    // consumed moving backward to the rounded x=4 self-echo first.
    expect(result.x).toBeCloseTo(4.6 + AGENT_WALK_SPEED, 5);
    expect(result.z).toBe(0);
  });

  it('still reaches the destination correctly when the path is only the self-echo (already there)', () => {
    const result = advanceAlongPath(baseInput({
      x: 10,
      z: 0,
      destinationX: 10,
      path: { found: true, waypoints: [{ x: 10, z: 0 }] },
    }));

    expect(result.isPathComplete).toBe(true);
    expect(result.x).toBe(10);
    expect(result.z).toBe(0);
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

// ── Already-walked waypoints (#953) ────────────────────────────────────────────
//
// With a climb limit in force, the legal route out of a cell often starts by
// stepping back to a neighbour the agent has already passed. Flooring the
// agent's continuous position into the cell it just left then hands it that
// backwards hop every tick, and it oscillates instead of arriving.

/** NavGrid from a height map: every cell walkable, `surfaceY` taken from the map. */
function heightGrid(heights: number[][]): NavGrid {
  const cells = heights.map(row => row.map((surfaceY): NavCell => ({
    type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false, surfaceY,
  })));
  return new NavGrid(heights[0]!.length, heights.length, cells, Math.max(...heights.flat()));
}

describe('advanceAlongPath — waypoints the agent has already walked', () => {
  const flat = heightGrid([
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]);

  /** A tick short enough that only a fraction of one cell is walked, so direction is readable. */
  const HALF_CELL = 0.5;

  it('skips a first waypoint the agent has already passed, instead of walking back to it', () => {
    // The agent stands between (1,0) and (0,1) and floors into (0,0), whose
    // route out starts by stepping back to (1,0) — the shape that oscillates.
    const result = advanceAlongPath(baseInput({
      x: 0.3, z: 0.7,
      walkSpeed: HALF_CELL,
      destinationX: 0, destinationZ: 1,
      path: { found: true, waypoints: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }] },
      navGrid: flat,
    }));

    expect(result.z).toBeGreaterThan(0.7);
    expect(result.x).toBeLessThan(0.3);
  });

  it('keeps the stepping stone when skipping it would invent a climb-illegal step', () => {
    // (1,1) → (1,2) → (2,1) descends and comes back up precisely because
    // (1,1) → (2,1) is a face taller than the climb limit.
    const stepped = heightGrid([
      [0, 0, 0],
      [0, NAV_MAX_CLIMB_HEIGHT + 1, 0],
      [0, NAV_MAX_CLIMB_HEIGHT + 1, 0],
    ]);

    const result = advanceAlongPath(baseInput({
      x: 1, z: 1.2,
      walkSpeed: HALF_CELL,
      destinationX: 2, destinationZ: 1,
      path: { found: true, waypoints: [{ x: 1, z: 1 }, { x: 1, z: 2 }, { x: 2, z: 1 }] },
      navGrid: stepped,
    }));

    expect(result.z).toBeGreaterThan(1.2);
    expect(result.x).toBe(1);
  });

  it('takes the same skip when the hop it opens up is climb-legal', () => {
    const result = advanceAlongPath(baseInput({
      x: 1, z: 1.2,
      walkSpeed: HALF_CELL,
      destinationX: 2, destinationZ: 1,
      path: { found: true, waypoints: [{ x: 1, z: 1 }, { x: 1, z: 2 }, { x: 2, z: 1 }] },
      navGrid: flat,
    }));

    expect(result.x).toBeGreaterThan(1);
  });

  it('still walks to the next waypoint when the agent has not reached it yet', () => {
    const result = advanceAlongPath(baseInput({
      x: 0, z: 0,
      walkSpeed: HALF_CELL,
      destinationX: 2, destinationZ: 0,
      path: { found: true, waypoints: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }] },
      navGrid: flat,
    }));

    expect(result.x).toBeCloseTo(HALF_CELL, 5);
    expect(result.z).toBe(0);
  });

  it('leaves the skip alone when the caller has no navgrid (direct-line branch)', () => {
    const result = advanceAlongPath(baseInput({
      x: 0.3, z: 0.7,
      walkSpeed: HALF_CELL,
      destinationX: 0, destinationZ: 1,
      path: { found: true, waypoints: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }] },
      navGrid: null,
    }));

    // No grid to prove the skip is legal, so waypoint 1 stands and the agent
    // walks back toward it — the pre-#953 behaviour, unchanged.
    expect(result.x).toBeGreaterThan(0.3);
  });
});

// ── #1129: cross-tick route-commitment guard ────────────────────────────────
//
// Every drive/foot leg recomputes its route from scratch each tick
// (findExactPath). Two near-adjacent start points toward the same goal can
// get two differently-shaped but cost-consistent routes back — advancing
// along the second route can land the agent back at (or near) the first
// route's start point, oscillating forever. `RouteCommitment` persists the
// in-flight target waypoint and its cost baseline across ticks so a fresh
// replan only overrides it when clearly better (beyond
// ROUTE_COMMIT_TIE_EPSILON), not just differently shaped at an equal cost.
//
// The skeleton wires `committed` straight through `advanceAlongPath`
// unmodified (`resolveTargetWaypoint` is a stub that throws and is never
// called) — every case below fails against that pass-through until the
// implementer wires the guard in.

describe('advanceAlongPath — route-commitment guard (#1129)', () => {
  it('core regression: does not walk back to the tick-1 start when tick-2 replans a differently-shaped, near-equal-cost route', () => {
    // Path A (tick 1): from (24,20), first real hop to (24,18) — walkSpeed 2
    // covers that hop exactly in one tick. totalCost 9.657, matching the
    // reported oscillation's cost.
    const destinationX = 22;
    const destinationZ = 24;
    const pathA = {
      found: true,
      waypoints: [{ x: 24, z: 20 }, { x: 24, z: 18 }, { x: 25, z: 17 }, { x: 22, z: 24 }],
      totalCost: 9.657,
    };
    const tick1 = advanceAlongPath(baseInput({
      x: 24, z: 20,
      walkSpeed: AGENT_WALK_SPEED, // 2
      destinationX, destinationZ,
      path: pathA,
      committed: NULL_ROUTE_COMMITMENT,
    }));

    // Path B (tick 2): freshly recomputed from tick 1's resulting position.
    // Its first real hop points BACK at (24,20) — tick 1's own start — while
    // its total cost is exactly one tick's walk distance (2) cheaper than
    // path A's, the cost-consistent-but-differently-shaped property from the
    // issue (9.657 vs 7.657).
    const pathB = {
      found: true,
      waypoints: [{ x: tick1.x, z: tick1.z }, { x: 24, z: 20 }, { x: 25, z: 19 }, { x: 22, z: 24 }],
      totalCost: 7.657,
    };
    const tick2 = advanceAlongPath(baseInput({
      x: tick1.x, z: tick1.z,
      walkSpeed: AGENT_WALK_SPEED,
      destinationX, destinationZ,
      path: pathB,
      // Threaded straight from tick 1's own outcome, as the real per-tick
      // caller would.
      committed: tick1.committed,
    }));

    const distToDest = (x: number, z: number): number =>
      Math.hypot(x - destinationX, z - destinationZ);

    // (a) Net distance to destination strictly decreases from tick 0's start
    // to tick 2's resulting position — it must not return to (or past) it.
    expect(distToDest(tick2.x, tick2.z)).toBeLessThan(distToDest(24, 20));

    // (b) Tick 2 must not have walked the agent back toward tick 1's start —
    // i.e. it must not have landed back on (24,20).
    expect(tick2.x === 24 && tick2.z === 20).toBe(false);
  });

  it('discards a stale commitment when the destination changes', () => {
    const stale: RouteCommitment = {
      waypointX: 5, waypointZ: 5, destX: 1, destZ: 1, remainingCost: 3,
    };
    const freshPath = { found: true, waypoints: [{ x: 0, z: 0 }, { x: 2, z: 2 }], totalCost: 4 };

    const result = advanceAlongPath(baseInput({
      x: 0, z: 0,
      walkSpeed: AGENT_WALK_SPEED,
      destinationX: 10, destinationZ: 10, // different from stale.destX/destZ
      path: freshPath,
      committed: stale,
    }));

    // The commitment written back must describe THIS leg's destination and
    // target, not the stale one from a previous leg.
    expect(result.committed.destX).toBe(10);
    expect(result.committed.destZ).toBe(10);
    expect(result.committed.waypointX).toBe(2);
    expect(result.committed.waypointZ).toBe(2);
  });

  it('discards a commitment whose waypoint has become impassable, staying reactive to the grid', () => {
    const flat = heightGrid([
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0],
    ]);
    // The committed waypoint (2,2) is out of this 5x3 grid's z range (0-2) —
    // use (2,1) instead, then block it.
    flat.cells[1]![2] = { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false, surfaceY: 0 };

    const committedButBlocked: RouteCommitment = {
      waypointX: 2, waypointZ: 1, destX: 10, destZ: 10, remainingCost: 5,
    };
    const freshPath = { found: true, waypoints: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 10, z: 10 }], totalCost: 6 };

    const result = advanceAlongPath(baseInput({
      x: 0, z: 0,
      walkSpeed: AGENT_WALK_SPEED,
      destinationX: 10, destinationZ: 10,
      path: freshPath,
      committed: committedButBlocked,
      navGrid: flat,
    }));

    // The now-blocked (2,1) must not survive as the resolved commitment —
    // the fresh path's own target takes over.
    expect(result.committed.waypointX).toBe(4);
    expect(result.committed.waypointZ).toBe(0);
  });

  it('adopts a fresh route clearly better than the committed one (beyond ROUTE_COMMIT_TIE_EPSILON)', () => {
    const committed: RouteCommitment = {
      waypointX: 3, waypointZ: 3, destX: 10, destZ: 10, remainingCost: 10,
    };
    // Fresh cost 5 is 5 below the committed remainingCost of 10 — well past
    // the epsilon tie band, a genuine improvement.
    const freshPath = { found: true, waypoints: [{ x: 0, z: 0 }, { x: 7, z: 7 }, { x: 10, z: 10 }], totalCost: 5 };

    const result = advanceAlongPath(baseInput({
      x: 0, z: 0,
      walkSpeed: AGENT_WALK_SPEED,
      destinationX: 10, destinationZ: 10,
      path: freshPath,
      committed,
    }));

    expect(result.committed.waypointX).toBe(7);
    expect(result.committed.waypointZ).toBe(7);
    expect(result.committed.remainingCost).toBeCloseTo(5, 5);
  });
});
