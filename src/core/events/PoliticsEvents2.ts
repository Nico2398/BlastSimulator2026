// BlastSimulator2026 — Political events batch 2 (events 26-50)
// External pressures, international absurdity, and governmental incompetence.
import { ev, r } from './EventBuilder.js';
import {
  EVENT_BOOM_PRICE_PCT,
  EVENT_BOYCOTT_DAYS,
  EVENT_BOYCOTT_PRICE_PCT,
  EVENT_BRIEF_STOP_HOURS,
  EVENT_CHEER_HOURS,
  EVENT_CHEER_MORALE_PER_HOUR,
  EVENT_CURFEW_BAN_HOURS,
  EVENT_GLOOM_HOURS,
  EVENT_GLOOM_MORALE_PER_HOUR,
  EVENT_INJUNCTION_BAN_HOURS,
  EVENT_INSPECTION_BAN_HOURS,
  EVENT_PERMANENT_RAISE_SALARY_PCT,
  EVENT_RETAINER_DAYS,
  EVENT_RETAINER_PER_DAY,
  EVENT_SCRUTINY_DAYS,
  EVENT_SCRUTINY_WEIGHT_FACTOR,
  EVENT_SULK_HOURS,
  EVENT_SULK_MORALE_PER_HOUR,
  EVENT_SURGE_HOURS,
  EVENT_SURGE_WORK_PCT,
  EVENT_TARIFF_DAYS,
  EVENT_TARIFF_PRICE_PCT,
  EVENT_UPKEEP_DISCOUNT_DAYS,
  EVENT_UPKEEP_DISCOUNT_PCT,
  EVENT_UPKEEP_SURCHARGE_DAYS,
  EVENT_UPKEEP_SURCHARGE_PCT,
  INSPECTION_EVENT_TAG,
} from '../config/balance.js';
import type { EventDef } from './EventPool.js';

