// BlastSimulator2026 — Crew event toasts (#1387)
// Subscribes to crew-related core events and raises localized notifications.

import type { EventEmitter } from '../../core/state/EventEmitter.js';
import type { GameState } from '../../core/state/GameState.js';
import type { NotifyInput, Severity } from './NotificationCenter.js';
import { CREW_TOAST_COOLDOWN_TICKS } from '../../core/config/balance.js';
import { t } from '../../core/i18n/I18n.js';
import { formatMoney } from '../../core/economy/formatMoney.js';

type CrewKind = 'collapsed' | 'need_warning' | 'levelup' | 'trained' | 'training_cancelled' | 'stuck' | 'action_abandoned';

const CREW_SEVERITY: Record<CrewKind, Severity> = {
  collapsed: 'critical',
  need_warning: 'warn',
  stuck: 'warn',
  action_abandoned: 'warn',
  training_cancelled: 'warn',
  levelup: 'info',
  trained: 'info',
};

/** Kinds that can repeat every tick while the cause persists, throttled per employee. */
const COOLDOWN_KINDS: ReadonlySet<CrewKind> = new Set<CrewKind>(['stuck', 'action_abandoned']);

/**
 * Wires employee:collapsed, employee:need_warning, employee:levelup,
 * employee:trained, employee:training_cancelled, agent:stuck and
 * agent:action_abandoned to `notify`.
 */
export function wireCrewNotifications(
  emitter: Pick<EventEmitter, 'on'>,
  getState: () => GameState | null,
  notify: (input: NotifyInput) => void,
): void {
  const lastToastTick = new Map<string, number>();

  const nameOf = (employeeId: number): string =>
    getState()?.employees.employees.find(e => e.id === employeeId)?.name ?? `#${employeeId}`;

  const raise = (kind: CrewKind, employeeId: number, params: Record<string, string | number> = {}): void => {
    if (COOLDOWN_KINDS.has(kind)) {
      const tick = getState()?.tickCount ?? 0;
      const key = `${employeeId}:${kind}`;
      const last = lastToastTick.get(key);
      if (last !== undefined && tick - last < CREW_TOAST_COOLDOWN_TICKS) return;
      lastToastTick.set(key, tick);
    }
    notify({
      severity: CREW_SEVERITY[kind],
      title: t('notification.title.crew'),
      body: t(`notification.crew.${kind}`, { name: nameOf(employeeId), ...params }),
    });
  };

  emitter.on('employee:collapsed', ({ employeeId, needKey }) =>
    raise('collapsed', employeeId, { need: t(`need.${needKey}`) }));
  emitter.on('employee:need_warning', ({ employeeId, needKey }) =>
    raise('need_warning', employeeId, { need: t(`need.${needKey}`) }));
  emitter.on('agent:stuck', ({ employeeId }) => raise('stuck', employeeId));
  emitter.on('agent:action_abandoned', ({ employeeId }) => raise('action_abandoned', employeeId));
  emitter.on('employee:training_cancelled', ({ employeeId, skill, refund }) =>
    raise('training_cancelled', employeeId, { skill: t(`skill.${skill}`), refund: formatMoney(refund) }));
  emitter.on('employee:levelup', ({ employeeId, category, newLevel }) =>
    raise('levelup', employeeId, { skill: t(`skill.${category}`), level: newLevel }));
  emitter.on('employee:trained', ({ employeeId, skill, level, isNew }) => {
    const params = { skill: t(`skill.${skill}`), level };
    if (isNew) raise('trained', employeeId, params);
    else notify({
      severity: CREW_SEVERITY.trained,
      title: t('notification.title.crew'),
      body: t('notification.crew.trained_level', { name: nameOf(employeeId), ...params }),
    });
  });
}
