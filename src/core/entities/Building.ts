// BlastSimulator2026 — Building system
// Canonical 9 building types with 3 tiers each.
// Ramps are directional voxel types (RampVoxelType), NOT buildings.
// Placement grid helpers: BuildingPlacement.ts
// Research Center queue: BuildingResearch.ts

import { BUILDING_DEFS } from './BuildingDefs.js';
import { isTierUnlocked } from './BuildingResearch.js';
import type { ResearchCondition } from './BuildingResearch.js';

// ── Building types ──

/**
 * The 9 canonical building types.
 * NOTE: Ramps are handled as RampVoxelType — directional voxels, not buildings.
 */
export type BuildingType =
  | 'driving_center'
  | 'blasting_academy'
  | 'management_office'
  | 'geology_lab'
  | 'research_center'
  | 'living_quarters'
  | 'explosive_warehouse'
  | 'freight_warehouse'
  | 'vehicle_depot';

/** Building upgrade tier. Tier 1 is the base tier available from the start. */
export type BuildingTier = 1 | 2 | 3;

/**
 * Ramp voxel direction. Ramps are carved into the VoxelGrid as directional
 * voxels to connect bench levels for vehicle travel. They are NOT buildings.
 */
export type RampVoxelType = 'ramp_north' | 'ramp_south' | 'ramp_east' | 'ramp_west';

export type ScoreId = 'wellBeing' | 'safety' | 'ecology' | 'nuisance';

// ── Building definition ──

export interface BuildingDef {
  type: BuildingType;
  tier: BuildingTier;
  /** i18n key for the tier-specific building name. */
  nameKey: string;
  /** Footprint as [dx, dz] cell offsets relative to the placement origin. */
  footprint: ReadonlyArray<readonly [number, number]>;
  /** Entry point as [dx, dz] offset from placement origin. */
  entryPoint: readonly [number, number];
  /** Exit point as [dx, dz] offset from placement origin. */
  exitPoint: readonly [number, number];
  /** One-time construction cost ($). */
  constructionCost: number;
  /** Demolish/removal cost ($). */
  demolishCost: number;
  /** Operating cost per game tick ($). */
  operatingCostPerTick: number;
  /** Capacity: employee beds, storage kg, vehicle slots, etc. */
  capacity: number;
  /** Max HP before destruction from blast damage. */
  maxHp: number;
  /**
   * Reserved for future blast/damage modeling.
   * Currently configuration-only and not consumed by runtime destruction logic.
   * Will gate building destruction when the blast-projection energy accumulator
   * is wired into the damage pipeline.
   */
  structuralResistance: number;
  /** Score delta effects per tick while active. */
  scoreEffects: Partial<Record<ScoreId, number>>;
}

// Re-export catalog for consumers.
export { BUILDING_DEFS };

/** Look up the definition for a building type and tier (defaults to tier 1). */
export function getBuildingDef(type: BuildingType, tier: BuildingTier = 1): BuildingDef {
  return BUILDING_DEFS[type][tier];
}

/** Return all canonical building types. */
export function getAllBuildingTypes(): BuildingType[] {
  return Object.keys(BUILDING_DEFS) as BuildingType[];
}

// ── Footprint helpers ──

/**
 * Derive bounding-box size from a footprint cell list.
 * The result is cached per `BuildingDef` reference; pass the same `def` object
 * to avoid recomputing on repeated calls (e.g. in tight damage loops).
 */
export function getFootprintSize(fp: ReadonlyArray<readonly [number, number]>): { sizeX: number; sizeZ: number } {
  if (fp.length === 0) return { sizeX: 0, sizeZ: 0 };
  let maxX = 0;
  let maxZ = 0;
  for (const [dx, dz] of fp) {
    if (dx > maxX) maxX = dx;
    if (dz > maxZ) maxZ = dz;
  }
  return { sizeX: maxX + 1, sizeZ: maxZ + 1 };
}

/** Pre-computed footprint bounds cache keyed by `BuildingDef` object identity. */
const _footprintSizeCache = new WeakMap<BuildingDef, { sizeX: number; sizeZ: number }>();

/**
 * Return cached bounding-box size for a `BuildingDef`.
 * On the first call for a given def object the size is derived from its footprint
 * and stored; subsequent calls return the cached value with zero allocations.
 */
export function getDefSize(def: BuildingDef): { sizeX: number; sizeZ: number } {
  let size = _footprintSizeCache.get(def);
  if (size === undefined) {
    size = getFootprintSize(def.footprint);
    _footprintSizeCache.set(def, size);
  }
  return size;
}

// ── Building instance ──

