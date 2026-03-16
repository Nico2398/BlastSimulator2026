// BlastSimulator2026 — Politics/external events batch 1 (25 events)
// Satirical geopolitics, regulations, and capitalism critique in open-pit mining.
import { ev, r } from './EventBuilder.js';
import type { EventDef } from './EventPool.js';

export const POLITICS_EVENTS_1: EventDef[] = [
  // 1 — Republic of Boomistan embargoes explosives
  ev('politics_explosive_embargo', 'politics', {
    weight: (s) => 1.2 + 0.8 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.tickCount > 30,
    options: [
      { cashDelta: -40000, scoreDelta: { ecology: 3 }, effectTag: 'embargo_stockpile' },
      { cashDelta: -5000, corruptionDelta: 20, effectTag: 'embargo_black_market' },
      { cashDelta: -15000, scoreDelta: { ecology: 8 }, effectTag: 'embargo_alt_explosives' },
    ],
  }),
  // 2 — "Rocks Have Feelings Too" eco-blockade
  ev('politics_eco_blockade', 'politics', {
    weight: (s) => 1.5 + 2 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.scores.ecology < 40,
    options: [
      { cashDelta: -20000, scoreDelta: { ecology: 15, nuisance: -5 } },
      { cashDelta: 0, scoreDelta: { ecology: -10, nuisance: 12 }, effectTag: 'bulldoze_protesters' },
      { cashDelta: -8000, scoreDelta: { ecology: 8 }, effectTag: 'pr_campaign' },
    ],
  }),
  // 3 — Surprise tax audit
  ev('politics_tax_audit', 'politics', {
    weight: (s) => 1.0 + 1.5 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.tickCount > 50,
    options: [
      { cashDelta: -50000, scoreDelta: { ecology: 2 } },
      { cashDelta: -10000, corruptionDelta: 25, effectTag: 'creative_bookkeeping' },
      { cashDelta: -30000, corruptionDelta: 5, effectTag: 'partial_disclosure' },
    ],
  }),
  // 4 — MegaBlast Corp opens nearby mine
  ev('politics_competitor_mine', 'politics', {
    weight: (s) => 1.0 + 0.5 * r.ec(s),
    canFire: (ctx) => ctx.tickCount > 100,
    options: [
      { cashDelta: -25000, effectTag: 'price_war' },
      { cashDelta: -5000, corruptionDelta: 15, effectTag: 'sabotage_competitor' },
      { cashDelta: -15000, scoreDelta: { wellBeing: 5 }, effectTag: 'poach_their_workers' },
    ],
  }),
  // 5 — Minister of Mines visiting
  ev('politics_minister_visit', 'politics', {
    weight: (s) => 1.0 + 0.8 * r.sf(s),
    options: [
      { cashDelta: -30000, scoreDelta: { safety: 10, ecology: 5 }, effectTag: 'red_carpet' },
      { cashDelta: 0, scoreDelta: { safety: -8 }, effectTag: 'honest_tour' },
      { cashDelta: -5000, corruptionDelta: 15, scoreDelta: { safety: 5 }, effectTag: 'potemkin_mine' },
    ],
  }),
  // 6 — International ore price crash
  ev('politics_ore_crash', 'politics', {
    weight: (s) => 1.1 + 0.6 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.activeContractCount > 0,
    options: [
      { cashDelta: -35000, effectTag: 'honor_contracts_loss' },
      { cashDelta: -10000, corruptionDelta: 10, effectTag: 'renegotiate_shady' },
      { cashDelta: -20000, scoreDelta: { wellBeing: -8 }, effectTag: 'layoffs' },
    ],
  }),
  // 7 — New regulation bans favorite explosive
  ev('politics_explosive_ban', 'politics', {
    weight: (s) => 1.3 + 1.0 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.scores.ecology < 50,
    options: [
      { cashDelta: -25000, scoreDelta: { ecology: 12 }, effectTag: 'comply_new_explosive' },
      { cashDelta: -5000, corruptionDelta: 20, effectTag: 'ignore_regulation' },
      { cashDelta: -15000, scoreDelta: { ecology: 6 }, effectTag: 'lobby_exemption' },
    ],
  }),
  // 8 — Neighboring country declares mining a human right
  ev('politics_mining_human_right', 'politics', {
    weight: (s) => 0.8 + 0.4 * r.wb(s),
    options: [
      { cashDelta: 15000, scoreDelta: { wellBeing: -5 }, effectTag: 'cheap_labor_influx' },
      { cashDelta: 0, scoreDelta: { wellBeing: 5 }, effectTag: 'ignore_border' },
      { cashDelta: -10000, scoreDelta: { wellBeing: 8 }, effectTag: 'hire_immigrants_fairly' },
    ],
  }),
  // 9 — Reality TV show wants to film at mine
  ev('politics_reality_tv', 'politics', {
    weight: (s) => 0.9 + 0.5 * r.sf(s),
    canFire: (ctx) => ctx.employeeCount > 5,
    options: [
      { cashDelta: 20000, scoreDelta: { nuisance: 15, safety: -8 }, effectTag: 'cameras_rolling' },
      { cashDelta: 0, scoreDelta: { nuisance: -3 } },
      { cashDelta: 10000, scoreDelta: { nuisance: 8, safety: -3 }, effectTag: 'controlled_filming' },
    ],
  }),
  // 10 — Government subsidy available (with strings)
  ev('politics_gov_subsidy', 'politics', {
    weight: (s) => 1.0 + 0.7 * (1 - r.ec(s)),
    options: [
      { cashDelta: 50000, scoreDelta: { ecology: -15 }, effectTag: 'subsidy_no_eco_rules' },
      { cashDelta: 20000, scoreDelta: { ecology: 5 }, effectTag: 'subsidy_green_strings' },
      { cashDelta: 0, scoreDelta: { ecology: 3 } },
    ],
  }),
  // 11 — Trade war with Explosistan
  ev('politics_trade_war', 'politics', {
    weight: (s) => 1.0 + 0.8 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.tickCount > 40,
    options: [
      { cashDelta: -30000, effectTag: 'tariff_stockpile' },
      { cashDelta: -8000, corruptionDelta: 12, effectTag: 'smuggle_route' },
      { cashDelta: -18000, scoreDelta: { ecology: 5 }, effectTag: 'domestic_supplier' },
    ],
  }),
  // 12 — Mining lobbyist offers "partnership"
  ev('politics_lobbyist', 'politics', {
    weight: (s) => 0.9 + 1.2 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.corruptionLevel < 60,
    options: [
      { cashDelta: 30000, corruptionDelta: 30, effectTag: 'lobbyist_deal' },
      { cashDelta: 0, scoreDelta: { ecology: 5 } },
      { cashDelta: 10000, corruptionDelta: 10, effectTag: 'lobbyist_small_favor' },
    ],
  }),
  // 13 — Election: pro-mining vs anti-mining candidate
  ev('politics_election', 'politics', {
    weight: (s) => 1.1 + 0.5 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.tickCount > 60,
    options: [
      { cashDelta: -20000, corruptionDelta: 20, effectTag: 'fund_pro_mining' },
      { cashDelta: -10000, scoreDelta: { ecology: 10 }, effectTag: 'fund_anti_mining' },
      { cashDelta: 0, scoreDelta: { ecology: -5 }, probability: 0.5,
        alt: { scoreDelta: { ecology: 8 } } },
    ],
  }),
  // 14 — Foreign delegation tour (impress for contracts)
  ev('politics_delegation', 'politics', {
    weight: (s) => 1.0 + 0.6 * r.sf(s),
    canFire: (ctx) => ctx.employeeCount > 3,
    options: [
      { cashDelta: -25000, scoreDelta: { safety: 8 }, effectTag: 'impress_delegation',
        probability: 0.7, alt: { cashDelta: -25000, scoreDelta: { safety: 3 } } },
      { cashDelta: -5000, scoreDelta: { safety: -5 }, effectTag: 'rush_tour' },
      { cashDelta: -15000, corruptionDelta: 10, effectTag: 'bribe_delegation' },
    ],
  }),
  // 15 — Local mayor running on "shut down the mine"
  ev('politics_mayor_antimine', 'politics', {
    weight: (s) => 1.4 + 1.5 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.scores.ecology < 45,
    options: [
      { cashDelta: -30000, corruptionDelta: 25, effectTag: 'fund_opponent' },
      { cashDelta: -20000, scoreDelta: { ecology: 12, nuisance: -8 }, effectTag: 'go_green_pr' },
      { cashDelta: 0, scoreDelta: { ecology: -10 }, followUp: 'politics_mayor_wins' },
    ],
  }),
  // 16 — Celebrity endorsement opportunity
  ev('politics_celebrity', 'politics', {
    weight: (s) => 0.7 + 0.4 * r.wb(s),
    options: [
      { cashDelta: -35000, scoreDelta: { wellBeing: 10, nuisance: 8 }, effectTag: 'celeb_endorsed' },
      { cashDelta: 0 },
      { cashDelta: -15000, scoreDelta: { wellBeing: 5 }, effectTag: 'celeb_social_media' },
    ],
  }),
  // 17 — Mining industry awards ceremony
  ev('politics_awards', 'politics', {
    weight: (s) => 0.8 + 0.5 * r.sf(s) + 0.3 * r.ec(s),
    canFire: (ctx) => ctx.tickCount > 80,
    options: [
      { cashDelta: -10000, scoreDelta: { wellBeing: 8, safety: 5 }, effectTag: 'attend_awards',
        probability: 0.4, alt: { cashDelta: -10000, scoreDelta: { wellBeing: 3 } } },
      { cashDelta: 0, scoreDelta: { wellBeing: -3 } },
      { cashDelta: -5000, corruptionDelta: 15, effectTag: 'rig_awards' },
    ],
  }),
  // 18 — Competitor caught in scandal
  ev('politics_competitor_scandal', 'politics', {
    weight: (s) => 0.9 + 0.4 * r.ec(s),
    canFire: (ctx) => ctx.tickCount > 70,
    options: [
      { cashDelta: 25000, scoreDelta: { ecology: -8 }, effectTag: 'poach_contracts' },
      { cashDelta: 0, scoreDelta: { ecology: 5 }, effectTag: 'stay_clean' },
      { cashDelta: 10000, corruptionDelta: 10, effectTag: 'leak_more_dirt' },
    ],
  }),
  // 19 — International mining safety summit
  ev('politics_safety_summit', 'politics', {
    weight: (s) => 1.0 + 1.0 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.tickCount > 50,
    options: [
      { cashDelta: -15000, scoreDelta: { safety: 12 }, effectTag: 'attend_summit' },
      { cashDelta: 0, scoreDelta: { safety: -5 } },
      { cashDelta: -8000, scoreDelta: { safety: 6 }, effectTag: 'send_delegate' },
    ],
  }),
  // 20 — New tariff on imported explosives
  ev('politics_explosive_tariff', 'politics', {
    weight: (s) => 1.0 + 0.6 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.tickCount > 35,
    options: [
      { cashDelta: -20000, effectTag: 'pay_tariff' },
      { cashDelta: -8000, corruptionDelta: 15, effectTag: 'tariff_loophole' },
      { cashDelta: -30000, scoreDelta: { ecology: 8 }, effectTag: 'local_supplier_switch' },
    ],
  }),
  // 21 — Mining documentary crew arrives
  ev('politics_documentary', 'politics', {
    weight: (s) => 0.9 + 0.8 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.employeeCount > 4,
    options: [
      { cashDelta: -5000, scoreDelta: { ecology: -10, nuisance: 10 }, effectTag: 'unfiltered_access' },
      { cashDelta: -20000, scoreDelta: { ecology: 8 }, effectTag: 'curated_footage' },
      { cashDelta: 0, scoreDelta: { ecology: -5 }, effectTag: 'ban_cameras' },
    ],
  }),
  // 22 — Government announces mining tax reform
  ev('politics_tax_reform', 'politics', {
    weight: (s) => 1.1 + 0.5 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.tickCount > 90,
    options: [
      { cashDelta: -40000, scoreDelta: { ecology: 10 }, effectTag: 'comply_reform' },
      { cashDelta: -15000, corruptionDelta: 20, effectTag: 'offshore_shell' },
      { cashDelta: -25000, effectTag: 'lobby_against_reform' },
    ],
  }),
  // 23 — Activist investor buys stake
  ev('politics_activist_investor', 'politics', {
    weight: (s) => 1.0 + 1.0 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.tickCount > 60,
    options: [
      { cashDelta: 20000, scoreDelta: { ecology: 15, wellBeing: 5 }, effectTag: 'green_reforms' },
      { cashDelta: 0, corruptionDelta: 10, effectTag: 'poison_pill' },
      { cashDelta: -10000, scoreDelta: { ecology: 8 }, effectTag: 'negotiate_compromise' },
    ],
  }),
  // 24 — Mining rights dispute — ancestral land claim
  ev('politics_land_claim', 'politics', {
    weight: (s) => 1.2 + 1.2 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.tickCount > 45,
    options: [
      { cashDelta: -35000, scoreDelta: { ecology: 18, wellBeing: 10 }, effectTag: 'fair_settlement' },
      { cashDelta: -5000, corruptionDelta: 20, scoreDelta: { ecology: -15 }, effectTag: 'legal_loophole' },
      { cashDelta: -20000, scoreDelta: { ecology: 10, wellBeing: 5 }, effectTag: 'shared_stewardship' },
    ],
  }),
  // 25 — Meteor heading toward the mine (rare, fantastical)
  ev('politics_meteor', 'politics', {
    weight: (s) => 0.15 + 0.1 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.tickCount > 120,
    options: [
      { cashDelta: -50000, scoreDelta: { safety: 15 }, effectTag: 'evacuate_mine' },
      { cashDelta: 0, scoreDelta: { safety: -20 }, probability: 0.3,
        alt: { cashDelta: 100000, scoreDelta: { safety: -5 }, effectTag: 'meteor_rare_ore' } },
      { cashDelta: -20000, effectTag: 'blast_meteor', probability: 0.5,
        alt: { cashDelta: -20000, scoreDelta: { safety: -15 }, effectTag: 'meteor_impact' } },
    ],
  }),
];
