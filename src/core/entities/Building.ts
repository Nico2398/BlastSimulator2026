// BlastSimulator2026 — Building system
// Buildings provide capacity, score bonuses, and cost upkeep.
// All building type data stored here as centralized config.

// ── Building types ──

export type BuildingType =
  | 'worker_quarters'
  | 'storage_depot'
  | 'vehicle_depot'
  | 'office'
  | 'break_room'
  | 'canteen'
  | 'medical_bay'
  | 'explosives_magazine';

export interface BuildingDef {
  type: BuildingType;
  /** Grid footprint width x depth. */
  sizeX: number;
  sizeZ: number;
  /** One-time construction cost ($). */
  constructionCost: number;
  /** Operating cost per tick ($). */
  operatingCostPerTick: number;
  /** Capacity: storage (kg), employee slots, vehicle slots, etc. */
  capacity: number;
  /** HP before destruction. */
  maxHp: number;
  /** Score effects per tick while active. */
  scoreEffects: Partial<Record<ScoreId, number>>;
}

export type ScoreId = 'wellBeing' | 'safety' | 'ecology' | 'nuisance';

// ── Building catalog ──
// Real-world mining: quarters house ~20 workers, depots ~500-2000t.
// Scaled for gameplay pace.

const BUILDING_DEFS: Record<BuildingType, BuildingDef> = {
  worker_quarters: {
    type: 'worker_quarters', sizeX: 3, sizeZ: 3,
    constructionCost: 8000, operatingCostPerTick: 5, capacity: 20, maxHp: 100,
    scoreEffects: { wellBeing: 2 },
  },
  storage_depot: {
    type: 'storage_depot', sizeX: 4, sizeZ: 4,
    constructionCost: 12000, operatingCostPerTick: 8, capacity: 2000, maxHp: 150,
    scoreEffects: {},
  },
  vehicle_depot: {
    type: 'vehicle_depot', sizeX: 4, sizeZ: 3,
    constructionCost: 15000, operatingCostPerTick: 10, capacity: 6, maxHp: 120,
    scoreEffects: {},
  },
  office: {
    type: 'office', sizeX: 2, sizeZ: 2,
    constructionCost: 6000, operatingCostPerTick: 4, capacity: 5, maxHp: 80,
    scoreEffects: { wellBeing: 1 },
  },
  break_room: {
    type: 'break_room', sizeX: 2, sizeZ: 2,
    constructionCost: 4000, operatingCostPerTick: 3, capacity: 15, maxHp: 60,
    scoreEffects: { wellBeing: 3 },
  },
  canteen: {
    type: 'canteen', sizeX: 3, sizeZ: 2,
    constructionCost: 7000, operatingCostPerTick: 6, capacity: 30, maxHp: 80,
    scoreEffects: { wellBeing: 2 },
  },
  medical_bay: {
    type: 'medical_bay', sizeX: 2, sizeZ: 2,
    constructionCost: 10000, operatingCostPerTick: 8, capacity: 10, maxHp: 100,
    scoreEffects: { safety: 3, wellBeing: 1 },
  },
  explosives_magazine: {
    type: 'explosives_magazine', sizeX: 2, sizeZ: 2,
    constructionCost: 20000, operatingCostPerTick: 12, capacity: 500, maxHp: 200,
    scoreEffects: { safety: -1 }, // Explosives on-site = slight safety concern
  },
};

export function getBuildingDef(type: BuildingType): BuildingDef {
  return BUILDING_DEFS[type];
}

export function getAllBuildingTypes(): BuildingType[] {
  return Object.keys(BUILDING_DEFS) as BuildingType[];
}

// ── Building instance ──

export interface Building {
  id: number;
  type: BuildingType;
  x: number;
  z: number;
  hp: number;
  active: boolean;
}

// ── Building state ──

export interface BuildingState {
  buildings: Building[];
  nextId: number;
}

export function createBuildingState(): BuildingState {
  return { buildings: [], nextId: 1 };
}

