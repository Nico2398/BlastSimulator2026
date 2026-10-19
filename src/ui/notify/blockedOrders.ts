// BlastSimulator2026 — Blocked-order classification and wording (#1061, #1810)
//
// Shared by the notification center, the Operations panel and the vehicle inspector.

import type { PendingAction, BlockedOrderReason } from '../../core/state/GameState.js';
import { readOrderDeliveryTick } from '../../core/mining/ExplosiveStock.js';
import { formatGameClock } from '../formatGameClock.js';
import { formatGameDuration } from '../formatGameDuration.js';
import { t } from '../../core/i18n/I18n.js';
import { ACTION_LABEL_KEY } from '../crewDetailSections.js';

/** True when the block is a failure the player must fix (vs. a stranded-debris or explosives-in-transit wait) (#1810, #1895). */
export function isFailureBlock(action: Pick<PendingAction, 'blockedReason'>): boolean {
  return action.blockedReason != null && action.blockedReason !== 'debris_out_of_reach' && !isInTransitBlock(action);
}

/** True while a charge order waits for its explosives to arrive (#1895): a neutral wait, not a failure. */
export function isInTransitBlock(action: Pick<PendingAction, 'blockedReason'>): boolean {
  return action.blockedReason === 'explosives_in_transit';
}

/** Block state of a QUEUED order (callers filter on status): the one ladder behind the Operations counts and groups. */
export function classifyQueuedBlock(action: Pick<PendingAction, 'blockedReason'>): 'open' | 'inTransit' | 'blocked' | 'stranded' {
  if (action.blockedReason == null) return 'open';
  if (isInTransitBlock(action)) return 'inTransit';
  return isFailureBlock(action) ? 'blocked' : 'stranded';
}

/** Builds the notification body naming the blocked order and its missing requirement (#1061). */
export function buildBlockedOrderMessage(action: PendingAction, nowTick?: number): string {
  const order = t(ACTION_LABEL_KEY[action.type]);
  switch (action.blockedReason) {
    case 'no_vehicle_in_fleet':
      return t('notification.order_blocked_no_vehicle', { order, role: t(`vehicle_type.${action.requiredVehicleRole}`) });
    case 'no_licensed_driver':
      return t('notification.order_blocked_no_driver', { order, role: t(`vehicle_type.${action.requiredVehicleRole}`) });
    case 'licence_level_too_low':
      return t('notification.order_blocked_licence_level', {
        order,
        licence: t(`vehicle_type.${action.requiredVehicleRole}`),
        level: action.blockedLicenceLevel ?? 1,
      });
    case 'no_reaching_vehicle':
      return t('notification.order_blocked_no_reaching_vehicle', {
        order,
        tier: action.blockedLicenceLevel ?? 1,
        role: t(`vehicle_type.${action.requiredVehicleRole}`),
      });
    case 'no_qualified_employee':
      return action.requiredSkill !== null
        ? t('notification.order_blocked_no_employee', { order, skill: t(`skill.${action.requiredSkill}`) })
        : t('notification.order_blocked_no_staff', { order });
    case 'no_dual_qualified_employee':
      return t('notification.order_blocked_no_dual_employee', {
        order,
        licence: t(`vehicle_type.${action.requiredVehicleRole}`),
        skill: t(`skill.${action.requiredSkill}`),
      });
    case 'target_unreachable':
      const detail = action.blockedDetail;
      if (detail !== undefined && typeof detail.key === 'string' && typeof detail.params === 'object' && detail.params !== null) {
        const { key, params } = detail;
        return t(key, typeof params['role'] === 'string' ? { ...params, role: t(`vehicle_type.${params['role']}`) } : params);
      }
      return t('notification.order_blocked_target_unreachable', { order });
    case 'no_freight_warehouse':
      return t('notification.order_blocked_no_warehouse', { order });
    case 'no_spoil_heap':
      return t('notification.order_blocked_no_spoil_heap', { order });
    case 'spoil_heap_full':
      return t('notification.order_blocked_spoil_heap_full', { order });
    case 'storage_full':
      return t('notification.order_blocked_storage_full', { order });
    case 'buried_under_rubble':
      return t('notification.order_blocked_buried', { order });
    case 'explosives_in_transit': {
      const arrivalTick = readOrderDeliveryTick(action) ?? 0;
      const when = formatGameClock(arrivalTick);
      return nowTick === undefined
        ? t('notification.order_blocked_in_transit_no_eta', { order, when })
        : t('notification.order_blocked_in_transit', {
          order, when, duration: formatGameDuration(Math.max(0, arrivalTick - nowTick)),
        });
    }
    case 'debris_out_of_reach':
      // Not toasted from update() (one summary pip instead); the Operations panel shows it per order.
      return t('notification.order_stranded_debris', { order });
    default:
      return order;
  }
}

