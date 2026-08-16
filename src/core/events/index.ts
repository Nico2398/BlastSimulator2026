// BlastSimulator2026 — Event registration
// Imports all event definitions and registers them in the global pool.

import { registerEvents, clearEvents } from './EventPool.js';

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
import { UNQUALIFIED_TASK_EVENTS } from './UnqualifiedTaskEvents.js';
import { ORE_REPORT_EVENTS } from './OreReportEvents.js';
import { TUTORIAL_EVENTS } from './TutorialEvents.js';

export { clearEvents } from './EventPool.js';

/**
 * Register all event definitions into the global pool. Genuinely idempotent
 * (#597): every `createRunner()` call — one per scenario engine in a batch
 * run like `run-all-scenarios.ts` — used to call this again, and
 * `registerEvents` unconditionally pushes, so the shared pool doubled,
 * tripled, ... on every subsequent call in the same process. `selectEvent`'s
 * weighted pick indexes into that pool, so which event fired ended up
 * depending on how many *other* engines had already been created earlier in
 * the same process — nothing to do with the scenario's own seed or pacing.
 * Clearing first makes repeat calls converge on the same canonical set every
 * time, matching this function's own "call once at app init" contract even
 * though callers do not actually honor "once".
 */
export function setupEvents(): void {
  clearEvents();
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
  registerEvents(UNQUALIFIED_TASK_EVENTS);
  registerEvents(ORE_REPORT_EVENTS);
  registerEvents(TUTORIAL_EVENTS);
}
