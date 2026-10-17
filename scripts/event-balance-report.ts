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
import { EVENT_FILES } from '../src/core/events/index.js';

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