// ── Operations ──

export interface PlaceBuildingResult {
  success: boolean;
  building?: Building;
  error?: string;
  cost?: number;
}

/** Place a building at grid coordinates. Returns cost to deduct. */
export function placeBuilding(
  state: BuildingState,
  type: BuildingType,
  x: number,
  z: number,
  gridSizeX: number,
  gridSizeZ: number,
): PlaceBuildingResult {
  const def = getBuildingDef(type);

  // Bounds check
  if (x < 0 || z < 0 || x + def.sizeX > gridSizeX || z + def.sizeZ > gridSizeZ) {
    return { success: false, error: 'Out of bounds' };
  }

  // Overlap check
  if (isOccupied(state, x, z, def.sizeX, def.sizeZ)) {
    return { success: false, error: 'Space is occupied' };
  }

  const building: Building = {
    id: state.nextId++,
    type,
    x, z,
    hp: def.maxHp,
    active: true,
  };
  state.buildings.push(building);

  return { success: true, building, cost: def.constructionCost };
}

/** Destroy a building by ID. */
export function destroyBuilding(state: BuildingState, buildingId: number): boolean {
  const idx = state.buildings.findIndex(b => b.id === buildingId);
  if (idx < 0) return false;
  state.buildings.splice(idx, 1);
  return true;
}

/** Move a building to new coordinates. Returns relocation cost (50% of construction). */
export function moveBuilding(
  state: BuildingState,
  buildingId: number,
  newX: number,
  newZ: number,
  gridSizeX: number,
  gridSizeZ: number,
): PlaceBuildingResult {
  const building = state.buildings.find(b => b.id === buildingId);
  if (!building) return { success: false, error: 'Building not found' };

  const def = getBuildingDef(building.type);

  if (newX < 0 || newZ < 0 || newX + def.sizeX > gridSizeX || newZ + def.sizeZ > gridSizeZ) {
    return { success: false, error: 'Out of bounds' };
  }

  // Check overlap excluding self
  if (isOccupied(state, newX, newZ, def.sizeX, def.sizeZ, buildingId)) {
    return { success: false, error: 'Space is occupied' };
  }

  building.x = newX;
  building.z = newZ;
  const relocCost = Math.round(def.constructionCost * 0.5);
  return { success: true, building, cost: relocCost };
}

/** Calculate total operating cost for all active buildings. */
export function getTotalOperatingCost(state: BuildingState): number {
  let total = 0;
  for (const b of state.buildings) {
    if (b.active) {
      total += getBuildingDef(b.type).operatingCostPerTick;
    }
  }
  return total;
}

/** Get total storage capacity from storage depots. */
export function getStorageCapacity(state: BuildingState): number {
  let total = 0;
  for (const b of state.buildings) {
    if (b.active && b.type === 'storage_depot') {
      total += getBuildingDef(b.type).capacity;
    }
  }
  return total;
}

/** Aggregate score effects from all active buildings. */
export function getBuildingScoreEffects(state: BuildingState): Record<ScoreId, number> {
  const effects: Record<ScoreId, number> = { wellBeing: 0, safety: 0, ecology: 0, nuisance: 0 };
  for (const b of state.buildings) {
    if (!b.active) continue;
    const def = getBuildingDef(b.type);
    for (const [key, val] of Object.entries(def.scoreEffects)) {
      effects[key as ScoreId] += val as number;
    }
  }
  return effects;
}

// ── Helpers ──

function isOccupied(
  state: BuildingState,
  x: number, z: number,
  sizeX: number, sizeZ: number,
  excludeId?: number,
): boolean {
  for (const b of state.buildings) {
    if (excludeId !== undefined && b.id === excludeId) continue;
    const def = getBuildingDef(b.type);
    // AABB overlap
    if (x < b.x + def.sizeX && x + sizeX > b.x &&
        z < b.z + def.sizeZ && z + sizeZ > b.z) {
      return true;
    }
  }
  return false;
}
