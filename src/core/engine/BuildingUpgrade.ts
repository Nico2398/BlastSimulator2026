// BlastSimulator2026 — In-place building upgrade (#1875)
// An upgrade order raises the standing building's tier on completion; nothing is demolished.

import type { Building, BuildingTier } from '../entities/Building.js';
import type { GameState } from '../state/GameState.js';

/** True when a pending upgrade site already targets this building. */
export function isUpgradeOrdered(_state: Pick<GameState, 'plannedBuildings'>, _buildingId: number): boolean {
  // TODO: implement
  return false;
}

/** Raise the building to `tier` in place and refill hp to the new max. Null when the building is gone. */
export function completeUpgrade(_state: Pick<GameState, 'buildings'>, _buildingId: number, _tier: BuildingTier): Building | null {
  // TODO: implement
  return null;
}
