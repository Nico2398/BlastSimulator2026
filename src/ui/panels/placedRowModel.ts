import type { Building } from '../../core/entities/Building.js';
import type { GameState, PlannedBuilding } from '../../core/state/GameState.js';

export type RowModelState = Pick<
  GameState,
  'buildings' | 'logistics' | 'plannedBuildings' | 'pendingActions' | 'employees' | 'events' | 'tickCount'
>;

export interface PlacedRowModel {
  hpFraction: number;
  hpText: string;
  utilization: { text: string; fraction: number | null } | null;
  badge: 'out_of_service' | 'demolition_ordered' | 'rebuilding' | null;
}

export interface SiteRowModel {
  progress: number | null;
  rebuild: boolean;
}

export function placedRowModel(_b: Building, _state: RowModelState): PlacedRowModel {
  // TODO: implement
  return { hpFraction: 1, hpText: '', utilization: null, badge: null };
}

export function siteRowModel(_pb: PlannedBuilding, _state: RowModelState): SiteRowModel {
  // TODO: implement
  return { progress: null, rebuild: false };
}
