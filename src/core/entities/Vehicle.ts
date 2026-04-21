// BlastSimulator2026 — Vehicle system
// Debris haulers, rock diggers, drill rigs, building destroyers, and rock fragmenters.
// Real mining: CAT 797F hauls ~363t, Liebherr R 9800 excavates ~42m³/pass.
// Scaled for gameplay.

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

const VEHICLE_DEFS: Record<VehicleRole, VehicleDef> = {
  debris_hauler: {
    type: 'debris_hauler',
    tier: 1,
    nameKey: 'vehicle.debris_hauler.tier1',
    workRate: 10,           // kg/tick effective transport throughput
    purchaseCost: 25000, // Real: $1-5M scaled down for game
    maintenanceCostPerTick: 3,
    fuelCostPerTick: 5, // Real: diesel ~$150/hr scaled
    capacity: 200, // kg payload
    speed: 3,
    maxHp: 100,
  },
  rock_digger: {
    type: 'rock_digger',
    tier: 1,
    nameKey: 'vehicle.rock_digger.tier1',
    workRate: 8,            // m³/tick excavation rate
    purchaseCost: 50000, // Key bottleneck — expensive
    maintenanceCostPerTick: 5,
    fuelCostPerTick: 8,
    capacity: 50, // kg/tick loading rate
    speed: 1,
    maxHp: 150,
  },
  drill_rig: {
    type: 'drill_rig',
    tier: 1,
    nameKey: 'vehicle.drill_rig.tier1',
    workRate: 5,            // progress units/tick per hole
    purchaseCost: 35000,
    maintenanceCostPerTick: 4,
    fuelCostPerTick: 6,
    capacity: 2, // holes per tick
    speed: 1,
    maxHp: 120,
  },
  building_destroyer: {
    type: 'building_destroyer',
    tier: 1,
    nameKey: 'vehicle.building_destroyer.tier1',
    workRate: 12,           // damage units/tick
    purchaseCost: 30000,
    maintenanceCostPerTick: 4,
    fuelCostPerTick: 7,
    capacity: 100, // kg/tick clearing rate
    speed: 2,
    maxHp: 130,
  },
  rock_fragmenter: {
    type: 'rock_fragmenter',
    tier: 1,
    nameKey: 'vehicle.rock_fragmenter.tier1',
    workRate: 9,            // fragments/tick output rate
    purchaseCost: 32000,
    maintenanceCostPerTick: 4,
    fuelCostPerTick: 7,
    capacity: 90, // kg/tick fragmentation rate
    speed: 2,
    maxHp: 125,
  },
};

export function getVehicleDef(role: VehicleRole): VehicleDef {
  return VEHICLE_DEFS[role];
}

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
