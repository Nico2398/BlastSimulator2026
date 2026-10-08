// BlastSimulator2026 — Follow-up events
// Events triggered as consequences of other events' decision options.

import { ev as buildEvent } from './EventBuilder.js';
import type { EventDef } from './EventPool.js';
import {
  EVENT_BOOM_PRICE_PCT,
  EVENT_BRIEF_STOP_HOURS,
  EVENT_CALM_DAYS,
  EVENT_CALM_WEIGHT_FACTOR,
  EVENT_CURFEW_BAN_HOURS,
  EVENT_INJUNCTION_BAN_HOURS,
  EVENT_INSPECTION_BAN_HOURS,
  EVENT_PARTIAL_BAN_HOURS,
  EVENT_PARTIAL_BAN_WORK_PCT,
  EVENT_PENALTY_DAYS,
  EVENT_PENALTY_PER_DAY,
  EVENT_PERMANENT_RAISE_SALARY_PCT,
  EVENT_RELOCATE_PAUSE_HOURS,
  EVENT_SCRUTINY_DAYS,
  EVENT_SCRUTINY_WEIGHT_FACTOR,
  EVENT_SETTLEMENT_DAYS,
  EVENT_SETTLEMENT_PER_DAY,
  EVENT_SULK_HOURS,
  EVENT_SULK_MORALE_PER_HOUR,
  EVENT_TARIFF_DAYS,
  EVENT_TARIFF_PRICE_PCT,
  EVENT_UPKEEP_DISCOUNT_DAYS,
  EVENT_UPKEEP_DISCOUNT_PCT,
} from '../config/balance.js';

/** Every event here fires only when a parent queues it — never from a category timer (#1413). */
const ev: typeof buildEvent = (id, category, opts) => buildEvent(id, category, { ...opts, followUpOnly: true });

