// Grade-gated vehicle tiers on progression sites (#1928).
import type { VehicleTier } from '../entities/Vehicle.js';

/** Mine grade at which a vehicle tier unlocks. */
export function requiredGradeForVehicleTier(_tier: VehicleTier): number {
  return undefined as unknown as number; // TODO: implement
}

/** Null when allowed (or grade is undefined: non-progression site); else the grade needed. */
export function vehicleTierGate(_grade: number | undefined, _tier: VehicleTier): { needed: number } | null {
  return undefined as unknown as null; // TODO: implement
}

/** Refusal message for a gated purchase or upgrade. */
export function vehicleTierRefusalText(_grade: number, _needed: number): string {
  return undefined as unknown as string; // TODO: implement
}

/** Short lock label shown on gated UI controls. */
export function vehicleTierLockLabel(_needed: number): string {
  return undefined as unknown as string; // TODO: implement
}
