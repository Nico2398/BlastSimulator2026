// BlastSimulator2026 — Lawsuit events batch 1 (25 events)
// Satirical legal absurdity in open-pit mining: frivolous suits, class actions, and regulatory hell.
import { ev, r } from './EventBuilder.js';
import type { EventDef } from './EventPool.js';

export const LAWSUIT_EVENTS_1: EventDef[] = [
  // 1 — Wrongful death suit from bereaved family
  ev('lawsuit_wrongful_death', 'lawsuit', {
    weight: (s) => 1.5 + 2.0 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.deathCount >= 1,
    options: [
      { cashDelta: -200000, scoreDelta: { safety: 5 }, effectTag: 'settle_death_suit' },
      { cashDelta: -50000, corruptionDelta: 25, effectTag: 'intimidate_family' },
      { cashDelta: -120000, scoreDelta: { safety: 10, wellBeing: 5 }, effectTag: 'memorial_fund' },
    ],
  }),
  // 2 — Workers' class action for unsafe conditions
  ev('lawsuit_class_action', 'lawsuit', {
    weight: (s) => 1.8 + 2.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.scores.safety < 30 && ctx.employeeCount >= 5,
    options: [
      { cashDelta: -150000, scoreDelta: { safety: 12, wellBeing: 8 }, effectTag: 'class_action_settle' },
      { cashDelta: -30000, scoreDelta: { safety: -5 }, probability: 0.4,
        alt: { cashDelta: -250000, scoreDelta: { safety: 15 } } },
      { cashDelta: -20000, corruptionDelta: 20, effectTag: 'bribe_union_reps' },
    ],
  }),
  // 3 — Mrs. Henderson's 47 porcelain cats shattered by vibrations
  ev('lawsuit_neighbor_vibrations', 'lawsuit', {
    weight: (s) => 1.2 + 2.0 * (1 - r.nu(s)),
    canFire: (ctx) => ctx.scores.nuisance < 40,
    options: [
      { cashDelta: -45000, scoreDelta: { nuisance: 10 }, effectTag: 'replace_porcelain' },
      { cashDelta: -5000, scoreDelta: { nuisance: -8 }, effectTag: 'deny_vibrations' },
      { cashDelta: -25000, scoreDelta: { nuisance: 15 }, effectTag: 'vibration_dampeners' },
    ],
  }),
  // 4 — EPA environmental investigation
  ev('lawsuit_environmental_agency', 'lawsuit', {
    weight: (s) => 2.0 + 2.5 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.scores.ecology < 25,
    options: [
      { cashDelta: -100000, scoreDelta: { ecology: 15 }, effectTag: 'epa_comply' },
      { cashDelta: -20000, corruptionDelta: 30, effectTag: 'epa_bribe_inspector' },
      { cashDelta: -60000, scoreDelta: { ecology: 8 }, effectTag: 'epa_partial_fix' },
    ],
  }),
  // 5 — Criminal negligence charges — game-ending potential
  ev('lawsuit_criminal_negligence', 'lawsuit', {
    weight: (s) => 2.5 + 3.0 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.deathCount >= 3 || (ctx.lawsuitCount >= 5 && ctx.scores.safety < 20),
    options: [
      { cashDelta: -300000, scoreDelta: { safety: 20 }, effectTag: 'plea_deal' },
      { cashDelta: -50000, probability: 0.3,
        alt: { cashDelta: -500000, effectTag: 'found_guilty' } },
      { cashDelta: -100000, corruptionDelta: 40, effectTag: 'flee_jurisdiction' },
    ],
  }),
  // 6 — Workers' comp for "existential dread caused by explosions"
  ev('lawsuit_existential_dread', 'lawsuit', {
    weight: (s) => 0.9 + 1.2 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.employeeCount >= 3,
    options: [
      { cashDelta: -30000, scoreDelta: { wellBeing: 8 }, effectTag: 'hire_therapist' },
      { cashDelta: -5000, scoreDelta: { wellBeing: -5 }, effectTag: 'deny_existential' },
      { cashDelta: -15000, scoreDelta: { wellBeing: 12 }, effectTag: 'meditation_room' },
    ],
  }),
  // 7 — Neighbor sues over plummeting property values
  ev('lawsuit_property_values', 'lawsuit', {
    weight: (s) => 1.1 + 1.5 * (1 - r.nu(s)),
    canFire: (ctx) => ctx.scores.nuisance < 45,
    options: [
      { cashDelta: -80000, scoreDelta: { nuisance: 10 }, effectTag: 'compensate_neighbors' },
      { cashDelta: -10000, corruptionDelta: 15, effectTag: 'buy_appraiser' },
      { cashDelta: -40000, scoreDelta: { nuisance: 6 }, effectTag: 'landscape_buffer' },
    ],
  }),
  // 8 — Patent troll claims ownership of your blasting technique
  ev('lawsuit_patent_troll', 'lawsuit', {
    weight: (s) => 0.8 + 0.4 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.tickCount > 40,
    options: [
      { cashDelta: -60000, effectTag: 'license_patent' },
      { cashDelta: -120000, probability: 0.6,
        alt: { cashDelta: -20000, effectTag: 'patent_invalidated' } },
      { cashDelta: -25000, corruptionDelta: 10, effectTag: 'counter_troll' },
    ],
  }),
  // 9 — Former employee writes tell-all book "The Pit of Despair"
  ev('lawsuit_tell_all_book', 'lawsuit', {
    weight: (s) => 0.9 + 1.0 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.tickCount > 60 && ctx.employeeCount >= 2,
    options: [
      { cashDelta: -50000, scoreDelta: { wellBeing: -10, nuisance: -8 }, effectTag: 'injunction' },
      { cashDelta: -15000, scoreDelta: { wellBeing: 5 }, effectTag: 'own_the_narrative' },
      { cashDelta: -30000, corruptionDelta: 15, effectTag: 'buy_all_copies' },
    ],
  }),
  // 10 — Animal rights group sues for displaced "endangered gravel beetles"
  ev('lawsuit_animal_rights', 'lawsuit', {
    weight: (s) => 1.3 + 1.8 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.scores.ecology < 40,
    options: [
      { cashDelta: -40000, scoreDelta: { ecology: 12 }, effectTag: 'beetle_sanctuary' },
      { cashDelta: -8000, scoreDelta: { ecology: -5 }, effectTag: 'deny_beetles_exist' },
      { cashDelta: -25000, scoreDelta: { ecology: 8 }, effectTag: 'beetle_relocation' },
    ],
  }),
  // 11 — Noise complaint escalates to restraining order against your explosives
  ev('lawsuit_noise_restraining', 'lawsuit', {
    weight: (s) => 1.0 + 1.8 * (1 - r.nu(s)),
    canFire: (ctx) => ctx.scores.nuisance < 35,
    options: [
      { cashDelta: -35000, scoreDelta: { nuisance: 15 }, effectTag: 'sound_barriers' },
      { cashDelta: -10000, corruptionDelta: 12, effectTag: 'judge_golf_trip' },
      { cashDelta: -20000, scoreDelta: { nuisance: 8 }, effectTag: 'blast_schedule' },
    ],
  }),
  // 12 — Slip-and-fall from mine tour visitor who ignored 14 warning signs
  ev('lawsuit_slip_and_fall', 'lawsuit', {
    weight: (s) => 0.8 + 1.0 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.hasBuilding('visitor_center'),
    options: [
      { cashDelta: -25000, scoreDelta: { safety: 5 }, effectTag: 'settle_slip' },
      { cashDelta: -60000, probability: 0.5,
        alt: { cashDelta: -5000, scoreDelta: { safety: 3 }, effectTag: 'case_dismissed' } },
      { cashDelta: -15000, scoreDelta: { safety: 8 }, effectTag: 'more_warning_signs' },
    ],
  }),
  // 13 — OSHA investigation: hardhats used as soup bowls
  ev('lawsuit_osha_hardhats', 'lawsuit', {
    weight: (s) => 1.4 + 2.0 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.scores.safety < 35,
    options: [
      { cashDelta: -70000, scoreDelta: { safety: 15 }, effectTag: 'osha_full_overhaul' },
      { cashDelta: -20000, corruptionDelta: 18, effectTag: 'osha_gift_basket' },
      { cashDelta: -40000, scoreDelta: { safety: 8 }, effectTag: 'osha_minimum_fix' },
    ],
  }),
  // 14 — IP dispute: neighboring mine claims you stole their ore name "Boomite"
  ev('lawsuit_ore_name_ip', 'lawsuit', {
    weight: (s) => 0.6 + 0.3 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.tickCount > 50,
    options: [
      { cashDelta: -20000, effectTag: 'rename_ore' },
      { cashDelta: -45000, probability: 0.5,
        alt: { cashDelta: -10000, effectTag: 'keep_name' } },
      { cashDelta: -15000, corruptionDelta: 8, effectTag: 'buy_trademark' },
    ],
  }),
  // 15 — Insurance company sues YOU for filing too many claims
  ev('lawsuit_insurance_counter', 'lawsuit', {
    weight: (s) => 1.2 + 1.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.lawsuitCount >= 3,
    options: [
      { cashDelta: -90000, effectTag: 'insurance_settle' },
      { cashDelta: -30000, scoreDelta: { safety: 10 }, effectTag: 'improve_safety_record' },
      { cashDelta: -15000, corruptionDelta: 15, effectTag: 'falsify_records' },
    ],
  }),
  // 16 — Former employee claims mine gave them superpowers, wants royalties
  ev('lawsuit_superpowers', 'lawsuit', {
    weight: (s) => 0.3 + 0.2 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.tickCount > 80 && ctx.scores.ecology < 50,
    options: [
      { cashDelta: -10000, scoreDelta: { ecology: -3 }, effectTag: 'superpower_dismiss' },
      { cashDelta: -50000, scoreDelta: { ecology: 5 }, effectTag: 'superpower_study' },
      { cashDelta: -5000, corruptionDelta: 8, effectTag: 'nda_superpowers' },
    ],
  }),
  // 17 — Wrongful termination: fired employee says they were "too good at blasting"
  ev('lawsuit_wrongful_termination', 'lawsuit', {
    weight: (s) => 0.9 + 0.8 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.employeeCount >= 2,
    options: [
      { cashDelta: -35000, scoreDelta: { wellBeing: 8 }, effectTag: 'rehire_blaster' },
      { cashDelta: -60000, probability: 0.5,
        alt: { cashDelta: -15000, effectTag: 'termination_upheld' } },
      { cashDelta: -25000, scoreDelta: { wellBeing: 5 }, effectTag: 'severance_package' },
    ],
  }),
  // 18 — Data breach: employee records leaked, everyone's dynamite allergies exposed
  ev('lawsuit_data_breach', 'lawsuit', {
    weight: (s) => 0.8 + 0.6 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.employeeCount >= 5,
    options: [
      { cashDelta: -55000, scoreDelta: { safety: 5, wellBeing: 5 }, effectTag: 'breach_notify' },
      { cashDelta: -10000, corruptionDelta: 12, effectTag: 'breach_cover_up' },
      { cashDelta: -30000, scoreDelta: { safety: 8 }, effectTag: 'cyber_security' },
    ],
  }),
  // 19 — Contractor disputes blast damage to their equipment
  ev('lawsuit_contractor_damage', 'lawsuit', {
    weight: (s) => 1.0 + 1.2 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.hasDrillPlan,
    options: [
      { cashDelta: -45000, scoreDelta: { safety: 5 }, effectTag: 'replace_equipment' },
      { cashDelta: -80000, probability: 0.4,
        alt: { cashDelta: -15000, effectTag: 'contractor_loses' } },
      { cashDelta: -25000, corruptionDelta: 10, effectTag: 'blame_subcontractor' },
    ],
  }),
  // 20 — Neighboring farmer: dust ruined his "artisanal organic gravel crop"
  ev('lawsuit_farmer_dust', 'lawsuit', {
    weight: (s) => 1.1 + 1.5 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.scores.ecology < 45,
    options: [
      { cashDelta: -35000, scoreDelta: { ecology: 10 }, effectTag: 'dust_suppression' },
      { cashDelta: -8000, scoreDelta: { ecology: -5 }, effectTag: 'deny_dust' },
      { cashDelta: -20000, scoreDelta: { ecology: 6, nuisance: 5 }, effectTag: 'buy_his_crop' },
    ],
  }),
  // 21 — Historical society: you blasted a "priceless" 200-year-old rock pile
  ev('lawsuit_historical_artifact', 'lawsuit', {
    weight: (s) => 1.0 + 1.2 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.tickCount > 30 && ctx.scores.ecology < 50,
    options: [
      { cashDelta: -65000, scoreDelta: { ecology: 12 }, effectTag: 'artifact_restoration' },
      { cashDelta: -15000, corruptionDelta: 15, effectTag: 'artifact_coverup' },
      { cashDelta: -35000, scoreDelta: { ecology: 8 }, effectTag: 'museum_donation' },
    ],
  }),
  // 22 — Tax evasion investigation: "creative accounting with dynamite receipts"
  ev('lawsuit_tax_evasion', 'lawsuit', {
    weight: (s) => 1.3 + 1.0 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 30,
    options: [
      { cashDelta: -100000, scoreDelta: { ecology: 3 }, effectTag: 'back_taxes' },
      { cashDelta: -30000, corruptionDelta: 25, effectTag: 'offshore_accounts' },
      { cashDelta: -60000, effectTag: 'voluntary_disclosure' },
    ],
  }),
  // 23 — Workers sue for "psychological damage from break room coffee"
  ev('lawsuit_bad_coffee', 'lawsuit', {
    weight: (s) => 0.7 + 0.8 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.employeeCount >= 4,
    options: [
      { cashDelta: -20000, scoreDelta: { wellBeing: 10 }, effectTag: 'espresso_machine' },
      { cashDelta: -5000, scoreDelta: { wellBeing: -3 }, effectTag: 'deny_coffee_trauma' },
      { cashDelta: -12000, scoreDelta: { wellBeing: 6 }, effectTag: 'hire_barista' },
    ],
  }),
  // 24 — Product liability: sold contaminated ore, customer's factory turned purple
  ev('lawsuit_contaminated_ore', 'lawsuit', {
    weight: (s) => 1.2 + 1.5 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.activeContractCount > 0 && ctx.scores.ecology < 40,
    options: [
      { cashDelta: -85000, scoreDelta: { ecology: 10 }, effectTag: 'ore_recall' },
      { cashDelta: -20000, corruptionDelta: 18, effectTag: 'blame_shipping' },
      { cashDelta: -50000, scoreDelta: { ecology: 6 }, effectTag: 'quality_control' },
    ],
  }),
  // 25 — Government fines for exceeding blast limits (again)
  ev('lawsuit_blast_limit_fines', 'lawsuit', {
    weight: (s) => 1.5 + 2.0 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.lawsuitCount >= 1 && ctx.scores.safety < 40,
    options: [
      { cashDelta: -75000, scoreDelta: { safety: 12 }, effectTag: 'blast_compliance' },
      { cashDelta: -15000, corruptionDelta: 20, effectTag: 'recalibrate_sensors' },
      { cashDelta: -40000, scoreDelta: { safety: 8 }, effectTag: 'blast_reduction' },
    ],
  }),
];
