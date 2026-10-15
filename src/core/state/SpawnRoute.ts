// BlastSimulator2026 — Spawn route checks
// How far a freshly placed agent would really walk to the middle of its site,
// against a straight line. Shared by the starting-crew layout and the rally
// point choice, which must both refuse a spawn walled off behind a slope.

import type { NavGrid } from '../nav/NavGrid.js';
import { findPath, type PathResult } from '../nav/Pathfinding.js';
import { CREW_SPAWN_MAX_ROUTE_INFLATION } from '../config/balance.js';

interface Cell { x: number; z: number }

/**
 * Slack added to the route-length allowance, in waypoints. A crew standing a
 * few metres from the site centre has a straight-line reference near zero,
 * where any ratio at all reads as catastrophic inflation; this keeps the test
 * about long detours, which is what it is for.
 */
const ROUTE_ALLOWANCE_SLACK = 8;

/**
 * How far the crew would actually walk from `from` to the middle of the site,
 * in waypoints, against how far it is in a straight line. 1.0 is open ground.
 * `Infinity` means no route at all.
 *
 * This, not a reachability percentage, is the measure that matters under a
 * slope limit: on desert seed 10 every cell of the site was climb-reachable
 * from the spawn corner and the crew still could not work, because the routes
 * out of that corner ran 2.78x long on average and 14x at worst.
 */
export function routeInflation(
  navGrid: NavGrid,
  from: Cell,
  centre: Cell,
  metric: (r: PathResult) => number = r => r.waypoints.length,
): number {
  const straight = Math.hypot(centre.x - from.x, centre.z - from.z);
  if (straight < 1) return 1;
  const route = findPath(navGrid, {
    agentId: 0,
    fromX: from.x, fromZ: from.z,
    toX: centre.x, toZ: centre.z,
    avoidVehicles: false,
  });
  if (!route.found) return Number.POSITIVE_INFINITY;
  return metric(route) / straight;
}

/** Whether the route from `from` to `centre` is no detour: within `maxInflation` (plus slack) of a straight line. */
export function isRouteAcceptable(
  navGrid: NavGrid,
  from: Cell,
  centre: Cell,
  maxInflation = CREW_SPAWN_MAX_ROUTE_INFLATION,
  slack = ROUTE_ALLOWANCE_SLACK,
  metric: (r: PathResult) => number = r => r.waypoints.length,
): boolean {
  const straight = Math.hypot(centre.x - from.x, centre.z - from.z);
  if (straight < 1e-9) return true; // same-cell / zero distance: trivially acceptable
  const allowance = maxInflation + slack / straight;
  return routeInflation(navGrid, from, centre, metric) <= allowance;
}

