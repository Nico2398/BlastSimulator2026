// BlastSimulator2026 — Ore report event definitions
// Fires when a blast produces notable ore yield conditions.

import { ev } from './EventBuilder.js';
import type { EventDef } from './EventPool.js';

export const ORE_REPORT_EVENTS: EventDef[] = [
  // lucky_strike — blast yielded significantly more ore than survey estimated
  ev('lucky_strike', 'mining', {
    weight: () => 1,
    options: [
      { cashDelta: 10000, effectTag: 'bonus_paid' },
      { cashDelta: 5000, scoreDelta: { wellBeing: 5 }, effectTag: 'team_bonus' },
      { cashDelta: 0, scoreDelta: { safety: 3 }, effectTag: 'celebrate_safely' },
    ],
  }),

  // barren_blast — blast yielded far less ore than survey estimated
  ev('barren_blast', 'mining', {
    weight: () => 1,
    options: [
      { cashDelta: -5000, effectTag: 'geologist_review' },
      { cashDelta: 0, scoreDelta: { safety: -3 }, effectTag: 'blame_crew' },
      { cashDelta: -10000, scoreDelta: { wellBeing: -5 }, effectTag: 'order_new_survey' },
    ],
  }),

  // legendary_vein — treranium was found in the blast yield
  ev('legendary_vein', 'mining', {
    weight: () => 1,
    options: [
      { cashDelta: 25000, effectTag: 'celebrate_find' },
      { cashDelta: 10000, scoreDelta: { wellBeing: 10 }, effectTag: 'share_wealth' },
      { cashDelta: 5000, scoreDelta: { ecology: 5 }, effectTag: 'research_vein' },
    ],
  }),

  // absurdium_jackpot — absurdium makes up >30% of blast yield
  ev('absurdium_jackpot', 'mining', {
    weight: () => 1,
    options: [
      { cashDelta: 50000, effectTag: 'jackpot_bonus' },
      { cashDelta: 20000, scoreDelta: { wellBeing: 8, safety: -5 }, effectTag: 'wild_celebration' },
      { cashDelta: 15000, scoreDelta: { ecology: -8 }, effectTag: 'expedite_mining' },
    ],
  }),
];
