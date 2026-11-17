// BlastSimulator2026 — Vehicle seat anchors
// Where each seat of a vehicle model sits, in the vehicle group's local space,
// so a seated figure can be drawn per occupant (#2319).

import type { VehicleRole, VehicleTier } from '../core/entities/Vehicle.js';

/** A seat position in the vehicle group's local space (model units). */
interface SeatAnchor {
  x: number;
  y: number;
  z: number;
}

/** Underside of the shuttle benches' cushions (m, model space); the cushion spans 0.52-0.64. */
const SHUTTLE_SEAT_Y = 0.52;
/** Seat-surface height of the race car's bucket seat (m, model space). */
const RACE_CAR_SEAT_Y = 0.55;

// Model space is the glTF export of the Blender build: X forward, Y up, Z = -Blender Y.
// Seat positions mirror vehicles_t1.py (`build_travel_shuttle`) and vehicles.py (`build_travel_race_car`).
const SHUTTLE_SEATS: readonly SeatAnchor[] = [
  { x: 0.4, y: SHUTTLE_SEAT_Y, z: -0.28 },
  { x: 0.4, y: SHUTTLE_SEAT_Y, z: 0.28 },
  { x: -0.15, y: SHUTTLE_SEAT_Y, z: -0.28 },
  { x: -0.15, y: SHUTTLE_SEAT_Y, z: 0.28 },
  { x: -0.7, y: SHUTTLE_SEAT_Y, z: -0.28 },
  { x: -0.7, y: SHUTTLE_SEAT_Y, z: 0.28 },
];
const RACE_CAR_SEATS: readonly SeatAnchor[] = [{ x: -0.05, y: RACE_CAR_SEAT_Y, z: 0 }];

/** Seat anchors of a vehicle model, index 0 the driver's; empty when the model draws no seats. */
export function vehicleSeatAnchors(role: VehicleRole, tier: VehicleTier): readonly SeatAnchor[] {
  if (role !== 'travel_vehicle') return [];
  if (tier === 1) return SHUTTLE_SEATS;
  return tier === 2 ? RACE_CAR_SEATS : [];
}