export interface Building {
  id: number;
  type: BuildingType;
  /** Upgrade tier for this building instance. */
  tier: BuildingTier;
  x: number;
  z: number;
  hp: number;
  active: boolean;
  storedExplosivesKg?: number;
}

// ── Building state ──

export interface ResearchTask {
  targetType: BuildingType;
  targetTier: 2 | 3;
  ticksRemaining: number;
  cost: number;
  conditions: ResearchCondition[];
}

export interface BuildingState {
  buildings: Building[];
  nextId: number;
  researchQueue: ResearchTask[];
  unlockedTiers: Partial<Record<BuildingType, BuildingTier>>;
}

export function createBuildingState(): BuildingState {
  return { buildings: [], nextId: 1, researchQueue: [], unlockedTiers: {} };
}

// ── Operations ──

export interface PlaceBuildingResult {
  success: boolean;
  building?: Building;
  error?: string;
  cost?: number;
}

/**
 * Whether placing or upgrading a building at this tier is blocked because the
 * tier has not been unlocked via a Research Center task.
 * Tier 1 is always unlocked; tier 2/3 require `isTierUnlocked` to report true.
 */
export function isPlacementBlockedByResearch(
  state: BuildingState,
  type: BuildingType,
  tier: BuildingTier,
): boolean {
  return !isTierUnlocked(state, type, tier);
}

/**
 * Place a building at grid coordinates. Returns cost to deduct.
 *
 * `gridSizeX`/`gridSizeZ` are the site's bounding-box dimensions and
 * `originX`/`originZ` its west/north edges — which are no longer always 0,
 * since a site that has been claimed westward or northward starts at negative
 * coordinates (#473).
 */
