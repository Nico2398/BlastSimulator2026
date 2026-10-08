// BlastSimulator2026 — Building-task core helpers (#1086)
//
// Core-owned relocation of the pure building/footprint/nav-patch helpers
// from src/console/commands/buildingHelpers.ts, so the core-owned tick
// pipeline (TickPipeline.ts) doesn't reach into src/console/ for them.
// `siteBoundsForGrid` narrows the original `siteBounds(ctx: GameContext)` to
// the one field it actually reads — the grid — since GameContext (a console
// concept) isn't available in core.

import { getStorageCapacity } from '../entities/Building.js';
import { freightWarehouseSites } from '../entities/BuildingWarehouse.js';
import { syncLogisticsCapacity } from '../economy/Logistics.js';
import type { BlastRegion } from '../mining/BlastExecution.js';
import type { GameState } from '../state/GameState.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { levelGroundRect } from '../mining/LevelGround.js';
import { DEFAULT_GRID_SIZE } from '../config/balance.js';
import { NavGrid } from '../nav/NavGrid.js';
import { regionForColumns } from '../nav/NavGridSync.js';
import { updateVehicleCellOccupancy } from './EntityMovementTick.js';
import { loseOrphanedStock, type WarehouseLoss } from '../economy/FreightWarehouses.js';

/** The rectangular region a building/footprint of `sizeX`x`sizeZ` occupies, anchored at (x, z). */
export function makeFootprintRegion(x: number, z: number, sizeX: number, sizeZ: number): BlastRegion {
  return { minX: x, maxX: x + sizeX - 1, minZ: z, maxZ: z + sizeZ - 1 };
}

/**
 * Level a building's footprint at the end of construction, upgrade or move —
 * the carve-then-level idiom `TaskCompletionEffects.ts` and `entities.ts`'s
 * upgrade/move branches each call after mutating the building's own state.
 * Carves and derives the target height from the same true footprint region
 * (`makeFootprintRegion`) — the building's mesh is now centred on that exact
 * footprint (#1198), so there is no wider skirt to level separately.
 */
export function levelBuildingFootprint(
  grid: VoxelGrid,
  x: number,
  z: number,
  sizeX: number,
  sizeZ: number,
  emitter?: EventEmitter,
): ReturnType<typeof levelGroundRect> {
  return levelGroundRect(grid, makeFootprintRegion(x, z, sizeX, sizeZ), emitter);
}

/**
 * The site's live bounding box, as `placeBuilding`/`moveBuilding` want it.
 * Falls back to a 64 m square at the origin only when no grid exists.
 */
export function siteBoundsForGrid(grid: VoxelGrid | null): { width: number; depth: number; originX: number; originZ: number } {
  if (!grid) return { width: DEFAULT_GRID_SIZE, depth: DEFAULT_GRID_SIZE, originX: 0, originZ: 0 };
  return { width: grid.sizeX, depth: grid.sizeZ, originX: grid.minX, originZ: grid.minZ };
}

/**
 * Re-derive logistics storage capacity from the current warehouse total. Call after any building mutation (build/destroy/upgrade/move).
 * Stock is lost only on destruction: a warehouse demolished for an upgrade keeps its id through
 * the planned rebuild order, so its stock survives until the rebuilt building takes it back.
 */
export function refreshLogisticsCapacity(state: GameState): WarehouseLoss[] {
  syncLogisticsCapacity(state.logistics, getStorageCapacity(state.buildings));
  const liveIds = new Set(freightWarehouseSites(state.buildings).map(s => s.id));
  for (const pb of state.plannedBuildings) liveIds.add(pb.buildingId);
  return loseOrphanedStock(state.logistics, state.collectedOre, liveIds);
}

/**
 * Emit `nav:occupancy_changed` for a footprint of `sizeX`x`sizeZ` anchored
 * at (x, z) — the one shared implementation for every call site that needs
 * NavGridSync to re-patch a footprint's region without a voxel carve
 * (construction success, construction failure/refund, and the console-layer
 * destroy/upgrade/move commands via `buildingHelpers.ts`'s wrapper). Used to
 * be copied three times (#1200 finding).
 */
