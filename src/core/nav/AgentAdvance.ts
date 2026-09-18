// BlastSimulator2026 — AgentAdvance: shared find-path/stuck-tracking/advance skeleton
// Factored out of EntityMovementTick.ts's tickVehicleOnNavGrid and tickEmployeeMovement
// (#407 review round 2), which ran the identical stuck-detection + per-tick-advance
// sequence end to end, differing only in field names and caller-specific bookkeeping
// (vehicle occupancy pre-check, employee morale penalty).

import { advanceAgent, recordStuckFailure, resetStuckState, type AgentState } from './AgentMovement.js';
import { isStepClimbable, type NavGrid } from './NavGrid.js';
import { isImpassable } from './Pathfinding.js';
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
  /**
   * The in-flight waypoint/cost baseline carried across ticks (#1129) — see
   * `RouteCommitment`. Optional so callers/fixtures predating the guard (no
   * commitment to carry yet) keep compiling unchanged; defaults to
   * `NULL_ROUTE_COMMITMENT`, which always adopts the fresh replan's own
   * target — identical to pre-#1129 behaviour.
   */
  committed?: RouteCommitment;
  /** Whether the fresh replan this tick avoids vehicle-occupied cells — used by the route-commitment guard to re-resolve a waypoint on the same terms the fresh path was found under. */
  avoidVehicles?: boolean;
  /**
   * Mover's own position 2 ticks back, threaded like `committed`. Null when
   * fewer than 2 ticks of history exist yet.
   */
  moveHistoryX?: number | null;
  moveHistoryZ?: number | null;
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
  /**
   * This tick's pre-move position, becomes moveHistoryX/Z two ticks from now.
   * Shift-register invariant: at start of tick n, moveHistoryX/Z == P(n-2),
   * input.x/z == P(n-1).
   */
  moveHistoryX: number | null;
  moveHistoryZ: number | null;
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
  /**
   * The position the agent was walking from when `waypointX`/`waypointZ` was
   * set (#1129). Used only to recognise a fresh replan's immediate target
   * retracing the very hop that produced the current (now possibly exhausted)
   * commitment — the oscillation's exact signature: two differently-shaped,
   * cost-tied routes from points a tick's movement apart, one pointing back
   * at the other's start. Optional so a fixture/caller built before this
   * field existed keeps compiling and behaves exactly as before (no `from`
   * position on record means the retrace check never fires).
   */
  fromX?: number | null;
  fromZ?: number | null;
}

/** The empty commitment — no in-flight waypoint yet. Default for a fresh journey/leg. */
export const NULL_ROUTE_COMMITMENT: RouteCommitment = {
  waypointX: null, waypointZ: null, destX: null, destZ: null, remainingCost: null,
  fromX: null, fromZ: null,
};

