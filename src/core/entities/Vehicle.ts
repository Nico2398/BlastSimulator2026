// BlastSimulator2026 — Vehicle system
// Debris haulers, rock diggers, drill rigs, building destroyers, and rock fragmenters.
// Base stats and tier multipliers live in src/core/config/balance.ts.

import { VEHICLE_BASE_STATS, VEHICLE_TIER_MULTIPLIERS } from '../config/balance.js';
import type { EmployeeState, SkillCategory } from '../entities/Employee.js';

// ── Vehicle roles ──

export type VehicleRole =
  | 'building_destroyer'
  | 'debris_hauler'
  | 'drill_rig'
  | 'rock_digger'
  | 'rock_fragmenter';

// ── VehicleTier ──

/** Equipment tier: 1 = base, 2 = upgraded, 3 = elite. */
export type VehicleTier = 1 | 2 | 3;

// ── VehicleOperationalState ──

/** High-level operational state for a vehicle instance. */
export type VehicleOperationalState = 'idle' | 'moving' | 'working' | 'waiting' | 'broken';

// ── VehicleTask ──

/** Granular task label used by vehicle assignment and cost logic. */
export type VehicleTask = 'idle' | 'moving' | 'transport' | 'loading' | 'drilling' | 'clearing';

export interface VehicleDef {
  type: VehicleRole;
  /** Tier level (1 = base, 2 = upgraded, 3 = elite). */
  tier: VehicleTier;
  /** Localisation key for the vehicle name. */
  nameKey: string;
  /** Work output rate (role-specific units per tick). */
  workRate: number;
  /** Purchase cost ($). */
  purchaseCost: number;
  /** Maintenance cost per tick ($). */
  maintenanceCostPerTick: number;
  /** Fuel cost per tick when active ($). */
  fuelCostPerTick: number;
  /** Capacity: tons for haulers, m³/tick for diggers, holes/tick for drills. */
  capacity: number;
  /** Movement speed (grid cells per tick). */
  speed: number;
  /** Max HP. */
  maxHp: number;
}

// ── Base stats shape ──────────────────────────────────────────────────────────

/** Shape of tier-1 stats sourced from VEHICLE_BASE_STATS in balance config. */
interface BaseStats {
  readonly workRate: number;
  readonly purchaseCost: number;
  readonly maintenanceCostPerTick: number;
  readonly fuelCostPerTick: number;
  readonly capacity: number;
  readonly speed: number;
  readonly maxHp: number;
}

// ── Catalog builder ───────────────────────────────────────────────────────────

/** Generate all three tier VehicleDefs from a role's base (tier-1) stats. */
function makeTiers(role: VehicleRole, base: BaseStats): Record<VehicleTier, VehicleDef> {
  const tiers: VehicleTier[] = [1, 2, 3];
  const result = {} as Record<VehicleTier, VehicleDef>;
  for (const tier of tiers) {
    const m = VEHICLE_TIER_MULTIPLIERS[tier];
    result[tier] = {
      type: role,
      tier,
      nameKey: `vehicle.${role}.tier${tier}`,
      workRate: base.workRate * m.workRate,
      purchaseCost: base.purchaseCost * m.purchaseCost,
      maintenanceCostPerTick: base.maintenanceCostPerTick * m.maintenanceCostPerTick,
      fuelCostPerTick: base.fuelCostPerTick * m.fuelCostPerTick,
      capacity: base.capacity * m.capacity,
      speed: base.speed * m.speed,
      maxHp: base.maxHp * m.maxHp,
    };
  }
  return result;
}

const VEHICLE_DEFS: Record<VehicleRole, Record<VehicleTier, VehicleDef>> = {
  debris_hauler:      makeTiers('debris_hauler',      VEHICLE_BASE_STATS.debris_hauler),
  rock_digger:        makeTiers('rock_digger',         VEHICLE_BASE_STATS.rock_digger),
  drill_rig:          makeTiers('drill_rig',           VEHICLE_BASE_STATS.drill_rig),
  building_destroyer: makeTiers('building_destroyer',  VEHICLE_BASE_STATS.building_destroyer),
  rock_fragmenter:    makeTiers('rock_fragmenter',     VEHICLE_BASE_STATS.rock_fragmenter),
};

/** Returns the tier-1 def for backward compatibility. */
export function getVehicleDef(role: VehicleRole): VehicleDef {
  return VEHICLE_DEFS[role][1];
}

/** Returns the def for the given role and tier. */
export function getVehicleDefByTier(role: VehicleRole, tier: VehicleTier): VehicleDef {
  return VEHICLE_DEFS[role][tier];
}

/** Returns all registered vehicle roles in catalog order. */
export function getAllVehicleRoles(): VehicleRole[] {
  return Object.keys(VEHICLE_DEFS) as VehicleRole[];
}

