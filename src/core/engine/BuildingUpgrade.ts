// BlastSimulator2026 — In-place building upgrade (#1875)
// An upgrade order raises the standing building's tier on completion; nothing is demolished.

import {
  getBuildingDef, checkFootprintPlacement,
  type Building, type BuildingTier, type FootprintOccupant,
} from '../entities/Building.js';
import { terrainReservations } from '../entities/PlacementReservations.js';
import { buildingFootprintOccupants } from '../nav/NavGridSync.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { GameState } from '../state/GameState.js';

/** Site extent a footprint is validated against. */
export interface UpgradeSiteBounds { width: number; depth: number; originX: number; originZ: number }

/**
 * Can `building` grow to `tier` on its own origin? Used at order time and again at
 * completion. The building itself never counts as an occupant of its own cells; `ignore` names
 * further occupants to skip (the completing order's own reservation).
 */
export function checkUpgradeFootprint(
  state: GameState,
  grid: VoxelGrid | null,
  bounds: UpgradeSiteBounds,
  building: Building,
  tier: BuildingTier,
  ignore: ReadonlyArray<FootprintOccupant> = [],
): ReturnType<typeof checkFootprintPlacement> {
  const skipped = new Set<FootprintOccupant>([building, ...ignore]);
  return checkFootprintPlacement(
    buildingFootprintOccupants(state).filter(o => !skipped.has(o)),
    building.type, building.x, building.z, tier,
    bounds.width, bounds.depth, bounds.originX, bounds.originZ, grid ?? undefined,
    terrainReservations(state),
  );
}

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
