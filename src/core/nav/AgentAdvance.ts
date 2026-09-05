// BlastSimulator2026 — AgentAdvance: shared find-path/stuck-tracking/advance skeleton
// Factored out of EntityMovementTick.ts's tickVehicleOnNavGrid and tickEmployeeMovement
// (#407 review round 2), which ran the identical stuck-detection + per-tick-advance
// sequence end to end, differing only in field names and caller-specific bookkeeping
// (vehicle occupancy pre-check, employee morale penalty).

import { advanceAgent, recordStuckFailure, resetStuckState, type AgentState } from './AgentMovement.js';
import { isStepClimbable, type NavGrid } from './NavGrid.js';
import { NAV_MAX_CLIMB_HEIGHT } from '../config/balance.js';

/** A pre-resolved path — either from Pathfinding.findPath or synthesized directly. */
export interface AgentPath {
  found: boolean;
  waypoints: Array<{ x: number; z: number }>;
}

export interface AdvanceAlongPathInput {
  x: number;
  z: number;
  walkSpeed: number;
  destinationX: number;
  destinationZ: number;
  consecutiveFailures: number;
  isStuck: boolean;
  path: AgentPath;
  /**
   * The grid the path was found on, when the caller has one. Used only to
   * check that skipping an already-walked waypoint stays a legal step — see
   * `firstUnwalkedWaypoint`. Callers on the direct-line branch (no navgrid)
   * pass null and get the plain "skip the agent's own cell" behaviour.
   */
  navGrid?: NavGrid | null;
}

export interface AdvanceAlongPathOutcome {
  /** Whether a path was found this tick — false means the agent did not move. */
  pathFound: boolean;
  /** New position — unchanged from input when pathFound is false. */
  x: number;
  z: number;
  /** Updated stuck-tracker fields, to be written back onto the entity. */
  consecutiveFailures: number;
  isStuck: boolean;
  /** True only on the falling edge into stuck (was not stuck, now is) — callers
   *  emit their "stuck" event exactly once on this transition. */
  becameStuck: boolean;
  /** True when the agent reached the final waypoint this tick. */
  isPathComplete: boolean;
}

/**
 * Shared per-tick movement skeleton for any entity walking a NavGrid path:
 * on a failed path, record a stuck-failure and report whether this tick is the
 * falling edge into stuck; on a found path, reset stuck-tracking and advance
 * the entity along the waypoints one tick's worth via AgentMovement.advanceAgent.
 *
 * Callers own everything path-independent: computing/synthesizing `path`,
 * any pre-move checks (e.g. vehicle-occupancy on the next cell), writing the
 * returned position/stuck fields back onto their entity, snapping to the exact
 * destination and clearing it on isPathComplete, and entity-specific side
 * effects (vehicle waitingTicks/state, employee morale penalty).
 */
export function advanceAlongPath(input: AdvanceAlongPathInput): AdvanceAlongPathOutcome {
  const stuckInput: AgentState = {
    x: input.x,
    z: input.z,
    waypoints: [],
    waypointIndex: 0,
    walkSpeed: input.walkSpeed,
    destinationX: input.destinationX,
    destinationZ: input.destinationZ,
    consecutiveFailures: input.consecutiveFailures,
    isStuck: input.isStuck,
  };

  if (!input.path.found) {
    const wasStuck = input.isStuck;
    const next = recordStuckFailure(stuckInput);
    return {
      pathFound: false,
      x: input.x,
      z: input.z,
      consecutiveFailures: next.consecutiveFailures,
      isStuck: next.isStuck,
      becameStuck: next.isStuck && !wasStuck,
      isPathComplete: false,
    };
  }

  const reset = resetStuckState(stuckInput);
  // Both of findPath's sources (the A* reconstruction and the direct-line
  // fallback) emit waypoints[0] as the agent's own (floor-rounded) starting
  // cell — every path is a fresh from-here-to-there route recomputed each
  // tick, so index 0 is never a real step to walk toward. Left at index 0,
  // advanceAgent spends part of every tick's movement budget snapping the
  // agent's continuous position onto that rounded echo of itself before
  // making real progress — usually just a wasted fraction of a step, but
  // near a bench/ramp boundary where the "correct" next hop flips depending
  // on which side of an integer cell the agent is floored into, that wasted
  // snap-back is enough to drag the agent back across the boundary every
  // tick, producing a stable two-tick walk-forward/walk-back oscillation
  // that never reaches the destination (found via a #458 T6.1 regression:
  // resized levels carry more natural terrain relief, putting agents near a
  // ramp far more often than the old, flatter levels did).
  const startIndex = firstUnwalkedWaypoint(input.x, input.z, input.path.waypoints, input.navGrid ?? null);
  const advance = advanceAgent({
    x: input.x,
    z: input.z,
    waypoints: input.path.waypoints,
    waypointIndex: startIndex,
    walkSpeed: input.walkSpeed,
    destinationX: input.destinationX,
    destinationZ: input.destinationZ,
    consecutiveFailures: reset.consecutiveFailures,
    isStuck: reset.isStuck,
  });

  return {
    pathFound: true,
    x: advance.x,
    z: advance.z,
    consecutiveFailures: reset.consecutiveFailures,
    isStuck: reset.isStuck,
    becameStuck: false,
    isPathComplete: advance.isPathComplete,
  };
}