export function emitFootprintRegionChanged(
  emitter: EventEmitter,
  grid: VoxelGrid,
  x: number,
  z: number,
  sizeX: number,
  sizeZ: number,
): void {
  emitter.emit('nav:occupancy_changed', { region: regionForColumns(makeFootprintRegion(x, z, sizeX, sizeZ), grid) });
}

/** True when the (rounded) world cell (x, z) falls inside `region`'s bounding box. */
function isInRegion(x: number, z: number, region: BlastRegion): boolean {
  const cx = Math.round(x);
  const cz = Math.round(z);
  return cx >= region.minX && cx <= region.maxX && cz >= region.minZ && cz <= region.maxZ;
}

/**
 * Move every alive employee standing inside `region` (a footprint's world
 * cells) to the nearest reachable free cell — called whenever a footprint
 * newly blocks routing: ordering, completing, upgrading or moving a
 * building (#1200). Also sweeps parked (unoccupied) vehicles caught in the
 * same region and relocates them the same way (#1270) — a mounted vehicle
 * needs no such sweep, since the locomotion tick already rewrites its
 * position from its (just-relocated) occupant's every tick; only a parked
 * vehicle has no per-tick writer and would otherwise be stranded on ground
 * that just turned solid.
 */
export function relocateFootprintOccupants(state: GameState, region: BlastRegion): void {
  if (!state.navGrid) return;
  for (const emp of state.employees.employees) {
    if (!emp.alive) continue;
    if (!isInRegion(emp.x, emp.z, region)) continue;
    // avoidOccupancy: true — same fragment-/vehicle-occupancy rule foot
    // travel obeys (#954) gates the cell relocated onto, so this sweep
    // never "rescues" someone from a newly-blocked footprint straight into
    // another occupied cell. See NavGrid.findNearestReachableCell's doc.
    const nearest = NavGrid.findNearestReachableCell(state.navGrid, 0, 0, emp.x, emp.z, true);
    emp.x = nearest.x;
    emp.z = nearest.z;
    // A mounted employee's vehicle is deliberately left untouched here: the
    // locomotion tick rewrites every mounted vehicle's position from its
    // occupant's every tick (the `vehicles` rule's sole-writer invariant),
    // so the vehicle self-corrects to this same cell on the very next tick
    // without a second writer. Moving it here too — one tick early, via this
    // function's own reachability search rather than the tick's normal
    // sync — cost #1270 a regression: on a footprint tight enough to leave
    // only one open cell adjacent to an unrelated nearby feature (a drill
    // hole in `building-destruction-visual`), landing the vehicle on that
    // one open cell sealed the hole off from every walker, permanently.
  }

  // Parked (unoccupied) vehicles caught in the footprint get their own
  // relocation sweep — but only when the footprint patch actually turned
  // the vehicle's own cell into 'blocked'. A footprint's bounding box can
  // cover a cell the patch protects from blocking (a drill_hole keeps its
  // own type even when a building's box geometrically contains it — see
  // NavGridSync's footprint-patch handling), and a vehicle parked there was
  // never actually stranded. Relocating it anyway is not a no-op: the
  // vehicle's own `vehicleOccupied` flag can turn the one open approach to
  // that same protected cell into a dead end for `avoidVehicles` foot
  // pathing (confirmed in `building-destruction-visual`, #1270 — a
  // freight_warehouse footprint boxing in a drill hole on three sides moved
  // the idle rock_digger parked on the hole onto the fourth, its only
  // approach, sealing it off from every driller/blaster for the rest of the
  // run). The employee loop above has no matching failure mode — an
  // employee's own cell carries no pathfinding-blocking flag — so it is
  // deliberately left on the plain bounding-box check.
  for (const vehicle of state.vehicles.vehicles) {
    if (vehicle.occupantIds.length > 0) continue;
    if (!isInRegion(vehicle.x, vehicle.z, region)) continue;
    const vx = Math.round(vehicle.x);
    const vz = Math.round(vehicle.z);
    if (state.navGrid.cellAt(vx, vz)?.type !== 'blocked') continue;
    const nearest = NavGrid.findNearestReachableCell(state.navGrid, 0, 0, vehicle.x, vehicle.z, true);
    vehicle.x = nearest.x;
    vehicle.z = nearest.z;
    updateVehicleCellOccupancy(state, vehicle, true, true, vx, vz);
  }
}
