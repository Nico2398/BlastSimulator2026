// BlastSimulator2026 — Vehicle seat anchors
// Where each seat of a vehicle model sits, in the vehicle group's local space,
// so a seated figure can be drawn per occupant (#2319).

import type { VehicleRole, VehicleTier } from '../core/entities/Vehicle.js';

/** A seat position in the vehicle group's local space (model units). */
export interface SeatAnchor {
  x: number;
  y: number;
  z: number;
}

/** Seat anchors of a vehicle model, index 0 the driver's; empty when the model draws no seats. */
export function vehicleSeatAnchors(_role: VehicleRole, _tier: VehicleTier): readonly SeatAnchor[] {
  throw new Error('not implemented');
}
