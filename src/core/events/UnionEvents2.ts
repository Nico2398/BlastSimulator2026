// BlastSimulator2026 — Union events batch 2 (events 26-50)
// Satirical worker uprising scenarios: Theme Hospital meets capitalism critique.
import { ev, r } from './EventBuilder.js';
import type { EventDef } from './EventPool.js';

export const UNION_EVENTS_2: EventDef[] = [
  // 26 — Emotional proximity to explosions
  ev('union_hazard_emotional', 'union', {
    weight: (s) => 1 + 1.2 * (1 - r.sf(s)),
    options: [
      { cashDelta: -4000, scoreDelta: { wellBeing: 8 }, effectTag: 'hazard_emotional_pay' },
      { cashDelta: 0, scoreDelta: { wellBeing: -6 } },
      { cashDelta: -1500, scoreDelta: { wellBeing: 3 }, effectTag: 'earplugs_feelings' },
    ],
  }),
  // 27 — Company therapist petition
  ev('union_therapist', 'union', {
    weight: (s) => 1 + 1.5 * (1 - r.wb(s)),
    options: [
      { cashDelta: -6000, scoreDelta: { wellBeing: 12 }, effectTag: 'therapist_hired' },
      { cashDelta: 0, scoreDelta: { wellBeing: -8 } },
      { cashDelta: -2000, scoreDelta: { wellBeing: 4 }, effectTag: 'self_help_books' },
    ],
  }),
  // 28 — Rename "blast zone" petition
  ev('union_rename_blastzone', 'union', {
    weight: (s) => 1 + 0.8 * (1 - r.sf(s)),
    options: [
      { cashDelta: -500, scoreDelta: { wellBeing: 5, safety: 2 }, effectTag: 'happy_zone' },
      { cashDelta: 0, scoreDelta: { wellBeing: -3 } },
      { cashDelta: -200, scoreDelta: { wellBeing: 2 }, effectTag: 'focus_group' },
    ],
  }),
  // 29 — Foreman micro-rest defense
  ev('union_micro_rest', 'union', {
    weight: (s) => 1 + 0.6 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.employeeCount >= 5,
    options: [
      { cashDelta: -1000, scoreDelta: { wellBeing: 6 }, effectTag: 'nap_pods' },
      { cashDelta: 0, scoreDelta: { wellBeing: -5 }, effectTag: 'foreman_fired' },
      { cashDelta: -500, scoreDelta: { wellBeing: 3 }, effectTag: 'siesta_schedule' },
    ],
  }),
  // 30 — Workers demand profit sharing
  ev('union_profit_sharing', 'union', {
    weight: (s) => 1 + 1.8 * (1 - r.wb(s)),
    options: [
      { cashDelta: -8000, scoreDelta: { wellBeing: 15 }, effectTag: 'profit_share' },
      { cashDelta: 0, scoreDelta: { wellBeing: -12 }, corruptionDelta: 5 },
      { cashDelta: -3000, scoreDelta: { wellBeing: 6 }, effectTag: 'pizza_fridays' },
    ],
  }),
  // 31 — Unlucky days refusal
  ev('union_unlucky_days', 'union', {
    weight: (s) => 1 + 0.5 * (1 - r.wb(s)),
    options: [
      { cashDelta: -2000, scoreDelta: { wellBeing: 5 }, effectTag: 'lucky_charms' },
      { cashDelta: 0, scoreDelta: { wellBeing: -4 } },
      { cashDelta: -800, scoreDelta: { wellBeing: 3 }, effectTag: 'horoscope_sub' },
    ],
  }),
  // 32 — Anonymous music complaint
  ev('union_music_complaint', 'union', {
    weight: (s) => 0.8 + 0.4 * (1 - r.wb(s)),
    options: [
      { cashDelta: -300, scoreDelta: { wellBeing: 4 }, effectTag: 'jukebox' },
      { cashDelta: 0, scoreDelta: { wellBeing: -2, nuisance: 3 } },
      { cashDelta: -1500, scoreDelta: { wellBeing: 7 }, effectTag: 'dj_hired' },
    ],
  }),
  // 33 — Environmental sub-committee
  ev('union_eco_committee', 'union', {
    weight: (s) => 1 + 1.0 * (1 - r.ec(s)),
    options: [
      { cashDelta: -3000, scoreDelta: { ecology: 8, wellBeing: 4 }, effectTag: 'eco_committee' },
      { cashDelta: 0, scoreDelta: { wellBeing: -5, ecology: -3 } },
      { cashDelta: -1000, scoreDelta: { ecology: 3 }, effectTag: 'recycling_bins' },
    ],
  }),
  // 34 — Company merchandise demand
  ev('union_merch', 'union', {
    weight: (s) => 0.7 + 0.5 * (1 - r.wb(s)),
    options: [
      { cashDelta: -2500, scoreDelta: { wellBeing: 6 }, effectTag: 'branded_merch' },
      { cashDelta: 0, scoreDelta: { wellBeing: -3 } },
      { cashDelta: -800, scoreDelta: { wellBeing: 2 }, effectTag: 'bootleg_merch' },
    ],
  }),
  // 35 — Food truck festival
  ev('union_food_trucks', 'union', {
    weight: (s) => 0.9 + 0.6 * (1 - r.wb(s)),
    options: [
      { cashDelta: -4000, scoreDelta: { wellBeing: 10, nuisance: 5 }, effectTag: 'food_fest' },
      { cashDelta: 0, scoreDelta: { wellBeing: -4 } },
      { cashDelta: -1500, scoreDelta: { wellBeing: 5 }, effectTag: 'vending_upgrade' },
    ],
  }),
  // 36 — Seat on the "board" (literal wooden board)
  ev('union_board_seat', 'union', {
    weight: (s) => 1 + 1.0 * (1 - r.wb(s)),
    options: [
      { cashDelta: -100, scoreDelta: { wellBeing: 8 }, effectTag: 'board_seat_literal' },
      { cashDelta: 0, scoreDelta: { wellBeing: -6 }, corruptionDelta: 3 },
      { cashDelta: -50, scoreDelta: { wellBeing: 4 }, effectTag: 'folding_chair' },
    ],
  }),
  // 37 — "Slow-down" protest (working at normal speed)
  ev('union_slowdown', 'union', {
    weight: (s) => 1.2 + 1.0 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.employeeCount >= 3,
    options: [
      { cashDelta: -5000, scoreDelta: { wellBeing: 10 }, effectTag: 'overtime_abolished' },
      { cashDelta: 0, scoreDelta: { wellBeing: -8, safety: -3 } },
      { cashDelta: -2000, scoreDelta: { wellBeing: 5 }, effectTag: 'reasonable_hours' },
    ],
  }),
  // 38 — Lunch thief investigation
  ev('union_lunch_thief', 'union', {
    weight: (s) => 0.8 + 0.3 * (1 - r.wb(s)),
    options: [
      { cashDelta: -1200, scoreDelta: { wellBeing: 5 }, effectTag: 'fridge_cams' },
      { cashDelta: 0, scoreDelta: { wellBeing: -4 } },
      { cashDelta: -3000, scoreDelta: { wellBeing: 3 }, effectTag: 'private_detective', probability: 0.6,
        alt: { cashDelta: -3000, scoreDelta: { wellBeing: -2 }, effectTag: 'detective_ate_lunch' } },
    ],
  }),
  // 39 — Miner of the Month election
  ev('union_miner_month', 'union', {
    weight: (s) => 0.7 + 0.5 * (1 - r.wb(s)),
    options: [
      { cashDelta: -800, scoreDelta: { wellBeing: 6 }, effectTag: 'miner_month' },
      { cashDelta: 0, scoreDelta: { wellBeing: -3 } },
      { cashDelta: -400, scoreDelta: { wellBeing: 2, safety: -2 }, effectTag: 'popularity_contest' },
    ],
  }),
  // 40 — Rename explosives petition
  ev('union_rename_explosives', 'union', {
    weight: (s) => 0.9 + 0.7 * (1 - r.sf(s)),
    options: [
      { cashDelta: -600, scoreDelta: { wellBeing: 5, safety: 3 }, effectTag: 'gentle_booms' },
      { cashDelta: 0, scoreDelta: { wellBeing: -3 } },
      { cashDelta: -200, scoreDelta: { wellBeing: 2 }, effectTag: 'euphemism_handbook' },
    ],
  }),
  // 41 — Suggestion box (filled with complaints)
  ev('union_suggestion_box', 'union', {
    weight: (s) => 1 + 0.8 * (1 - r.wb(s)),
    options: [
      { cashDelta: -300, scoreDelta: { wellBeing: 4 }, effectTag: 'suggestion_box' },
      { cashDelta: 0, scoreDelta: { wellBeing: -5 } },
      { cashDelta: -100, scoreDelta: { wellBeing: 1 }, corruptionDelta: 2, effectTag: 'shredder' },
    ],
  }),
  // 42 — Union rep wants a secretary
  ev('union_rep_secretary', 'union', {
    weight: (s) => 1 + 1.2 * (1 - r.wb(s)),
    options: [
      { cashDelta: -5000, scoreDelta: { wellBeing: 7 }, effectTag: 'rep_secretary' },
      { cashDelta: 0, scoreDelta: { wellBeing: -6 }, corruptionDelta: 4 },
      { cashDelta: -1500, scoreDelta: { wellBeing: 3 }, effectTag: 'voice_recorder' },
    ],
  }),
  // 43 — Golden hour selfie refusal
  ev('union_golden_hour', 'union', {
    weight: (s) => 0.6 + 0.4 * (1 - r.wb(s)),
    options: [
      { cashDelta: -1000, scoreDelta: { wellBeing: 6 }, effectTag: 'selfie_break' },
      { cashDelta: 0, scoreDelta: { wellBeing: -4, nuisance: 2 } },
      { cashDelta: -500, scoreDelta: { wellBeing: 3 }, effectTag: 'ring_light_provided' },
    ],
  }),
  // 44 — Ancient burial ground discovery
  ev('union_burial_ground', 'union', {
    weight: (s) => 0.5 + 0.8 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.tickCount >= 20,
    options: [
      { cashDelta: -10000, scoreDelta: { ecology: 12, wellBeing: 5 }, effectTag: 'archaeologist' },
      { cashDelta: 0, scoreDelta: { ecology: -8, wellBeing: -5 }, effectTag: 'cursed_mine' },
      { cashDelta: -3000, scoreDelta: { ecology: 5 }, effectTag: 'gift_shop', probability: 0.7,
        alt: { cashDelta: 5000, scoreDelta: { ecology: -4 }, effectTag: 'tourist_trap' } },
    ],
  }),
  // 45 — Pet rock maternity leave
  ev('union_pet_rock_leave', 'union', {
    weight: (s) => 0.5 + 0.3 * (1 - r.wb(s)),
    options: [
      { cashDelta: -2000, scoreDelta: { wellBeing: 8 }, effectTag: 'pet_rock_nursery' },
      { cashDelta: 0, scoreDelta: { wellBeing: -5 } },
      { cashDelta: -500, scoreDelta: { wellBeing: 4 }, effectTag: 'rock_daycare' },
    ],
  }),
  // 46 — Company newsletter demand
  ev('union_newsletter', 'union', {
    weight: (s) => 0.7 + 0.4 * (1 - r.wb(s)),
    options: [
      { cashDelta: -1500, scoreDelta: { wellBeing: 5 }, effectTag: 'newsletter_launch' },
      { cashDelta: 0, scoreDelta: { wellBeing: -3 } },
      { cashDelta: -600, scoreDelta: { wellBeing: 2, nuisance: 3 }, effectTag: 'gossip_column' },
    ],
  }),
  // 47 — Safety drills too realistic
  ev('union_drills_realistic', 'union', {
    weight: (s) => 1 + 1.0 * (1 - r.sf(s)),
    options: [
      { cashDelta: -2000, scoreDelta: { safety: 5, wellBeing: 4 }, effectTag: 'gentle_drills' },
      { cashDelta: 0, scoreDelta: { wellBeing: -6, safety: 3 } },
      { cashDelta: -800, scoreDelta: { safety: -3, wellBeing: 3 }, effectTag: 'no_drills' },
    ],
  }),
  // 48 — Company anthem demand
  ev('union_anthem', 'union', {
    weight: (s) => 0.6 + 0.5 * (1 - r.wb(s)),
    options: [
      { cashDelta: -3000, scoreDelta: { wellBeing: 7, nuisance: 4 }, effectTag: 'anthem_composed' },
      { cashDelta: 0, scoreDelta: { wellBeing: -4 } },
      { cashDelta: -500, scoreDelta: { wellBeing: 3 }, effectTag: 'karaoke_night' },
    ],
  }),
  // 49 — Heated toilet seats ultimatum
  ev('union_heated_seats', 'union', {
    weight: (s) => 1 + 1.3 * (1 - r.wb(s)),
    options: [
      { cashDelta: -4000, scoreDelta: { wellBeing: 10 }, effectTag: 'heated_seats' },
      { cashDelta: 0, scoreDelta: { wellBeing: -8 }, effectTag: 'slowdown_threat' },
      { cashDelta: -1500, scoreDelta: { wellBeing: 5 }, effectTag: 'seat_warmers_basic' },
    ],
  }),
  // 50 — Rocks are speaking to a worker
  ev('union_talking_rocks', 'union', {
    weight: (s) => 0.4 + 0.6 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.tickCount >= 15 && ctx.hasDrillPlan,
    options: [
      { cashDelta: -1000, scoreDelta: { wellBeing: 5, ecology: 6 }, effectTag: 'rock_whisperer',
        probability: 0.8, alt: { scoreDelta: { wellBeing: -3 }, effectTag: 'hallucinating' } },
      { cashDelta: 0, scoreDelta: { wellBeing: -6 }, effectTag: 'psych_eval' },
      { cashDelta: -2500, scoreDelta: { ecology: 10 }, effectTag: 'survey_data_accurate' },
    ],
  }),
];
