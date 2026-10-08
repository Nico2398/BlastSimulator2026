/**
 * Vehicle tier upgrade (#1401): pay the purchase-price difference to move a
 * vehicle up one tier in place. Stubs only — implementation pending.
 */
import type { Employee } from './Employee.js';
import type { Vehicle, VehicleRole, VehicleTier } from './Vehicle.js';

export type VehicleUpgradeResult =
  | { success: true; cost: number; fromTier: VehicleTier; toTier: VehicleTier }
  | { success: false; reason: 'max_tier' };

/** Next tier above `tier`, or null at VEHICLE_MAX_TIER. */
export function nextVehicleTier(_tier: VehicleTier): VehicleTier | null {
  // TODO: implement
  return undefined as unknown as VehicleTier | null;
}

/** purchaseCost(next tier) - purchaseCost(current tier); null at max tier. */
export function computeVehicleUpgradeCost(_role: VehicleRole, _tier: VehicleTier): number | null {
  // TODO: implement
  return undefined as unknown as number | null;
}

/** Raises tier by one and sets hp to the new tier's maxHp; mutates only tier and hp. Does not charge cash. */
export function upgradeVehicle(_vehicle: Vehicle): VehicleUpgradeResult {
  // TODO: implement
  return undefined as unknown as VehicleUpgradeResult;
}

/** True when `employee` may drive a vehicle of `role` at `tier`. */
export function isLicensedForVehicleTier(_employee: Employee, _role: VehicleRole, _tier: VehicleTier): boolean {
  // TODO(#1524): equals isLicensedForRole today; tier-specific licences come with #1524.
  return undefined as unknown as boolean;
}

/** True when any alive employee in the roster is licensed for `role` at `tier`. */
export function rosterCanDriveVehicleTier(_employees: readonly Employee[], _role: VehicleRole, _tier: VehicleTier): boolean {
  // TODO: implement
  return undefined as unknown as boolean;
}
