// BlastSimulator2026 — Pathfinding: A* route finding over the NavGrid
// Part of the navmesh system.

import { NavGrid } from './NavGrid.js';

/**
 * Describes a pathfinding request from one grid cell to another.
 * Coordinates are in NavGrid cell space (x = column, z = row).
 */
export interface PathRequest {
  agentId: number;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  avoidVehicles: boolean;
}

/**
 * The result of a pathfinding attempt.
 * If `found` is false the `waypoints` array will be empty.
 */
export interface PathResult {
  found: boolean;
  waypoints: Array<{ x: number; z: number }>;
  totalCost: number;
}

/**
 * Find the shortest path from (fromX, fromZ) to (toX, toZ) on the given NavGrid.
 * Uses A* with 8-directional movement and octile heuristic.
 *
 * @param grid   - The navigation grid to pathfind across.
 * @param request - The pathfinding request parameters.
 * @returns A PathResult indicating whether a path was found and the resulting waypoints.
 */
export function findPath(grid: NavGrid, request: PathRequest): PathResult {
  // TODO: implement A* pathfinding
  void grid;
  void request;
  return { found: false, waypoints: [], totalCost: 0 };
}