export function placeBuilding(
  state: BuildingState,
  type: BuildingType,
  x: number,
  z: number,
  gridSizeX: number,
  gridSizeZ: number,
  tier: BuildingTier = 1,
  originX: number = 0,
  originZ: number = 0,
): PlaceBuildingResult {
  const def = getBuildingDef(type, tier);

  if (isPlacementBlockedByResearch(state, type, tier)) {
    return { success: false, error: `Tier ${tier} ${type} is not researched — research required before placement.` };
  }

  const check = checkFootprintPlacement(
    state.buildings.map(b => ({ type: b.type, tier: b.tier, x: b.x, z: b.z })),
    type, x, z, tier, gridSizeX, gridSizeZ, originX, originZ,
  );
  if (!check.valid) {
    return { success: false, error: check.error! };
  }

  const building: Building = {
    id: state.nextId++,
    type,
    tier,
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

export interface DemolishBuildingResult {
  success: boolean;
  /** Absolute grid cells freed by the demolition (for navmesh update). */
  freedCells: Array<{ x: number; z: number }>;
  error?: string;
}

/**
 * Demolish a building: remove it from the grid and return the freed footprint
 * cells so the caller can patch the navmesh incrementally.
 */
export function demolishBuilding(state: BuildingState, buildingId: number): DemolishBuildingResult {
  const building = state.buildings.find(b => b.id === buildingId);
  if (!building) return { success: false, freedCells: [], error: 'Building not found' };

  const def = getBuildingDef(building.type, building.tier);
  const freedCells = def.footprint.map(([dx, dz]) => ({ x: building.x + dx, z: building.z + dz }));

  destroyBuilding(state, buildingId);

  return { success: true, freedCells };
}

/** Cost to demolish a building ($): the demolish cost of its current type/tier. */
export function getDemolishCost(building: Building): number {
  return getBuildingDef(building.type, building.tier).demolishCost;
}

/**
 * Cost to upgrade a building to `nextTier` ($): demolishing the current tier
 * plus constructing the next one.
 */
export function getUpgradeCost(building: Building, nextTier: BuildingTier): number {
  return getBuildingDef(building.type, building.tier).demolishCost
    + getBuildingDef(building.type, nextTier).constructionCost;
}

/** Cost to relocate a building ($): 50% of its construction cost. */
export function getMoveCost(building: Building): number {
  return Math.round(getBuildingDef(building.type, building.tier).constructionCost * 0.5);
}

/** Move a building to new coordinates. Returns relocation cost (50% of construction). */
export function moveBuilding(
  state: BuildingState,
  buildingId: number,
  newX: number,
  newZ: number,
  gridSizeX: number,
  gridSizeZ: number,
  originX: number = 0,
  originZ: number = 0,
): PlaceBuildingResult {
  const building = state.buildings.find(b => b.id === buildingId);
  if (!building) return { success: false, error: 'Building not found' };

  const check = checkFootprintPlacement(
    state.buildings.filter(b => b.id !== buildingId).map(b => ({ type: b.type, tier: b.tier, x: b.x, z: b.z })),
    building.type, newX, newZ, building.tier, gridSizeX, gridSizeZ, originX, originZ,
  );
  if (!check.valid) {
    return { success: false, error: check.error! };
  }

  building.x = newX;
  building.z = newZ;
  return { success: true, building, cost: getMoveCost(building) };
}

/** Calculate total operating cost for all active buildings. */
export function getTotalOperatingCost(state: BuildingState): number {
  let total = 0;
  for (const b of state.buildings) {
    if (b.active) {
      total += getBuildingDef(b.type, b.tier).operatingCostPerTick;
    }
  }
  return total;
}

/** Get total ore storage capacity from freight warehouses. */
export function getStorageCapacity(state: BuildingState): number {
  let total = 0;
  for (const b of state.buildings) {
    if (b.active && b.type === 'freight_warehouse') {
      total += getBuildingDef(b.type, b.tier).capacity;
    }
  }
  return total;
}

/** Aggregate score effects from all active buildings. */
export function getBuildingScoreEffects(state: BuildingState): Record<ScoreId, number> {
  const effects: Record<ScoreId, number> = { wellBeing: 0, safety: 0, ecology: 0, nuisance: 0 };
  for (const b of state.buildings) {
    if (!b.active) continue;
    const def = getBuildingDef(b.type, b.tier);
    for (const [key, val] of Object.entries(def.scoreEffects)) {
      effects[key as ScoreId] += val as number;
    }
  }
  return effects;
}

/**
 * Find the nearest active building of a given type to a grid position, by
 * straight-line distance from (x, z). Returns null when no active building
 * of that type exists.
 */
export function findNearestActiveBuildingOfType(
  buildings: BuildingState,
  type: BuildingType,
  x: number,
  z: number,
): Building | null {
  let nearest: Building | null = null;
  let bestDistSq = Infinity;
  for (const b of buildings.buildings) {
    if (!b.active || b.type !== type) continue;
    const distSq = (b.x - x) ** 2 + (b.z - z) ** 2;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      nearest = b;
    }
  }
  return nearest;
}

// ── Construction site footprint checks (#556) ────────────────────────────────

/**
 * An occupant of the placement grid for `checkFootprintPlacement` purposes —
 * either a live `Building` or a still-under-construction `PlannedBuilding`
 * (`GameState.ts`), reduced to the fields footprint overlap needs.
 */
export interface FootprintOccupant {
  type: BuildingType;
  tier: BuildingTier;
  x: number;
  z: number;
}

/**
 * Whether a building of `type`/`tier` can be placed at (x, z) given the
 * current occupants (live buildings AND planned-but-not-yet-built ones) —
 * bounds + occupancy check shared by `placeBuilding` and the new
 * order-then-build path. Stub: implementation phase moves the real checks
 * here from `placeBuilding`'s inline bounds/`isOccupied` calls.
 */
export function checkFootprintPlacement(
  occupants: ReadonlyArray<FootprintOccupant>,
  type: BuildingType,
  x: number,
  z: number,
  tier: BuildingTier,
  gridSizeX: number,
  gridSizeZ: number,
  originX: number,
  originZ: number,
): { valid: boolean; error?: string } {
  const def = getBuildingDef(type, tier);
  const { sizeX, sizeZ } = getDefSize(def);

  if (x < originX || z < originZ || x + sizeX > originX + gridSizeX || z + sizeZ > originZ + gridSizeZ) {
    return { valid: false, error: 'Out of bounds' };
  }

  for (const occ of occupants) {
    const occDef = getBuildingDef(occ.type, occ.tier);
    const { sizeX: oSX, sizeZ: oSZ } = getDefSize(occDef);
    if (x < occ.x + oSX && x + sizeX > occ.x &&
        z < occ.z + oSZ && z + sizeZ > occ.z) {
      return { valid: false, error: 'Space is occupied' };
    }
  }

  return { valid: true };
}

// ── Re-exports from sub-modules ──────────────────────────────────────────────

export {
  BUSY, buildPlacementGrid, getSurfaceY, canPlaceBuilding, isBuildingFootprintCell,
  type SurfaceY, type PlacementCell, type CanPlaceBuildingResult, type PlacementGrid,
} from './BuildingPlacement.js';
export {
  queueResearchTask, tickResearch, isTierUnlocked, isResearchQueued,
  hasActiveResearchCenter, getUnmetConditions, getQueueBlockCode,
  type QueueBlockCode, type CancelledResearch,
} from './BuildingResearch.js';
export { getLivingQuartersWellbeingMultiplier } from './BuildingWellbeing.js';
export {
  getExplosivesCapacity, getExplosivesInStock,
  storeExplosives, consumeExplosives, hasExplosivesForBlast, freightWarehouseHasRoom,
} from './BuildingWarehouse.js';
