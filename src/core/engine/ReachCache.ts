// BlastSimulator2026 — Climb labellings shared by the order pools and vehicle choice (#1306, #1603)
//
// One labelling of the nav grid into climb components per clearance and climb
// limit, kept per game state until the grid's revision moves. Order
// classification (OrderReachability.ts) answers every actor pool from it, and a
// claim picking which free vehicle to take (VehicleReservation.ts) asks it which
// vehicles can drive to the work at all.

import type { NavGrid } from '../nav/NavGrid.js';
import { isProgressionSite, type GameState } from '../state/GameState.js';
import { vehicleMaxSlopeRatio, type Vehicle } from '../entities/Vehicle.js';
import { computeClimbComponents, type ClimbComponents } from '../nav/NavGridReachability.js';
import { dockedFrom, withDockingCells } from '../nav/DockingReach.js';
import { NAV_CLEARANCE_VEHICLE_CELLS, NAV_MAX_SLOPE_RATIO } from '../config/balance.js';

/**
 * Derived reachability per game state, never serialized. Valid for one nav grid
 * at one `revision`: labellings ignore occupancy, so only a cell write
 * invalidates. One labelling per clearance and climb limit, built the first time a pool needs it.
 */
export interface ReachCache {
  navGrid: NavGrid;
  revision: number;
  components: Map<string, ClimbComponents>;
}

const reachCaches = new WeakMap<GameState, ReachCache>();

/** The cache for `state`'s current nav grid and revision; null with no nav grid. */
export function cacheFor(state: GameState): ReachCache | null {
  const navGrid = state.navGrid;
  if (navGrid === null) {
    reachCaches.delete(state);
    return null;
  }
  let cache = reachCaches.get(state);
  if (cache === undefined || cache.navGrid !== navGrid || cache.revision !== navGrid.revision) {
    cache = { navGrid, revision: navGrid.revision, components: new Map() };
    reachCaches.set(state, cache);
  }
  return cache;
}

/** The labelling for one clearance and climb limit, built on first use. */
export function componentsOf(cache: ReachCache, clearance: number, maxSlopeRatio: number = NAV_MAX_SLOPE_RATIO): ClimbComponents {
  const key = `${clearance}|${maxSlopeRatio}`;
  let components = cache.components.get(key);
  if (components === undefined) {
    components = computeClimbComponents(cache.navGrid, clearance, maxSlopeRatio);
    cache.components.set(key, components);
  }
  return components;
}

/**
 * Whether `vehicle` can drive to (x, z) on the site's one vehicle climb limit, counting the cells it docked from
 * and an approach cell beside a building the way order classification does. True with no nav grid (nothing to
 * weigh). A vehicle a shot left on a crater floor reaches only that floor (#2091).
 */
export function vehicleReachesCell(state: GameState, vehicle: Pick<Vehicle, 'x' | 'z'>, x: number, z: number): boolean {
  const cache = cacheFor(state);
  if (cache === null) return true;
  const ratio = vehicleMaxSlopeRatio(isProgressionSite(state));
  const reach = componentsOf(cache, NAV_CLEARANCE_VEHICLE_CELLS, ratio)
    .reachableFrom(dockedFrom(cache.navGrid, [vehicle], NAV_CLEARANCE_VEHICLE_CELLS, ratio));
  return withDockingCells(cache.navGrid, reach, NAV_CLEARANCE_VEHICLE_CELLS).has(x, z);
}
