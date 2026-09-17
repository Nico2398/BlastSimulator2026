// BlastSimulator2026 — Vehicle system
// Debris haulers, rock diggers, drill rigs, building destroyers, and rock fragmenters.
// Base stats and tier multipliers live in src/core/config/balance.ts.

import { VEHICLE_BASE_STATS, VEHICLE_TIER_MULTIPLIERS, VEHICLE_SCRAP_RESIDUAL_FRACTION } from '../config/balance.js';

export { ROLE_LICENCE_REQUIRED, canAssignDriver } from './VehicleDriverAssignment.js';

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
  /** Capacity: kg for haulers (see `payload.massKg`), m³/tick for diggers, holes/tick for drills. */
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
  /** High-level operational state. */
  state: VehicleOperationalState;
  /**
   * The single cargo item this vehicle currently carries — a fragment loaded
   * by a `haul_load` arrival effect, cleared by `haul_unload`. Null when
   * empty. Replaces the old `payloadKg` + `haulingFragmentId` pair (#1091):
   * mass and fragment identity travel together as one loaded/unloaded unit
   * rather than two fields that could disagree.
   */
  payload: { fragmentId: number; massKg: number } | null;
  /** Number of consecutive ticks the vehicle has spent in the waiting state. */
  waitingTicks: number;
  /** Consecutive ticks tickVehicle failed to find a NavGrid path to targetX/Z. */
  moveConsecutiveFailures: number;
  /**
   * True once moveConsecutiveFailures reaches STUCK_THRESHOLD, OR once an
   * occupancy-block reroute attempt fails after
   * VEHICLE_OCCUPANCY_REROUTE_THRESHOLD ticks of waiting on another vehicle
   * (both in src/core/config/balance.ts; see handleVehicleOccupancyBlock in
   * VehicleOccupancyReroute.ts, #591) — idle until the path clears either way.
   */
  isMoveStuck: boolean;
  /**
   * PendingAction id this vehicle is exclusively reserved for — set at claim
   * time by GameLoop for a vehicle-gated action, VehicleReservation.ts owns
   * every transition. Distinct from the driver seat: reserved-but-not-yet-
   * boarded is the walk-to-vehicle phase.
   */
  reservedForActionId: number | null;
  /**
   * IDs of employees currently mounted in this vehicle (driver included).
   * Must agree with each occupant's `Locomotion` in both directions — see
   * the `vehicles` rule's invariant list. Bounded by
   * `VEHICLE_SEAT_COUNT[role]`.
   */
  occupantIds: number[];
}

// ── Fleet state ──

export interface VehicleState {
  vehicles: Vehicle[];
  nextId: number;
  /** Fleet-wide count of driver-boarding events. */
  driverBoardingCount: number;
}

/**
 * The employee driving `vehicle` right now, or null when nobody is aboard.
 * The driver is the first occupant (`occupantIds[0]`) — the one whose
 * itinerary moves the vehicle (`gameplay-vehicle-fleet`). The single
 * accessor every reader goes through, so "who drives this" stays one
 * question the fleet module answers rather than a field shape each caller
 * re-derives (#1092 — replaces the `driverId` mirror deleted with phase 6).
 */
export function vehicleDriverId(vehicle: Vehicle): number | null {
  return vehicle.occupantIds[0] ?? null;
}

export function createVehicleState(): VehicleState {
  return { vehicles: [], nextId: 1, driverBoardingCount: 0 };
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
    state: 'idle',
    payload: null,
    waitingTicks: 0,
    moveConsecutiveFailures: 0,
    isMoveStuck: false,
    reservedForActionId: null,
    occupantIds: [],
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

/**
 * Calculate total maintenance + fuel costs for all vehicles per tick. Billed
 * off the vehicle's OWN tier (#1092): a tier-3 rig costs
 * `VEHICLE_TIER_MULTIPLIERS[3].maintenanceCostPerTick` times a tier-1's
 * upkeep, and the same for fuel — upkeep that ignored `tier` made the elite
 * tiers strictly better than their price implied.
 */
export function getVehicleCostsPerTick(state: VehicleState): number {
  let total = 0;
  for (const v of state.vehicles) {
    const def = getVehicleDefByTier(v.type, v.tier);
    total += def.maintenanceCostPerTick;
    if (v.task !== 'idle') {
      total += def.fuelCostPerTick;
    }
  }
  return total;
}

/**
 * Unassign a vehicle's driver, freeing the employee to be reassigned
 * elsewhere. Refuses while the vehicle is carrying a loaded haul so it
 * doesn't get orphaned mid-flight with cargo aboard and nobody driving it.
 *
 * `payload !== null` is the only guard needed (#1091): the itinerary model's
 * "not yet loaded" leg (driving toward the fragment, cargo not aboard yet)
 * carries nothing worth protecting — losing that driver mid-drive is exactly
 * as recoverable as any other vehicle-gated action's ordinary mid-drive
 * interruption, which this guard was never meant to cover. Only a vehicle
 * that has actually picked something up (`payload` set) risks being
 * orphaned with cargo nobody is driving.
 *
 * Guard-only since #1092: there is no `driverId` field left to clear — the
 * driver seat is `occupantIds[0]`, and `Mount.alight` (the one writer of
 * `occupantIds`) is what actually empties it once this guard passes.
 */
export function unassignDriver(
  vehicleState: VehicleState,
  vehicleId: number,
): { success: boolean; error?: string } {
  const vehicle = vehicleState.vehicles.find(v => v.id === vehicleId);
  if (!vehicle) return { success: false, error: 'Vehicle not found' };
  if (vehicle.payload !== null) return { success: false, error: 'Vehicle is mid-haul' };

  return { success: true };
}

// ── Licence mapping / driver assignment / loading rate ──
// Moved to VehicleDriverAssignment.ts (#484), re-exported above.
