// BlastSimulator2026 — Blocked-order classification and wording (#1061, #1810)
//
// Shared by the notification center, the Operations panel and the vehicle inspector.

import type { PendingAction } from '../../core/state/GameState.js';
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
      return t('notification.order_blocked_target_unreachable', { order });
    case 'no_freight_warehouse':
      return t('notification.order_blocked_no_warehouse', { order });
    case 'no_spoil_heap':
      return t('notification.order_blocked_no_spoil_heap', { order });
    case 'spoil_heap_full':
      return t('notification.order_blocked_spoil_heap_full', { order });
    case 'storage_full':
      return t('notification.order_blocked_storage_full', { order });
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