/** Max cause lines shown for a pile of blocked orders. */
export const BLOCKED_PHRASE_LINES = 3;

const BLOCKED_PHRASE_KINDS = ['crew_fleet', 'storage_full', 'no_warehouse', 'no_spoil_heap', 'spoil_heap_full', 'unreachable', 'buried'] as const;

type BlockedPhraseKind = typeof BLOCKED_PHRASE_KINDS[number];

interface BlockedKindCount { kind: BlockedPhraseKind; count: number }

/** Phrase kind per reason; exhaustive, so a new BlockedOrderReason fails to compile until classified. null = not a failure. */
const PHRASE_KIND_BY_REASON: Record<BlockedOrderReason, BlockedPhraseKind | null> = {
  no_qualified_employee: 'crew_fleet',
  no_dual_qualified_employee: 'crew_fleet',
  no_vehicle_in_fleet: 'crew_fleet',
  no_licensed_driver: 'crew_fleet',
  licence_level_too_low: 'crew_fleet',
  no_reaching_vehicle: 'crew_fleet',
  storage_full: 'storage_full',
  no_freight_warehouse: 'no_warehouse',
  no_spoil_heap: 'no_spoil_heap',
  spoil_heap_full: 'spoil_heap_full',
  target_unreachable: 'unreachable',
  buried_under_rubble: 'buried',
  debris_out_of_reach: null,
  explosives_in_transit: null,
};

/** Phrase kind of a failure reason; null for non-failure or absent reasons. */
export function blockedPhraseKind(reason: BlockedOrderReason | null | undefined): BlockedPhraseKind | null {
  return reason == null ? null : PHRASE_KIND_BY_REASON[reason];
}

/** Adds one order to a reason tally when it is a failure block; the single increment behind every tally. */
export function tallyBlockedReason(counts: Partial<Record<BlockedOrderReason, number>>, action: Pick<PendingAction, 'blockedReason'>): void {
  if (!isFailureBlock(action) || action.blockedReason == null) return;
  counts[action.blockedReason] = (counts[action.blockedReason] ?? 0) + 1;
}

/** Tallies failure-block reasons across orders. */
export function countBlockedReasons(actions: readonly Pick<PendingAction, 'blockedReason'>[]): Partial<Record<BlockedOrderReason, number>> {
  const counts: Partial<Record<BlockedOrderReason, number>> = {};
  for (const a of actions) tallyBlockedReason(counts, a);
  return counts;
}

/** Failure kinds with counts, largest first; ties by union order. */
export function rankBlockedKinds(counts: Partial<Record<BlockedOrderReason, number>>): BlockedKindCount[] {
  const byKind: Partial<Record<BlockedPhraseKind, number>> = {};
  for (const reason of Object.keys(counts) as BlockedOrderReason[]) {
    const kind = blockedPhraseKind(reason);
    const n = counts[reason] ?? 0;
    if (kind !== null && n > 0) byKind[kind] = (byKind[kind] ?? 0) + n;
  }
  // Array.sort is stable: ties keep BLOCKED_PHRASE_KINDS (union) order.
  return BLOCKED_PHRASE_KINDS
    .map(kind => ({ kind, count: byKind[kind] ?? 0 }))
    .filter(e => e.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** Count plus remedy sentence for one kind. */
export function blockedPhrase(entry: BlockedKindCount): string {
  return t(`notification.blocked_phrase.${entry.kind}`, { count: entry.count.toLocaleString('en-US') });
}

/** Short label for a kind, e.g. "storage full". */
export function blockedKindLabel(kind: BlockedPhraseKind): string {
  return t(`notification.blocked_kind.${kind}`);
}

/** Up to `max` phrases for the largest blocked kinds. */
export function describeBlockedReasons(counts: Partial<Record<BlockedOrderReason, number>>, max: number = BLOCKED_PHRASE_LINES): string[] {
  return rankBlockedKinds(counts).slice(0, max).map(blockedPhrase);
}
