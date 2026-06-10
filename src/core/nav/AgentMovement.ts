// BlastSimulator2026 — AgentMovement: per-tick agent position advancement along a path
// Part of the navmesh system.

import type { NavGrid } from './NavGrid.js';

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
 * Check whether the next waypoint or any subsequent waypoint is blocked
 * by an obstacle (vehicle or terrain change) on the NavGrid.
 *
 * @param state - The agent's current navigation state.
 * @param grid  - The navigation grid to check against.
 * @param avoidVehicles - Whether to treat vehicle-occupied cells as blocked.
 * @returns `true` if any remaining waypoint is blocked.
 */
export function isPathBlocked(state: AgentState, grid: NavGrid, avoidVehicles: boolean): boolean {
  // TODO: implement
  return false;
}

/**
 * Check whether any segment of the agent's remaining path crosses
 * a specified axis-aligned region (e.g., a recently updated blast area).
 *
 * @param state  - The agent's current navigation state.
 * @param region - The axis-aligned bounding box to test against.
 * @returns `true` if the remaining path intersects the region.
 */
export function doesPathCrossRegion(
  state: AgentState,
  region: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  // TODO: implement
  return false;
}

/**
 * Request a re-route by clearing the current waypoint list and resetting
 * the agent's state so a new path can be computed.
 *
 * @param state - The agent's current navigation state.
 * @returns A new `AgentState` with cleared waypoints ready for re-routing.
 */
export function requestReRoute(state: AgentState): AgentState {
  // TODO: implement
  return state;
}
