// BlastSimulator2026 — Vehicle system
// Debris haulers, rock diggers, drill rigs, building destroyers, and rock fragmenters.
// Base stats and tier multipliers live in src/core/config/balance.ts.

import type { MovementTrail } from './MovementTrail.js';
import {
  VEHICLE_BASE_STATS,
  VEHICLE_TIER_MULTIPLIERS,
  VEHICLE_SCRAP_RESIDUAL_FRACTION,
  NAV_CLEARANCE_VEHICLE_CELLS,
} from '../config/balance.js';
import type { Employee } from './Employee.js';

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

/**
 * Required NavGrid cell clearance for `vehicle`'s role (#1154). Every
 * current role needs the same envelope today — per-role turning-radius
 * variance is out of scope for #1154 — so this is a flat constant rather
 * than a per-role lookup table with one value repeated in every entry.
 */
export function vehicleRequiredClearanceCells(vehicle: Vehicle): number {
  void vehicle;
  return NAV_CLEARANCE_VEHICLE_CELLS;
}

// ── Vehicle instance ──

export interface Vehicle {
  id: number;
  type: VehicleRole;
  tier: VehicleTier;
  x: number;
  z: number;
  hp: number;
  /**
   * The single cargo item this vehicle currently carries — a fragment loaded
   * by a `haul_load` arrival effect, cleared by `haul_unload`. Null when
   * empty. Replaces the old `payloadKg` + `haulingFragmentId` pair (#1091):
   * mass and fragment identity travel together as one loaded/unloaded unit
   * rather than two fields that could disagree.
   */
  payload: { fragmentId: number; massKg: number } | null;
  /**
   * IDs of employees currently mounted in this vehicle (driver included).
   * Must agree with each occupant's `Locomotion` in both directions — see
   * the `vehicles` rule's invariant list. Bounded by
   * `VEHICLE_SEAT_COUNT[role]`.
   */
  occupantIds: number[];
  /** Cells driven since the current tick batch opened (#1199) — see `Employee.walkTrail`. Transient, never saved. */
  walkTrail?: MovementTrail;
}

// ── Fleet state ──

