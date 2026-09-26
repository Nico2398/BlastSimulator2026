// BlastSimulator2026 — Entity sync helpers
// Incremental diff-sync for buildings, vehicles, and characters.

import type { GameState } from '../core/state/GameState.js';
import type { Building } from '../core/entities/Building.js';
import { getBuildingDef } from '../core/entities/Building.js';
import { isOccupyingHost } from '../core/entities/Employee.js';
import type { BuildingMesh } from './BuildingMesh.js';
import type { VehicleMesh } from './VehicleMesh.js';
import type { CharacterMesh } from './CharacterMesh.js';

/**
 * Terrain surface height for a building's whole footprint, not just its
 * center — a footprint spanning multiple voxel levels buries one corner and
 * floats the opposite one under a single center sample. Samples every
 * footprint column the building actually occupies and takes the lowest, so
 * the building's flat base sits on (or below) every corner of the ground
 * beneath it rather than clipping into a rising corner (#1007, #1145 —
 * bounding-box corners lay one column past the footprint's own edge on two
 * axes; every column is sampled instead).
 */
export function buildingFootprintSurfaceY(
  b: Building,
  getSurfaceY: (x: number, z: number) => number,
): number {
  const def = getBuildingDef(b.type, b.tier);
  if (def.footprint.length === 0) return getSurfaceY(b.x, b.z);
  let min = Infinity;
  for (const [dx, dz] of def.footprint) {
    const h = getSurfaceY(b.x + dx, b.z + dz);
    if (h < min) min = h;
  }
  return min;
}

/**
 * Incrementally sync three entity collections against the current game state.
 * Adds new entities, removes gone ones, and updates existing buildings.
 * Mutates the three rendered-ID sets in place.
 *
 * @param getSurfaceY - Terrain surface height sampler, same one used for
 *   vehicles/characters. Buildings are static once placed, so unlike
 *   vehicles/characters they get no per-frame resnap here — the surface
 *   height is baked in at add/update time (#408). They are still re-snapped
 *   later, but only when the terrain mesh revision changes rather than every
 *   frame: GameRendererSync calls `BuildingMesh.setSurfaceY` for each
 *   building whenever that revision advances (#1145).
 */
export function syncEntitySets(
  state: GameState,
  buildings: BuildingMesh | null,
  renderedBuildingIds: Set<number>,
  vehicles: VehicleMesh | null,
  renderedVehicleIds: Set<number>,
  characters: CharacterMesh | null,
  renderedEmployeeIds: Set<number>,
  getSurfaceY: (x: number, z: number) => number = () => 0,
): void {
  if (buildings) {
    for (const b of state.buildings.buildings) {
      const surfaceY = buildingFootprintSurfaceY(b, getSurfaceY);
      if (!renderedBuildingIds.has(b.id)) {
        buildings.addBuilding(b, surfaceY);
        renderedBuildingIds.add(b.id);
      } else {
        buildings.updateBuilding(b, surfaceY);
      }
    }
    // Remove destroyed buildings
    for (const id of [...renderedBuildingIds]) {
      if (!state.buildings.buildings.find(b => b.id === id)) {
        buildings.removeBuilding(id);
        renderedBuildingIds.delete(id);
      }
    }
  }

  if (vehicles) {
    for (const v of state.vehicles.vehicles) {
      if (!renderedVehicleIds.has(v.id)) {
        vehicles.addVehicle(v, state.vehicles, state.employees.employees);
        renderedVehicleIds.add(v.id);
      }
    }
    for (const id of [...renderedVehicleIds]) {
      if (!state.vehicles.vehicles.find(v => v.id === id)) {
        vehicles.removeVehicle(id);
        renderedVehicleIds.delete(id);
      }
    }
  }

  if (characters) {
    // Per-employee check against Locomotion (#1087) — an employee mounted in
    // a vehicle (x/z tracks the vehicle's own via syncDriverPosition, #922)
    // or inside a building (#1202) gets no character mesh, and so is never
    // picked in the scene either; leaving brings the mesh back.
    for (const e of state.employees.employees) {
      if (isOccupyingHost(e.locomotion)) {
        if (renderedEmployeeIds.has(e.id)) {
          characters.removeEmployee(e.id);
          renderedEmployeeIds.delete(e.id);
        }
        continue;
      }
      if (!renderedEmployeeIds.has(e.id)) {
        characters.addEmployee(e);
        renderedEmployeeIds.add(e.id);
      }
    }
    for (const id of [...renderedEmployeeIds]) {
      if (!state.employees.employees.find(e => e.id === id)) {
        characters.removeEmployee(id);
        renderedEmployeeIds.delete(id);
      }
    }
  }
}
