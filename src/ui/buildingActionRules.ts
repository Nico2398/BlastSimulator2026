// Which building actions the inspector offers, and why one is not (#1758).

import {
  getBuildingDef, getDefSize, getDemolishCost, getMoveCost, getResearchProgress, getUpgradeCost,
  isSingleTierType, isTierUnlocked,
  type Building, type BuildingTier, type BuildingType,
} from '../core/entities/Building.js';
import { RESERVATION_REFUSAL, reservationBlocking, terrainReservations, type TerrainReservation } from '../core/entities/PlacementReservations.js';
import { isDemolitionOrdered } from '../core/engine/BuildingDemolition.js';
import { getResearchTaskDef } from '../core/config/balance.js';
import { researchCostFor } from '../core/events/ActiveModifiers.js';
import { formatMoney } from '../core/economy/formatMoney.js';
import type { PlacementCutoff } from '../core/entities/Building.js';
import type { Rect } from '../core/world/WorldGen.js';
import type { GameState } from '../core/state/GameState.js';
import { placementCutoffFor, cutoffStateKey } from './placementCutoffConfirm.js';

/** Reason key shared by every action refused for short cash; BuildMenu keeps its plain `$cost` tooltip for it. */
export const REASON_CASH = 'inspector.reason.cash';

export interface BuildingActionRules {
  upgrade: {
    kind: 'available' | 'locked' | 'refused';
    cost: number | null;
    reasonKey: string | null;
    reasonParams?: Record<string, string | number>;
    nextTier: BuildingTier | null;
    cutoff: number | null;
  };
  research: {
    type: BuildingType;
    tier: BuildingTier;
    cost: number;
    duration: number;
    queued: { fraction: number; remaining: number } | null;
  } | null;
  move: { cost: number; disabledReasonKey: string | null };
  demolish: { cost: number; disabledReasonKey: string | null };
}

export function buildingActionRules(
  state: GameState,
  b: Building,
  reservations: ReadonlyArray<TerrainReservation> = terrainReservations(state),
): BuildingActionRules {
  const ordered = isDemolitionOrdered(state, b.id);
  const orderedOr = (cost: number): string | null => {
    if (ordered) return 'inspector.reason.demolition_ordered';
    return state.cash < cost ? REASON_CASH : null;
  };
  const moveCost = getMoveCost(b);
  const demolishCost = getDemolishCost(b);
  const { upgrade, research } = upgradeRules(state, b, ordered, reservations);
  return {
    upgrade,
    research,
    move: { cost: moveCost, disabledReasonKey: orderedOr(moveCost) },
    demolish: { cost: demolishCost, disabledReasonKey: orderedOr(demolishCost) },
  };
}

/** Single-entry memo: the inspector asks every frame, but the flood only changes with the nav grid or the crew. */
let cutoffMemo: { grid: unknown; key: string; value: PlacementCutoff | null } | null = null;

function memoCutoff(state: GameState, buildingKey: string, next: Rect, freed: Rect): PlacementCutoff | null {
  const key = `${state.navGrid?.revision ?? -1}|${cutoffStateKey(state)}|${buildingKey}|${next.minX},${next.minZ},${next.maxX},${next.maxZ}`;
  if (cutoffMemo?.grid === state.navGrid && cutoffMemo.key === key) return cutoffMemo.value;
  const value = placementCutoffFor(state, next, freed);
  cutoffMemo = { grid: state.navGrid, key, value };
  return value;
}

type UpgradeRules = Pick<BuildingActionRules, 'upgrade' | 'research'>;

/** Upgrade verdict in the console's `build upgrade` order: max tier, demolition, locked, reserved terrain, cash. */
function upgradeRules(
  state: GameState, b: Building, ordered: boolean, reservations: ReadonlyArray<TerrainReservation>,
): UpgradeRules {
  const refused = (reasonKey: string, nextTier: BuildingTier | null, cost: number | null, params?: Record<string, string | number>): UpgradeRules => ({
    upgrade: { kind: 'refused', cost, reasonKey, ...(params ? { reasonParams: params } : {}), nextTier, cutoff: null }, research: null,
  });
  if (isSingleTierType(b.type)) return refused('inspector.reason.single_tier', null, null);
  if (b.tier >= 3) return refused('inspector.reason.max_tier', null, null);
  const nextTier = (b.tier + 1) as BuildingTier;
  const cost = getUpgradeCost(b, nextTier);
  if (ordered) return refused('inspector.reason.demolition_ordered', nextTier, cost);

  if (!isTierUnlocked(state.buildings, b.type, nextTier)) {
    const def = getResearchTaskDef(b.type, nextTier as 2 | 3);
    const task = state.buildings.researchQueue.find(r => r.targetType === b.type && r.targetTier === nextTier);
    return {
      upgrade: {
        kind: 'locked', cost, reasonKey: 'ui.build.research_required', reasonParams: { tier: nextTier },
        nextTier, cutoff: null,
      },
      research: {
        type: b.type,
        tier: nextTier,
        cost: researchCostFor(def.cost, state.events.activeModifiers, state.tickCount),
        duration: def.ticks,
        queued: task ? { fraction: getResearchProgress(task).fraction, remaining: task.ticksRemaining } : null,
      },
    };
  }

  const { sizeX, sizeZ } = getDefSize(getBuildingDef(b.type, nextTier));
  const next = { minX: b.x, minZ: b.z, maxX: b.x + sizeX, maxZ: b.z + sizeZ };
  const blocking = reservationBlocking(reservations, next);
  if (blocking !== null) return refused(RESERVATION_REFUSAL[blocking].errorKey, nextTier, cost);
  if (state.cash < cost) {
    return refused(REASON_CASH, nextTier, cost, { need: formatMoney(cost), have: formatMoney(state.cash) });
  }
  const { sizeX: curX, sizeZ: curZ } = getDefSize(getBuildingDef(b.type, b.tier));
  const cutoff = memoCutoff(state, `${b.id}:${b.tier}`, next, { minX: b.x, minZ: b.z, maxX: b.x + curX, maxZ: b.z + curZ });
  return {
    upgrade: { kind: 'available', cost, reasonKey: null, nextTier, cutoff: cutoff ? cutoff.cells : null },
    research: null,
  };
}