export interface VehicleState {
  vehicles: Vehicle[];
  nextId: number;
  /** Fleet-wide count of driver-boarding events. */
  driverBoardingCount: number;
  /**
   * The exclusive claim a PendingAction holds on a vehicle (#1138) — replaces
   * the old per-vehicle `reservedForActionId` field. At most one entry per
   * `vehicleId` and at most one per `actionId`; `reserveVehicle`/
   * `clearVehicleReservation` (VehicleReservation.ts) own every transition.
   */
  reservations: Array<{ vehicleId: number; actionId: number }>;
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

/**
 * The PendingAction id `vehicleId` is currently reserved for, or null when
 * unreserved — the single lookup every reader of the old
 * `Vehicle.reservedForActionId` field goes through now that the reservation
 * lives in `VehicleState.reservations` instead of on the vehicle itself
 * (#1138). Lives here rather than in VehicleReservation.ts to avoid an import
 * cycle with VehicleDriverAssignment.ts (see that file's own canAssignDriver).
 */
export function getVehicleReservation(state: VehicleState, vehicleId: number): number | null {
  return state.reservations.find(r => r.vehicleId === vehicleId)?.actionId ?? null;
}

/**
 * The vehicle currently reserved for `actionId`, or null when nothing is
 * reserved for it — the reverse lookup of `getVehicleReservation`, replacing
 * every `state.vehicles.vehicles.find(v => v.reservedForActionId === actionId)`
 * call site (#1138).
 */
export function findVehicleReservedForAction(state: VehicleState, actionId: number): Vehicle | null {
  const entry = state.reservations.find(r => r.actionId === actionId);
  if (!entry) return null;
  return state.vehicles.find(v => v.id === entry.vehicleId) ?? null;
}

/**
 * Removes any reservation entry for `vehicleId` from `state.reservations`.
 * No-op if none exists. The one code path that splices `reservations` (#1138)
 * — `destroyVehicle` below calls it directly (entities may not import
 * VehicleReservation.ts, which already imports this file), and
 * VehicleReservation.ts's own `clearVehicleReservation` calls it too rather
 * than duplicating the splice, so a reservation is never removed two ways.
 */
export function removeVehicleReservation(state: VehicleState, vehicleId: number): void {
  const idx = state.reservations.findIndex(r => r.vehicleId === vehicleId);
  if (idx >= 0) state.reservations.splice(idx, 1);
}

/**
 * The employee currently driving `vehicle`, resolved from `employees` by
 * `vehicleDriverId` — the shared lookup callers that only have an employee
 * list (not a full `GameState`) use instead of re-deriving it (#1138).
 */
export function resolveVehicleDriver(vehicle: Vehicle, employees: readonly Employee[]): Employee | undefined {
  const driverId = vehicleDriverId(vehicle);
  if (driverId === null) return undefined;
  return employees.find(e => e.id === driverId);
}

/**
 * True when `vehicle` is actively being driven right now — replaces the old
 * `vehicle.state === 'moving'` read (#1138): a vehicle carries no state of
 * its own any more, so "moving" is derived from its driver's own itinerary
 * (a non-null itinerary means the driver, and therefore the vehicle they're
 * mounted in, is still travelling — `gameplay-vehicle-fleet`).
 */
export function isVehicleCurrentlyDriving(vehicle: Vehicle, employees: readonly Employee[]): boolean {
  const driver = resolveVehicleDriver(vehicle, employees);
  return driver !== undefined && driver.itinerary !== null;
}

export function createVehicleState(): VehicleState {
  return { vehicles: [], nextId: 1, driverBoardingCount: 0, reservations: [] };
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
    payload: null,
    occupantIds: [],
  };
  state.vehicles.push(vehicle);
  return { vehicle, cost: def.purchaseCost };
}

/** Destroy a vehicle (e.g., hit by a projectile). Also removes its reservation entry, if any (#1138) — a destroyed vehicle must never leave a stale `reservations` entry naming an id no longer in `state.vehicles`. */
export function destroyVehicle(state: VehicleState, vehicleId: number): boolean {
  const idx = state.vehicles.findIndex(v => v.id === vehicleId);
  if (idx < 0) return false;
  state.vehicles.splice(idx, 1);
  removeVehicleReservation(state, vehicleId);
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
    // Fuel bills only while the vehicle holds an active reservation for a
    // gated action (#1138) — reservation state, not raw occupancy, is the
    // source of truth for "is this vehicle actively working" everywhere else
    // on this branch. A vehicle someone merely rides (no reservation) burns
    // no fuel; a reserved-but-not-yet-boarded vehicle already does.
    if (getVehicleReservation(state, v.id) !== null) {
      total += def.fuelCostPerTick;
    }
  }
  return total;
}

/**
 * Whether a vehicle's driver seat may be emptied right now. Refuses while
 * the vehicle is carrying a loaded haul so it doesn't get orphaned
 * mid-flight with cargo aboard and nobody driving it.
 *
 * `payload !== null` is the only guard needed (#1091): the itinerary model's
 * "not yet loaded" leg (driving toward the fragment, cargo not aboard yet)
 * carries nothing worth protecting — losing that driver mid-drive is exactly
 * as recoverable as any other vehicle-gated action's ordinary mid-drive
 * interruption, which this guard was never meant to cover. Only a vehicle
 * that has actually picked something up (`payload` set) risks being
 * orphaned with cargo nobody is driving.
 *
 * A question, not an operation, since #1092: `driverId` is gone, the driver
 * seat is `occupantIds[0]`, and `Mount.alight` — the one writer of
 * `occupantIds`, per the `vehicles` rule — is what actually empties it once
 * this answers yes. It was named `unassignDriver` while it still did the
 * unassigning itself.
 */
export function canReleaseDriver(
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
