// BlastSimulator2026 — Navmesh-occupancy helpers shared across movement.
// Used to host every per-tick vehicle/employee movement stepper; that walk
// (findPath + AgentAdvance.advanceAlongPath, per-leg occupancy/stuck
// handling) is now owned end to end by Locomotion.ts (#1089), the only
// mover. What's left here is the occupancy-cache helper that outlives any
// one stepper: isDestinationOccupied (still read by ActionSelection.ts's
// claim-time reachability check).

import type { GameState } from '../state/GameState.js';
import { isCellOccupied } from '../nav/NavGrid.js';
import type { Vehicle } from '../entities/Vehicle.js';

/**
 * True when the NavCell at (x, z) is currently marked vehicle- or
 * fragment-occupied (#954). Used to decide, per walk, whether an employee's
 * own destination is a cell they must be able to stand on regardless of
 * occupancy — see Locomotion.ts's own avoidVehicles comment.
 *
 * Exported (#954 follow-up fix) so ActionSelection.ts's resolveActionCost can
 * apply the exact same occupied-destination exemption to its own claim-time
 * reachability check — see that call site's own comment for why the two must
 * agree.
 */
export function isDestinationOccupied(state: GameState, x: number, z: number): boolean {
  return isCellOccupied(state.navGrid?.cellAt(Math.round(x), Math.round(z)));
}

/**
 * Keeps NavCell.vehicleOccupied in sync with a vehicle's own current cell
 * (#954), independent of vehicle role — a single shared path so drill_rig,
 * debris_hauler, rock_fragmenter etc. all block foot pathfinding identically
 * rather than needing a per-role branch. Guarded on state.navGrid since some
 * ticks may run before a navgrid exists (e.g. tests constructing a bare
 * GameState). Called from Locomotion.ts, the only writer of a vehicle's x/z.
 */
export function updateVehicleCellOccupancy(
  state: GameState,
  vehicle: Vehicle,
  wasStationary: boolean,
  isStationaryNow: boolean,
  prevX: number,
  prevZ: number,
): void {
  if (!state.navGrid) return;
  const nextX = Math.round(vehicle.x);
  const nextZ = Math.round(vehicle.z);
  const cellChanged = nextX !== prevX || nextZ !== prevZ;

  if ((wasStationary && !isStationaryNow) || cellChanged) {
    const oldCell = state.navGrid.cellAt(prevX, prevZ);
    if (oldCell) oldCell.vehicleOccupied = false;
  }

  if (isStationaryNow) {
    const currentCell = state.navGrid.cellAt(nextX, nextZ);
    if (currentCell) currentCell.vehicleOccupied = true;
  }
}