export const POLITICS_EVENTS_2: EventDef[] = [
  // 26 — UN inspector surprise visit
  ev('politics_un_inspector', 'politics', {
    tags: [INSPECTION_EVENT_TAG],
    weight: (s) => 1.2 + 1.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.tickCount > 30,
    options: [
      { cashDelta: -20000, scoreDelta: { safety: 12, ecology: 8 }, effectTag: 'emergency_cleanup',
        effects: [{ type: 'work_stoppage', hours: EVENT_BRIEF_STOP_HOURS }] },
      { cashDelta: 0, scoreDelta: { safety: -15, ecology: -10 }, effectTag: 'un_citation',
        effects: [{ type: 'ban', what: 'blast', hours: EVENT_INSPECTION_BAN_HOURS }] },
      { corruptionDelta: 20, cashDelta: -5000, scoreDelta: { safety: 3 }, effectTag: 'bribe_inspector' },
    ],
  }),
  // 27 — Currency devaluation
  ev('politics_currency_crash', 'politics', {
    weight: (s) => 0.8 + 0.6 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.tickCount > 20,
    options: [
      { cashDelta: -40000, scoreDelta: { wellBeing: -5 }, effectTag: 'price_surge',
        effects: [
          { type: 'cost_factor', what: 'upkeep', pct: EVENT_UPKEEP_SURCHARGE_PCT, days: EVENT_UPKEEP_SURCHARGE_DAYS },
        ] },
      { cashDelta: -15000, corruptionDelta: 10, effectTag: 'black_market_supplies' },
      { cashDelta: -25000, scoreDelta: { wellBeing: 5 }, effectTag: 'hedge_currency',
        effects: [{ type: 'morale_shift', perHour: EVENT_CHEER_MORALE_PER_HOUR, hours: EVENT_CHEER_HOURS }] },
    ],
  }),
  // 28 — Mining cartel formed
  ev('politics_mining_cartel', 'politics', {
    weight: (s) => 1.0 + 0.8 * r.ec(s),
    canFire: (ctx) => ctx.activeContractCount > 1,
    options: [
      { cashDelta: 30000, corruptionDelta: 25, effectTag: 'join_cartel',
        effects: [{ type: 'contract_price', pct: EVENT_BOOM_PRICE_PCT, days: EVENT_TARIFF_DAYS }] },
      { cashDelta: -10000, scoreDelta: { ecology: 5 }, effectTag: 'refuse_cartel',
        effects: [{ type: 'contract_price', pct: EVENT_TARIFF_PRICE_PCT, days: EVENT_TARIFF_DAYS }] },
      { cashDelta: 0, scoreDelta: { ecology: -5 }, corruptionDelta: 10, effectTag: 'spy_on_cartel' },
    ],
  }),
  // 29 — Parliament debates banning open-pit mining
  ev('politics_mining_ban_debate', 'politics', {
    weight: (s) => 1.5 + 2.0 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.scores.ecology < 40,
    options: [
      { cashDelta: -50000, scoreDelta: { ecology: 15 }, effectTag: 'lobbying_campaign' },
      { cashDelta: 0, scoreDelta: { ecology: -8 }, followUp: 'politics_mining_ban_vote' },
      { corruptionDelta: 30, cashDelta: -20000, effectTag: 'buy_politicians' },
    ],
  }),
  // 30 — Social media campaign against your mine
  ev('politics_viral_hashtag', 'politics', {
    weight: (s) => 1.1 + 1.8 * (1 - r.nu(s)),
    options: [
      { cashDelta: -15000, scoreDelta: { nuisance: 12, ecology: 5 }, effectTag: 'pr_blitz' },
      { cashDelta: 0, scoreDelta: { nuisance: -10, ecology: -8 }, effectTag: 'trending_disaster',
        effects: [{ type: 'contract_price', pct: EVENT_BOYCOTT_PRICE_PCT, days: EVENT_BOYCOTT_DAYS }] },
      { cashDelta: -8000, scoreDelta: { nuisance: 5 }, effectTag: 'hire_influencer' },
    ],
  }),
  // 31 — Neighboring mine collapses
  ev('politics_neighbor_collapse', 'politics', {
    weight: (s) => 0.6 + 1.0 * (1 - r.sf(s)),
    options: [
      { cashDelta: -30000, scoreDelta: { safety: 10, wellBeing: 8 }, effectTag: 'send_rescue',
        effects: [{ type: 'morale_shift', perHour: EVENT_CHEER_MORALE_PER_HOUR, hours: EVENT_CHEER_HOURS }] },
      { cashDelta: 20000, scoreDelta: { ecology: -5 }, effectTag: 'poach_contracts',
        effects: [{ type: 'special_contract' }] },
      { cashDelta: -5000, scoreDelta: { safety: 15 }, effectTag: 'safety_audit_response' },
    ],
  }),
  // 32 — Government mandates electric vehicles
  ev('politics_ev_mandate', 'politics', {
    weight: (s) => 0.9 + 0.7 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.tickCount > 40,
    options: [
      { cashDelta: -60000, scoreDelta: { ecology: 18, nuisance: 8 }, effectTag: 'electric_fleet',
        effects: [
          { type: 'cost_factor', what: 'upkeep', pct: EVENT_UPKEEP_DISCOUNT_PCT, days: EVENT_UPKEEP_DISCOUNT_DAYS },
        ] },
      { cashDelta: -10000, scoreDelta: { ecology: -5 }, corruptionDelta: 15, effectTag: 'delay_compliance',
        effects: [{ type: 'ban', what: 'haul', hours: EVENT_INSPECTION_BAN_HOURS }] },
      { cashDelta: -30000, scoreDelta: { ecology: 8 }, effectTag: 'hybrid_compromise' },
    ],
  }),
  // 33 — Ambassador's wife fainted during mine tour
  ev('politics_ambassador_faint', 'politics', {
    weight: (s) => 0.5 + 1.2 * (1 - r.nu(s)),
    options: [
      { cashDelta: -12000, scoreDelta: { nuisance: 6, wellBeing: 4 }, effectTag: 'formal_apology' },
      { cashDelta: 0, scoreDelta: { nuisance: -8 }, followUp: 'politics_diplomatic_incident' },
      { cashDelta: -25000, scoreDelta: { nuisance: 10 }, effectTag: 'spa_gift_basket' },
    ],
  }),
  // 34 — International mining expo invitation
  ev('politics_mining_expo', 'politics', {
    weight: (s) => 0.8 + 0.5 * r.ec(s),
    options: [
      { cashDelta: -20000, scoreDelta: { ecology: 5, safety: 5 }, effectTag: 'expo_booth',
        effects: [{ type: 'special_contract' }] },
      { cashDelta: 0, scoreDelta: { ecology: -3 } },
      { cashDelta: -35000, scoreDelta: { ecology: 10, wellBeing: 5 }, effectTag: 'expo_keynote',
        probability: 0.6, alt: { cashDelta: -35000, scoreDelta: { ecology: 3 } } },
    ],
  }),
  // 35 — Mining company IPO opportunity
  ev('politics_ipo_opportunity', 'politics', {
    weight: (s) => 0.7 + 0.8 * r.sf(s),
    canFire: (ctx) => ctx.tickCount > 50,
    options: [
      { cashDelta: 80000, corruptionDelta: 15, scoreDelta: { wellBeing: -8 }, effectTag: 'go_public' },
      { cashDelta: 0, scoreDelta: { wellBeing: 5 } },
      { cashDelta: 40000, corruptionDelta: 5, effectTag: 'partial_shares',
        effects: [
          { type: 'event_weight', category: 'lawsuit', factor: EVENT_SCRUTINY_WEIGHT_FACTOR, days: EVENT_SCRUTINY_DAYS },
        ] },
    ],
  }),
  // 36 — Fictional country nationalizes all mines
  ev('politics_nationalization', 'politics', {
    weight: (s) => 0.4 + 1.0 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.corruptionLevel > 30,
    options: [
      { cashDelta: -45000, scoreDelta: { ecology: 10 }, effectTag: 'comply_nationalize' },
      { corruptionDelta: 25, cashDelta: -15000, effectTag: 'offshore_assets',
        effects: [
          { type: 'event_weight', category: 'lawsuit', factor: EVENT_SCRUTINY_WEIGHT_FACTOR, days: EVENT_SCRUTINY_DAYS },
        ] },
      { cashDelta: -30000, scoreDelta: { wellBeing: 10 }, effectTag: 'worker_cooperative',
        effects: [{ type: 'salary', pct: EVENT_PERMANENT_RAISE_SALARY_PCT, days: null }] },
    ],
  }),
  // 37 — Whistleblower leaks internal documents
  ev('politics_whistleblower', 'politics', {
    weight: (s) => 0.9 + 1.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel > 20,
    options: [
      { cashDelta: -20000, scoreDelta: { safety: 10, ecology: 8 }, corruptionDelta: -15, effectTag: 'transparency_pledge' },
      { cashDelta: -5000, corruptionDelta: 15, scoreDelta: { wellBeing: -10 }, effectTag: 'silence_whistleblower',
        effects: [{ type: 'morale_shift', perHour: EVENT_SULK_MORALE_PER_HOUR, hours: EVENT_SULK_HOURS }] },
      { cashDelta: -35000, scoreDelta: { safety: 15, ecology: 12 }, corruptionDelta: -25, effectTag: 'full_reform' },
    ],
  }),
  // 38 — Environmental NGO offers partnership
  ev('politics_ngo_partnership', 'politics', {
    weight: (s) => 1.0 + 1.2 * (1 - r.ec(s)),
    options: [
      { cashDelta: -10000, scoreDelta: { ecology: 15, nuisance: 5 }, effectTag: 'green_partner' },
      { cashDelta: 0, scoreDelta: { ecology: -8 }, effectTag: 'reject_ngo',
        effects: [{ type: 'contract_price', pct: EVENT_BOYCOTT_PRICE_PCT, days: EVENT_BOYCOTT_DAYS }] },
      { cashDelta: -5000, scoreDelta: { ecology: 8 }, effectTag: 'token_gesture' },
    ],
  }),
  // 39 — Government orders archaeological survey (delays)
  ev('politics_archaeology_halt', 'politics', {
    weight: (s) => 0.6 + 0.8 * r.ec(s),
    canFire: (ctx) => ctx.hasDrillPlan,
    options: [
      { cashDelta: -25000, scoreDelta: { ecology: 12 }, effectTag: 'proper_survey',
        effects: [{ type: 'ban', what: 'drill', hours: EVENT_CURFEW_BAN_HOURS }] },
      { cashDelta: -5000, corruptionDelta: 20, effectTag: 'bury_artifacts' },
      { cashDelta: -15000, scoreDelta: { ecology: 6 }, effectTag: 'rush_survey',
        effects: [{ type: 'ban', what: 'drill', hours: EVENT_INSPECTION_BAN_HOURS }] },
    ],
  }),
  // 40 — Mining stock market bubble
  ev('politics_stock_bubble', 'politics', {
    weight: (s) => 0.7 + 0.5 * r.sf(s),
    options: [
      { cashDelta: 50000, effectTag: 'ride_bubble', probability: 0.5,
        alt: { cashDelta: -40000, effectTag: 'bubble_burst' } },
      { cashDelta: 10000, effectTag: 'cautious_invest' },
      { cashDelta: 0, scoreDelta: { wellBeing: 3 }, effectTag: 'ignore_market' },
    ],
  }),
  // 41 — International sanctions affect ore exports
  ev('politics_sanctions', 'politics', {
    weight: (s) => 0.8 + 1.0 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.activeContractCount > 2,
    options: [
      { cashDelta: -35000, scoreDelta: { ecology: 5 }, effectTag: 'find_new_buyers',
        effects: [{ type: 'contract_price', pct: EVENT_TARIFF_PRICE_PCT, days: EVENT_TARIFF_DAYS }] },
      { corruptionDelta: 20, cashDelta: 15000, effectTag: 'sanctions_smuggling' },
      { cashDelta: -20000, scoreDelta: { ecology: 10 }, effectTag: 'domestic_pivot',
        effects: [{ type: 'contract_price', pct: EVENT_BOYCOTT_PRICE_PCT, days: EVENT_BOYCOTT_DAYS }] },
    ],
  }),
  // 42 — Celebrity activist camps at your gate
  ev('politics_celebrity_protest', 'politics', {
    weight: (s) => 0.9 + 1.5 * (1 - r.nu(s)),
    options: [
      { cashDelta: -15000, scoreDelta: { nuisance: 8, ecology: 5 }, effectTag: 'engage_celebrity' },
      { cashDelta: 0, scoreDelta: { nuisance: -12 }, effectTag: 'ignore_celeb',
        effects: [
          { type: 'event_weight', category: 'lawsuit', factor: EVENT_SCRUTINY_WEIGHT_FACTOR, days: EVENT_SCRUTINY_DAYS },
        ] },
      { cashDelta: -8000, scoreDelta: { nuisance: 4 }, effectTag: 'invite_mine_tour',
        probability: 0.7, alt: { scoreDelta: { nuisance: -5 }, effectTag: 'celeb_horrified' } },
    ],
  }),
  // 43 — AI threatens to replace all miners (meta-humor)
  ev('politics_ai_replacement', 'politics', {
    weight: (s) => 0.5 + 0.6 * r.sf(s),
    canFire: (ctx) => ctx.tickCount > 60,
    options: [
      { cashDelta: -40000, scoreDelta: { wellBeing: -15, safety: 10 }, effectTag: 'automate_mine',
        effects: [
          { type: 'employee_leaves', pick: 'random' },
          { type: 'work_rate', pct: EVENT_SURGE_WORK_PCT, hours: EVENT_SURGE_HOURS },
        ] },
      { cashDelta: -5000, scoreDelta: { wellBeing: 12 }, effectTag: 'humans_first_pledge',
        effects: [{ type: 'morale_shift', perHour: EVENT_CHEER_MORALE_PER_HOUR, hours: EVENT_CHEER_HOURS }] },
      { cashDelta: -20000, scoreDelta: { wellBeing: -5, safety: 5 }, effectTag: 'ai_assistant_only' },
    ],
  }),
  // 44 — Government "efficiency expert" assigned
  ev('politics_efficiency_expert', 'politics', {
    weight: (s) => 0.8 + 1.0 * (1 - r.wb(s)),
    options: [
      { cashDelta: -10000, scoreDelta: { wellBeing: -8 }, effectTag: 'expert_restructure',
        effects: [
          { type: 'work_rate', pct: EVENT_SURGE_WORK_PCT, hours: EVENT_SURGE_HOURS },
          { type: 'morale_shift', perHour: EVENT_GLOOM_MORALE_PER_HOUR, hours: EVENT_GLOOM_HOURS },
        ] },
      { corruptionDelta: 12, cashDelta: -3000, scoreDelta: { wellBeing: 3 }, effectTag: 'distract_expert' },
      { cashDelta: -18000, scoreDelta: { wellBeing: 5, safety: 5 }, effectTag: 'implement_suggestions',
        effects: [{ type: 'work_rate', pct: EVENT_SURGE_WORK_PCT, hours: EVENT_SURGE_HOURS }] },
    ],
  }),
  // 45 — Mining heritage listed (can't blast certain areas)
  ev('politics_heritage_listing', 'politics', {
    weight: (s) => 0.6 + 0.9 * r.ec(s),
    canFire: (ctx) => ctx.hasDrillPlan,
    options: [
      { cashDelta: -15000, scoreDelta: { ecology: 12 }, effectTag: 'respect_heritage',
        effects: [{ type: 'ban', what: 'blast', hours: EVENT_INJUNCTION_BAN_HOURS }] },
      { cashDelta: -5000, corruptionDelta: 18, effectTag: 'delist_heritage' },
      { cashDelta: -25000, scoreDelta: { ecology: 8, nuisance: 5 }, effectTag: 'heritage_museum' },
    ],
  }),
  // 46 — Alien mineral discovered in your ore (fantastical)
  ev('politics_alien_mineral', 'politics', {
    weight: (s) => 0.15 + 0.2 * r.ec(s),
    options: [
      { cashDelta: 100000, scoreDelta: { ecology: -15 }, corruptionDelta: 10, effectTag: 'sell_to_military',
        effects: [
          { type: 'event_weight', category: 'mafia', factor: EVENT_SCRUTINY_WEIGHT_FACTOR, days: EVENT_SCRUTINY_DAYS },
        ] },
      { cashDelta: -20000, scoreDelta: { ecology: 15, safety: 10 }, effectTag: 'donate_to_science' },
      { cashDelta: 30000, scoreDelta: { nuisance: -10 }, effectTag: 'alien_tourism',
        probability: 0.4, alt: { cashDelta: -10000, scoreDelta: { nuisance: -15 }, effectTag: 'alien_panic' } },
    ],
  }),
  // 47 — Political scandal implicates your biggest client
  ev('politics_client_scandal', 'politics', {
    weight: (s) => 0.7 + 0.8 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.activeContractCount > 0,
    options: [
      { cashDelta: -20000, scoreDelta: { ecology: 8 }, effectTag: 'cut_ties',
        effects: [{ type: 'cancel_contract', penalty: false }] },
      { cashDelta: 10000, corruptionDelta: 15, effectTag: 'keep_quiet' },
      { cashDelta: -10000, scoreDelta: { ecology: 4 }, effectTag: 'public_distance' },
    ],
  }),
  // 48 — Tourism board wants mine tours
  ev('politics_mine_tourism', 'politics', {
    weight: (s) => 0.8 + 0.6 * r.sf(s),
    canFire: (ctx) => ctx.scores.safety > 50,
    options: [
      { cashDelta: 15000, scoreDelta: { nuisance: -8, safety: -5 }, effectTag: 'open_tours',
        effects: [{ type: 'employee_injured' }] },
      { cashDelta: 0, scoreDelta: { nuisance: 3 } },
      { cashDelta: 5000, scoreDelta: { safety: -2, nuisance: -3 }, effectTag: 'vip_tours_only' },
    ],
  }),
  // 49 — Insurance company doubles premiums
  ev('politics_insurance_hike', 'politics', {
    weight: (s) => 1.0 + 1.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.deathCount > 0 || ctx.lawsuitCount > 0,
    options: [
      { cashDelta: -30000, scoreDelta: { safety: 5 }, effectTag: 'pay_premium' },
      { cashDelta: -10000, corruptionDelta: 10, effectTag: 'shady_insurer',
        effects: [
          { type: 'event_weight', category: 'lawsuit', factor: EVENT_SCRUTINY_WEIGHT_FACTOR, days: EVENT_SCRUTINY_DAYS },
        ] },
      { cashDelta: -45000, scoreDelta: { safety: 15 }, effectTag: 'safety_overhaul_discount',
        effects: [
          { type: 'cost_factor', what: 'upkeep', pct: EVENT_UPKEEP_DISCOUNT_PCT, days: EVENT_UPKEEP_DISCOUNT_DAYS },
          { type: 'recurring_charge', perDay: EVENT_RETAINER_PER_DAY, days: EVENT_RETAINER_DAYS },
        ] },
    ],
  }),
  // 50 — Mining rights auction for adjacent land
  ev('politics_land_auction', 'politics', {
    weight: (s) => 0.7 + 0.5 * r.ec(s),
    canFire: (ctx) => ctx.tickCount > 25,
    options: [
      { cashDelta: -60000, scoreDelta: { ecology: -10 }, effectTag: 'win_auction' },
      { cashDelta: 0, scoreDelta: { ecology: 5 } },
      { cashDelta: -30000, scoreDelta: { ecology: -3 }, effectTag: 'joint_venture',
        probability: 0.7, alt: { cashDelta: -30000, scoreDelta: { ecology: -8 }, effectTag: 'venture_betrayal' } },
    ],
  }),
];