// ── Vehicle instance ──

export interface Vehicle {
  id: number;
  type: VehicleRole;
  x: number;
  z: number;
  hp: number;
  task: VehicleTask;
  /** Target coordinates for movement/task. */
  targetX: number;
  targetZ: number;
  /** ID of the employee currently driving this vehicle (null = unassigned). */
  driverId: number | null;
  /** High-level operational state. */
  state: VehicleOperationalState;
  /** Current payload in kg. */
  payloadKg: number;
}

// ── Fleet state ──

export interface VehicleState {
  vehicles: Vehicle[];
  nextId: number;
}

export function createVehicleState(): VehicleState {
  return { vehicles: [], nextId: 1 };
}

// ── Operations ──

/** Purchase a vehicle. Returns cost to deduct. */
export function purchaseVehicle(
  state: VehicleState,
  role: VehicleRole,
  x: number = 0,
  z: number = 0,
): { vehicle: Vehicle; cost: number } {
  const def = getVehicleDef(role);
  const vehicle: Vehicle = {
    id: state.nextId++,
    type: role, x, z,
    hp: def.maxHp,
    task: 'idle',
    targetX: x,
    targetZ: z,
    driverId: null,
    state: 'idle',
    payloadKg: 0,
  };
  state.vehicles.push(vehicle);
  return { vehicle, cost: def.purchaseCost };
}

/** Assign a vehicle to a task. */
export function assignVehicle(
  state: VehicleState,
  vehicleId: number,
  task: VehicleTask,
  targetX?: number,
  targetZ?: number,
): boolean {
  const vehicle = state.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return false;

  vehicle.task = task;
  if (targetX !== undefined) vehicle.targetX = targetX;
  if (targetZ !== undefined) vehicle.targetZ = targetZ;
  return true;
}

/** Move a vehicle to target coordinates. */
export function moveVehicle(
  state: VehicleState,
  vehicleId: number,
  targetX: number,
  targetZ: number,
): boolean {
  const vehicle = state.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return false;

  vehicle.task = 'moving';
  vehicle.targetX = targetX;
  vehicle.targetZ = targetZ;
  return true;
}

/** Destroy a vehicle (e.g., hit by a projectile). */
export function destroyVehicle(state: VehicleState, vehicleId: number): boolean {
  const idx = state.vehicles.findIndex(v => v.id === vehicleId);
  if (idx < 0) return false;
  state.vehicles.splice(idx, 1);
  return true;
}

/** Calculate total maintenance + fuel costs for all vehicles per tick. */
export function getVehicleCostsPerTick(state: VehicleState): number {
  let total = 0;
  for (const v of state.vehicles) {
    const def = getVehicleDef(v.type);
    total += def.maintenanceCostPerTick;
    if (v.task !== 'idle') {
      total += def.fuelCostPerTick;
    }
  }
  return total;
}

// ── Licence mapping ──

const ROLE_LICENCE_REQUIRED: Record<VehicleRole, SkillCategory> = {
  debris_hauler:      'driving.truck',
  building_destroyer: 'driving.truck',
  rock_digger:        'driving.excavator',
  rock_fragmenter:    'driving.excavator',
  drill_rig:          'driving.drill_rig',
};

/** Assign a driver (employee) to a vehicle, enforcing licence and availability checks. */
export function assignDriver(
  vehicleState: VehicleState,
  employeeState: EmployeeState,
  vehicleId: number,
  employeeId: number,
): { success: boolean; error?: string } {
  const vehicle = vehicleState.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return { success: false, error: 'Vehicle not found' };

  const employee = employeeState.employees.find(e => e.id === employeeId);
  if (!employee || !employee.alive) return { success: false, error: 'Employee not found' };

  const requiredLicence = ROLE_LICENCE_REQUIRED[vehicle.type];
  const hasLicence = employee.qualifications.some(q => q.category === requiredLicence);
  if (!hasLicence) return { success: false, error: 'Employee lacks licence for this role' };

  const alreadyDriving = vehicleState.vehicles.some(v => v.driverId === employeeId);
  if (alreadyDriving) return { success: false, error: 'Employee already driving another vehicle' };

  if (vehicle.driverId !== null) return { success: false, error: 'Vehicle already has a driver' };

  vehicle.driverId = employeeId;
  return { success: true };
}

/**
 * Returns the loading rate (kg/tick) for a rock_digger, or 0 for any other role.
 *
 * @note Function name intentionally kept as `getExcavatorLoadingRate` for
 *       public-API backward compatibility — do not rename without updating all callers.
 */
export function getExcavatorLoadingRate(vehicle: Vehicle): number {
  if (vehicle.type !== 'rock_digger') return 0;
  return getVehicleDef('rock_digger').capacity;
}
