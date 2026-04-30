// BlastSimulator2026 — Entity sync helpers
// Incremental diff-sync for buildings, vehicles, and characters.

import type { GameState } from '../core/state/GameState.js';
import type { BuildingMesh } from './BuildingMesh.js';
import type { VehicleMesh } from './VehicleMesh.js';
import type { CharacterMesh } from './CharacterMesh.js';

/**
 * Incrementally sync three entity collections against the current game state.
 * Adds new entities, removes gone ones, and updates existing buildings.
 * Mutates the three rendered-ID sets in place.
 */
export function syncEntitySets(
  state: GameState,
  buildings: BuildingMesh | null,
  renderedBuildingIds: Set<number>,
  vehicles: VehicleMesh | null,
  renderedVehicleIds: Set<number>,
  characters: CharacterMesh | null,
  renderedEmployeeIds: Set<number>,
): void {
  if (buildings) {
    for (const b of state.buildings.buildings) {
      if (!renderedBuildingIds.has(b.id)) {
        buildings.addBuilding(b);
        renderedBuildingIds.add(b.id);
      } else {
        buildings.updateBuilding(b);
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
    for (const e of state.employees.employees) {
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
