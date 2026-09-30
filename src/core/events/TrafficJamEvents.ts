// BlastSimulator2026 — Traffic jam event definitions
// Fires when ≥3 agents are stuck at one chokepoint for ≥10 ticks (TrafficJams.ts).

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
