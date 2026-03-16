// BlastSimulator2026 — Follow-up events
// Events triggered as consequences of other events' decision options.

import { ev } from './EventBuilder.js';
import type { EventDef } from './EventPool.js';

export const FOLLOWUP_EVENTS: EventDef[] = [
  // Follow-up to union_strike_threat (option 2: call their bluff → full strike)
  ev('union_strike_aftermath', 'union', {
    weight: () => 2,
    options: [
      // Capitulate: pay raises retroactively + ping-pong table
      { cashDelta: -40000, scoreDelta: { wellBeing: 25 }, effectTag: 'strike_capitulation' },
      // Hire scabs: production resumes but morale destroyed
      { cashDelta: -15000, scoreDelta: { wellBeing: -15, safety: -8 }, effectTag: 'scab_labor' },
      // Close the mine for maintenance (stalling tactic)
      { cashDelta: -10000, scoreDelta: { wellBeing: -5 }, effectTag: 'maintenance_shutdown' },
    ],
  }),

  // Follow-up to lawsuit_dust_fashion (option 2: fight in court)
  ev('lawsuit_dust_fashion_appeal', 'lawsuit', {
    weight: () => 1.5,
    options: [
      // Settle on appeal — pay more than the original offer
      { cashDelta: -40000, scoreDelta: { nuisance: -10 }, effectTag: 'appeal_settlement' },
      // Win on a technicality — PR nightmare though
      { cashDelta: -8000, scoreDelta: { nuisance: 8 }, effectTag: 'technicality_win' },
      // Bribe the appellate judge — risky at this level
      { corruptionDelta: 20, cashDelta: -15000, effectTag: 'bribe_appeals_court' },
    ],
  }),

  // Follow-up to lawsuit_ambulance_chaser (option 2: ignore the lawyer)
  ev('lawsuit_class_action_mega', 'lawsuit', {
    weight: () => 2,
    options: [
      // Mega-settlement: the ambulance chaser found 200 plaintiffs
      { cashDelta: -120000, scoreDelta: { safety: 10, wellBeing: 5 }, effectTag: 'mega_payout' },
      // Fight it — very expensive legal battle
      { cashDelta: -60000, scoreDelta: { safety: -5 }, probability: 0.3,
        alt: { cashDelta: -200000, scoreDelta: { safety: -10, wellBeing: -10 } } },
      // Declare bankruptcy and restructure (drastic)
      { cashDelta: -80000, scoreDelta: { wellBeing: -20 }, effectTag: 'bankruptcy_restructure' },
    ],
  }),

  // Follow-up to lawsuit_village_coalition (option 2: partial settlement)
  ev('lawsuit_village_coalition_2', 'lawsuit', {
    weight: () => 1.8,
    options: [
      // Full settlement with community investment fund
      { cashDelta: -80000, scoreDelta: { nuisance: -20, ecology: 15 }, effectTag: 'community_fund' },
      // Individual village deals (divide and conquer)
      { cashDelta: -35000, scoreDelta: { nuisance: -8 }, corruptionDelta: 8, effectTag: 'divide_villages' },
      // Government mediation — slow but fair
      { cashDelta: -20000, scoreDelta: { nuisance: -5, ecology: 5 }, effectTag: 'govt_mediation' },
    ],
  }),

  // Follow-up to politics_mayor_antimine (option 3: do nothing → mayor wins)
  ev('politics_mayor_wins', 'politics', {
    weight: () => 2,
    options: [
      // Comply with new restrictions — expensive but legal
      { cashDelta: -60000, scoreDelta: { ecology: 20 }, effectTag: 'comply_restrictions' },
      // Lobby to overturn at regional level
      { cashDelta: -40000, corruptionDelta: 15, effectTag: 'regional_lobby' },
      // Relocate operations (drastic, but fresh start)
      { cashDelta: -100000, scoreDelta: { ecology: 30, nuisance: -20 }, effectTag: 'relocate_ops' },
      // "Negotiate" with the new mayor (corruption path)
      { cashDelta: -25000, corruptionDelta: 25, scoreDelta: { ecology: 5 }, effectTag: 'bribe_new_mayor' },
    ],
  }),

  // Follow-up to politics_mining_ban_debate (option 2: do nothing → vote happens)
  ev('politics_mining_ban_vote', 'politics', {
    weight: () => 2,
    options: [
      // Emergency lobbying blitz
      { cashDelta: -80000, scoreDelta: { ecology: 10 }, effectTag: 'emergency_lobby',
        probability: 0.6, alt: { cashDelta: -80000, scoreDelta: { ecology: -20 } } },
      // Accept partial ban (reduced operations for 60 ticks)
      { cashDelta: -30000, scoreDelta: { ecology: 15 }, effectTag: 'partial_ban' },
      // Bribe key parliament members
      { cashDelta: -50000, corruptionDelta: 30, effectTag: 'bribe_parliament' },
    ],
  }),

  // Follow-up to politics_ambassador_faint (option 2: deny responsibility)
  ev('politics_diplomatic_incident', 'politics', {
    weight: () => 1.5,
    options: [
      // Formal diplomatic apology + gift to embassy
      { cashDelta: -35000, scoreDelta: { nuisance: -12 }, effectTag: 'diplomatic_apology' },
      // Blame it on the altitude (the mine is deep, not high, but still)
      { cashDelta: -5000, scoreDelta: { nuisance: 5 }, effectTag: 'altitude_excuse' },
      // Trade deal compensation — offer ore at discount
      { cashDelta: -20000, scoreDelta: { nuisance: -8 }, effectTag: 'trade_compensation' },
    ],
  }),

  // Follow-up to weather_debris_wind (option 2: ignore damage → lawsuit)
  ev('weather_lawsuit_debris', 'lawsuit', {
    weight: () => 2,
    options: [
      // Pay for all property damage
      { cashDelta: -45000, scoreDelta: { nuisance: -10, safety: 5 }, effectTag: 'debris_payout' },
      // Contest in court — wind is an act of God
      { cashDelta: -10000, scoreDelta: { nuisance: 8 }, probability: 0.5,
        alt: { cashDelta: -60000, scoreDelta: { nuisance: -5 } } },
      // Install permanent blast shields (expensive but prevents recurrence)
      { cashDelta: -70000, scoreDelta: { nuisance: -15, safety: 10 }, effectTag: 'blast_shields' },
    ],
  }),
];
