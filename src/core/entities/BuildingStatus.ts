// BlastSimulator2026 — Building status derivation (#1758)
// What a placed building is going through right now. Locale-agnostic: returns
// a kind + raw data, never player-facing text — mirrors VehicleStatus.ts.

import type { BuildingTier } from './Building.js';
import type { GameState, PlannedBuilding } from '../state/GameState.js';
import { isDemolitionOrdered } from '../engine/BuildingDemolition.js';

type BuildingStatusKind =
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

type BuildingStatusInput = Pick<GameState, 'buildings' | 'plannedBuildings' | 'pendingActions' | 'employees' | 'tickCount'> & {
  events: Pick<GameState['events'], 'activeModifiers'>;
};

const BASE: BuildingStatus = {
  kind: 'operating', closureTicksRemaining: null, closureEventId: null, progress: null, builderId: null, targetTier: null,
};

/** The employee holding the site's place_building action and how far along their work is. */
function siteWork(s: BuildingStatusInput, site: PlannedBuilding): { builderId: number | null; progress: number | null } {
  const action = s.pendingActions.find(a => a.id === site.actionId && a.type === 'place_building');
  const holder = action?.holderId == null ? undefined : s.employees.employees.find(e => e.id === action.holderId);
  if (!holder) return { builderId: null, progress: null };
  const total = holder.activeTaskTotalTicks;
  const remaining = holder.taskTicksRemaining;
  if (remaining === null || total === undefined || total <= 0) return { builderId: holder.id, progress: null };
  return { builderId: holder.id, progress: Math.min(1, Math.max(0, 1 - remaining / total)) };
}

/** A site is a rebuild when its upgrade order says so, or a pending demolition still carries its order id. */
function isRebuildSite(s: BuildingStatusInput, site: PlannedBuilding): boolean {
  return site.rebuild === true
    || s.pendingActions.some(a => a.type === 'demolish_building' && a.payload['rebuildOrderId'] === site.id);
}

/**
 * Status of the placed building `buildingId`, or null when it does not exist.
 * Priority: a site with no standing building, then a queued demolition, then a live closure.
 */
export function computeBuildingStatus(s: BuildingStatusInput, buildingId: number): BuildingStatus | null {
  const standing = s.buildings.buildings.some(b => b.id === buildingId);
  const site = standing ? undefined : s.plannedBuildings.find(pb => pb.buildingId === buildingId);
  if (site) {
    return {
      ...BASE,
      kind: isRebuildSite(s, site) ? 'rebuilding' : 'under_construction',
      targetTier: site.tier,
      ...siteWork(s, site),
    };
  }
  if (!standing) return null;
  if (isDemolitionOrdered(s, buildingId)) return { ...BASE, kind: 'demolition_ordered' };

  const closures = s.events.activeModifiers.filter(
    m => m.kind === 'out_of_service' && m.targetKind === 'building' && m.targetId === buildingId
      && (m.endTick === null || m.endTick > s.tickCount),
  );
  if (closures.length === 0) return BASE;
  // The closure that lasts longest decides the countdown; a permanent one never ends.
  const latest = closures.reduce((a, b) => (a.endTick === null ? a : b.endTick === null || b.endTick > a.endTick ? b : a));
  return {
    ...BASE,
    kind: 'out_of_service',
    closureTicksRemaining: latest.endTick === null ? null : latest.endTick - s.tickCount,
    closureEventId: latest.sourceEventId,
  };
}
