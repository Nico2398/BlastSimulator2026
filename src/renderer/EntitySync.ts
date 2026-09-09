// BlastSimulator2026 — Entity sync helpers
// Incremental diff-sync for buildings, vehicles, and characters.

import type { GameState } from '../core/state/GameState.js';
import type { Building } from '../core/entities/Building.js';
import { getBuildingDef, getDefSize } from '../core/entities/Building.js';
import type { BuildingMesh } from './BuildingMesh.js';
import type { VehicleMesh } from './VehicleMesh.js';
import type { CharacterMesh } from './CharacterMesh.js';

/**
 * Terrain surface height for a building's whole footprint, not just its
 * center — a footprint spanning multiple voxel levels buries one corner and
 * floats the opposite one under a single center sample. Samples the
 * footprint's 4 bounding-box corners and takes the lowest, so the building's
 * flat base sits on (or below) every corner of the ground beneath it rather
 * than clipping into a rising corner (#1007).
 */
export function buildingFootprintSurfaceY(
  b: Building,
  getSurfaceY: (x: number, z: number) => number,
): number {
  const def = getBuildingDef(b.type, b.tier);
  const { sizeX, sizeZ } = getDefSize(def);
  return Math.min(
    getSurfaceY(b.x, b.z),
    getSurfaceY(b.x + sizeX, b.z),
    getSurfaceY(b.x, b.z + sizeZ),
    getSurfaceY(b.x + sizeX, b.z + sizeZ),
  );
}

/**
 * Incrementally sync three entity collections against the current game state.
 * Adds new entities, removes gone ones, and updates existing buildings.
 * Mutates the three rendered-ID sets in place.
 *
 * @param getSurfaceY - Terrain surface height sampler, same one used for
 *   vehicles/characters. Buildings are static once placed (no per-frame
 *   resnap like vehicles/characters get in GameRenderer.syncFromContext), so
 *   the surface height is baked in here at add/update time (#408).
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
        vehicles.addVehicle(v);
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
    // Built once per call (not once per employee) so suppressing a seated
    // driver's mesh stays O(vehicles + employees), not O(vehicles ×
    // employees) — every employee currently seated as any vehicle's driver
    // gets no character mesh; x/z tracks the vehicle's own via
    // syncDriverPosition (#922).
    const seatedDriverIds = new Set<number>();
    for (const v of state.vehicles.vehicles) {
      if (v.driverId !== null) seatedDriverIds.add(v.driverId);
    }

    for (const e of state.employees.employees) {
      if (seatedDriverIds.has(e.id)) {
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
