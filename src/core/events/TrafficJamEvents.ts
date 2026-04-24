// BlastSimulator2026 — Traffic jam event definitions
// Fires when ≥3 vehicles are waiting on the same path for ≥10 ticks.

import { ev } from './EventBuilder.js';
import type { EventDef } from './EventPool.js';

export const TRAFFIC_JAM_EVENTS: EventDef[] = [
  // traffic_jam — fires when ≥3 vehicles waiting on same path ≥10 ticks
  ev('traffic_jam', 'traffic', {
    weight: () => 1,
    options: [
      { effectTag: 'reroute_vehicles' },
      { cashDelta: -15000, effectTag: 'widen_ramp' },
      { effectTag: 'ignore_jam' },
    ],
  }),
];