/**
 * Index of the first waypoint the agent has not effectively walked already.
 *
 * Index 0 is the agent's own floor-rounded cell (see the note in
 * `advanceAlongPath`), so 1 is the normal answer. Index 1 has to be skipped
 * too whenever the route's first hop is a *detour backwards*: with a climb
 * limit in force (#953), the legal way out of a cell often starts by stepping
 * to a neighbour the agent has already passed, because the direct
 * continuation is a face too tall to climb. An agent standing between the two
 * cells floors into the one it just left, is handed a route whose first hop
 * points back the way it came, walks back, floors into the other cell, and
 * gets the mirror image next tick — the same stable two-tick oscillation
 * #458 D14 documents for ramps, reached through the climb gate instead.
 * Reproduced on `sandbox-mode`: a drill rig bouncing between (11,10) and
 * (10,11) for the whole scenario, one hole drilled out of four.
 *
 * Two conditions both have to hold before waypoint 1 is skipped, and each
 * one rules out a way of making things worse:
 *
 * - The agent must be at least as close to waypoint 2 as waypoint 1 is —
 *   i.e. it has effectively arrived at waypoint 1 already. A wider "nearest
 *   waypoint anywhere on the path" rule would cut corners across terrain the
 *   route deliberately walks around, which on a crater rim means stepping
 *   off the wall this gate exists to make impassable.
 * - The hop from the cell the agent is actually standing in (nearest cell,
 *   not floored — flooring is what misplaces it in the first place) to
 *   waypoint 2 must itself be passable and climb-legal. Without this the
 *   skip invents a step A* rejected: the route (11,12) → (11,13) → (12,12)
 *   descends and re-ascends precisely because (11,12) → (12,12) is a
 *   three-voxel face, and skipping the stepping stone walks the agent
 *   straight at it, trading one oscillation for another.
 */
function firstUnwalkedWaypoint(
  x: number,
  z: number,
  waypoints: Array<{ x: number; z: number }>,
  navGrid: NavGrid | null,
): number {
  if (waypoints.length <= 1) return 0;
  if (waypoints.length === 2 || !navGrid) return 1;

  const next = waypoints[1]!;
  const afterNext = waypoints[2]!;
  const agentToAfterNext = (x - afterNext.x) ** 2 + (z - afterNext.z) ** 2;
  const nextToAfterNext = (next.x - afterNext.x) ** 2 + (next.z - afterNext.z) ** 2;
  if (agentToAfterNext > nextToAfterNext) return 1;

  const target = navGrid.cellAt(afterNext.x, afterNext.z);
  if (!target || target.type === 'blocked' || target.type === 'void') return 1;
  const standing = navGrid.cellAt(navGrid.clampX(x), navGrid.clampZ(z));
  return isStepClimbable(standing?.surfaceY, target.surfaceY, NAV_MAX_CLIMB_HEIGHT) ? 2 : 1;
}
