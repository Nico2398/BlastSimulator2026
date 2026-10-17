import { fractionOf } from '../../core/math/Fraction.js';
import { t } from '../../core/i18n/I18n.js';
import { warehouseStoredKg } from '../../core/economy/FreightWarehouses.js';
import { getBuildingDef, getBuildingPeopleCapacity, warehouseStockKg, type Building } from '../../core/entities/Building.js';
import { computeBuildingStatus } from '../../core/entities/BuildingStatus.js';
import type { GameState, PlannedBuilding } from '../../core/state/GameState.js';

type RowModelState = Pick<
  GameState,
  'buildings' | 'logistics' | 'plannedBuildings' | 'pendingActions' | 'employees' | 'events' | 'tickCount'
>;

export interface PlacedRowModel {
  hpFraction: number;
  hpText: string;
  utilization: { text: string; fraction: number | null } | null;
  badge: 'out_of_service' | 'demolition_ordered' | 'upgrading' | null;
}

export interface SiteRowModel {
  progress: number | null;
}

function kgUtilization(storedKg: number, capacity: number): NonNullable<PlacedRowModel['utilization']> {
  return {
    text: t('ui.build.row.util_kg', { stored: Math.round(storedKg), capacity: Math.round(capacity) }),
    fraction: fractionOf(storedKg, capacity),
  };
}

function utilizationOf(b: Building, state: RowModelState): PlacedRowModel['utilization'] {
  const capacity = getBuildingDef(b.type, b.tier).capacity;
  const beds = getBuildingPeopleCapacity(b.type, b.tier);
  if (beds > 0) {
    const inside = b.occupantIds.length;
    return { text: t('ui.build.row.util_beds', { inside, capacity: beds }), fraction: fractionOf(inside, beds) };
  }
  switch (b.type) {
    case 'explosive_warehouse': return kgUtilization(warehouseStockKg(b), capacity);
    case 'freight_warehouse': return kgUtilization(warehouseStoredKg(state.logistics, b.id), capacity);
    case 'research_center': {
      const busy = state.buildings.researchQueue.length > 0;
      return { text: t(busy ? 'ui.build.row.util_research_busy' : 'ui.build.row.util_research_idle'), fraction: null };
    }
    default: return null;
  }
}

export function placedRowModel(b: Building, state: RowModelState): PlacedRowModel {
  const maxHp = getBuildingDef(b.type, b.tier).maxHp;
  const kind = computeBuildingStatus(state, b.id)?.kind;
  const badge = kind === 'out_of_service' || kind === 'demolition_ordered' || kind === 'upgrading' ? kind : null;
  return {
    hpFraction: fractionOf(b.hp, maxHp),
    hpText: t('ui.build.row.hp', { hp: Math.round(b.hp), max: maxHp }),
    utilization: utilizationOf(b, state),
    badge,
  };
}

export function siteRowModel(pb: PlannedBuilding, state: RowModelState): SiteRowModel {
  const status = computeBuildingStatus(state, pb.buildingId);
  return { progress: status?.progress ?? null };
}
