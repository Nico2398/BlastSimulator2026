// BlastSimulator2026 — Building status derivation (#1758)
// What a placed building is going through right now. Locale-agnostic: returns
// a kind + raw data, never player-facing text — mirrors VehicleStatus.ts.

import type { BuildingTier } from './Building.js';
import type { GameState } from '../state/GameState.js';

export type BuildingStatusKind =
  | 'operating' | 'out_of_service' | 'demolition_ordered' | 'rebuilding' | 'under_construction';

export interface BuildingStatus {
  kind: BuildingStatusKind;
  /** Ticks until a closure ends, set only for 'out_of_service'. */
  closureTicksRemaining: number | null;
  /** Event behind the closure, set only for 'out_of_service'. */
  closureEventId: string | null;
  /** 0..1 build progress, set only for 'rebuilding' / 'under_construction'. */
  progress: number | null;
  /** Employee carrying out the work, when one is assigned. */
  builderId: number | null;
  /** Tier being built, set only for 'rebuilding' / 'under_construction'. */
  targetTier: BuildingTier | null;
}

export type BuildingStatusInput = Pick<GameState, 'buildings' | 'plannedBuildings' | 'pendingActions' | 'employees' | 'tickCount'> & {
  events: Pick<GameState['events'], 'activeModifiers'>;
};

/** Status of the placed building `buildingId`, or null when it does not exist. */
export function computeBuildingStatus(_s: BuildingStatusInput, _buildingId: number): BuildingStatus | null {
  return null; // TODO: implement
}
