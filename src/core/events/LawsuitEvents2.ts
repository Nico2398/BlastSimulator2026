// BlastSimulator2026 — Lawsuit events batch 2 (events 26-50)
// Legal absurdity, ambulance chasers, and satirical courtroom drama.
import { ev, r } from './EventBuilder.js';
import {
  EVENT_BOYCOTT_DAYS,
  EVENT_BOYCOTT_PRICE_PCT,
  EVENT_BRIEF_STOP_HOURS,
  EVENT_CHEER_HOURS,
  EVENT_CHEER_MORALE_PER_HOUR,
  EVENT_CURFEW_BAN_HOURS,
  EVENT_EXPLOSIVE_SURCHARGE_DAYS,
  EVENT_EXPLOSIVE_SURCHARGE_PCT,
  EVENT_INSPECTION_BAN_HOURS,
  EVENT_PENALTY_DAYS,
  EVENT_PENALTY_PER_DAY,
  EVENT_PERMANENT_RAISE_SALARY_PCT,
  EVENT_PERMIT_BAN_HOURS,
  EVENT_PROTECTION_DAYS,
  EVENT_PROTECTION_PER_DAY,
  EVENT_RETAINER_DAYS,
  EVENT_RETAINER_PER_DAY,
  EVENT_SCRUTINY_DAYS,
  EVENT_SCRUTINY_WEIGHT_FACTOR,
  EVENT_STRIKE_HOURS,
  EVENT_SULK_HOURS,
  EVENT_SULK_MORALE_PER_HOUR,
  EVENT_SURGE_HOURS,
  EVENT_SURGE_WORK_PCT,
  EVENT_TARIFF_DAYS,
  EVENT_TARIFF_PRICE_PCT,
  INSPECTION_EVENT_TAG,
} from '../config/balance.js';
import type { EventDef } from './EventPool.js';
import { hasEnvironmentalCause } from './EventPool.js';

