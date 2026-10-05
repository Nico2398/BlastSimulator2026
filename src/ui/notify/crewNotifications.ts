// BlastSimulator2026 — Crew event toasts (#1387)
// Subscribes to crew-related core events and raises localized notifications.

import type { EventEmitter } from '../../core/state/EventEmitter.js';
import type { GameState } from '../../core/state/GameState.js';
import type { NotifyInput } from './NotificationCenter.js';

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
  void emitter; void getState; void notify;
  // TODO: implement
}
