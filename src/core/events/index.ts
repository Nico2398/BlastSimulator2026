// BlastSimulator2026 — Event registration
// Imports all event definitions and registers them in the global pool.

import { registerEvents } from './EventPool.js';

import { UNION_EVENTS_1 } from './UnionEvents1.js';
import { UNION_EVENTS_2 } from './UnionEvents2.js';
import { POLITICS_EVENTS_1 } from './PoliticsEvents1.js';
import { POLITICS_EVENTS_2 } from './PoliticsEvents2.js';
import { WEATHER_EVENTS_1 } from './WeatherEvents1.js';
import { WEATHER_EVENTS_2 } from './WeatherEvents2.js';
import { MAFIA_EVENTS_1 } from './MafiaEvents1.js';
import { MAFIA_EVENTS_2 } from './MafiaEvents2.js';
import { LAWSUIT_EVENTS_1 } from './LawsuitEvents1.js';
import { LAWSUIT_EVENTS_2 } from './LawsuitEvents2.js';
import { FOLLOWUP_EVENTS } from './FollowUpEvents.js';
import { TRAFFIC_JAM_EVENTS } from './TrafficJamEvents.js';

/** Register all 258 events into the global pool. Call once at app init. */
export function setupEvents(): void {
  registerEvents(UNION_EVENTS_1);
  registerEvents(UNION_EVENTS_2);
  registerEvents(POLITICS_EVENTS_1);
  registerEvents(POLITICS_EVENTS_2);
  registerEvents(WEATHER_EVENTS_1);
  registerEvents(WEATHER_EVENTS_2);
  registerEvents(MAFIA_EVENTS_1);
  registerEvents(MAFIA_EVENTS_2);
  registerEvents(LAWSUIT_EVENTS_1);
  registerEvents(LAWSUIT_EVENTS_2);
  registerEvents(FOLLOWUP_EVENTS);
  registerEvents(TRAFFIC_JAM_EVENTS);
}
