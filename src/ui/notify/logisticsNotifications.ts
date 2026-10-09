// BlastSimulator2026 — Warehouse stock loss toast (#1372)
// Subscribes to the core logistics event and raises a localized notification.

import type { EventEmitter } from '../../core/state/EventEmitter.js';
import type { NotifyInput } from './NotificationCenter.js';
import { t } from '../../core/i18n/I18n.js';

/** Wires logistics:warehouse_stock_lost to `notify`. */
export function wireLogisticsNotifications(
  emitter: Pick<EventEmitter, 'on'>,
  notify: (input: NotifyInput) => void,
): void {
  emitter.on('logistics:warehouse_stock_lost', ({ buildingId, massKg }) =>
    notify({
      severity: 'warn',
      title: t('notification.title.warehouse_stock_lost'),
      body: t('notification.warehouse_stock_lost', { id: buildingId, kg: Math.round(massKg) }),
    }));
}