export const LAWSUIT_EVENTS_2: EventDef[] = [
  // 26 — Class action: chronic dust inhalation fashion damage
  ev('lawsuit_dust_fashion', 'lawsuit', {
    weight: (s) => 1.0 + 1.8 * (1 - r.nu(s)),
    canFire: (ctx) => hasEnvironmentalCause(ctx) && ctx.tickCount > 15,
    options: [
      { cashDelta: -25000, scoreDelta: { nuisance: 8 }, effectTag: 'dust_settlement' },
      { cashDelta: -5000, scoreDelta: { nuisance: -5 }, followUp: 'lawsuit_dust_fashion_appeal' },
      { corruptionDelta: 12, cashDelta: -3000, effectTag: 'bribe_dry_cleaners' },
    ],
  }),
  // 27 — Supplier sues for unpaid invoices
  ev('lawsuit_unpaid_supplier', 'lawsuit', {
    weight: (s) => 1.2 + 1.0 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.activeContractCount > 0,
    options: [
      { cashDelta: -40000, scoreDelta: { wellBeing: 5 }, effectTag: 'pay_invoices' },
      { cashDelta: -10000, scoreDelta: { wellBeing: -8 }, effectTag: 'dispute_invoices',
        effects: [
          { type: 'cost_factor', what: 'explosive', pct: EVENT_EXPLOSIVE_SURCHARGE_PCT, days: EVENT_EXPLOSIVE_SURCHARGE_DAYS },
        ] },
      { corruptionDelta: 15, cashDelta: -5000, effectTag: 'lose_paperwork' },
    ],
  }),
  // 28 — Regulatory fine for paperwork violations
  ev('lawsuit_paperwork_fine', 'lawsuit', {
    tags: [INSPECTION_EVENT_TAG],
    weight: (s) => 1.3 + 1.5 * (1 - r.sf(s)),
    options: [
      { cashDelta: -20000, scoreDelta: { safety: 8 }, effectTag: 'pay_fine_fix_docs' },
      { cashDelta: -8000, scoreDelta: { safety: -5 }, effectTag: 'partial_compliance' },
      { corruptionDelta: 18, cashDelta: -2000, effectTag: 'forge_paperwork' },
    ],
  }),
  // 29 — Neighbor sues for aesthetic pollution
  ev('lawsuit_aesthetic_pollution', 'lawsuit', {
    weight: (s) => 0.8 + 1.6 * (1 - r.nu(s)),
    canFire: (ctx) => hasEnvironmentalCause(ctx) && ctx.scores.nuisance < 60,
    options: [
      { cashDelta: -15000, scoreDelta: { nuisance: 10, ecology: 5 }, effectTag: 'landscaping' },
      { cashDelta: 0, scoreDelta: { nuisance: -8 }, effectTag: 'beauty_is_subjective',
        effects: [
          { type: 'event_weight', category: 'lawsuit', factor: EVENT_SCRUTINY_WEIGHT_FACTOR, days: EVENT_SCRUTINY_DAYS },
        ] },
      { cashDelta: -30000, scoreDelta: { nuisance: 15 }, effectTag: 'hire_mine_architect' },
    ],
  }),
  // 30 — Employee discrimination suit (wanted to be a blaster)
  ev('lawsuit_blaster_discrimination', 'lawsuit', {
    weight: (s) => 0.9 + 1.2 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.employeeCount > 3,
    options: [
      { cashDelta: -18000, scoreDelta: { wellBeing: 10 }, effectTag: 'promote_to_blaster',
        effects: [{ type: 'salary', pct: EVENT_PERMANENT_RAISE_SALARY_PCT, days: null, role: 'blaster' }] },
      { cashDelta: -12000, scoreDelta: { wellBeing: -5 }, effectTag: 'settle_quietly',
        effects: [{ type: 'morale_shift', perHour: EVENT_SULK_MORALE_PER_HOUR, hours: EVENT_SULK_HOURS }] },
      { cashDelta: -5000, scoreDelta: { safety: -8 }, effectTag: 'give_them_dynamite',
        probability: 0.5, alt: { cashDelta: -30000, scoreDelta: { safety: -15 }, effectTag: 'unqualified_blast' } },
    ],
  }),
  // 31 — Environmental cleanup order from government
  ev('lawsuit_env_cleanup_order', 'lawsuit', {
    weight: (s) => 1.5 + 2.0 * (1 - r.ec(s)),
    canFire: (ctx) => hasEnvironmentalCause(ctx) && ctx.scores.ecology < 45,
    options: [
      { cashDelta: -60000, scoreDelta: { ecology: 20, nuisance: 5 }, effectTag: 'full_cleanup',
        effects: [{ type: 'work_stoppage', hours: EVENT_BRIEF_STOP_HOURS }] },
      { cashDelta: -20000, scoreDelta: { ecology: 8 }, effectTag: 'minimal_cleanup',
        effects: [
          { type: 'event_weight', category: 'lawsuit', factor: EVENT_SCRUTINY_WEIGHT_FACTOR, days: EVENT_SCRUTINY_DAYS },
        ] },
      { corruptionDelta: 25, cashDelta: -10000, effectTag: 'bury_toxic_report' },
    ],
  }),
  // 32 — Workers sue for right to unionize
  ev('lawsuit_union_right', 'lawsuit', {
    weight: (s) => 1.1 + 1.4 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.employeeCount > 5,
    options: [
      { cashDelta: -10000, scoreDelta: { wellBeing: 15 }, effectTag: 'allow_union',
        effects: [{ type: 'morale_shift', perHour: EVENT_CHEER_MORALE_PER_HOUR, hours: EVENT_CHEER_HOURS }] },
      { cashDelta: -25000, scoreDelta: { wellBeing: -12 }, effectTag: 'fight_unionization',
        effects: [{ type: 'work_stoppage', hours: EVENT_STRIKE_HOURS }] },
      { corruptionDelta: 20, cashDelta: -3000, scoreDelta: { wellBeing: -5 }, effectTag: 'install_puppet_union' },
    ],
  }),
  // 33 — Noise ordinance violation, multiple infractions
  ev('lawsuit_noise_infractions', 'lawsuit', {
    weight: (s) => 1.2 + 1.8 * (1 - r.nu(s)),
    canFire: (ctx) => hasEnvironmentalCause(ctx) && ctx.lawsuitCount > 0,
    options: [
      { cashDelta: -35000, scoreDelta: { nuisance: 12 }, effectTag: 'install_noise_barriers' },
      { cashDelta: -15000, scoreDelta: { nuisance: 4 }, effectTag: 'pay_fines_only',
        effects: [{ type: 'recurring_charge', perDay: EVENT_PENALTY_PER_DAY, days: EVENT_PENALTY_DAYS }] },
      { corruptionDelta: 14, cashDelta: -5000, effectTag: 'bribe_noise_inspector' },
    ],
  }),
  // 34 — Competitor sues for unfair blasting practices
  ev('lawsuit_unfair_blasting', 'lawsuit', {
    weight: (s) => 0.7 + 1.0 * r.sf(s),
    canFire: (ctx) => ctx.hasDrillPlan,
    options: [
      { cashDelta: -20000, scoreDelta: { safety: 5 }, effectTag: 'legal_defense' },
      { cashDelta: -40000, scoreDelta: { safety: 10, ecology: 5 }, effectTag: 'countersue_and_win',
        probability: 0.4, alt: { cashDelta: -55000, scoreDelta: { safety: -5 }, effectTag: 'countersue_fail' } },
      { corruptionDelta: 15, cashDelta: -8000, effectTag: 'settle_with_competitor' },
    ],
  }),
  // 35 — Local school sues: blasts interrupt exams
  ev('lawsuit_school_exams', 'lawsuit', {
    weight: (s) => 1.0 + 1.5 * (1 - r.nu(s)),
    canFire: (ctx) => hasEnvironmentalCause(ctx) && ctx.hasDrillPlan,
    options: [
      { cashDelta: -12000, scoreDelta: { nuisance: 10, wellBeing: 5 }, effectTag: 'blast_schedule_change',
        effects: [{ type: 'ban', what: 'blast', hours: EVENT_CURFEW_BAN_HOURS }] },
      { cashDelta: -25000, scoreDelta: { nuisance: 8 }, effectTag: 'fund_school_soundproofing' },
      { cashDelta: 0, scoreDelta: { nuisance: -10, wellBeing: -8 }, effectTag: 'children_can_cope',
        effects: [
          { type: 'event_weight', category: 'lawsuit', factor: EVENT_SCRUTINY_WEIGHT_FACTOR, days: EVENT_SCRUTINY_DAYS },
        ] },
    ],
  }),
  // 36 — Ambulance chaser lawyer appears
  ev('lawsuit_ambulance_chaser', 'lawsuit', {
    weight: (s) => 1.3 + 1.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.deathCount > 0 || ctx.lawsuitCount > 1,
    options: [
      { cashDelta: -30000, scoreDelta: { safety: 8 }, effectTag: 'preemptive_settlement' },
      { cashDelta: -5000, followUp: 'lawsuit_class_action_mega', effectTag: 'ignore_lawyer' },
      { corruptionDelta: 18, cashDelta: -8000, effectTag: 'hire_the_chaser',
        effects: [{ type: 'recurring_charge', perDay: EVENT_RETAINER_PER_DAY, days: EVENT_RETAINER_DAYS }] },
    ],
  }),
  // 37 — Joint lawsuit from multiple villages
  ev('lawsuit_village_coalition', 'lawsuit', {
    weight: (s) => 1.4 + 2.0 * (1 - r.nu(s)) + 1.0 * (1 - r.ec(s)),
    canFire: (ctx) => hasEnvironmentalCause(ctx) && ctx.lawsuitCount > 2,
    options: [
      { cashDelta: -50000, scoreDelta: { nuisance: 15, ecology: 10 }, effectTag: 'mega_settlement' },
      { cashDelta: -15000, scoreDelta: { nuisance: -5 }, followUp: 'lawsuit_village_coalition_2' },
      { corruptionDelta: 30, cashDelta: -10000, effectTag: 'buy_village_mayors',
        effects: [{ type: 'recurring_charge', perDay: EVENT_PROTECTION_PER_DAY, days: EVENT_PROTECTION_DAYS }] },
    ],
  }),
  // 38 — Workers sue for lack of career development
  ev('lawsuit_career_stagnation', 'lawsuit', {
    weight: (s) => 0.9 + 1.3 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.employeeCount > 4 && ctx.tickCount > 30,
    options: [
      { cashDelta: -20000, scoreDelta: { wellBeing: 12 }, effectTag: 'training_program',
        effects: [{ type: 'work_rate', pct: EVENT_SURGE_WORK_PCT, hours: EVENT_SURGE_HOURS }] },
      { cashDelta: -8000, scoreDelta: { wellBeing: 4 }, effectTag: 'motivational_posters' },
      { cashDelta: -3000, scoreDelta: { wellBeing: -6 }, effectTag: 'tell_them_rock_is_career',
        effects: [{ type: 'employee_leaves', pick: 'junior' }] },
    ],
  }),
  // 39 — Government demands back-taxes on unreported ore
  ev('lawsuit_back_taxes', 'lawsuit', {
    weight: (s) => 1.1 + 1.0 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.corruptionLevel > 15,
    options: [
      { cashDelta: -55000, scoreDelta: { ecology: 5 }, corruptionDelta: -10, effectTag: 'pay_back_taxes' },
      { cashDelta: -20000, corruptionDelta: 20, effectTag: 'creative_accounting' },
      { cashDelta: -35000, corruptionDelta: -5, effectTag: 'tax_lawyer_hired',
        effects: [{ type: 'recurring_charge', perDay: EVENT_RETAINER_PER_DAY, days: EVENT_RETAINER_DAYS }] },
    ],
  }),
  // 40 — Shareholder derivative suit
  ev('lawsuit_shareholder_suit', 'lawsuit', {
    weight: (s) => 0.8 + 1.2 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.tickCount > 50,
    options: [
      { cashDelta: -45000, scoreDelta: { safety: 10 }, effectTag: 'governance_reform' },
      { cashDelta: -15000, scoreDelta: { wellBeing: -5 }, effectTag: 'fight_shareholders',
        effects: [
          { type: 'event_weight', category: 'lawsuit', factor: EVENT_SCRUTINY_WEIGHT_FACTOR, days: EVENT_SCRUTINY_DAYS },
        ] },
      { corruptionDelta: 22, cashDelta: -8000, effectTag: 'buy_back_shares_quietly',
        effects: [{ type: 'recurring_charge', perDay: EVENT_RETAINER_PER_DAY, days: EVENT_RETAINER_DAYS }] },
    ],
  }),
  // 41 — Celebrity sues after chipping nail during mine visit
  ev('lawsuit_celeb_nail', 'lawsuit', {
    weight: (s) => 0.5 + 0.8 * (1 - r.nu(s)),
    options: [
      { cashDelta: -20000, scoreDelta: { nuisance: 5 }, effectTag: 'celeb_settlement' },
      { cashDelta: 0, scoreDelta: { nuisance: -12 }, effectTag: 'celeb_goes_viral',
        effects: [{ type: 'contract_price', pct: EVENT_TARIFF_PRICE_PCT, days: EVENT_TARIFF_DAYS }] },
      { cashDelta: -50000, scoreDelta: { nuisance: 15 }, effectTag: 'celeb_endorsement_deal',
        probability: 0.3, alt: { cashDelta: -50000, scoreDelta: { nuisance: -8 }, effectTag: 'celeb_still_sues' } },
    ],
  }),
  // 42 — Professional mountaineer sues for ruining the mountain
  ev('lawsuit_mountaineer', 'lawsuit', {
    weight: (s) => 0.7 + 1.2 * (1 - r.ec(s)),
    canFire: (ctx) => hasEnvironmentalCause(ctx),
    options: [
      { cashDelta: -15000, scoreDelta: { ecology: 8 }, effectTag: 'mountain_restoration_fund' },
      { cashDelta: 0, scoreDelta: { ecology: -5, nuisance: -5 }, effectTag: 'its_a_pit_not_a_peak' },
      { cashDelta: -25000, scoreDelta: { ecology: 12, nuisance: 5 }, effectTag: 'build_climbing_wall',
        effects: [{ type: 'morale_shift', perHour: EVENT_CHEER_MORALE_PER_HOUR, hours: EVENT_CHEER_HOURS }] },
    ],
  }),
  // 43 — Mine inspectors union demands better inspection conditions
  ev('lawsuit_inspector_union', 'lawsuit', {
    weight: (s) => 1.0 + 1.4 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.scores.safety < 50,
    options: [
      { cashDelta: -22000, scoreDelta: { safety: 12, wellBeing: 5 }, effectTag: 'inspector_lounge' },
      { cashDelta: -8000, scoreDelta: { safety: 4 }, effectTag: 'hard_hats_for_inspectors' },
      { corruptionDelta: 16, cashDelta: -3000, effectTag: 'inspector_free_zone' },
    ],
  }),
  // 44 — Ghost of former miner files posthumous complaint (fantastical)
  ev('lawsuit_ghost_miner', 'lawsuit', {
    weight: (s) => 0.2 + 0.3 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.deathCount > 0,
    options: [
      { cashDelta: -10000, scoreDelta: { safety: 10, wellBeing: 8 }, effectTag: 'memorial_shrine',
        effects: [{ type: 'morale_shift', perHour: EVENT_CHEER_MORALE_PER_HOUR, hours: EVENT_CHEER_HOURS }] },
      { cashDelta: -5000, scoreDelta: { safety: -3 }, effectTag: 'exorcist_hired' },
      { cashDelta: -30000, scoreDelta: { safety: 15, wellBeing: 12 }, effectTag: 'ghost_satisfaction',
        probability: 0.5, alt: { cashDelta: -30000, scoreDelta: { safety: 5 }, effectTag: 'ghost_unsatisfied' } },
    ],
  }),
  // 45 — Class action over emotional distress from explosion names
  ev('lawsuit_explosion_names', 'lawsuit', {
    weight: (s) => 0.6 + 1.0 * (1 - r.nu(s)),
    canFire: (ctx) => ctx.hasDrillPlan,
    options: [
      { cashDelta: -12000, scoreDelta: { nuisance: 8 }, effectTag: 'rename_operations' },
      { cashDelta: 0, scoreDelta: { nuisance: -6 }, effectTag: 'double_down_names',
        effects: [
          { type: 'event_weight', category: 'lawsuit', factor: EVENT_SCRUTINY_WEIGHT_FACTOR, days: EVENT_SCRUTINY_DAYS },
        ] },
      { cashDelta: -6000, scoreDelta: { nuisance: 3 }, effectTag: 'sensitivity_committee' },
    ],
  }),
  // 46 — Divorce lawyer subpoenas mine records
  ev('lawsuit_divorce_subpoena', 'lawsuit', {
    weight: (s) => 0.5 + 0.6 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.corruptionLevel > 10,
    options: [
      { cashDelta: -8000, effectTag: 'comply_subpoena' },
      { cashDelta: -3000, corruptionDelta: 12, effectTag: 'shred_documents',
        effects: [
          { type: 'event_weight', category: 'lawsuit', factor: EVENT_SCRUTINY_WEIGHT_FACTOR, days: EVENT_SCRUTINY_DAYS },
        ] },
      { cashDelta: -15000, corruptionDelta: -5, effectTag: 'full_audit_trail' },
    ],
  }),
  // 47 — PETA sues for distressing local goat population
  ev('lawsuit_peta_goats', 'lawsuit', {
    weight: (s) => 0.8 + 1.4 * (1 - r.ec(s)),
    canFire: (ctx) => hasEnvironmentalCause(ctx),
    options: [
      { cashDelta: -18000, scoreDelta: { ecology: 12, nuisance: 5 }, effectTag: 'goat_sanctuary' },
      { cashDelta: 0, scoreDelta: { ecology: -8, nuisance: -8 }, effectTag: 'goats_are_fine',
        effects: [{ type: 'contract_price', pct: EVENT_BOYCOTT_PRICE_PCT, days: EVENT_BOYCOTT_DAYS }] },
      { cashDelta: -10000, scoreDelta: { ecology: 6 }, effectTag: 'goat_relocation',
        probability: 0.7, alt: { scoreDelta: { ecology: -3, nuisance: -5 }, effectTag: 'goats_return' } },
    ],
  }),
  // 48 — Building code violations from hasty construction
  ev('lawsuit_building_code', 'lawsuit', {
    weight: (s) => 1.2 + 1.6 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.hasBuilding('any'),
    options: [
      { cashDelta: -35000, scoreDelta: { safety: 15 }, effectTag: 'rebuild_to_code',
        effects: [{ type: 'work_stoppage', hours: EVENT_BRIEF_STOP_HOURS }] },
      { cashDelta: -12000, scoreDelta: { safety: 5 }, effectTag: 'patch_violations',
        effects: [{ type: 'ban', what: 'drill', hours: EVENT_INSPECTION_BAN_HOURS }] },
      { corruptionDelta: 20, cashDelta: -5000, effectTag: 'bribe_building_inspector' },
    ],
  }),
  // 49 — Whistleblower protection lawsuit
  ev('lawsuit_whistleblower', 'lawsuit', {
    weight: (s) => 1.0 + 1.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel > 25,
    options: [
      { cashDelta: -30000, scoreDelta: { safety: 10, wellBeing: 8 }, corruptionDelta: -15, effectTag: 'protect_whistleblower',
        effects: [{ type: 'morale_shift', perHour: EVENT_CHEER_MORALE_PER_HOUR, hours: EVENT_CHEER_HOURS }] },
      { cashDelta: -10000, scoreDelta: { wellBeing: -10 }, corruptionDelta: 15, effectTag: 'retaliate_whistleblower',
        effects: [{ type: 'employee_leaves', pick: 'junior' }] },
      { cashDelta: -20000, corruptionDelta: -8, effectTag: 'anonymous_hotline' },
    ],
  }),
  // 50 — International Court of Mining Justice summons (fantastical)
  ev('lawsuit_intl_mining_court', 'lawsuit', {
    weight: (s) => 0.15 + 0.3 * (1 - r.ec(s)) + 0.3 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.lawsuitCount > 3 && ctx.tickCount > 40,
    options: [
      { cashDelta: -70000, scoreDelta: { ecology: 15, safety: 15 }, corruptionDelta: -20, effectTag: 'comply_intl_court' },
      { cashDelta: -20000, scoreDelta: { ecology: -10, safety: -10, nuisance: -10 }, effectTag: 'ignore_jurisdiction',
        effects: [{ type: 'ban', what: 'haul', hours: EVENT_PERMIT_BAN_HOURS }] },
      { corruptionDelta: 35, cashDelta: -15000, effectTag: 'bribe_intl_judges',
        probability: 0.3, alt: { cashDelta: -80000, corruptionDelta: 20, effectTag: 'bribe_exposed' } },
    ],
  }),
];
