// BlastSimulator2026 — AgentMovement: per-tick agent position advancement along a path
// Part of the navmesh system.

import type { NavGrid } from './NavGrid.js';

/** Number of consecutive failed re-route attempts before the agent transitions to stuck state. */
export const STUCK_THRESHOLD = 3;

/** Event ID emitted when an agent becomes stuck. */
export const AGENT_STUCK_EVENT_ID = 'agent_stuck';

/**
 * The current navigation state of an agent walking along a path.
 * Tracks position, waypoint list, progress index, and base walk speed.
 */
export interface AgentState {
  /** Current world x-coordinate (grid cells). */
  x: number;
  /** Current world z-coordinate (grid cells). */
  z: number;
  /** Ordered list of waypoints the agent must traverse. */
  waypoints: Array<{ x: number; z: number }>;
  /** Index into `waypoints` pointing to the next target waypoint. */
  waypointIndex: number;
  /** Agent walking speed in grid cells per tick. */
  walkSpeed: number;
  /** The ultimate destination x-coordinate. */
  destinationX: number;
  /** The ultimate destination z-coordinate. */
  destinationZ: number;
  /** Number of consecutive failed re-route attempts. */
  consecutiveFailures: number;
  /** True when consecutiveFailures >= STUCK_THRESHOLD. */
  isStuck: boolean;
}

/**
 * The result of advancing an agent along its path for one tick.
 */
export interface AdvanceResult {
  /** New x-coordinate after movement. */
  x: number;
  /** New z-coordinate after movement. */
  z: number;
  /** Updated waypoint index (may have advanced past one or more waypoints). */
  waypointIndex: number;
  /** Whether the agent has reached the final waypoint this tick. */
  isPathComplete: boolean;
}

/**
 * The result of checking whether an agent's current path is stale
 * due to obstacles or changed regions.
 */
export interface StaleCheckResult {
  isStale: boolean;
  reason?: 'BLOCKED_WAYPOINT' | 'CROSSES_UPDATED_REGION';
}

/**
 * Full stuck-state snapshot for an agent.
 */
export interface StuckResult {
  consecutiveFailures: number;
  isStuck: boolean;
}

/**
 * Advance an agent toward the next waypoint for a single tick.
 *
 * @param state - The agent's current navigation state.
 * @returns The updated position and path-progress information.
 */
export function advanceAgent(state: AgentState): AdvanceResult {
  // Guard: NaN/infinite coordinates → bail out as path complete (defense-in-depth)
  if (!Number.isFinite(state.x) || !Number.isFinite(state.z)) {
    return { x: state.x, z: state.z, waypointIndex: state.waypointIndex, isPathComplete: true };
  }

  // Guard: NaN walkSpeed → treat as 0 (no movement)
  if (!Number.isFinite(state.walkSpeed)) {
    return { x: state.x, z: state.z, waypointIndex: state.waypointIndex, isPathComplete: false };
  }

  // Guard: no waypoints or already past the end → path complete
  if (state.waypoints.length === 0 || state.waypointIndex >= state.waypoints.length) {
    return { x: state.x, z: state.z, waypointIndex: state.waypointIndex, isPathComplete: true };
  }

  // Clamp walk speed to non-negative
  const speed = Math.max(0, state.walkSpeed);
  let remaining = speed;

  // If speed is zero, return current position with appropriate isPathComplete
  if (remaining === 0) {
    return {
      x: state.x,
      z: state.z,
      waypointIndex: state.waypointIndex,
      isPathComplete: state.waypointIndex >= state.waypoints.length,
    };
  }

  // Work with local copies to avoid mutating the input
  let x = state.x;
  let z = state.z;
  let waypointIndex = state.waypointIndex;

  while (remaining > 0 && waypointIndex < state.waypoints.length) {
    const target = state.waypoints[waypointIndex]!;
    const dx = target.x - x;
    const dz = target.z - z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist <= remaining) {
      // Snap to target
      x = target.x;
      z = target.z;
      remaining -= dist;
      waypointIndex++;
    } else {
      // Move fractionally toward target
      x += (dx / dist) * remaining;
      z += (dz / dist) * remaining;
      remaining = 0;
    }
  }

  return {
    x,
    z,
    waypointIndex,
    isPathComplete: waypointIndex >= state.waypoints.length,
  };
}

/**
 * Iterate over remaining waypoints and return true if any satisfy the predicate.
 * Returns false if no waypoints remain or the path is already complete.
 */
function someRemainingWaypoint(
  state: AgentState,
  predicate: (wp: { x: number; z: number }) => boolean,
): boolean {
  if (state.waypoints.length === 0 || state.waypointIndex >= state.waypoints.length) {
    return false;
  }
  for (let i = state.waypointIndex; i < state.waypoints.length; i++) {
    const wp = state.waypoints[i]!;
    if (predicate(wp)) return true;
  }
  return false;
}

