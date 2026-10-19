// BlastSimulator2026 — Mine-grade progression toasts (#1926)
// Subscribes to progression core events and raises localized notifications.

import type { EventEmitter } from '../../core/state/EventEmitter.js';
import type { NotifyInput } from './NotificationCenter.js';
import { t } from '../../core/i18n/I18n.js';
import { gradeDef } from '../../core/economy/MineGrade.js';

/** Wires progression:grade_applied and progression:grade_approved to `notify`. */
export function wireProgressionNotifications(
  emitter: Pick<EventEmitter, 'on'>,
  notify: (input: NotifyInput) => void,
): void {
  emitter.on('progression:grade_applied', () =>
    notify({ severity: 'info', title: t('notification.title.permit'), body: t('notification.progression.applied') }));
  emitter.on('progression:grade_approved', ({ grade }) => {
    const def = gradeDef(grade);
    notify({ severity: 'info', title: t('notification.title.permit'), body: t('notification.progression.approved', { name: t(def.nameKey, def.nameParams) }) });
  });
}
