// BlastSimulator2026 — Mafia events batch 2 (events 26-50)
// Dark satirical organized crime: escalating absurdity meets open-pit mining.
import { ev, r } from './EventBuilder.js';
import type { EventDef } from './EventPool.js';

export const MAFIA_EVENTS_2: EventDef[] = [
  // 26 — Rigged contract bidding
  ev('mafia_rig_contracts', 'mafia', {
    weight: (s) => 1.2 + 1.0 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 2 && ctx.activeContractCount >= 1,
    options: [
      { cashDelta: 12000, scoreDelta: { safety: -5 }, corruptionDelta: 8, effectTag: 'rigged_bids' },
      { cashDelta: 0, scoreDelta: { wellBeing: 3 } },
      { cashDelta: 4000, corruptionDelta: 3, effectTag: 'soft_rig' },
    ],
  }),
  // 27 — Witness protection hiding spot
  ev('mafia_witness_protection', 'mafia', {
    weight: (s) => 0.9 + 0.7 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 2,
    options: [
      { cashDelta: 8000, scoreDelta: { safety: -8 }, corruptionDelta: 6, effectTag: 'witness_hidden' },
      { cashDelta: 0, scoreDelta: { safety: 3 }, corruptionDelta: -2 },
      { cashDelta: 3000, scoreDelta: { safety: -3 }, corruptionDelta: 3, effectTag: 'witness_shed' },
    ],
  }),
  // 28 — Mob enforcer wants workers' comp
  ev('mafia_enforcer_comp', 'mafia', {
    weight: (s) => 1.0 + 0.8 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 1,
    options: [
      { cashDelta: -6000, scoreDelta: { wellBeing: -4 }, corruptionDelta: 4, effectTag: 'enforcer_healed' },
      { cashDelta: 0, scoreDelta: { safety: -10 }, corruptionDelta: -2, effectTag: 'enforcer_angry' },
      { cashDelta: -3000, scoreDelta: { wellBeing: -2 }, corruptionDelta: 2, effectTag: 'fake_cast' },
    ],
  }),
  // 29 — Mafia vault discovered during blasting
  ev('mafia_vault_found', 'mafia', {
    weight: (s) => 0.6 + 0.5 * r.ec(s),
    canFire: (ctx) => ctx.corruptionLevel >= 1 && ctx.hasDrillPlan,
    options: [
      { cashDelta: 25000, corruptionDelta: 10, effectTag: 'vault_looted', probability: 0.7,
        alt: { cashDelta: -5000, scoreDelta: { safety: -12 }, effectTag: 'vault_booby_trapped' } },
      { cashDelta: 0, scoreDelta: { safety: 5 }, corruptionDelta: -3, effectTag: 'vault_reported' },
      { cashDelta: 8000, corruptionDelta: 5, effectTag: 'vault_split' },
    ],
  }),
  // 30 — FBI undercover agent suspected
  ev('mafia_fbi_mole', 'mafia', {
    weight: (s) => 1.3 + 0.9 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 3 && ctx.employeeCount >= 5,
    options: [
      { cashDelta: -4000, scoreDelta: { wellBeing: -8 }, corruptionDelta: 5, effectTag: 'mole_fired' },
      { cashDelta: 0, scoreDelta: { wellBeing: -3 }, corruptionDelta: -5, effectTag: 'cooperate_fbi' },
      { cashDelta: -2000, scoreDelta: { safety: -4 }, corruptionDelta: 3, effectTag: 'paranoia_sweep' },
    ],
  }),
  // 31 — Mob boss wants to blast rival's property
  ev('mafia_blast_rival', 'mafia', {
    weight: (s) => 1.0 + 1.2 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 4 && ctx.hasDrillPlan,
    options: [
      { cashDelta: 20000, scoreDelta: { safety: -15, ecology: -10 }, corruptionDelta: 12, effectTag: 'rival_blasted' },
      { cashDelta: 0, scoreDelta: { safety: -5 }, corruptionDelta: -3, effectTag: 'refused_boss' },
      { cashDelta: 8000, scoreDelta: { ecology: -5 }, corruptionDelta: 6, effectTag: 'small_boom_rival' },
    ],
  }),
  // 32 — Insurance scam opportunity
  ev('mafia_insurance_scam', 'mafia', {
    weight: (s) => 1.1 + 0.8 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 2,
    options: [
      { cashDelta: 15000, scoreDelta: { safety: -8 }, corruptionDelta: 7, effectTag: 'staged_accident' },
      { cashDelta: 0, scoreDelta: { wellBeing: 4 } },
      { cashDelta: 5000, corruptionDelta: 4, effectTag: 'minor_fraud', probability: 0.6,
        alt: { cashDelta: -8000, corruptionDelta: 2, effectTag: 'fraud_caught' } },
    ],
  }),
  // 33 — Drug lab in abandoned section
  ev('mafia_drug_lab', 'mafia', {
    weight: (s) => 0.8 + 1.0 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 3,
    options: [
      { cashDelta: -2000, scoreDelta: { safety: 8, ecology: 5 }, corruptionDelta: -4, effectTag: 'lab_demolished' },
      { cashDelta: 10000, scoreDelta: { safety: -12, ecology: -8 }, corruptionDelta: 8, effectTag: 'lab_tolerated' },
      { cashDelta: 0, scoreDelta: { safety: -3 }, corruptionDelta: 2, effectTag: 'lab_relocated' },
    ],
  }),
  // 34 — Armored vehicles at a "discount"
  ev('mafia_armored_vehicles', 'mafia', {
    weight: (s) => 0.9 + 0.6 * r.sf(s),
    canFire: (ctx) => ctx.corruptionLevel >= 2,
    options: [
      { cashDelta: -8000, scoreDelta: { safety: 10 }, corruptionDelta: 5, effectTag: 'stolen_apcs' },
      { cashDelta: 0, scoreDelta: { safety: -2 } },
      { cashDelta: -3000, scoreDelta: { safety: 4 }, corruptionDelta: 3, effectTag: 'one_armored_van' },
    ],
  }),
  // 35 — Corrupt judge offers permanent immunity
  ev('mafia_corrupt_judge', 'mafia', {
    weight: (s) => 0.7 + 1.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 4 && ctx.lawsuitCount >= 1,
    options: [
      { cashDelta: -50000, corruptionDelta: 15, effectTag: 'judicial_immunity' },
      { cashDelta: 0, scoreDelta: { wellBeing: 5 }, corruptionDelta: -2 },
      { cashDelta: -20000, corruptionDelta: 8, effectTag: 'partial_immunity' },
    ],
  }),
  // 36 — Mafia attack dogs for security
  ev('mafia_attack_dogs', 'mafia', {
    weight: (s) => 0.8 + 0.7 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 2,
    options: [
      { cashDelta: -4000, scoreDelta: { safety: 6, wellBeing: -8 }, corruptionDelta: 4, effectTag: 'guard_dogs' },
      { cashDelta: 0, scoreDelta: { wellBeing: 3 } },
      { cashDelta: -1500, scoreDelta: { wellBeing: -3 }, corruptionDelta: 2, effectTag: 'one_chihuahua' },
    ],
  }),
  // 37 — Offshore account opportunity
  ev('mafia_offshore', 'mafia', {
    weight: (s) => 1.0 + 1.3 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 3,
    options: [
      { cashDelta: 18000, corruptionDelta: 10, effectTag: 'offshore_opened' },
      { cashDelta: 0, corruptionDelta: -3, scoreDelta: { wellBeing: 2 } },
      { cashDelta: 6000, corruptionDelta: 5, effectTag: 'shell_company', probability: 0.7,
        alt: { cashDelta: -10000, corruptionDelta: 3, effectTag: 'shell_audited' } },
    ],
  }),
  // 38 — Rival mob recruits your workers
  ev('mafia_rival_recruit', 'mafia', {
    weight: (s) => 1.2 + 0.8 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 2 && ctx.employeeCount >= 3,
    options: [
      { cashDelta: -6000, scoreDelta: { wellBeing: 6 }, effectTag: 'loyalty_raises' },
      { cashDelta: 0, scoreDelta: { wellBeing: -10 }, effectTag: 'workers_poached' },
      { cashDelta: -2000, corruptionDelta: 4, effectTag: 'double_agents' },
    ],
  }),
  // 39 — Mine as movie set
  ev('mafia_movie_set', 'mafia', {
    weight: (s) => 0.7 + 0.5 * r.nu(s),
    canFire: (ctx) => ctx.corruptionLevel >= 1,
    options: [
      { cashDelta: 10000, scoreDelta: { nuisance: 12, safety: -6 }, corruptionDelta: 3, effectTag: 'mob_movie' },
      { cashDelta: 0, scoreDelta: { nuisance: -3 } },
      { cashDelta: 4000, scoreDelta: { nuisance: 5 }, corruptionDelta: 1, effectTag: 'cameo_only' },
    ],
  }),
  // 40 — Fake alibis using timesheets
  ev('mafia_fake_alibis', 'mafia', {
    weight: (s) => 1.0 + 0.9 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 3,
    options: [
      { cashDelta: 7000, corruptionDelta: 8, effectTag: 'alibis_forged' },
      { cashDelta: 0, scoreDelta: { safety: -6 }, corruptionDelta: -2, effectTag: 'alibis_refused' },
      { cashDelta: 3000, corruptionDelta: 4, effectTag: 'plausible_deniability' },
    ],
  }),
  // 41 — Illegal explosive prototype
  ev('mafia_illegal_explosive', 'mafia', {
    weight: (s) => 0.6 + 1.4 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 4 && ctx.hasDrillPlan,
    options: [
      { cashDelta: -5000, scoreDelta: { safety: -20, ecology: -15 }, corruptionDelta: 10, effectTag: 'mega_explosive',
        probability: 0.5, alt: { cashDelta: -15000, scoreDelta: { safety: -30 }, effectTag: 'prototype_detonated' } },
      { cashDelta: 0, scoreDelta: { safety: 5 } },
      { cashDelta: -2000, scoreDelta: { safety: -8 }, corruptionDelta: 5, effectTag: 'small_sample' },
    ],
  }),
  // 42 — Mob boss birthday party at mine
  ev('mafia_boss_birthday', 'mafia', {
    weight: (s) => 0.8 + 0.5 * r.wb(s),
    canFire: (ctx) => ctx.corruptionLevel >= 2,
    options: [
      { cashDelta: -8000, scoreDelta: { nuisance: 10, wellBeing: -5 }, corruptionDelta: 5, effectTag: 'boss_party' },
      { cashDelta: 0, scoreDelta: { safety: -8 }, corruptionDelta: -2, effectTag: 'party_declined' },
      { cashDelta: -3000, scoreDelta: { nuisance: 4 }, corruptionDelta: 3, effectTag: 'modest_party' },
    ],
  }),
  // 43 — Courier service through tunnels
  ev('mafia_tunnel_courier', 'mafia', {
    weight: (s) => 1.1 + 0.7 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 3,
    options: [
      { cashDelta: 9000, scoreDelta: { safety: -10 }, corruptionDelta: 7, effectTag: 'tunnel_courier' },
      { cashDelta: 0, scoreDelta: { safety: 4 }, corruptionDelta: -2 },
      { cashDelta: 3000, scoreDelta: { safety: -4 }, corruptionDelta: 3, effectTag: 'one_shipment' },
    ],
  }),
  // 44 — International criminal wants ore for weapons
  ev('mafia_weapons_ore', 'mafia', {
    weight: (s) => 0.5 + 1.5 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 5,
    options: [
      { cashDelta: 30000, scoreDelta: { ecology: -15, safety: -10 }, corruptionDelta: 15, effectTag: 'weapons_deal' },
      { cashDelta: 0, scoreDelta: { safety: -8 }, corruptionDelta: -5, effectTag: 'arms_refused' },
      { cashDelta: 10000, scoreDelta: { ecology: -5 }, corruptionDelta: 8, effectTag: 'small_shipment' },
    ],
  }),
  // 45 — Mob politician offers zoning favors
  ev('mafia_zoning_favors', 'mafia', {
    weight: (s) => 1.0 + 1.0 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 3,
    options: [
      { cashDelta: -10000, scoreDelta: { ecology: -8 }, corruptionDelta: 8, effectTag: 'zoning_bribed' },
      { cashDelta: 0, scoreDelta: { ecology: 4 } },
      { cashDelta: -4000, corruptionDelta: 4, effectTag: 'minor_rezoning' },
    ],
  }),
  // 46 — Mafia therapist available
  ev('mafia_therapist', 'mafia', {
    weight: (s) => 0.7 + 0.6 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 1,
    options: [
      { cashDelta: -3000, scoreDelta: { wellBeing: 8 }, corruptionDelta: 3, effectTag: 'mob_therapist' },
      { cashDelta: 0, scoreDelta: { wellBeing: -2 } },
      { cashDelta: -1000, scoreDelta: { wellBeing: 4 }, corruptionDelta: 1, effectTag: 'group_session' },
    ],
  }),
  // 47 — Crime family reunion at canteen
  ev('mafia_family_reunion', 'mafia', {
    weight: (s) => 0.8 + 0.5 * r.nu(s),
    canFire: (ctx) => ctx.corruptionLevel >= 2,
    options: [
      { cashDelta: -5000, scoreDelta: { nuisance: 12, wellBeing: -6 }, corruptionDelta: 5, effectTag: 'family_reunion' },
      { cashDelta: 0, scoreDelta: { safety: -6 }, corruptionDelta: -2 },
      { cashDelta: -2000, scoreDelta: { nuisance: 5 }, corruptionDelta: 2, effectTag: 'reunion_buffet' },
    ],
  }),
  // 48 — Naming rights to rock formation
  ev('mafia_naming_rights', 'mafia', {
    weight: (s) => 0.6 + 0.4 * r.ec(s),
    canFire: (ctx) => ctx.corruptionLevel >= 1,
    options: [
      { cashDelta: 5000, scoreDelta: { nuisance: 6 }, corruptionDelta: 3, effectTag: 'don_cliff' },
      { cashDelta: 0, scoreDelta: { ecology: 3 } },
      { cashDelta: 2000, corruptionDelta: 1, effectTag: 'subtle_plaque' },
    ],
  }),
  // 49 — Underground casino in storage depot
  ev('mafia_casino', 'mafia', {
    weight: (s) => 1.0 + 1.1 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.corruptionLevel >= 3 && ctx.hasBuilding('storage'),
    options: [
      { cashDelta: 12000, scoreDelta: { safety: -10, wellBeing: -6 }, corruptionDelta: 9, effectTag: 'underground_casino' },
      { cashDelta: 0, scoreDelta: { safety: 4 }, corruptionDelta: -3 },
      { cashDelta: 4000, scoreDelta: { wellBeing: -3 }, corruptionDelta: 4, effectTag: 'poker_night' },
    ],
  }),
  // 50 — Mob boss genuinely interested in geology
  ev('mafia_geology_nerd', 'mafia', {
    weight: (s) => 0.5 + 0.8 * r.ec(s),
    canFire: (ctx) => ctx.corruptionLevel >= 1,
    options: [
      { cashDelta: -2000, scoreDelta: { ecology: 10, wellBeing: 6 }, corruptionDelta: -3, effectTag: 'boss_geologist' },
      { cashDelta: 0, scoreDelta: { wellBeing: -4 }, corruptionDelta: 2, effectTag: 'mocked_boss' },
      { cashDelta: -500, scoreDelta: { ecology: 5, wellBeing: 3 }, corruptionDelta: -1, effectTag: 'rock_collection',
        probability: 0.8, alt: { cashDelta: 8000, scoreDelta: { ecology: -5 }, effectTag: 'found_gems' } },
    ],
  }),
];
