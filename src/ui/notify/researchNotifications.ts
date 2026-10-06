// BlastSimulator2026 — Research event toasts (#1398)
// Subscribes to research core events and raises localized notifications.

import type { EventEmitter } from '../../core/state/EventEmitter.js';
import type { NotifyInput } from './NotificationCenter.js';

/** Wires research:completed and research:cancelled to `notify`. */
export function wireResearchNotifications(
  emitter: Pick<EventEmitter, 'on'>,
  notify: (input: NotifyInput) => void,
): void {
  void emitter;
  void notify;
  // TODO: implement
}
