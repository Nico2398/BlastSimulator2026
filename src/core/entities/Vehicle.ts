// BlastSimulator2026 — Vehicle system
// Debris haulers, rock diggers, drill rigs, building destroyers, and rock fragmenters.
// Base stats and tier multipliers live in src/core/config/balance.ts.

import { VEHICLE_BASE_STATS, VEHICLE_TIER_MULTIPLIERS, VEHICLE_SCRAP_RESIDUAL_FRACTION } from '../config/balance.js';

export { ROLE_LICENCE_REQUIRED, canAssignDriver, assignDriver, getExcavatorLoadingRate } from './VehicleDriverAssignment.js';

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
  tier: VehicleTier;
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
  /** Number of consecutive ticks the vehicle has spent in the waiting state. */
  waitingTicks: number;
  /** Consecutive ticks tickVehicle failed to find a NavGrid path to targetX/Z. */
  moveConsecutiveFailures: number;
  /** True once moveConsecutiveFailures reaches STUCK_THRESHOLD — idle until the path clears. */
  isMoveStuck: boolean;
  /** Fragment ID this debris_hauler is currently hauling, or null when not hauling. */
  haulingFragmentId: number | null;
  /**
   * Which leg of the haul the vehicle is on: driving to the fragment to load
   * it, or driving to the depot to deliver it. Null when not hauling.
   */
  haulingPhase: 'to_fragment' | 'to_depot' | null;
  /** Depot/warehouse building ID the current haul is delivering to, or null. */
  haulingDepotBuildingId: number | null;
  /** Fragment ID this rock_fragmenter is currently breaking, or null. */
  breakFragmentId: number | null;
  /** Single-leg break phase — travelling to the boulder. Null when idle. */
  breakPhase: 'to_boulder' | null;
  /**
   * PendingAction id this vehicle is exclusively reserved for — set at claim
   * time by GameLoop for a vehicle-gated action, VehicleReservation.ts owns
   * every transition. Distinct from driverId: reserved-but-not-yet-boarded
   * is the walk-to-vehicle phase.
   */
  reservedForActionId: number | null;
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
  tier: VehicleTier = 1,
): { vehicle: Vehicle; cost: number } {
  const def = getVehicleDefByTier(role, tier);
  const vehicle: Vehicle = {
    id: state.nextId++,
    type: role,
    tier,
    x, z,
    hp: def.maxHp,
    task: 'idle',
    targetX: x,
    targetZ: z,
    driverId: null,
    state: 'idle',
    payloadKg: 0,
    waitingTicks: 0,
    moveConsecutiveFailures: 0,
    isMoveStuck: false,
    haulingFragmentId: null,
    haulingPhase: null,
    haulingDepotBuildingId: null,
    breakFragmentId: null,
    breakPhase: null,
    reservedForActionId: null,
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
  if (task === 'moving') vehicle.waitingTicks = 0;
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
  vehicle.waitingTicks = 0;
  return true;
}

/** Destroy a vehicle (e.g., hit by a projectile). */
export function destroyVehicle(state: VehicleState, vehicleId: number): boolean {
  const idx = state.vehicles.findIndex(v => v.id === vehicleId);
  if (idx < 0) return false;
  state.vehicles.splice(idx, 1);
  return true;
}

/**
 * Cash credited back on `vehicle scrap`: a fraction of purchaseCost, scaled by
 * the vehicle's current hp/maxHp so a wrecked vehicle salvages for less than
 * a pristine one. Exported so the Fleet panel's scrap confirmation can show
 * the real number before the player commits, not a guess.
 */
export function computeScrapResidualValue(vehicleType: VehicleRole, vehicleTier: VehicleTier, hp: number): number {
  const def = getVehicleDefByTier(vehicleType, vehicleTier);
  const hpFraction = def.maxHp > 0 ? Math.max(0, Math.min(1, hp / def.maxHp)) : 0;
  return Math.round(def.purchaseCost * VEHICLE_SCRAP_RESIDUAL_FRACTION * hpFraction);
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

/**
 * Unassign a vehicle's driver, freeing the employee to be reassigned
 * elsewhere. Refuses while the vehicle is mid-haul (driving to a fragment or
 * to the depot with one loaded) so a haul doesn't get orphaned mid-flight.
 */
export function unassignDriver(
  vehicleState: VehicleState,
  vehicleId: number,
): { success: boolean; error?: string } {
  const vehicle = vehicleState.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return { success: false, error: 'Vehicle not found' };
  if (vehicle.driverId === null) return { success: false, error: 'Vehicle has no driver' };
  if (vehicle.haulingPhase !== null) return { success: false, error: 'Vehicle is mid-haul' };

  vehicle.driverId = null;
  return { success: true };
}

// ── Licence mapping / driver assignment / loading rate ──
// Moved to VehicleDriverAssignment.ts (#484), re-exported above.
