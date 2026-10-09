// BlastSimulator2026 — Corruption / mafia event toasts (#1411)
// Subscribes to corruption and mafia core events and raises localized notifications.

import type { EventEmitter } from '../../core/state/EventEmitter.js';
import type { NotifyInput } from './NotificationCenter.js';
import { t } from '../../core/i18n/I18n.js';
import { formatMoney } from '../../core/economy/formatMoney.js';

/** Wires corruption:scandal, mafia:investigation, mafia:tax_audit and mafia:exposed to `notify`. */
export function wireCorruptionNotifications(
  emitter: Pick<EventEmitter, 'on'>,
  notify: (input: NotifyInput) => void,
): void {
  emitter.on('corruption:scandal', ({ target, fine }) =>
    notify({
      severity: 'critical',
      title: t('notification.title.scandal'),
      body: t('notification.corruption.scandal', { target: t(`corruption.target.${target}`), fine: formatMoney(fine) }),
    }));
  emitter.on('mafia:investigation', () =>
    notify({
      severity: 'warn',
      title: t('notification.title.investigation'),
      body: t('notification.mafia.investigation'),
    }));
  emitter.on('mafia:tax_audit', ({ kind, amount }) =>
    notify(kind === 'clean'
      ? { severity: 'info', title: t('notification.title.tax_audit'), body: t('notification.mafia.tax_audit_clean') }
      : { severity: 'critical', title: t('notification.title.tax_audit'), body: t('notification.mafia.tax_audit_regularisation', { amount: formatMoney(amount) }) }));
  emitter.on('mafia:exposed', () =>
    notify({
      severity: 'critical',
      title: t('notification.title.investigation'),
      body: t('notification.mafia.exposed'),
    }));
}
