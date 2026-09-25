// BlastSimulator2026 — Unit tests: advanceAlongPath (shared find-path/stuck/advance skeleton)
// Extracted from EntityMovementTick.ts's tickVehicleOnNavGrid and tickEmployeeMovement, which
// duplicated this sequence end to end (#407 review round 2).

import { describe, it, expect } from 'vitest';
import {
  advanceAlongPath, NULL_ROUTE_COMMITMENT, type AdvanceAlongPathInput, type RouteCommitment,
} from '../../../src/core/nav/AgentAdvance.js';
import { AGENT_WALK_SPEED, STUCK_THRESHOLD } from '../../../src/core/config/balance.js';
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

/** NavGrid from a height map: every cell walkable, `surfaceY` taken from the map.
 * `climbY` (the integer field production climb-gating actually reads, #1149)
 * mirrors `surfaceY` here since these hand-built fixtures have no real voxel
 * grid to derive a separate integer index from. */
function heightGrid(heights: number[][]): NavGrid {
  const cells = heights.map(row => row.map((surfaceY): NavCell => ({
    type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false, surfaceY, climbY: surfaceY,
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
    // (1,1) → (2,1) is a face far steeper than the slope limit (10m over a
    // 1m cardinal run — well past NAV_MAX_SLOPE_RATIO's ~0.5774m).
    const stepped = heightGrid([
      [0, 0, 0],
      [0, 10, 0],
      [0, 10, 0],
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

// ── #1129 fix (ba8bdc1b): retrace guard false-positive + off-grid arrival ──
//
// The route-commitment guard above landed with two bugs of its own, fixed in
// ba8bdc1b with no regression coverage. Both are exercised here directly
// against the specific branch each fix touches.

describe('advanceAlongPath — stationary-at-dead-end does not misfire the retrace guard (#1129 bug 1)', () => {
  it('holds position instead of routing off toward the raw destination when parked at a zero-distance-hop commitment', () => {
    // Agent is parked at (10,0) — a NavGrid-clamped dead end short of a raw
    // destination (50,0) far off to the east. Every tick's fresh replan can
    // only ever hand back (10,0) again (nothing further is reachable), and
    // the carried commitment reflects a hop that moved zero distance: its
    // `fromX/fromZ` (where the hop started) equals its own `waypointX/waypointZ`
    // (where it ended) — the ordinary shape once an agent is genuinely stuck
    // in place, not the two-different-points shape a real retrace requires.
    const destinationX = 50;
    const destinationZ = 0;
    const committedAtDeadEnd: RouteCommitment = {
      waypointX: 10, waypointZ: 0,
      destX: destinationX, destZ: destinationZ,
      remainingCost: 0,
      fromX: 10, fromZ: 0, // zero-distance hop: from === waypoint
    };
    // Single-waypoint fresh path whose only entry is that same stationary
    // cell — the clamped replan's own target, tick after tick.
    const freshPath = { found: true, waypoints: [{ x: 10, z: 0 }], totalCost: 0 };

    const result = advanceAlongPath(baseInput({
      x: 10, z: 0,
      walkSpeed: AGENT_WALK_SPEED,
      destinationX, destinationZ,
      path: freshPath,
      committed: committedAtDeadEnd,
    }));

    // Pre-fix, the unguarded isRetrace check treats this self-referential
    // "from" as a retrace signature and forces a straight, unclamped hop at
    // the raw destination (50,0) — the agent would end this tick partway
    // toward x=50. The fix's extra guard clause requires fromX/fromZ to
    // differ from waypointX/waypointZ before calling it a retrace, so a
    // parked agent simply re-adopts the fresh (still-stationary) target and
    // does not move.
    expect(result.x).toBe(10);
    expect(result.z).toBe(0);
  });
});

// ── #1166: climb-legality re-check uses the fixed inter-cell run, not the
// agent's shrinking distance to the committed waypoint ──────────────────────
//
// Pre-fix, resolveTargetWaypoint's climb-legality re-check measured `run` as
// Math.hypot(committed.waypointX - x, committed.waypointZ - z) — the agent's
// own live distance to the waypoint, which shrinks toward 0 every tick it
// approaches. A step whose rise is legal over the true 1.0m cardinal run
// (0.5 <= NAV_MAX_SLOPE_RATIO*1.0 ≈ 0.577) then reads as spuriously illegal
// once the agent gets close enough (remaining distance below ~0.866),
// dropping the commitment and forcing a replan every tick. The fix reads
// `run` from the fixed cell pair `RouteCommitment.originX/originZ` ->
// `waypointX/waypointZ` instead, which never changes while the commitment is
// held.

describe('advanceAlongPath — climb re-check uses fixed inter-cell run, not shrinking distance (#1166)', () => {
  it('keeps a climb-legal committed waypoint across several ticks as the agent gets closer to it', () => {
    // Column 0 sits at height 0, column 1 at height 0.5 — a cardinal step
    // legal over the fixed 1.0m run but illegal over anything narrower than
    // ~0.866m, which the agent's own remaining distance passes through well
    // before arrival.
    const grid = heightGrid([
      [0, 0.5],
      [0, 0.5],
      [0, 0.5],
    ]);

    const destinationX = 1;
    const destinationZ = 0;
    let committed: RouteCommitment = {
      waypointX: 1, waypointZ: 0, destX: destinationX, destZ: destinationZ,
      remainingCost: 5,
      fromX: 0, fromZ: 0,
      // The fixed edge A* actually validated: (0,0) -> (1,0). Never changes
      // while this waypoint stays committed.
      originX: 0, originZ: 0,
    };

    let x = 0;
    const z = 0;
    // Successively smaller ticks closing the gap — remaining distance to the
    // committed waypoint (1,0) shrinks well under the ~0.866 threshold a
    // shrinking-distance climb check would have started failing at.
    const walkSteps = [0.5, 0.3, 0.15, 0.04, 0.005];

    for (const step of walkSteps) {
      const result = advanceAlongPath(baseInput({
        x, z,
        walkSpeed: step,
        destinationX, destinationZ,
        // A fresh replan pointing at a different cell, with a cost that is
        // NOT clearly better than the committed baseline (tied, in fact) —
        // must not win over the held commitment on its own.
        path: { found: true, waypoints: [{ x, z }, { x: 0, z: 1 }], totalCost: 5 },
        committed,
        navGrid: grid,
      }));

      // The commitment toward (1,0) must survive every tick — never
      // dropped for the fresh alternative (0,1) purely because the agent
      // got closer to it.
      expect(result.committed.waypointX).toBe(1);
      expect(result.committed.waypointZ).toBe(0);
      expect(result.z).toBe(0);
      expect(result.x).toBeGreaterThan(x);

      x = result.x;
      committed = result.committed;
    }
  });
});

// ── #1130: period-2 oscillation trips isStuck even though pathFound stays true ──
//
// findPath can hand back two equal-cost route shapes that alternate tick over
// tick near a terrain ridge — a genuine A/B/A/B position cycle. The old
// stuck-counter reset fired on every `found: true` tick regardless of whether
// the mover's position actually changed, so this cycle never tripped
// isStuck. moveHistoryX/Z is a 2-tick shift register (input == the mover's
// own position 2 ticks back; output == this tick's own pre-move position) —
// when the tick's final position exactly matches moveHistoryX/Z AND the leg
// did not complete this tick, that's the oscillation's signature and must run
// through the same failure-accumulation path `!path.found` already uses,
// without ever reporting `pathFound: false`.

describe('advanceAlongPath — period-2 oscillation trips isStuck (#1130)', () => {
  /**
   * A fresh-replan path whose next hop is `target` — walkSpeed covers it in
   * one tick, landing exactly on it. Carries a placeholder index-0 entry (the
   * agent's own echoed cell — `firstUnwalkedWaypoint` always skips it when a
   * caller passes no navGrid) and a trailing waypoint well past `target`, so
   * `target` is never the fresh path's own *last* waypoint. A real
   * `findPath` route to a far-off destination always has more path left
   * beyond the immediate next hop; a single-waypoint synthetic path here
   * would instead trip `advanceAlongPath`'s `exhaustedFreshPath` leg-complete
   * check every tick (real for the #1129 off-grid-destination case, false
   * here) and mask the oscillation branch entirely.
   */
  function hopTo(target: { x: number; z: number }): { found: true; waypoints: Array<{ x: number; z: number }> } {
    return { found: true, waypoints: [{ x: 0, z: 0 }, target, { x: 999, z: 999 }] };
  }

  it('crosses STUCK_THRESHOLD via a synthetic A/B/A/B cycle even though every tick reports pathFound: true, and becameStuck fires exactly once on the transition', () => {
    const A = { x: 0, z: 0 };
    const B = { x: 1, z: 0 };

    let x = A.x, z = A.z;
    let consecutiveFailures = 0;
    let isStuck = false;
    let moveHistoryX: number | null = null;
    let moveHistoryZ: number | null = null;
    const becameStuckTicks: boolean[] = [];
    const pathFoundTicks: boolean[] = [];

    // Alternate the "fresh path" target every tick between B and A — with
    // walkSpeed exactly covering one hop, the mover's own position follows
    // the identical A/B/A/B cycle.
    for (let tick = 0; tick < STUCK_THRESHOLD + 3; tick++) {
      const target = tick % 2 === 0 ? B : A;
      const result = advanceAlongPath(baseInput({
        x, z,
        walkSpeed: 1, // exactly one full hop between A and B per tick
        destinationX: 10, destinationZ: 10, // far away — the leg never legitimately completes
        consecutiveFailures, isStuck,
        path: hopTo(target),
        committed: NULL_ROUTE_COMMITMENT,
        moveHistoryX, moveHistoryZ,
      }));

      pathFoundTicks.push(result.pathFound);
      becameStuckTicks.push(result.becameStuck);
      x = result.x;
      z = result.z;
      consecutiveFailures = result.consecutiveFailures;
      isStuck = result.isStuck;
      moveHistoryX = result.moveHistoryX;
      moveHistoryZ = result.moveHistoryZ;
    }

    // Every tick genuinely found and walked a route — this is not the
    // `!path.found` mechanism.
    expect(pathFoundTicks.every(Boolean)).toBe(true);
    expect(isStuck).toBe(true);
    expect(becameStuckTicks.filter(Boolean)).toHaveLength(1);
  });

  it('does not trip isStuck when a 3+-tick path legitimately revisits a cell it passed through earlier (not a strict period-2 alternation)', () => {
    // A → B → C → A → B → C ... — a period-3 cycle. No tick's own position
    // ever matches its OWN 2-ticks-back position under this cycle (A's
    // 2-back is C, B's 2-back is A, C's 2-back is B) — never a match, so the
    // oscillation signature never fires despite the mover genuinely
    // revisiting cells.
    const A = { x: 0, z: 0 };
    const B = { x: 1, z: 0 };
    const C = { x: 2, z: 0 };
    const cycle = [B, C, A, B, C, A, B, C, A, B];

    let x = A.x, z = A.z;
    let consecutiveFailures = 0;
    let isStuck = false;
    let moveHistoryX: number | null = null;
    let moveHistoryZ: number | null = null;

    for (const target of cycle) {
      const result = advanceAlongPath(baseInput({
        x, z,
        walkSpeed: 1,
        destinationX: 10, destinationZ: 10,
        consecutiveFailures, isStuck,
        path: hopTo(target),
        committed: NULL_ROUTE_COMMITMENT,
        moveHistoryX, moveHistoryZ,
      }));

      x = result.x;
      z = result.z;
      consecutiveFailures = result.consecutiveFailures;
      isStuck = result.isStuck;
      moveHistoryX = result.moveHistoryX;
      moveHistoryZ = result.moveHistoryZ;

      expect(isStuck).toBe(false);
    }
  });

  it('the first two ticks of any journey (moveHistoryX/Z still null) never false-positive, and reset normally on a found path', () => {
    const result = advanceAlongPath(baseInput({
      x: 0, z: 0,
      walkSpeed: AGENT_WALK_SPEED,
      destinationX: 10, destinationZ: 0,
      consecutiveFailures: STUCK_THRESHOLD - 1,
      isStuck: false,
      path: { found: true, waypoints: [{ x: AGENT_WALK_SPEED, z: 0 }] },
      committed: NULL_ROUTE_COMMITMENT,
      moveHistoryX: null,
      moveHistoryZ: null,
    }));

    expect(result.pathFound).toBe(true);
    expect(result.isStuck).toBe(false);
    expect(result.becameStuck).toBe(false);
    expect(result.consecutiveFailures).toBe(0);
  });

  it('leg completing this tick always resets the stuck counter, even on what would otherwise look like an oscillating tick', () => {
    // Position exactly matches moveHistoryX/Z (the oscillation signature),
    // but the leg completes this very tick — isPathComplete must win.
    const result = advanceAlongPath(baseInput({
      x: 9, z: 0,
      walkSpeed: AGENT_WALK_SPEED,
      destinationX: 10, destinationZ: 0,
      consecutiveFailures: STUCK_THRESHOLD,
      isStuck: false,
      path: { found: true, waypoints: [{ x: 10, z: 0 }] },
      committed: NULL_ROUTE_COMMITMENT,
      // Pre-fix-shaped history: the mover's position 2 ticks back happens to
      // equal where this tick's hop actually lands — irrelevant, since the
      // leg completes.
      moveHistoryX: 10,
      moveHistoryZ: 0,
    }));

    expect(result.isPathComplete).toBe(true);
    expect(result.isStuck).toBe(false);
    expect(result.consecutiveFailures).toBe(0);
  });

  it('shift-register invariant: this tick\'s output moveHistoryX/Z equals this tick\'s own pre-move input x/z', () => {
    const result = advanceAlongPath(baseInput({
      x: 3, z: 4,
      walkSpeed: AGENT_WALK_SPEED,
      destinationX: 10, destinationZ: 4,
      path: { found: true, waypoints: [{ x: 5, z: 4 }] },
      committed: NULL_ROUTE_COMMITMENT,
      moveHistoryX: 1,
      moveHistoryZ: 4,
    }));

    expect(result.moveHistoryX).toBe(3);
    expect(result.moveHistoryZ).toBe(4);
  });

});

describe('advanceAlongPath — off-grid destination still completes the leg (#1129 bug 2)', () => {
  it('reports the leg complete on reaching the fresh path\'s own last waypoint even though it never equals the raw destination', () => {
    // destinationX/Z (100,0) sits far outside anything the NavGrid could
    // route to — findPath's own clampToGrid means the route's actual last
    // waypoint is (5,0), which will never equal the raw destination
    // coordinates. Agent starts one short hop away from that clamped
    // endpoint, well within walkSpeed for a single tick.
    const result = advanceAlongPath(baseInput({
      x: 4, z: 0,
      walkSpeed: AGENT_WALK_SPEED,
      destinationX: 100, destinationZ: 0,
      path: { found: true, waypoints: [{ x: 4, z: 0 }, { x: 5, z: 0 }] },
      committed: NULL_ROUTE_COMMITMENT,
    }));

    // Pre-fix, legComplete required hopTarget to exactly equal
    // destinationX/Z — (5,0) never equals (100,0), so the agent would reach
    // (5,0) and report isPathComplete: false forever, stuck one cell short
    // with no further path to walk. The fix's second arm (hopTarget equals
    // the fresh path's own last waypoint) completes the leg here instead.
    expect(result.x).toBe(5);
    expect(result.z).toBe(0);
    expect(result.isPathComplete).toBe(true);
  });
});

// ── #1197: retrace recovery must never cross an unvalidated cell ───────────
//
// `resolveTargetWaypoint`'s own `isRetrace` branch (the #1129 oscillation
// recovery) sets its resolved target straight to the raw
// `destinationX`/`destinationZ` for one hop, bypassing the ordinary
// adjacent-cell resolution entirely. `advanceAgent` then walks the agent
// toward that far-off point by pure geometry — it never consults the
// NavGrid at all — so nothing validates whether the straight line between
// the agent and the raw destination actually crosses a real obstacle (a
// building footprint, a blocked column) sitting on it. `directLineWalk` was
// exported specifically so this recovery can validate that line before
// committing to it (see the `TODO(#1197)` in AgentAdvance.ts's own import
// block) — every case below fails against the unmodified pass-through until
// the implementer wires that validation in.

describe('advanceAlongPath — retrace recovery never crosses an unvalidated cell (#1197)', () => {
  /** Single-row NavGrid, `width` cells wide, every cell walkable except
   * `blockedX` — standing in for a building footprint sitting on the
   * straight line between the agent and its destination. */
  function makeRowGridWithBlock(width: number, blockedX: number): NavGrid {
    const cells: NavCell[][] = [[]];
    for (let x = 0; x < width; x++) {
      cells[0]!.push({
        type: x === blockedX ? 'blocked' : 'walkable',
        moveCost: x === blockedX ? Infinity : 1.0,
        benchLevel: 0,
        vehicleOccupied: false,
        surfaceY: 0,
        climbY: 0,
      });
    }
    return new NavGrid(width, 1, cells);
  }

  it('never lets the agent land on or cross the blocked column while a retrace-triggered "hold toward destination" is in effect', () => {
    // 11-cell-wide row, (5,0) blocked. destinationX=10 sits on the far side
    // of it — the only way to reach it directly is straight through.
    const grid = makeRowGridWithBlock(11, 5);
    const destinationX = 10;
    const destinationZ = 0;

    // tick 1: ordinary forward progress. The fresh path carries a third
    // point beyond the immediate hop target (2,0) so the hop does not
    // exhaust the whole fresh path (which would otherwise mark the leg
    // complete and discard the commitment before tick 2 ever runs).
    const tick1 = advanceAlongPath({
      x: 0, z: 0,
      walkSpeed: AGENT_WALK_SPEED, // 2
      destinationX, destinationZ,
      consecutiveFailures: 0, isStuck: false,
      path: { found: true, waypoints: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0 }], totalCost: 4 },
      committed: NULL_ROUTE_COMMITMENT,
      navGrid: grid,
    });
    expect(tick1.x).toBe(2);
    expect(tick1.z).toBe(0);

    // tick 2: the fresh replan retraces tick 1's own start, (0,0) — the
    // #1129 oscillation signature — at a cost (1) that is NOT a clear
    // improvement over the committed baseline (2): 1 is not
    // < 2 - ROUTE_COMMIT_TIE_EPSILON(1) = 1, an actual tie. This is exactly
    // the shape that triggers the isRetrace recovery.
    const tick2 = advanceAlongPath({
      x: tick1.x, z: tick1.z,
      walkSpeed: AGENT_WALK_SPEED,
      destinationX, destinationZ,
      consecutiveFailures: tick1.consecutiveFailures, isStuck: tick1.isStuck,
      path: { found: true, waypoints: [{ x: 2, z: 0 }, { x: 0, z: 0 }, { x: -2, z: 0 }], totalCost: 1 },
      committed: tick1.committed,
      navGrid: grid,
    });

    // A correct recovery must never adopt the raw, far-off destination as a
    // single unvalidated hop when the straight line to it is blocked, and
    // must never let the agent's position reach or pass the blocked column.
    expect(tick2.x).toBeLessThan(5);
    expect(tick2.committed.waypointX).not.toBe(destinationX);
    expect(tick2.x).not.toBe(destinationX);

    // Extend a further 3 ticks feeding the same alternating retrace shape —
    // the buggy "hold toward the raw destination" recovery keeps advancing
    // the agent AGENT_WALK_SPEED per tick regardless of the blocked column,
    // eventually landing on or past it.
    let x = tick2.x;
    const z = tick2.z;
    let committed = tick2.committed;
    let consecutiveFailures = tick2.consecutiveFailures;
    let isStuck = tick2.isStuck;

    for (let i = 0; i < 3; i++) {
      const next = advanceAlongPath({
        x, z,
        walkSpeed: AGENT_WALK_SPEED,
        destinationX, destinationZ,
        consecutiveFailures, isStuck,
        path: { found: true, waypoints: [{ x, z }, { x: x - 2, z }, { x: x - 4, z }], totalCost: 1 },
        committed,
        navGrid: grid,
      });

      expect(next.x).toBeLessThan(5);

      x = next.x;
      committed = next.committed;
      consecutiveFailures = next.consecutiveFailures;
      isStuck = next.isStuck;
    }
  });
});
