// BlastSimulator2026 — Event registration
// Imports all event definitions and registers them in the global pool.

import { registerEvents, clearEvents } from './EventPool.js';
import type { EventDef } from './EventPool.js';

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
import { PERMIT_EVENTS_1 } from './PermitEvents1.js';

export { clearEvents } from './EventPool.js';

/**
 * Every event definition file, keyed by file name. Single source for pool
 * registration and the balance report (#1894).
 */
export const EVENT_FILES: Readonly<Record<string, EventDef[]>> = {
  'UnionEvents1.ts': UNION_EVENTS_1,
  'UnionEvents2.ts': UNION_EVENTS_2,
  'PoliticsEvents1.ts': POLITICS_EVENTS_1,
  'PoliticsEvents2.ts': POLITICS_EVENTS_2,
  'WeatherEvents1.ts': WEATHER_EVENTS_1,
  'WeatherEvents2.ts': WEATHER_EVENTS_2,
  'MafiaEvents1.ts': MAFIA_EVENTS_1,
  'MafiaEvents2.ts': MAFIA_EVENTS_2,
  'LawsuitEvents1.ts': LAWSUIT_EVENTS_1,
  'LawsuitEvents2.ts': LAWSUIT_EVENTS_2,
  'FollowUpEvents.ts': FOLLOWUP_EVENTS,
  'TrafficJamEvents.ts': TRAFFIC_JAM_EVENTS,
  'UnqualifiedTaskEvents.ts': UNQUALIFIED_TASK_EVENTS,
  'OreReportEvents.ts': ORE_REPORT_EVENTS,
  'TutorialEvents.ts': TUTORIAL_EVENTS,
  'PermitEvents1.ts': PERMIT_EVENTS_1,
};

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
  for (const events of Object.values(EVENT_FILES)) registerEvents(events);
}
