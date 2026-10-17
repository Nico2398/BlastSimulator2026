// BlastSimulator2026 — In-place building upgrade (#1875)
// An upgrade order raises the standing building's tier on completion; nothing is demolished.

import { getBuildingDef, type Building, type BuildingTier } from '../entities/Building.js';
import type { GameState } from '../state/GameState.js';

/** True when a pending upgrade site already targets this building. */
export function isUpgradeOrdered(state: Pick<GameState, 'plannedBuildings'>, buildingId: number): boolean {
  return state.plannedBuildings.some(pb => pb.buildingId === buildingId && pb.upgrade === true);
}

/** Raise the building to `tier` in place and refill hp to the new max. Null when the building is gone. */
export function completeUpgrade(state: Pick<GameState, 'buildings'>, buildingId: number, tier: BuildingTier): Building | null {
  const building = state.buildings.buildings.find(b => b.id === buildingId);
  if (!building) return null;
  building.tier = tier;
  building.hp = getBuildingDef(building.type, tier).maxHp;
  return building;
}
