// BlastSimulator2026 — Mafia events batch 1 (25 events)
// Dark satirical organized crime entanglements in open-pit mining.
import { ev, r } from './EventBuilder.js';
import type { EventDef } from './EventPool.js';

export const MAFIA_EVENTS_1: EventDef[] = [
  // 1 — "Consulting fee" protection racket
  ev('mafia_protection_racket', 'mafia', {
    weight: (s) => 1 + 0.8 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 1,
    options: [
      { cashDelta: -5000, corruptionDelta: 5, scoreDelta: { safety: 4 } },
      { cashDelta: 0, scoreDelta: { safety: -10 }, effectTag: 'equipment_sabotaged' },
      { cashDelta: -2000, corruptionDelta: 2, scoreDelta: { safety: 1 }, effectTag: 'negotiate_fee' },
    ],
  }),
  // 2 — Treranium "fell off a truck"
  ev('mafia_smuggling_opportunity', 'mafia', {
    weight: (s) => 1.1 + 0.6 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 2,
    options: [
      { cashDelta: 15000, corruptionDelta: 10, scoreDelta: { ecology: -8 } },
      { cashDelta: 0, scoreDelta: { ecology: 3 } },
      { cashDelta: 5000, corruptionDelta: 5, scoreDelta: { ecology: -3 }, probability: 0.7,
        alt: { cashDelta: -10000, scoreDelta: { ecology: -5 }, effectTag: 'caught_smuggling' } },
    ],
  }),
  // 3 — Someone's talking to the feds
  ev('mafia_informant', 'mafia', {
    weight: (s) => 1.3 + 0.5 * r.sf(s),
    canFire: (ctx) => ctx.corruptionLevel >= 3,
    options: [
      { cashDelta: -20000, corruptionDelta: -10, effectTag: 'cooperate_feds' },
      { cashDelta: -8000, corruptionDelta: 8, scoreDelta: { safety: -12 }, effectTag: 'silence_informant' },
      { cashDelta: 0, corruptionDelta: 3, scoreDelta: { wellBeing: -6 }, effectTag: 'ignore_informant' },
    ],
  }),
  // 4 — Run numbers through your books
  ev('mafia_money_laundering', 'mafia', {
    weight: (s) => 1.2 + 0.4 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 2,
    options: [
      { cashDelta: 25000, corruptionDelta: 15, scoreDelta: { ecology: -5 } },
      { cashDelta: 0, scoreDelta: { safety: -6 }, effectTag: 'books_refused_threat' },
      { cashDelta: 10000, corruptionDelta: 8, probability: 0.6,
        alt: { cashDelta: -15000, corruptionDelta: 5, effectTag: 'audit_triggered' } },
    ],
  }),
  // 5 — Turf war, mine as weapons storage
  ev('mafia_rival_gang', 'mafia', {
    weight: (s) => 1.5 + 0.8 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 4,
    options: [
      { cashDelta: 30000, corruptionDelta: 20, scoreDelta: { safety: -20 }, effectTag: 'weapons_cache' },
      { cashDelta: 0, scoreDelta: { safety: -8 }, effectTag: 'gang_retaliation' },
      { cashDelta: -10000, corruptionDelta: -5, scoreDelta: { safety: 5 }, effectTag: 'tip_police' },
    ],
  }),
  // 6 — Eliminate a competitor's key employee
  ev('mafia_hit_offer', 'mafia', {
    weight: (s) => 1.4 + 0.6 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 4,
    options: [
      { cashDelta: 20000, corruptionDelta: 25, scoreDelta: { safety: -15, wellBeing: -10 } },
      { cashDelta: 0, scoreDelta: { safety: -5 }, effectTag: 'refused_hit' },
      { cashDelta: -5000, corruptionDelta: 5, effectTag: 'fake_the_hit', probability: 0.5,
        alt: { corruptionDelta: 15, scoreDelta: { safety: -20 }, effectTag: 'deception_discovered' } },
    ],
  }),
  // 7 — Stolen explosives found in your depot
  ev('mafia_stolen_explosives', 'mafia', {
    weight: (s) => 1.2 + 1.0 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 2 && ctx.hasDrillPlan,
    options: [
      { cashDelta: 0, corruptionDelta: -3, scoreDelta: { safety: 5 }, effectTag: 'report_explosives' },
      { cashDelta: 8000, corruptionDelta: 10, scoreDelta: { safety: -15 }, effectTag: 'keep_explosives' },
      { cashDelta: -3000, corruptionDelta: 2, scoreDelta: { safety: -3 }, effectTag: 'return_quietly' },
    ],
  }),
  // 8 — Boss's nephew needs a no-show job
  ev('mafia_noshow_job', 'mafia', {
    weight: (s) => 1.0 + 0.5 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 2 && ctx.employeeCount > 3,
    options: [
      { cashDelta: -4000, corruptionDelta: 8, scoreDelta: { wellBeing: -5 } },
      { cashDelta: 0, scoreDelta: { safety: -8 }, effectTag: 'nephew_denied_threat' },
      { cashDelta: -8000, corruptionDelta: 4, scoreDelta: { wellBeing: -2 }, effectTag: 'nephew_real_job' },
    ],
  }),
  // 9 — Underground gambling ring in the mine
  ev('mafia_gambling_ring', 'mafia', {
    weight: (s) => 1.1 + 0.7 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 2 && ctx.employeeCount > 5,
    options: [
      { cashDelta: 12000, corruptionDelta: 12, scoreDelta: { wellBeing: -8, safety: -6 } },
      { cashDelta: 0, scoreDelta: { wellBeing: -3 }, effectTag: 'shut_down_gambling' },
      { cashDelta: 5000, corruptionDelta: 6, scoreDelta: { wellBeing: 3 }, effectTag: 'house_cut' },
    ],
  }),
  // 10 — Counterfeit ore certificates for sale
  ev('mafia_fake_certificates', 'mafia', {
    weight: (s) => 1.3 + 0.5 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 3 && ctx.activeContractCount > 0,
    options: [
      { cashDelta: 18000, corruptionDelta: 15, scoreDelta: { ecology: -10 } },
      { cashDelta: 0, scoreDelta: { ecology: 5 } },
      { cashDelta: 8000, corruptionDelta: 8, probability: 0.65,
        alt: { cashDelta: -20000, corruptionDelta: 5, effectTag: 'certificate_fraud_caught' } },
    ],
  }),
  // 11 — Witness needs to "disappear" (hide in mine)
  ev('mafia_hide_witness', 'mafia', {
    weight: (s) => 1.4 + 0.4 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 3,
    options: [
      { cashDelta: 10000, corruptionDelta: 18, scoreDelta: { safety: -10, wellBeing: -8 } },
      { cashDelta: 0, scoreDelta: { safety: -4 }, effectTag: 'refused_hiding' },
      { cashDelta: 0, corruptionDelta: -5, scoreDelta: { safety: 8 }, effectTag: 'witness_protection_tip' },
    ],
  }),
  // 12 — Exclusive ore buyer at premium prices
  ev('mafia_exclusive_buyer', 'mafia', {
    weight: (s) => 1.2 + 0.3 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 1,
    options: [
      { cashDelta: 20000, corruptionDelta: 6, scoreDelta: { ecology: -4 } },
      { cashDelta: 0, scoreDelta: { ecology: 2 } },
      { cashDelta: 10000, corruptionDelta: 3, effectTag: 'partial_deal' },
    ],
  }),
  // 13 — Gang tattoo artist in break room
  ev('mafia_tattoo_shop', 'mafia', {
    weight: (s) => 0.8 + 0.4 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 1 && ctx.hasBuilding('canteen'),
    options: [
      { cashDelta: 3000, corruptionDelta: 4, scoreDelta: { wellBeing: 5, safety: -4 } },
      { cashDelta: 0, scoreDelta: { wellBeing: -2 } },
      { cashDelta: 1000, corruptionDelta: 2, scoreDelta: { wellBeing: 3 }, effectTag: 'weekends_only_tattoos' },
    ],
  }),
  // 14 — Enforcer as your "security consultant"
  ev('mafia_enforcer', 'mafia', {
    weight: (s) => 1.3 + 0.6 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 3,
    options: [
      { cashDelta: -6000, corruptionDelta: 12, scoreDelta: { safety: 8, wellBeing: -10 } },
      { cashDelta: 0, scoreDelta: { safety: -6 }, effectTag: 'enforcer_refused_consequences' },
      { cashDelta: -12000, corruptionDelta: 6, scoreDelta: { safety: 10, wellBeing: -4 }, effectTag: 'legit_security' },
    ],
  }),
  // 15 — Protection fee increases
  ev('mafia_fee_hike', 'mafia', {
    weight: (s) => 1.4 + 0.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 2,
    options: [
      { cashDelta: -12000, corruptionDelta: 3, scoreDelta: { safety: 2 } },
      { cashDelta: 0, scoreDelta: { safety: -12 }, effectTag: 'fee_refused_arson' },
      { cashDelta: -6000, corruptionDelta: 6, effectTag: 'counter_offer', probability: 0.5,
        alt: { cashDelta: -18000, corruptionDelta: 2, effectTag: 'intimidation_escalation' } },
    ],
  }),
  // 16 — Hire specific "employees" (mob plants)
  ev('mafia_plant_workers', 'mafia', {
    weight: (s) => 1.1 + 0.5 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 3 && ctx.employeeCount > 4,
    options: [
      { cashDelta: -3000, corruptionDelta: 10, scoreDelta: { wellBeing: -8, safety: -5 } },
      { cashDelta: 0, scoreDelta: { safety: -10 }, effectTag: 'plants_refused_vandalism' },
      { cashDelta: -8000, corruptionDelta: 5, scoreDelta: { wellBeing: -3 }, effectTag: 'supervised_plants' },
    ],
  }),
  // 17 — Illegal waste dumping in abandoned shaft
  ev('mafia_waste_dumping', 'mafia', {
    weight: (s) => 1.3 + 0.8 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 3,
    options: [
      { cashDelta: 25000, corruptionDelta: 18, scoreDelta: { ecology: -25, safety: -8 } },
      { cashDelta: 0, scoreDelta: { ecology: 5 } },
      { cashDelta: 10000, corruptionDelta: 10, scoreDelta: { ecology: -12 }, probability: 0.55,
        alt: { cashDelta: -30000, scoreDelta: { ecology: -20 }, effectTag: 'epa_raid' } },
    ],
  }),
  // 18 — Offer to "solve" your union problem
  ev('mafia_union_fix', 'mafia', {
    weight: (s) => 1.2 + 0.6 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 3 && ctx.scores.wellBeing < 40,
    options: [
      { cashDelta: -15000, corruptionDelta: 15, scoreDelta: { wellBeing: 15, safety: -10 } },
      { cashDelta: 0, scoreDelta: { wellBeing: -3 } },
      { cashDelta: -5000, corruptionDelta: 8, scoreDelta: { wellBeing: 8, safety: -4 }, effectTag: 'light_intimidation' },
    ],
  }),
  // 19 — Stolen vehicles at discount
  ev('mafia_stolen_vehicles', 'mafia', {
    weight: (s) => 1.0 + 0.3 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 1,
    options: [
      { cashDelta: 12000, corruptionDelta: 8, scoreDelta: { safety: -4 } },
      { cashDelta: -8000, scoreDelta: { safety: 3 }, effectTag: 'buy_legit' },
      { cashDelta: 5000, corruptionDelta: 4, probability: 0.7,
        alt: { cashDelta: -10000, effectTag: 'vin_traced_police' } },
    ],
  }),
  // 20 — Mob accountant needs your books for audit cover
  ev('mafia_audit_cover', 'mafia', {
    weight: (s) => 1.3 + 0.4 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 3,
    options: [
      { cashDelta: 15000, corruptionDelta: 14, scoreDelta: { ecology: -6 } },
      { cashDelta: 0, scoreDelta: { safety: -5 }, effectTag: 'accountant_refused' },
      { cashDelta: 8000, corruptionDelta: 7, probability: 0.6,
        alt: { cashDelta: -25000, corruptionDelta: 5, effectTag: 'forensic_audit' } },
    ],
  }),
  // 21 — Anonymous tip about upcoming police raid
  ev('mafia_police_raid_tip', 'mafia', {
    weight: (s) => 1.5 + 0.3 * r.sf(s),
    canFire: (ctx) => ctx.corruptionLevel >= 4,
    options: [
      { cashDelta: -10000, corruptionDelta: -8, scoreDelta: { safety: 5 }, effectTag: 'clean_house' },
      { cashDelta: 0, corruptionDelta: 5, scoreDelta: { safety: -15 }, effectTag: 'ignore_tip_raided' },
      { cashDelta: -5000, corruptionDelta: -3, effectTag: 'partial_cleanup' },
    ],
  }),
  // 22 — Mafia wedding invitation (mandatory attendance)
  ev('mafia_wedding', 'mafia', {
    weight: (s) => 0.8 + 0.3 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 2,
    options: [
      { cashDelta: -8000, corruptionDelta: 3, scoreDelta: { wellBeing: 4 }, effectTag: 'lavish_gift' },
      { cashDelta: 0, corruptionDelta: 8, scoreDelta: { safety: -8 }, effectTag: 'skip_wedding_insult' },
      { cashDelta: -3000, corruptionDelta: 1, scoreDelta: { wellBeing: 2 }, effectTag: 'modest_attendance' },
    ],
  }),
  // 23 — Mob boss wants custom rock sculpture for garden
  ev('mafia_rock_sculpture', 'mafia', {
    weight: (s) => 0.7 + 0.2 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 1,
    options: [
      { cashDelta: -5000, corruptionDelta: 2, scoreDelta: { wellBeing: -3 }, effectTag: 'sculpt_masterpiece' },
      { cashDelta: 0, scoreDelta: { safety: -4 }, effectTag: 'declined_sculpture' },
      { cashDelta: 5000, corruptionDelta: 4, scoreDelta: { ecology: -3 }, effectTag: 'sell_rare_rock' },
    ],
  }),
  // 24 — Underground fight club in the pit after hours
  ev('mafia_fight_club', 'mafia', {
    weight: (s) => 1.2 + 0.7 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 3 && ctx.employeeCount > 6,
    options: [
      { cashDelta: 15000, corruptionDelta: 14, scoreDelta: { safety: -18, wellBeing: -10 } },
      { cashDelta: 0, scoreDelta: { wellBeing: -2 }, effectTag: 'fight_club_shut_down' },
      { cashDelta: 6000, corruptionDelta: 7, scoreDelta: { safety: -8, wellBeing: -4 }, effectTag: 'regulated_fights' },
    ],
  }),
  // 25 — Mafia-run lottery: mine as grand prize (absurd)
  ev('mafia_mine_lottery', 'mafia', {
    weight: (s) => 0.6 + 0.3 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 5,
    options: [
      { cashDelta: 50000, corruptionDelta: 25, scoreDelta: { safety: -15, ecology: -10 },
        probability: 0.4, alt: { cashDelta: -40000, corruptionDelta: 10, effectTag: 'lottery_winner_claims_mine' } },
      { cashDelta: 0, scoreDelta: { safety: -8 }, effectTag: 'lottery_refused_threats' },
      { cashDelta: 20000, corruptionDelta: 12, scoreDelta: { safety: -5 }, effectTag: 'rigged_lottery' },
    ],
  }),
];
