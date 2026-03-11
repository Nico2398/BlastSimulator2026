// BlastSimulator2026 — Vehicle system
// Trucks, excavators, drill rigs, and bulldozers.
// Real mining: CAT 797F hauls ~363t, Liebherr R 9800 excavates ~42m³/pass.
// Scaled for gameplay.

// ── Vehicle types ──

export type VehicleType = 'truck' | 'excavator' | 'drill_rig' | 'bulldozer';
export type VehicleTask = 'idle' | 'moving' | 'transport' | 'loading' | 'drilling' | 'clearing';

export interface VehicleDef {
  type: VehicleType;
  /** Purchase cost ($). */
  purchaseCost: number;
  /** Maintenance cost per tick ($). */
  maintenanceCostPerTick: number;
  /** Fuel cost per tick when active ($). */
  fuelCostPerTick: number;
  /** Capacity: tons for trucks, m³/tick for excavators, holes/tick for drills. */
  capacity: number;
  /** Movement speed (grid cells per tick). */
  speed: number;
  /** Max HP. */
  maxHp: number;
}

const VEHICLE_DEFS: Record<VehicleType, VehicleDef> = {
  truck: {
    type: 'truck',
    purchaseCost: 25000, // Real: $1-5M scaled down for game
    maintenanceCostPerTick: 3,
    fuelCostPerTick: 5, // Real: diesel ~$150/hr scaled
    capacity: 200, // kg payload
    speed: 3,
    maxHp: 100,
  },
  excavator: {
    type: 'excavator',
    purchaseCost: 50000, // Key bottleneck — expensive
    maintenanceCostPerTick: 5,
    fuelCostPerTick: 8,
    capacity: 50, // kg/tick loading rate
    speed: 1,
    maxHp: 150,
  },
  drill_rig: {
    type: 'drill_rig',
    purchaseCost: 35000,
    maintenanceCostPerTick: 4,
    fuelCostPerTick: 6,
    capacity: 2, // holes per tick
    speed: 1,
    maxHp: 120,
  },
  bulldozer: {
    type: 'bulldozer',
    purchaseCost: 30000,
    maintenanceCostPerTick: 4,
    fuelCostPerTick: 7,
    capacity: 100, // kg/tick clearing rate
    speed: 2,
    maxHp: 130,
  },
};

export function getVehicleDef(type: VehicleType): VehicleDef {
  return VEHICLE_DEFS[type];
}

export function getAllVehicleTypes(): VehicleType[] {
  return Object.keys(VEHICLE_DEFS) as VehicleType[];
}

// ── Vehicle instance ──

export interface Vehicle {
  id: number;
  type: VehicleType;
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
  type: VehicleType,
  x: number = 0,
  z: number = 0,
): { vehicle: Vehicle; cost: number } {
  const def = getVehicleDef(type);
  const vehicle: Vehicle = {
    id: state.nextId++,
    type, x, z,
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

/** Destroy a vehicle (e.g., by projection). */
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

/** Get loading rate of an excavator (kg/tick). */
export function getExcavatorLoadingRate(vehicle: Vehicle): number {
  if (vehicle.type !== 'excavator') return 0;
  return getVehicleDef('excavator').capacity;
}
