// BlastSimulator2026 — AgentMovement: per-tick agent position advancement along a path
// Part of the navmesh system.

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
  pathComplete: boolean;
}

/**
 * Advance an agent toward the next waypoint for a single tick.
 *
 * @param state - The agent's current navigation state.
 * @returns The updated position and path-progress information.
 */
export function advanceAgent(state: AgentState): AdvanceResult {
  // TODO: implement
  return { x: state.x, z: state.z, waypointIndex: state.waypointIndex, pathComplete: true };
}
