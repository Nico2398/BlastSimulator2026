// BlastSimulator2026 — Mine-grade progression toasts (#1926)
// Subscribes to progression core events and raises localized notifications.

import type { EventEmitter } from '../../core/state/EventEmitter.js';
import type { NotifyInput } from './NotificationCenter.js';

/** Wires progression:grade_applied to `notify`. */
export function wireProgressionNotifications(
  _emitter: Pick<EventEmitter, 'on'>,
  _notify: (input: NotifyInput) => void,
): void {
  // TODO: implement
}
