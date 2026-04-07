// BlastSimulator2026 — Building system
// Canonical 9 building types with 3 tiers each.
// Ramps are directional voxel types (RampVoxelType), NOT buildings.

import type { VoxelGrid } from '../world/VoxelGrid.js';
import { BUILDING_DEFS } from './BuildingDefs.js';

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

/** Place a building at grid coordinates. Returns cost to deduct. */
export function placeBuilding(
  state: BuildingState,
  type: BuildingType,
  x: number,
  z: number,
  gridSizeX: number,
  gridSizeZ: number,
  tier: BuildingTier = 1,
): PlaceBuildingResult {
  const def = getBuildingDef(type, tier);
  const { sizeX, sizeZ } = getDefSize(def);

  if (x < 0 || z < 0 || x + sizeX > gridSizeX || z + sizeZ > gridSizeZ) {
    return { success: false, error: 'Out of bounds' };
  }

  if (isOccupied(state, x, z, sizeX, sizeZ)) {
    return { success: false, error: 'Space is occupied' };
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

  const def = getBuildingDef(building.type, building.tier);
  const { sizeX, sizeZ } = getDefSize(def);

  if (newX < 0 || newZ < 0 || newX + sizeX > gridSizeX || newZ + sizeZ > gridSizeZ) {
    return { success: false, error: 'Out of bounds' };
  }

  if (isOccupied(state, newX, newZ, sizeX, sizeZ, building.id)) {
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

// ── Placement grid ──────────────────────────────────────────────────────────
//
// The 2D placement grid maps every (x, z) surface cell to:
//   - surfaceY: world-space Y of the first unoccupied voxel above solid ground.
//   - BUSY: the cell is covered by a placed building's footprint.

/** Sentinel value: this cell is under an existing building's footprint. */
export const BUSY = -1 as const;

export type SurfaceY = number | typeof BUSY;

export interface PlacementCell {
  /** World-space X coordinate. */
  worldX: number;
  /** World-space Z coordinate. */
  worldZ: number;
  /**
   * Y of the highest solid voxel + 1 (i.e. the first empty layer above ground).
   * Set to BUSY if the cell is occupied by a building footprint.
   */
  surfaceY: SurfaceY;
}

export interface CanPlaceBuildingResult {
  valid: boolean;
  reason?: string;
}

/** A 2-D grid indexed as [z][x] of PlacementCell. */
export type PlacementGrid = PlacementCell[][];

/**
 * Build a placement grid by scanning every (x, z) column of the VoxelGrid for
 * its surface height, then marking cells covered by building footprints as BUSY.
 */
export function buildPlacementGrid(
  voxelGrid: VoxelGrid,
  buildingState: BuildingState,
): PlacementGrid {
  const grid: PlacementGrid = [];

  for (let z = 0; z < voxelGrid.sizeZ; z++) {
    const row: PlacementCell[] = [];
    for (let x = 0; x < voxelGrid.sizeX; x++) {
      row.push({ worldX: x, worldZ: z, surfaceY: getSurfaceY(voxelGrid, x, z) });
    }
    grid.push(row);
  }

  // Mark every cell that falls under a building footprint as BUSY.
  for (const building of buildingState.buildings) {
    const def = getBuildingDef(building.type, building.tier);
    for (const [dx, dz] of def.footprint) {
      const cx = building.x + dx;
      const cz = building.z + dz;
      const row = grid[cz];
      if (row !== undefined && cx >= 0 && cx < row.length) {
        const cell = row[cx];
        if (cell !== undefined) cell.surfaceY = BUSY;
      }
    }
  }

  return grid;
}

/**
 * Return the Y coordinate of the first empty layer above the highest solid
 * voxel in column (x, z), or 0 if the entire column is empty.
 */
export function getSurfaceY(voxelGrid: VoxelGrid, x: number, z: number): number {
  for (let y = voxelGrid.sizeY - 1; y >= 0; y--) {
    const voxel = voxelGrid.getVoxel(x, y, z);
    if (voxel !== undefined && voxel.density > 0) return y + 1;
  }
  return 0;
}

/**
 * Check whether a building of the given type and tier can be placed at (x, z)
 * on the provided PlacementGrid.
 *
 * Checks (in order per footprint cell):
 *   1. All cells are within grid bounds.
 *   2. No cell is marked BUSY (occupied by an existing building).
 *   3. All cells share the same surfaceY (flat surface required).
 *
 * Returns `{ valid: true }` when all checks pass, or `{ valid: false, reason }`
 * describing the first failure encountered.
 */
export function canPlaceBuilding(
  grid: PlacementGrid,
  type: BuildingType,
  x: number,
  z: number,
  tier: BuildingTier = 1,
): CanPlaceBuildingResult {
  const def = getBuildingDef(type, tier);
  const gridSizeZ = grid.length;

  let referenceSurfaceY: number | undefined;

  for (const [dx, dz] of def.footprint) {
    const cx = x + dx;
    const cz = z + dz;

    if (cz < 0 || cz >= gridSizeZ) {
      return { valid: false, reason: 'Out of bounds' };
    }
    const row = grid[cz]!;
    if (cx < 0 || cx >= row.length) {
      return { valid: false, reason: 'Out of bounds' };
    }

    const cell = row[cx]!;

    if (cell.surfaceY === BUSY) {
      return { valid: false, reason: 'Space is occupied' };
    }

    if (referenceSurfaceY === undefined) {
      referenceSurfaceY = cell.surfaceY;
    } else if (cell.surfaceY !== referenceSurfaceY) {
      return { valid: false, reason: 'Uneven surface' };
    }
  }

  return { valid: true };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the absolute grid cell (ax, az) falls within the given
 * building's footprint.
 */
export function isBuildingFootprintCell(building: Building, ax: number, az: number): boolean {
  const def = getBuildingDef(building.type, building.tier);
  for (const [dx, dz] of def.footprint) {
    if (building.x + dx === ax && building.z + dz === az) return true;
  }
  return false;
}

function isOccupied(
  state: BuildingState,
  x: number, z: number,
  sizeX: number, sizeZ: number,
  excludeId?: number,
): boolean {
  for (const b of state.buildings) {
    if (excludeId !== undefined && b.id === excludeId) continue;
    const def = getBuildingDef(b.type, b.tier);
    const { sizeX: bSX, sizeZ: bSZ } = getDefSize(def);
    if (x < b.x + bSX && x + sizeX > b.x &&
        z < b.z + bSZ && z + sizeZ > b.z) {
      return true;
    }
  }
  return false;
}

// ── Research functions ──

/** Enqueue a research task. Returns the cost. */
export function queueResearchTask(
  state: BuildingState,
  targetType: BuildingType,
  targetTier: 2 | 3,
  durationTicks: number,
  cost: number,
): number {
  state.researchQueue.push({ targetType, targetTier, ticksRemaining: durationTicks, cost });
  return cost;
}

/**
 * Tick the research queue. Decrements head task's ticksRemaining.
 * When ticksRemaining reaches 0: set unlockedTiers[targetType] = targetTier, remove from queue.
 */
export function tickResearch(state: BuildingState): void {
  const task = state.researchQueue[0];
  if (!task) return;
  task.ticksRemaining -= 1;
  if (task.ticksRemaining <= 0) {
    state.unlockedTiers[task.targetType] = task.targetTier;
    state.researchQueue.shift();
  }
}

/**
 * Check if a tier is available. Tier 1 is always unlocked.
 * Tier N is unlocked if unlockedTiers[type] >= N.
 */
export function isTierUnlocked(
  state: BuildingState,
  type: BuildingType,
  tier: BuildingTier,
): boolean {
  if (tier === 1) return true;
  const unlocked = state.unlockedTiers[type];
  if (unlocked === undefined) return false;
  return unlocked >= tier;
}
