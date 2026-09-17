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
  /** Total A* cost of this route, when the source computed one (findPath/findExactPath do; the legacy direct-line synth does not). */
  totalCost?: number;
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
  /** The in-flight waypoint/cost baseline carried across ticks (#1129) — see `RouteCommitment`. */
  committed: RouteCommitment;
  /** Whether the fresh replan this tick avoids vehicle-occupied cells — used by the route-commitment guard to re-resolve a waypoint on the same terms the fresh path was found under. */
  avoidVehicles?: boolean;
}

interface AdvanceAlongPathOutcome {
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
  /** Updated route-commitment, to be written back onto the entity (#1129). */
  committed: RouteCommitment;
}

// ---------------------------------------------------------------------------
// Route commitment (#1129)
// ---------------------------------------------------------------------------

/**
 * The in-flight waypoint an agent has already committed to walking toward,
 * plus the cost baseline it was chosen under, carried across ticks. A fresh
 * replan every tick (`findExactPath`) can hand back a differently-shaped but
 * equal-cost route from a start point that shifted by a sub-cell fraction —
 * without this guard the agent abandons an in-flight hop and walks back to
 * where it started, oscillating forever (#1129). Null fields mean "no
 * commitment yet" — see `NULL_ROUTE_COMMITMENT`.
 */
export interface RouteCommitment {
  waypointX: number | null;
  waypointZ: number | null;
  destX: number | null;
  destZ: number | null;
  remainingCost: number | null;
}

/** The empty commitment — no in-flight waypoint yet. Default for a fresh journey/leg. */
export const NULL_ROUTE_COMMITMENT: RouteCommitment = {
  waypointX: null, waypointZ: null, destX: null, destZ: null, remainingCost: null,
};

// Tie tolerance for preferring the committed in-flight waypoint over a fresh
// replan's target (#1129), mirroring RAMP_TIE_EPSILON's precedent in
// Pathfinding.ts: two routes within this cost band are treated as equal, so
// the already-committed waypoint wins instead of flapping between them.
// Placeholder value — tuned by the implementer.
const ROUTE_COMMIT_TIE_EPSILON = 1.0;

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
      // TODO(#1129): a failed replan should not silently drop a live
      // commitment. Placeholder pass-through until implementer wires the
      // resolution logic in via resolveTargetWaypoint.
      committed: input.committed,
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
    // TODO(#1129): placeholder pass-through — implementer wires this up to
    // resolveTargetWaypoint's returned commitment.
    committed: input.committed,
  };
}

/**
 * Resolves this tick's actual walk target from the fresh replan's target
 * against any in-flight commitment (#1129): keeps the agent committed to an
 * already-in-progress waypoint unless the fresh route is clearly better by
 * more than `ROUTE_COMMIT_TIE_EPSILON`, breaking the oscillation described on
 * `RouteCommitment`. Returns the resolved walk target plus the commitment to
 * write back onto the entity for next tick.
 *
 * TODO(#1129): stub only — implementer fills in the guard logic. Exported
 * (rather than kept module-private, per plan) only so it type-checks as an
 * unused declaration under `noUnusedLocals` before `advanceAlongPath` calls
 * it — the implementer phase wires the call in and can drop the export if
 * the guard logic ends up module-private again.
 */
export function resolveTargetWaypoint(
  x: number,
  z: number,
  freshTarget: { x: number; z: number },
  freshCost: number | undefined,
  destinationX: number,
  destinationZ: number,
  committed: RouteCommitment,
  navGrid: NavGrid | null,
  avoidVehicles: boolean,
): { target: { x: number; z: number }; committed: RouteCommitment } {
  // Placeholder references so strict noUnusedParameters stays green until
  // the implementer fills in the guard logic (#1129).
  void [x, z, freshTarget, freshCost, destinationX, destinationZ, committed, navGrid, avoidVehicles, ROUTE_COMMIT_TIE_EPSILON];
  throw new Error('not implemented');
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
