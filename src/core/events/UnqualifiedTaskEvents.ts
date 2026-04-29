// BlastSimulator2026 — Unqualified task error event definition
// Fires when a pending action has no qualified employee on the roster.

import { ev } from './EventBuilder.js';
import type { EventDef } from './EventPool.js';

export const UNQUALIFIED_TASK_EVENTS: EventDef[] = [
  // unqualified_task_error — fires when ≥1 pending action has no qualified employee on the roster
  ev('unqualified_task_error', 'traffic', {
    weight: () => 1,
    options: [
      { effectTag: 'train_employee' },
      { cashDelta: -25000, effectTag: 'hire_contractor' },
      { effectTag: 'cancel_task' },
    ],
  }),
];