// Tie tolerance for preferring the committed in-flight waypoint over a fresh
// replan's target (#1129), mirroring RAMP_TIE_EPSILON's precedent in
// Pathfinding.ts: two routes within this cost band are treated as equal, so
// the already-committed waypoint wins instead of flapping between them. 1.0
// (one full move-cost unit — MIN_WALKABLE_COST in Pathfinding.ts) covers the
// issue's own repro (route B's cost = route A's cost minus about one tick's
// walk distance) while still yielding to a fresh route that is genuinely a
// cell or more shorter — a real reroute, not just a differently-shaped
// equal-cost alternative from a start point that drifted a sub-cell fraction.
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
      // A failed replan leaves whatever commitment was already in flight
      // untouched — nothing moved this tick, so there is nothing to roll
      // forward or decay.
      committed: input.committed ?? NULL_ROUTE_COMMITMENT,
      // Shift-register: this tick's own pre-move position becomes
      // moveHistoryX/Z two ticks from now.
      moveHistoryX: input.x,
      moveHistoryZ: input.z,
    };
  }

  // One tick's movement budget is spent hop by hop rather than in one
  // advanceAgent call over the whole fresh path (#1129): each hop re-resolves
  // its own target against the in-flight commitment — protecting against the
  // oscillation `RouteCommitment` documents — and, once that hop is fully
  // walked with budget still left over, loops to resolve the next one. A
  // single guarded call spanning the whole tick would otherwise either adopt
  // the fresh path uncritically (losing the guard on a multi-hop tick) or cap
  // movement at one hop regardless of leftover budget (stalling a fast agent
  // for ticks at a time whenever the guard's very first hop happens to be
  // short — confirmed live via #1088's itinerary/simulation equivalence
  // suite, which measured a drill_rig taking 3+ ticks longer than planned
  // before this loop existed).
  let x = input.x;
  let z = input.z;
  let remaining = Number.isFinite(input.walkSpeed) ? Math.max(0, input.walkSpeed) : 0;
  let committed = input.committed ?? NULL_ROUTE_COMMITMENT;
  let isPathComplete = false;

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
  //
  // Computed once, from the tick-START position — not re-derived per hop.
  // `firstUnwalkedWaypoint` is a geometry heuristic with no memory of its own
  // (unlike `advanceAgent`'s plain incrementing waypointIndex), so re-running
  // it from an interior hop's post-move position can hand back the very same
  // index the agent just departed, stalling the loop in place instead of
  // progressing through the fresh path's later waypoints.
  let pathIndex = firstUnwalkedWaypoint(input.x, input.z, input.path.waypoints, input.navGrid ?? null);

  // Bounded by one iteration per waypoint the fresh path holds (+1 for the
  // synthetic single-hop case) — cannot loop unboundedly since each iteration
  // either exhausts `remaining` or fully consumes one hop's distance.
  const maxHops = input.path.waypoints.length + 1;
  for (let hop = 0; hop < maxHops && remaining > 0 && !isPathComplete; hop++) {
    const freshTarget = input.path.waypoints[pathIndex] ?? input.path.waypoints[input.path.waypoints.length - 1]!;

    const resolved = resolveTargetWaypoint(
      x, z,
      freshTarget, input.path.totalCost,
      input.destinationX, input.destinationZ,
      committed,
      input.navGrid ?? null,
      input.avoidVehicles ?? false,
    );

    // Only a hop that actually consumes the fresh path's own next waypoint
    // advances the cursor into it — a "kept" hop toward the carried
    // commitment instead leaves `pathIndex` pointing at the same fresh
    // waypoint so a later hop (once the agent reaches the commitment and the
    // guard adopts fresh again) still compares against it correctly.
    const adoptedFresh = resolved.target.x === freshTarget.x && resolved.target.z === freshTarget.z;

    const hopTarget = resolved.target;
    const beforeX = x;
    const beforeZ = z;
    const hopAdvance = advanceAgent({
      x, z,
      waypoints: [hopTarget],
      waypointIndex: 0,
      walkSpeed: remaining,
      destinationX: input.destinationX,
      destinationZ: input.destinationZ,
      consecutiveFailures: 0,
      isStuck: false,
    });

    x = hopAdvance.x;
    z = hopAdvance.z;
    const walked = Math.hypot(x - beforeX, z - beforeZ);
    remaining = Math.max(0, remaining - walked);

    // hopAdvance.isPathComplete here means only "reached hopTarget" (a
    // single-waypoint list is all advanceAgent was given) — true "reached
    // the leg's own destination" only when that hop's target IS it, OR when
    // it's the fresh path's own last waypoint and there is no more path left
    // to walk. The second arm matters when `destinationX/Z` sits outside the
    // NavGrid (findPath's own silent clamp — Pathfinding.ts's `clampToGrid`):
    // the route's last waypoint then falls short of the exact destination
    // coordinates forever, so an exact-match-only test would leave the agent
    // parked one cell short with a route to nowhere further to walk, never
    // arriving — matching the pre-#1129 single-call advanceAgent, whose
    // completion test was index-based (walked past the last given waypoint)
    // and so never depended on hitting the exact destination value either.
    const reachedHop = hopAdvance.isPathComplete;
    const lastWaypoint = input.path.waypoints[input.path.waypoints.length - 1];
    const exhaustedFreshPath = !!lastWaypoint && hopTarget.x === lastWaypoint.x && hopTarget.z === lastWaypoint.z;
    const legComplete = reachedHop
      && (hopTarget.x === input.destinationX && hopTarget.z === input.destinationZ || exhaustedFreshPath);

    if (legComplete) {
      committed = NULL_ROUTE_COMMITMENT;
      isPathComplete = true;
      break;
    }

    // Decay the cost baseline this commitment was chosen/kept under by the
    // distance actually walked this hop, never below 0 — a route that is
    // honestly still improving, just not by more than the tie epsilon, must
    // keep losing ground against a genuinely shorter fresh route a few hops
    // later rather than being protected forever at its original cost. Only a
    // hop that fully lands on its target (`reachedHop`) corresponds to a real
    // graph edge whose cost `walked`'s Euclidean distance actually
    // approximates — a partial hop hasn't finished crossing that edge, and
    // the route's total A* cost can differ arbitrarily from raw distance
    // (cost and distance are different units in general), so decaying by a
    // partial `walked` would subtract a distance from a cost baseline with
    // nothing grounding the two as comparable.
    const baseline = adoptedFresh ? (input.path.totalCost ?? null) : resolved.committed.remainingCost;
    const decay = reachedHop ? walked : 0;
    const remainingCost = baseline === null ? null : Math.max(0, baseline - decay);

    committed = {
      waypointX: hopTarget.x,
      waypointZ: hopTarget.z,
      destX: input.destinationX,
      destZ: input.destinationZ,
      remainingCost,
      // Where THIS hop actually started from — not whatever `resolved.committed`
      // itself carried, so a future tick's retrace check always compares
      // against the true immediately-preceding position (#1129).
      fromX: beforeX,
      fromZ: beforeZ,
    };

    // Budget ran out mid-hop (partial move) — nothing left to spend on a
    // further hop this tick.
    if (!reachedHop) break;

    if (adoptedFresh) pathIndex = Math.min(pathIndex + 1, input.path.waypoints.length - 1);
  }

  // A leg that completes this tick is always genuine progress, regardless of
  // the move-history comparison below. Otherwise, an exact match against the
  // position 2 ticks back (with 2 ticks of history actually on record) is a
  // period-2 oscillation, not progress — route it through the same
  // failure-accumulation path the !path.found branch above uses, so isStuck
  // still flips true once STUCK_THRESHOLD is exceeded, while pathFound stays
  // true (a route genuinely was found and walked this tick).
  const wasStuck = input.isStuck;
  const isOscillation = !isPathComplete
    && input.moveHistoryX != null && input.moveHistoryZ != null
    && x === input.moveHistoryX && z === input.moveHistoryZ;
  const stuckOutcome = isOscillation ? recordStuckFailure(stuckInput) : resetStuckState(stuckInput);

  return {
    pathFound: true,
    x,
    z,
    consecutiveFailures: stuckOutcome.consecutiveFailures,
    isStuck: stuckOutcome.isStuck,
    becameStuck: isOscillation && stuckOutcome.isStuck && !wasStuck,
    isPathComplete,
    committed,
    // Shift-register: this tick's own pre-move position becomes
    // moveHistoryX/Z two ticks from now.
    moveHistoryX: input.x,
    moveHistoryZ: input.z,
  };
}

