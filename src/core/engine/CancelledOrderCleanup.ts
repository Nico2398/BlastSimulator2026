// BlastSimulator2026 — planned-order cleanup for a cancelled action (#1380)
//
// cancelAction (TaskCancellation.ts) is deliberately ignorant of mining- and
// building-specific state, so it can cancel any action type. The planned-pool
// entry an order reserved (planned hole, charge, ramp segment, building site)
// is bookkeeping owned here and has to be released whenever an order is
// cancelled — from the console's `employee cancel` and from the unqualified-task
// event's Cancel option alike (#554, #555, #556).

import type { GameState, PendingAction } from '../state/GameState.js';
import { getDefSize, getBuildingDef } from '../entities/Building.js';

/** Footprint a cancelled building order freed; the caller tells the nav grid. */
interface FreedFootprint {
  x: number;
  z: number;
  sizeX: number;
  sizeZ: number;
}

/**
 * Release the planned order a cancelled action reserved. Money is already
 * refunded by cancelAction; this clears the matching planned entry so the hole,
 * ramp segment or site can be ordered again. Returns the footprint freed by a
 * cancelled place_building order (blocked since order time, #1200), else null.
 */
export function releasePlannedOrderForCancelledAction(
  state: GameState,
  action: PendingAction,
): FreedFootprint | null {
  // A dig_ramp_segment keys off rampId/segmentIndex, not holeId.
  if (action.type === 'dig_ramp_segment') {
    const rampId = action.payload['rampId'];
    if (typeof rampId !== 'number') return null;
    const ramp = state.plannedRamps.find(r => r.id === rampId);
    if (!ramp) return null;

    const segmentIndex = action.payload['segmentIndex'];
    const idx = ramp.segments.findIndex(s => s.index === segmentIndex);
    if (idx !== -1) ramp.segments.splice(idx, 1);

    if (!ramp.segments.some(s => !s.done)) {
      const rampIdx = state.plannedRamps.findIndex(r => r.id === rampId);
      if (rampIdx !== -1) state.plannedRamps.splice(rampIdx, 1);
    }
    return null;
  }

  // A place_building order keys off buildingOrderId. cancelAction refunded the
  // full cost; this removes the PlannedBuilding so the site can be built on again.
  if (action.type === 'place_building') {
    const buildingOrderId = action.payload['buildingOrderId'];
    if (typeof buildingOrderId !== 'number') return null;
    const idx = state.plannedBuildings.findIndex(pb => pb.id === buildingOrderId);
    if (idx === -1) return null;
    const [order] = state.plannedBuildings.splice(idx, 1);
    const { sizeX, sizeZ } = getDefSize(getBuildingDef(order!.type, order!.tier));
    return { x: order!.x, z: order!.z, sizeX, sizeZ };
  }

  const holeId = action.payload['holeId'];
  if (typeof holeId !== 'string') return null;

  if (action.type === 'drill_hole') {
    const idx = state.plannedDrillHoles.findIndex(h => h.id === holeId);
    if (idx !== -1) state.plannedDrillHoles.splice(idx, 1);
  } else if (action.type === 'charge_hole') {
    delete state.plannedChargesByHole[holeId];
  }
  return null;
}