export const FOLLOWUP_EVENTS: EventDef[] = [
  // Follow-up to union_strike_threat (option 2: call their bluff → full strike)
  ev('union_strike_aftermath', 'union', {
    weight: () => 2,
    options: [
      // Capitulate: pay raises retroactively + ping-pong table
      { cashDelta: -40000, scoreDelta: { wellBeing: 25 }, effectTag: 'strike_capitulation',
        effects: [{ type: 'salary', pct: EVENT_PERMANENT_RAISE_SALARY_PCT, days: null }] },
      // Hire scabs: production resumes but morale destroyed
      { cashDelta: -15000, scoreDelta: { wellBeing: -15, safety: -8 }, effectTag: 'scab_labor',
        effects: [
          { type: 'employee_joins' },
          { type: 'morale_shift', perHour: EVENT_SULK_MORALE_PER_HOUR, hours: EVENT_SULK_HOURS },
        ] },
      // Close the mine for maintenance (stalling tactic)
      { cashDelta: -10000, scoreDelta: { wellBeing: -5 }, effectTag: 'maintenance_shutdown',
        effects: [{ type: 'work_stoppage', hours: EVENT_BRIEF_STOP_HOURS }] },
    ],
  }),

  // Follow-up to lawsuit_dust_fashion (option 2: fight in court)
  ev('lawsuit_dust_fashion_appeal', 'lawsuit', {
    weight: () => 1.5,
    options: [
      // Settle on appeal — pay more than the original offer
      { cashDelta: -40000, scoreDelta: { nuisance: 10 }, effectTag: 'appeal_settlement',
        effects: [{ type: 'recurring_charge', perDay: EVENT_SETTLEMENT_PER_DAY, days: EVENT_SETTLEMENT_DAYS }] },
      // Win on a technicality — PR nightmare though
      { cashDelta: -8000, scoreDelta: { nuisance: -8 }, effectTag: 'technicality_win' },
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
      { cashDelta: -80000, scoreDelta: { wellBeing: -20 }, effectTag: 'bankruptcy_restructure',
        effects: [
          { type: 'recurring_charge', perDay: EVENT_PENALTY_PER_DAY, days: EVENT_PENALTY_DAYS },
          { type: 'cancel_contract', penalty: true },
        ] },
    ],
  }),

  // Follow-up to lawsuit_village_coalition (option 2: partial settlement)
  ev('lawsuit_village_coalition_2', 'lawsuit', {
    weight: () => 1.8,
    options: [
      // Full settlement with community investment fund
      { cashDelta: -80000, scoreDelta: { nuisance: 20, ecology: 15 }, effectTag: 'community_fund',
        effects: [
          { type: 'event_weight', category: 'lawsuit', factor: EVENT_CALM_WEIGHT_FACTOR, days: EVENT_CALM_DAYS },
          { type: 'contract_price', pct: EVENT_BOOM_PRICE_PCT, days: EVENT_TARIFF_DAYS },
        ] },
      // Individual village deals (divide and conquer)
      { cashDelta: -35000, scoreDelta: { nuisance: 8 }, corruptionDelta: 8, effectTag: 'divide_villages' },
      // Government mediation — slow but fair
      { cashDelta: -20000, scoreDelta: { nuisance: 5, ecology: 5 }, effectTag: 'govt_mediation' },
    ],
  }),

  // Follow-up to politics_mayor_antimine (option 3: do nothing → mayor wins)
  ev('politics_mayor_wins', 'politics', {
    weight: () => 2,
    options: [
      // Comply with new restrictions — expensive but legal
      { cashDelta: -60000, scoreDelta: { ecology: 20 }, effectTag: 'comply_restrictions',
        effects: [{ type: 'ban', what: 'blast', hours: EVENT_INJUNCTION_BAN_HOURS }] },
      // Lobby to overturn at regional level
      { cashDelta: -40000, corruptionDelta: 15, effectTag: 'regional_lobby' },
      // Relocate operations (drastic, but fresh start)
      { cashDelta: -100000, scoreDelta: { ecology: 30, nuisance: 20 }, effectTag: 'relocate_ops',
        effects: [{ type: 'work_stoppage', hours: EVENT_RELOCATE_PAUSE_HOURS }] },
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
      { cashDelta: -30000, scoreDelta: { ecology: 15 }, effectTag: 'partial_ban',
        effects: [{ type: 'work_rate', pct: EVENT_PARTIAL_BAN_WORK_PCT, hours: EVENT_PARTIAL_BAN_HOURS }] },
      // Bribe key parliament members
      { cashDelta: -50000, corruptionDelta: 30, effectTag: 'bribe_parliament',
        effects: [{ type: 'ban', what: 'blast', hours: EVENT_INSPECTION_BAN_HOURS }] },
    ],
  }),

  // Follow-up to politics_ambassador_faint (option 2: deny responsibility)
  ev('politics_diplomatic_incident', 'politics', {
    weight: () => 1.5,
    options: [
      // Formal diplomatic apology + gift to embassy
      { cashDelta: -35000, scoreDelta: { nuisance: 12 }, effectTag: 'diplomatic_apology' },
      // Blame it on the altitude (the mine is deep, not high, but still)
      { cashDelta: -5000, scoreDelta: { nuisance: -5 }, effectTag: 'altitude_excuse' },
      // Trade deal compensation — offer ore at discount
      { cashDelta: -20000, scoreDelta: { nuisance: 8 }, effectTag: 'trade_compensation',
        effects: [{ type: 'contract_price', pct: EVENT_TARIFF_PRICE_PCT, days: EVENT_TARIFF_DAYS }] },
    ],
  }),

  // Follow-up to weather_debris_wind (option 2: ignore damage → lawsuit)
  ev('weather_lawsuit_debris', 'lawsuit', {
    weight: () => 2,
    options: [
      // Pay for all property damage
      { cashDelta: -45000, scoreDelta: { nuisance: 10, safety: 5 }, effectTag: 'debris_payout' },
      // Contest in court — wind is an act of God
      { cashDelta: -10000, scoreDelta: { nuisance: -8 }, probability: 0.5,
        alt: { cashDelta: -60000, scoreDelta: { nuisance: 5 } } },
      // Install permanent blast shields (expensive but prevents recurrence)
      { cashDelta: -70000, scoreDelta: { nuisance: 15, safety: 10 }, effectTag: 'blast_shields',
        effects: [
          { type: 'ban', what: 'haul', hours: EVENT_CURFEW_BAN_HOURS },
          { type: 'cost_factor', what: 'upkeep', pct: EVENT_UPKEEP_DISCOUNT_PCT, days: EVENT_UPKEEP_DISCOUNT_DAYS },
        ] },
    ],
  }),

  // Follow-up to a botched mafia action or an exposed mafia (#1411). Repeatable: every botch queues one.
  ev('mafia_police_investigation', 'mafia', {
    weight: () => 2,
    repeatable: true,
    options: [
      // Pay off the detective: quiet, expensive, adds corruption
      { cashDelta: -30000, corruptionDelta: 10, effectTag: 'pay_off_detective',
        effects: [
          { type: 'event_weight', category: 'mafia', factor: EVENT_CALM_WEIGHT_FACTOR, days: EVENT_CALM_DAYS },
        ] },
      // Hire a lawyer: cheaper, but may lose and pay a larger fine
      { cashDelta: -20000, effectTag: 'hire_lawyer',
        probability: 0.6, alt: { cashDelta: -60000, exposureDelta: 0.1 } },
      // Stonewall: free now, investigators dig deeper
      { exposureDelta: 0.15, effectTag: 'stonewall_police',
        effects: [
          { type: 'ban', what: 'blast', hours: EVENT_INJUNCTION_BAN_HOURS },
          { type: 'event_weight', category: 'mafia', factor: EVENT_SCRUTINY_WEIGHT_FACTOR, days: EVENT_SCRUTINY_DAYS },
        ] },
    ],
  }),
];
