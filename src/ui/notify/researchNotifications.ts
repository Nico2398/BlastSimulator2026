// BlastSimulator2026 — Research event toasts (#1398)
// Subscribes to research core events and raises localized notifications.

import type { EventEmitter } from '../../core/state/EventEmitter.js';
import type { NotifyInput } from './NotificationCenter.js';
import { t } from '../../core/i18n/I18n.js';
import { formatMoney } from '../../core/economy/formatMoney.js';

/** Wires research:completed and research:cancelled to `notify`. */
export function wireResearchNotifications(
  emitter: Pick<EventEmitter, 'on'>,
  notify: (input: NotifyInput) => void,
): void {
  emitter.on('research:completed', ({ targetType, targetTier }) =>
    notify({
      severity: 'positive',
      title: t('notification.title.research'),
      body: t('notification.research.completed', { type: t(`building.${targetType}.name`), tier: targetTier }),
    }));
  emitter.on('research:cancelled', ({ targetType, targetTier, refund }) =>
    notify({
      severity: 'warn',
      title: t('notification.title.research'),
      body: t('notification.research.cancelled', {
        type: t(`building.${targetType}.name`),
        tier: targetTier,
        refund: formatMoney(refund),
      }),
    }));
}
