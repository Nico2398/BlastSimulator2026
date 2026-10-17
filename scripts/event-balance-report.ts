/**
 * BlastSimulator2026 — Event option balance report (#1894)
 *
 * Prints every event option that is Pareto-dominated by a sibling option,
 * grouped by event file, with each side's value vector and option label keys.
 *
 * Usage: npx tsx scripts/event-balance-report.ts
 * Exit code: 0 when no option is dominated, 1 otherwise.
 *
 * @module event-balance-report
 */

import type { EventDef } from '../src/core/events/EventPool.js';
import { findDominatedPairs, optionValue } from '../src/core/events/EventOptionBalance.js';
import { UNION_EVENTS_1 } from '../src/core/events/UnionEvents1.js';
import { UNION_EVENTS_2 } from '../src/core/events/UnionEvents2.js';
import { POLITICS_EVENTS_1 } from '../src/core/events/PoliticsEvents1.js';
import { POLITICS_EVENTS_2 } from '../src/core/events/PoliticsEvents2.js';
import { WEATHER_EVENTS_1 } from '../src/core/events/WeatherEvents1.js';
import { WEATHER_EVENTS_2 } from '../src/core/events/WeatherEvents2.js';
import { MAFIA_EVENTS_1 } from '../src/core/events/MafiaEvents1.js';
import { MAFIA_EVENTS_2 } from '../src/core/events/MafiaEvents2.js';
import { LAWSUIT_EVENTS_1 } from '../src/core/events/LawsuitEvents1.js';
import { LAWSUIT_EVENTS_2 } from '../src/core/events/LawsuitEvents2.js';
import { FOLLOWUP_EVENTS } from '../src/core/events/FollowUpEvents.js';
import { TRAFFIC_JAM_EVENTS } from '../src/core/events/TrafficJamEvents.js';
import { UNQUALIFIED_TASK_EVENTS } from '../src/core/events/UnqualifiedTaskEvents.js';
import { ORE_REPORT_EVENTS } from '../src/core/events/OreReportEvents.js';
import { TUTORIAL_EVENTS } from '../src/core/events/TutorialEvents.js';

const EVENT_FILES: Record<string, readonly EventDef[]> = {
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
};

function vector(ev: EventDef, index: number): string {
  const { dims, opaque } = optionValue(ev.consequences[index]!);
  const parts = Object.entries(dims).filter(([, v]) => v !== 0).map(([k, v]) => `${k}=${+v.toFixed(4)}`);
  if (opaque) parts.push(`opaque=${opaque}`);
  return `${ev.options[index]!.labelKey} {${parts.join(', ')}}`;
}

let total = 0;
for (const [file, events] of Object.entries(EVENT_FILES)) {
  const lines: string[] = [];
  for (const ev of events) {
    for (const { winner, loser } of findDominatedPairs(ev)) {
      total++;
      lines.push(`  ${ev.id}: option ${winner} > option ${loser}`,
        `    winner: ${vector(ev, winner)}`, `    loser:  ${vector(ev, loser)}`);
    }
  }
  if (lines.length > 0) console.log(`${file}\n${lines.join('\n')}`);
}
console.log(total === 0 ? 'No dominated event options.' : `${total} dominated option pair(s).`);
process.exit(total === 0 ? 0 : 1);
