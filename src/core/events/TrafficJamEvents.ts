// BlastSimulator2026 — Traffic jam event definitions
// Fires when ≥TRAFFIC_JAM_MIN_AGENTS agents are stuck at one chokepoint for ≥TRAFFIC_JAM_MIN_TICKS ticks (TrafficJams.ts).

import { ev } from './EventBuilder.js';
import type { EventDef } from './EventPool.js';

export const TRAFFIC_JAM_EVENTS: EventDef[] = [
  // traffic_jam — the option effects live in TrafficJamEffects.ts, keyed by effectTag
  ev('traffic_jam', 'traffic', {
    weight: () => 1,
    options: [
      { effectTag: 'reroute_vehicles' },
      { effectTag: 'widen_ramp' },
      { effectTag: 'ignore_jam' },
    ],
  }),
];
