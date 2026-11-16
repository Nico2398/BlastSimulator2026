// Which building actions the inspector offers, and why one is not (#1758).

import {
  getBuildingDef, getDefSize, getDemolishCost, getMoveCost, getUpgradeCost,
  isSingleTierType,
  type Building, type BuildingTier,
} from '../core/entities/Building.js';
import { RESERVATION_REFUSAL, reservationBlocking, terrainReservations, type TerrainReservation } from '../core/entities/PlacementReservations.js';
import { DEMOLITION_VEHICLE_ROLE, isDemolitionOrdered } from '../core/engine/BuildingDemolition.js';
import { isUpgradeOrdered } from '../core/engine/BuildingUpgrade.js';
import { buildingTierLockedByQuest } from '../core/economy/Quests.js';
import { t } from '../core/i18n/I18n.js';
import { roleShortfall } from '../core/engine/OrderReachability.js';
import { isEligibleForWork } from '../core/entities/Employee.js';
import { formatMoney } from '../core/economy/formatMoney.js';
import type { GameState } from '../core/state/GameState.js';
import type { PlacementCutoff } from '../core/entities/Building.js';
import { memoizedPlacementCutoff } from './placementCutoffConfirm.js';

/** Reason key shared by every action refused for short cash; BuildMenu keeps its plain `$cost` tooltip for it. */
export const REASON_CASH = 'inspector.reason.cash';

export type InspectorWaitKey = 'inspector.wait.no_vehicle' | 'inspector.wait.no_driver';

export interface BuildingActionRules {
  upgrade: {
    kind: 'available' | 'locked' | 'refused';
    cost: number | null;
    reasonKey: string | null;
    reasonParams?: Record<string, string | number>;
    nextTier: BuildingTier | null;
    /** What the upgraded footprint would strand from the crew (#1391); null when nothing or not applicable. */
    cutoff: PlacementCutoff | null;
  };
  move: { cost: number; disabledReasonKey: string | null };
  demolish: { cost: number; disabledReasonKey: string | null; waitKey: InspectorWaitKey | null };
}

export function buildingActionRules(
  state: GameState,
  b: Building,
  reservations: ReadonlyArray<TerrainReservation> = terrainReservations(state),
): BuildingActionRules {
  const ordered = isDemolitionOrdered(state, b.id);
  const upgrading = isUpgradeOrdered(state, b.id);
  const orderedOr = (cost: number): string | null => {
    if (ordered) return 'inspector.reason.demolition_ordered';
    if (upgrading) return 'inspector.reason.upgrade_ordered';
    return state.cash < cost ? REASON_CASH : null;
  };
  const moveCost = getMoveCost(b);
  const demolishCost = getDemolishCost(b);
  const upgrade = upgradeRules(state, b, ordered, upgrading, reservations);
  const demolishWait = ordered || upgrading ? null : demolitionWaitKey(state.vehicles, state.employees);
  return {
    upgrade,
    move: { cost: moveCost, disabledReasonKey: orderedOr(moveCost) },
    demolish: { cost: demolishCost, disabledReasonKey: orderedOr(demolishCost), waitKey: demolishWait },
  };
}

/**
 * Why a demolition order would wait for want of a Building Destroyer or a licensed driver; null when none.
 */
function demolitionWaitKey(vehicles: GameState['vehicles'], employees: GameState['employees']): InspectorWaitKey | null {
  const shortfall = roleShortfall(vehicles.vehicles, employees.employees.filter(isEligibleForWork), DEMOLITION_VEHICLE_ROLE);
  if (shortfall === null) return null;
  return shortfall === 'no_vehicle_in_fleet' ? 'inspector.wait.no_vehicle' : 'inspector.wait.no_driver';
}

/** Upgrade verdict in the console's `build upgrade` order: max tier, demolition, upgrade ordered, locked by quest, reserved terrain, cash. */
function upgradeRules(
  state: GameState, b: Building, ordered: boolean, upgrading: boolean, reservations: ReadonlyArray<TerrainReservation>,
): BuildingActionRules['upgrade'] {
  const refused = (reasonKey: string, nextTier: BuildingTier | null, cost: number | null, params?: Record<string, string | number>): BuildingActionRules['upgrade'] => ({
    kind: 'refused', cost, reasonKey, ...(params ? { reasonParams: params } : {}), nextTier, cutoff: null,
  });
  if (isSingleTierType(b.type)) return refused('inspector.reason.single_tier', null, null);
  if (b.tier >= 3) return refused('inspector.reason.max_tier', null, null);
  const nextTier = (b.tier + 1) as 2 | 3; // b.tier < 3 here
  const cost = getUpgradeCost(b.type, nextTier);
  if (ordered) return refused('inspector.reason.demolition_ordered', nextTier, cost);
  if (upgrading) return refused('inspector.reason.upgrade_ordered', nextTier, cost);

  const lockedBy = buildingTierLockedByQuest(state, b.type, nextTier);
  if (lockedBy) {
    return {
      kind: 'locked', cost, reasonKey: 'inspector.reason.quest_required',
      reasonParams: { tier: nextTier, quest: t(lockedBy.titleKey) }, nextTier, cutoff: null,
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
  const cutoff = memoizedPlacementCutoff(state, next, { minX: b.x, minZ: b.z, maxX: b.x + curX, maxZ: b.z + curZ });
  return { kind: 'available', cost, reasonKey: null, nextTier, cutoff };
}
