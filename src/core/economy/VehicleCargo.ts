// BlastSimulator2026 — Ore composition of a vehicle's cargo (#1761)

import type { Vehicle } from '../entities/Vehicle.js';
import type { TrackedFragment } from './Logistics.js';
import { sumOreMass } from '../mining/BlastOreReport.js';

/** Cargo contents: kg per ore id, barren remainder, total and fragment count. */
export interface VehicleCargoBreakdown {
  byOre: Record<string, number>;
  barrenKg: number;
  totalKg: number;
  fragmentCount: number;
}

/** Ore breakdown of the fragments a vehicle carries; ids with no tracked fragment are skipped. */
export function vehicleCargoByOre(vehicle: Pick<Vehicle, 'cargo'>, fragments: readonly TrackedFragment[]): VehicleCargoBreakdown {
  const byId = new Map(fragments.map(f => [f.fragment.id, f.fragment]));
  const aboard = vehicle.cargo.flatMap(item => {
    const f = byId.get(item.fragmentId);
    return f ? [f] : [];
  });
  const totalKg = vehicle.cargo.reduce((sum, item) => sum + item.massKg, 0);
  const { oreKg, barrenKg } = sumOreMass(aboard, totalKg);
  return { byOre: oreKg, barrenKg, totalKg, fragmentCount: vehicle.cargo.length };
}