/**
 * Resolves this tick's actual walk target from the fresh replan's target
 * against any in-flight commitment (#1129): keeps the agent committed to an
 * already-in-progress waypoint unless the fresh route is clearly better by
 * more than `ROUTE_COMMIT_TIE_EPSILON`, breaking the oscillation described on
 * `RouteCommitment`. Returns the resolved walk target plus the commitment to
 * write back onto the entity for next tick.
 */
function resolveTargetWaypoint(
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
  const adoptFresh = (): { target: { x: number; z: number }; committed: RouteCommitment } => ({
    target: freshTarget,
    committed: {
      waypointX: freshTarget.x,
      waypointZ: freshTarget.z,
      destX: destinationX,
      destZ: destinationZ,
      remainingCost: freshCost ?? null,
    },
  });

  // No active commitment yet, or a previous tick adopted one with no cost
  // baseline to protect (no-navgrid mode) — nothing to compare against.
  if (committed.waypointX === null || committed.waypointZ === null || committed.remainingCost === null) {
    return adoptFresh();
  }

  // Stale commitment from a previous leg — the destination moved out from
  // under it.
  if (committed.destX !== destinationX || committed.destZ !== destinationZ) {
    return adoptFresh();
  }

  // Arrived at (or, since advanceAgent only ever snaps exactly onto a single
  // committed waypoint, never overshoots) the committed waypoint — same
  // exact-cell arrival test this file's own leg/destination checks already
  // use (Locomotion.ts's isLegArrived, advanceLegacyFootWalk's x===destX).
  // Checked here but acted on below the obstacle/cost checks: arrival alone
  // isn't sufficient to trust a fresh replan unconditionally (see below).
  const arrived = x === committed.waypointX && z === committed.waypointZ;

  // The committed waypoint is no longer a real step from here — a genuine
  // obstacle (blast, new building, vehicle) must be reacted to immediately,
  // never held stale by this guard. Reuses this file's own climb check and
  // Pathfinding's own impassability check rather than inventing new ones.
  if (navGrid) {
    const targetCell = navGrid.cellAt(navGrid.clampX(Math.floor(committed.waypointX)), navGrid.clampZ(Math.floor(committed.waypointZ)));
    const standingCell = navGrid.cellAt(navGrid.clampX(Math.floor(x)), navGrid.clampZ(Math.floor(z)));
    const blocked = !targetCell || isImpassable(targetCell, avoidVehicles, false);
    const climbLegal = !!standingCell && !!targetCell
      && isStepClimbable(standingCell.climbY, targetCell.climbY, NAV_MAX_CLIMB_HEIGHT);
    if (blocked || !climbLegal) return adoptFresh();
  }

  // No navgrid cost to compare against — nothing to protect the commitment
  // against oscillation with.
  if (freshCost === undefined) return adoptFresh();

  // Fresh route is a real reroute, not just a differently-shaped alternative
  // of about the same cost.
  const clearlyBetter = freshCost < committed.remainingCost - ROUTE_COMMIT_TIE_EPSILON;
  if (clearlyBetter) {
    return adoptFresh();
  }

  if (arrived) {
    // The committed waypoint is fully consumed — there is no more of the old
    // route left to protect, so "hold the line" toward it (below) would
    // target the agent's own current position and go nowhere forever.
    // Ordinarily that's fine: a fresh replan from the same spot the agent is
    // legitimately walking through is *expected* to look cost-tied with the
    // route already being followed, and trusting it (adoptFresh, below) is
    // just normal progress along the path. Only the narrow case where fresh's
    // own immediate target retraces the exact hop that produced this
    // commitment is the oscillation's signature (#1129): two cost-consistent,
    // differently-shaped routes from points a tick's movement apart, one
    // pointing back at the other's start. Trusting fresh there would walk
    // the agent right back where it came from, forever. Guard against that
    // one case only — walk straight at the leg's own destination for this
    // one hop instead, so next tick's replan, from a shifted position, gets
    // an unambiguous comparison to resolve the tie with.
    // A retrace is inherently a two-point signature — the fresh target must
    // point back at some *other* place the commitment came from. A hop that
    // moved zero distance (the agent already sitting exactly on both the
    // committed waypoint and the fresh path's own target — the ordinary
    // shape once the agent is parked at a route's dead end, e.g. the last
    // in-range cell before an out-of-grid destination) records fromX/fromZ
    // equal to waypointX/waypointZ itself. Left unguarded, that self-
    // referential "from" trivially matches a fresh target that is, every
    // tick, that same stationary cell — misfiring the retrace guard forever
    // and routing the agent in an unclamped straight line at the raw
    // destination instead of holding position, confirmed live via
    // needs-drain-visual's employee dispatch (150,150) on a 64x64 NavGrid:
    // pre-fix it walked straight off the grid for 65 extra ticks instead of
    // parking at the clamped edge cell.
    const isRetrace = committed.fromX != null && committed.fromZ != null
      && freshTarget.x === committed.fromX && freshTarget.z === committed.fromZ
      && (committed.fromX !== committed.waypointX || committed.fromZ !== committed.waypointZ);
    if (isRetrace) {
      return {
        target: { x: destinationX, z: destinationZ },
        committed: {
          waypointX: destinationX,
          waypointZ: destinationZ,
          destX: destinationX,
          destZ: destinationZ,
          remainingCost: freshCost,
        },
      };
    }
    return adoptFresh();
  }

  // Otherwise: hold the line. The caller decays remainingCost by this tick's
  // own walk distance once it knows how far the agent actually moved.
  return {
    target: { x: committed.waypointX, z: committed.waypointZ },
    committed,
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
  return isStepClimbable(standing?.climbY, target.climbY, NAV_MAX_CLIMB_HEIGHT) ? 2 : 1;
}
