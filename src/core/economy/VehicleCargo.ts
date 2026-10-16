// BlastSimulator2026 — Ore composition of a vehicle's cargo (#1761)

import type { Vehicle } from '../entities/Vehicle.js';
import type { TrackedFragment } from './Logistics.js';

/** Cargo contents: kg per ore id, barren remainder, total and fragment count. */
export interface VehicleCargoBreakdown {
  byOre: Record<string, number>;
  barrenKg: number;
  totalKg: number;
  fragmentCount: number;
}

/** Ore breakdown of the fragments a vehicle carries. */
export function vehicleCargoByOre(vehicle: Pick<Vehicle, 'cargo'>, fragments: readonly TrackedFragment[]): VehicleCargoBreakdown {
  void vehicle; void fragments;
  // TODO: implement
  return { byOre: {}, barrenKg: 0, totalKg: 0, fragmentCount: 0 };
}
