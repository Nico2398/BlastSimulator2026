// BlastSimulator2026 — AgentAdvance: shared find-path/stuck-tracking/advance skeleton
// Factored out of EntityMovementTick.ts's tickVehicleOnNavGrid and tickEmployeeMovement
// (#407 review round 2), which ran the identical stuck-detection + per-tick-advance
// sequence end to end, differing only in field names and caller-specific bookkeeping
// (vehicle occupancy pre-check, employee morale penalty).

import { advanceAgent, recordStuckFailure, resetStuckState, type AgentState } from './AgentMovement.js';

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
  const startIndex = input.path.waypoints.length > 1 ? 1 : 0;
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