/**
 * Check whether the next waypoint or any subsequent waypoint is blocked
 * by an obstacle (vehicle or terrain change) on the NavGrid.
 *
 * @param state - The agent's current navigation state.
 * @param grid  - The navigation grid to check against.
 * @param avoidVehicles - Whether to treat vehicle-occupied cells as blocked.
 * @returns `true` if any remaining waypoint is blocked.
 */
export function isPathBlocked(state: AgentState, grid: NavGrid, avoidVehicles: boolean): boolean {
  return someRemainingWaypoint(state, (wp) => {
    const clampedX = Math.max(0, Math.min(grid.width - 1, Math.floor(wp.x)));
    const clampedZ = Math.max(0, Math.min(grid.height - 1, Math.floor(wp.z)));
    const cell = grid.cells[clampedZ]![clampedX]!;

    if (cell.type === 'blocked' || cell.type === 'void') {
      return true;
    }
    if (avoidVehicles && cell.vehicleOccupied) {
      return true;
    }
    return false;
  });
}

/**
 * Check whether any remaining waypoint in the agent's path falls within
 * the specified axis-aligned region (point-in-AABB test).
 *
 * If waypoints are dense (adjacent cells), this approximates segment
 * intersection. For sparse waypoints, a segment may cross the region
 * without any waypoint inside it — callers should ensure waypoint density
 * or use a separate segment-intersection test if needed.
 *
 * @param state  - The agent's current navigation state.
 * @param region - The axis-aligned bounding box to test against.
 * @returns `true` if any remaining waypoint lies inside the region.
 */
export function doesPathCrossRegion(
  state: AgentState,
  region: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  // Guard: NaN/infinite region bounds → conservative (assume crossing)
  if (!Number.isFinite(region.minX) || !Number.isFinite(region.maxX) ||
      !Number.isFinite(region.minZ) || !Number.isFinite(region.maxZ)) {
    return true;
  }

  if (region.minX > region.maxX || region.minZ > region.maxZ) {
    return false;
  }

  return someRemainingWaypoint(state, (wp) =>
    wp.x >= region.minX && wp.x <= region.maxX && wp.z >= region.minZ && wp.z <= region.maxZ,
  );
}

/**
 * Request a re-route by clearing the current waypoint list and resetting
 * the agent's state so a new path can be computed.
 *
 * @param state - The agent's current navigation state.
 * @returns A new `AgentState` with cleared waypoints ready for re-routing.
 */
export function requestReRoute(state: AgentState): AgentState {
  return {
    x: state.x,
    z: state.z,
    waypoints: [],
    waypointIndex: 0,
    walkSpeed: state.walkSpeed,
    destinationX: state.destinationX,
    destinationZ: state.destinationZ,
    consecutiveFailures: state.consecutiveFailures,
    isStuck: state.isStuck,
  };
}

/**
 * Record a failed re-route attempt for an agent.
 * Increments consecutiveFailures and sets isStuck if threshold is reached.
 *
 * @param state - The agent's current navigation state.
 * @returns A new `AgentState` with updated stuck-tracker fields.
 */
export function recordStuckFailure(state: AgentState): AgentState {
  const base = (Number.isNaN(state.consecutiveFailures) || state.consecutiveFailures < 0)
    ? 0
    : state.consecutiveFailures;
  const newFailures = base + 1;
  return {
    ...state,
    consecutiveFailures: newFailures,
    isStuck: newFailures >= STUCK_THRESHOLD || state.isStuck,
  };
}

/**
 * Reset the stuck-tracker fields on an agent state.
 *
 * @param state - The agent's current navigation state.
 * @returns A new `AgentState` with consecutiveFailures=0 and isStuck=false.
 */
export function resetStuckState(state: AgentState): AgentState {
  return {
    ...state,
    consecutiveFailures: 0,
    isStuck: false,
  };
}

/**
 * Check whether the agent is currently in a stuck state.
 *
 * @param state - The agent's current navigation state.
 * @returns `true` if the agent is stuck.
 */
export function isAgentStuck(state: AgentState): boolean {
  return !!state.isStuck;
}

/**
 * Get the full stuck-state snapshot for an agent.
 *
 * @param state - The agent's current navigation state.
 * @returns A `StuckResult` with consecutiveFailures and isStuck.
 */
export function getStuckState(state: AgentState): StuckResult {
  return {
    consecutiveFailures: state.consecutiveFailures,
    isStuck: !!state.isStuck,
  };
}
