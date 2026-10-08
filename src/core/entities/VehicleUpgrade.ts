/**
 * Vehicle tier upgrade (#1401): pay the purchase-price difference to move a
 * vehicle up one tier in place. Holds the tier arithmetic, the upgrade cost,
 * the in-place tier/hp mutation (cash is charged by the caller) and the
 * affordability and licence checks shared by console, UI and main loop.
 */
import type { Employee } from './Employee.js';
import type { Vehicle, VehicleRole, VehicleTier } from './Vehicle.js';
import { getVehicleDefByTier } from './Vehicle.js';
import { canDriveTier } from './VehicleDriverAssignment.js';
import { VEHICLE_MAX_TIER } from '../config/balance.js';

type VehicleUpgradeResult =
  | { success: true; cost: number; fromTier: VehicleTier; toTier: VehicleTier }
  | { success: false; reason: 'max_tier' };

/** Next tier above `tier`, or null at VEHICLE_MAX_TIER. */
export function nextVehicleTier(tier: VehicleTier): VehicleTier | null {
  return tier >= VEHICLE_MAX_TIER ? null : ((tier + 1) as VehicleTier);
}

/** purchaseCost(next tier) - purchaseCost(current tier); null at max tier. */
export function computeVehicleUpgradeCost(role: VehicleRole, tier: VehicleTier): number | null {
  const next = nextVehicleTier(tier);
  if (next === null) return null;
  return getVehicleDefByTier(role, next).purchaseCost - getVehicleDefByTier(role, tier).purchaseCost;
}

/** True when `vehicle` has a tier left to buy and `cash` covers the price difference. */
export function canAffordVehicleUpgrade(vehicle: Pick<Vehicle, 'type' | 'tier'>, cash: number): boolean {
  const cost = computeVehicleUpgradeCost(vehicle.type, vehicle.tier);
  return cost !== null && cash >= cost;
}

/** Raises tier by one and sets hp to the new tier's maxHp; mutates only tier and hp. Does not charge cash. */
export function upgradeVehicle(vehicle: Vehicle): VehicleUpgradeResult {
  const toTier = nextVehicleTier(vehicle.tier);
  const cost = computeVehicleUpgradeCost(vehicle.type, vehicle.tier);
  if (toTier === null || cost === null) return { success: false, reason: 'max_tier' };
  const fromTier = vehicle.tier;
  vehicle.tier = toTier;
  vehicle.hp = getVehicleDefByTier(vehicle.type, toTier).maxHp;
  return { success: true, cost, fromTier, toTier };
}

/** True when `employee` may drive a vehicle of `role` at `tier`. */
export function isLicensedForVehicleTier(employee: Employee, role: VehicleRole, tier: VehicleTier): boolean {
  return canDriveTier(employee, role, tier);
}

/** True when any alive employee in the roster is licensed for `role` at `tier`. */
export function rosterCanDriveVehicleTier(employees: readonly Employee[], role: VehicleRole, tier: VehicleTier): boolean {
  return employees.some(e => e.alive && isLicensedForVehicleTier(e, role, tier));
}
