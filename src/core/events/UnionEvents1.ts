// BlastSimulator2026 — Union events batch 1 (25 events)
// Satirical labor disputes, absurd demands, and workplace comedy in open-pit mining.
import { ev, r } from './EventBuilder.js';
import type { EventDef } from './EventPool.js';

export const UNION_EVENTS_1: EventDef[] = [
  // 1 — Workers demand artisanal espresso machine
  ev('union_coffee_uprising', 'union', {
    weight: (s) => 1 + 1.5 * (1 - r.wb(s)),
    options: [
      { cashDelta: -8000, scoreDelta: { wellBeing: 12 } },
      { cashDelta: 0, scoreDelta: { wellBeing: -8 }, effectTag: 'morale_drop' },
      { cashDelta: -2000, scoreDelta: { wellBeing: 3 }, effectTag: 'instant_coffee_compromise' },
    ],
  }),
  // 2 — Demand end to 14-hour shifts
  ev('union_overtime_revolt', 'union', {
    weight: (s) => 1.2 + 2 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.employeeCount > 3,
    options: [
      { cashDelta: -15000, scoreDelta: { wellBeing: 15, safety: 5 } },
      { cashDelta: 0, scoreDelta: { wellBeing: -12, safety: -8 } },
      { cashDelta: -5000, scoreDelta: { wellBeing: 5 }, effectTag: 'shorter_shifts' },
    ],
  }),
  // 3 — Workers refuse unflattering helmets
  ev('union_safety_helmets', 'union', {
    weight: (s) => 0.8 + 1.2 * (1 - r.sf(s)),
    options: [
      { cashDelta: -6000, scoreDelta: { safety: 8, wellBeing: 6 }, effectTag: 'designer_helmets' },
      { cashDelta: 0, scoreDelta: { wellBeing: -5 } },
      { cashDelta: -12000, scoreDelta: { safety: 12, wellBeing: 10 }, effectTag: 'fashion_helmets' },
    ],
  }),
  // 4 — General strike vote
  ev('union_strike_threat', 'union', {
    weight: (s) => 2 + 3 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.scores.wellBeing < 35,
    options: [
      { cashDelta: -25000, scoreDelta: { wellBeing: 20 } },
      { cashDelta: 0, scoreDelta: { wellBeing: -20 }, effectTag: 'full_strike', followUp: 'union_strike_aftermath' },
      { corruptionDelta: 15, scoreDelta: { wellBeing: -5 }, effectTag: 'bribe_union_boss' },
    ],
  }),
  // 5 — Mandatory karaoke night
  ev('union_karaoke_demand', 'union', {
    weight: (s) => 0.7 + 0.8 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.hasBuilding('living_quarters'),
    options: [
      { cashDelta: -3000, scoreDelta: { wellBeing: 8, nuisance: 5 } },
      { cashDelta: 0, scoreDelta: { wellBeing: -4 } },
      { cashDelta: -1000, scoreDelta: { wellBeing: 5 }, effectTag: 'karaoke_wednesdays' },
    ],
  }),
  // 6 — Ergonomic chairs for the pit
  ev('union_ergo_chairs', 'union', {
    weight: (s) => 0.9 + 1.0 * (1 - r.wb(s)),
    options: [
      { cashDelta: -10000, scoreDelta: { wellBeing: 10 }, effectTag: 'pit_recliners' },
      { cashDelta: 0, scoreDelta: { wellBeing: -6 } },
    ],
  }),
  // 7 — Break room TV channel war
  ev('union_tv_channel', 'union', {
    weight: (s) => 0.6 + 0.5 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.hasBuilding('living_quarters'),
    options: [
      { cashDelta: -2000, scoreDelta: { wellBeing: 4 }, effectTag: 'extra_tvs' },
      { cashDelta: 0, scoreDelta: { wellBeing: -3 } },
      { cashDelta: -500, scoreDelta: { wellBeing: 2 }, effectTag: 'tv_schedule_vote' },
    ],
  }),
  // 8 — Unauthorized book club during shifts
  ev('union_book_club', 'union', {
    weight: (s) => 0.5 + 0.6 * r.wb(s),
    options: [
      { cashDelta: -1500, scoreDelta: { wellBeing: 6 }, effectTag: 'sanctioned_book_club' },
      { cashDelta: 0, scoreDelta: { wellBeing: -3 }, effectTag: 'book_club_banned' },
      { cashDelta: -500, scoreDelta: { wellBeing: 4 }, effectTag: 'lunch_book_club' },
    ],
  }),
  // 9 — Casual Friday in a mine
  ev('union_casual_friday', 'union', {
    weight: (s) => 0.7 + 0.4 * (1 - r.sf(s)),
    options: [
      { cashDelta: 0, scoreDelta: { wellBeing: 5, safety: -10 }, effectTag: 'casual_friday' },
      { cashDelta: -4000, scoreDelta: { wellBeing: 7, safety: 2 }, effectTag: 'casual_ppe' },
      { cashDelta: 0, scoreDelta: { wellBeing: -4 } },
    ],
  }),
  // 10 — Talent show in the quarry
  ev('union_talent_show', 'union', {
    weight: (s) => 0.6 + 0.7 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.employeeCount > 5,
    options: [
      { cashDelta: -5000, scoreDelta: { wellBeing: 10, nuisance: 3 } },
      { cashDelta: 0, scoreDelta: { wellBeing: -5 } },
      { cashDelta: -2000, scoreDelta: { wellBeing: 6 }, effectTag: 'small_talent_show' },
    ],
  }),
  // 11 — Lunch menu quality complaints
  ev('union_lunch_quality', 'union', {
    weight: (s) => 0.8 + 1.0 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.hasBuilding('living_quarters'),
    options: [
      { cashDelta: -7000, scoreDelta: { wellBeing: 9 }, effectTag: 'gourmet_chef' },
      { cashDelta: 0, scoreDelta: { wellBeing: -7 } },
      { cashDelta: -3000, scoreDelta: { wellBeing: 4 }, effectTag: 'taco_tuesday' },
    ],
  }),
  // 12 — Company mascot demand
  ev('union_mascot', 'union', {
    weight: (s) => 0.5 + 0.3 * (1 - r.wb(s)),
    options: [
      { cashDelta: -4000, scoreDelta: { wellBeing: 7 }, effectTag: 'mascot_rocky' },
      { cashDelta: 0, scoreDelta: { wellBeing: -2 } },
      { cashDelta: -15000, scoreDelta: { wellBeing: 12, nuisance: 4 }, effectTag: 'mascot_animatronic' },
    ],
  }),
  // 13 — WiFi in the mine shaft
  ev('union_wifi_demand', 'union', {
    weight: (s) => 1.0 + 0.8 * (1 - r.wb(s)),
    options: [
      { cashDelta: -20000, scoreDelta: { wellBeing: 14 }, effectTag: 'shaft_wifi' },
      { cashDelta: 0, scoreDelta: { wellBeing: -8 } },
      { cashDelta: -5000, scoreDelta: { wellBeing: 5 }, effectTag: 'wifi_breakroom_only' },
    ],
  }),
  // 14 — Refuse to work near "cursed" drill hole
  ev('union_cursed_hole', 'union', {
    weight: (s) => 0.4 + 1.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.hasDrillPlan,
    options: [
      { cashDelta: -3000, scoreDelta: { wellBeing: 6 }, effectTag: 'exorcism_hired' },
      { cashDelta: 0, scoreDelta: { wellBeing: -6, safety: -4 } },
      { cashDelta: -8000, scoreDelta: { wellBeing: 10, safety: 5 }, effectTag: 'relocate_drill' },
    ],
  }),
  // 15 — Protest against motivational posters
  ev('union_motivational_posters', 'union', {
    weight: (s) => 0.6 + 0.5 * r.wb(s),
    options: [
      { cashDelta: -1000, scoreDelta: { wellBeing: 5 }, effectTag: 'remove_posters' },
      { cashDelta: 0, scoreDelta: { wellBeing: -3 } },
      { cashDelta: -2000, scoreDelta: { wellBeing: 3, nuisance: 2 }, effectTag: 'worker_posters' },
    ],
  }),
  // 16 — Nap room demand
  ev('union_nap_room', 'union', {
    weight: (s) => 0.9 + 1.2 * (1 - r.wb(s)),
    options: [
      { cashDelta: -12000, scoreDelta: { wellBeing: 14, safety: 6 } },
      { cashDelta: 0, scoreDelta: { wellBeing: -8 } },
      { cashDelta: -4000, scoreDelta: { wellBeing: 6 }, effectTag: 'hammocks' },
    ],
  }),
  // 17 — Hard hat color complaint
  ev('union_hat_color', 'union', {
    weight: (s) => 0.4 + 0.3 * (1 - r.wb(s)),
    options: [
      { cashDelta: -3000, scoreDelta: { wellBeing: 5, safety: 2 }, effectTag: 'custom_colors' },
      { cashDelta: 0, scoreDelta: { wellBeing: -2 } },
    ],
  }),
  // 18 — Bring-your-pet day
  ev('union_pet_day', 'union', {
    weight: (s) => 0.5 + 0.4 * r.wb(s),
    options: [
      { cashDelta: -2000, scoreDelta: { wellBeing: 8, safety: -12 }, effectTag: 'pets_in_pit' },
      { cashDelta: 0, scoreDelta: { wellBeing: -4 } },
      { cashDelta: -1000, scoreDelta: { wellBeing: 5 }, effectTag: 'pet_photos_only' },
    ],
  }),
  // 19 — Union rep demands corner office in the pit
  ev('union_corner_office', 'union', {
    weight: (s) => 0.6 + 0.9 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.employeeCount > 8,
    options: [
      { cashDelta: -9000, scoreDelta: { wellBeing: 6 }, effectTag: 'pit_office' },
      { cashDelta: 0, scoreDelta: { wellBeing: -5 }, corruptionDelta: 5 },
      { corruptionDelta: 10, scoreDelta: { wellBeing: 3 }, effectTag: 'bribe_rep' },
    ],
  }),
  // 20 — Company retreat planning
  ev('union_retreat', 'union', {
    weight: (s) => 0.7 + 0.6 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.employeeCount > 4,
    options: [
      { cashDelta: -20000, scoreDelta: { wellBeing: 18 }, effectTag: 'beach_retreat' },
      { cashDelta: 0, scoreDelta: { wellBeing: -6 } },
      { cashDelta: -5000, scoreDelta: { wellBeing: 8 }, effectTag: 'camping_retreat' },
    ],
  }),
  // 21 — Complaint about ambient explosion noise
  ev('union_noise_complaint', 'union', {
    weight: (s) => 0.8 + 1.5 * r.nu(s),
    options: [
      { cashDelta: -15000, scoreDelta: { nuisance: -10, wellBeing: 8 }, effectTag: 'noise_cancel_headphones' },
      { cashDelta: 0, scoreDelta: { wellBeing: -6 } },
      { cashDelta: -3000, scoreDelta: { nuisance: -3, wellBeing: 4 }, effectTag: 'ear_plugs' },
    ],
  }),
  // 22 — Workers want a company band
  ev('union_company_band', 'union', {
    weight: (s) => 0.5 + 0.4 * (1 - r.wb(s)),
    options: [
      { cashDelta: -6000, scoreDelta: { wellBeing: 9, nuisance: 8 }, effectTag: 'pit_orchestra' },
      { cashDelta: 0, scoreDelta: { wellBeing: -3 } },
      { cashDelta: -2000, scoreDelta: { wellBeing: 5, nuisance: 3 }, effectTag: 'lunch_jam_session' },
    ],
  }),
  // 23 — Better parking spaces for haul trucks
  ev('union_truck_parking', 'union', {
    weight: (s) => 0.7 + 0.5 * (1 - r.wb(s)),
    options: [
      { cashDelta: -18000, scoreDelta: { wellBeing: 7, safety: 5 }, effectTag: 'valet_parking' },
      { cashDelta: 0, scoreDelta: { wellBeing: -4 } },
      { cashDelta: -6000, scoreDelta: { wellBeing: 4 }, effectTag: 'assigned_spots' },
    ],
  }),
  // 24 — Meditation sessions between blasts
  ev('union_meditation', 'union', {
    weight: (s) => 0.6 + 0.8 * (1 - r.wb(s)),
    options: [
      { cashDelta: -4000, scoreDelta: { wellBeing: 10, safety: 3 }, effectTag: 'blast_yoga' },
      { cashDelta: 0, scoreDelta: { wellBeing: -4 } },
      { cashDelta: -1500, scoreDelta: { wellBeing: 5 }, effectTag: 'breathing_exercises' },
    ],
  }),
  // 25 — Ghost unionized, demands back pay (rare, fantastical)
  ev('union_ghost_backpay', 'union', {
    weight: (s) => 0.15 + 0.3 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.deathCount > 0,
    options: [
      { cashDelta: -30000, scoreDelta: { wellBeing: 15, safety: 10 }, effectTag: 'ghost_paid' },
      { cashDelta: 0, scoreDelta: { safety: -15, wellBeing: -10 }, effectTag: 'ghost_angry' },
      { cashDelta: -5000, corruptionDelta: 8, scoreDelta: { wellBeing: 5 }, effectTag: 'ghost_exorcised' },
      { cashDelta: -50000, scoreDelta: { wellBeing: 20, safety: 15 }, effectTag: 'ghost_promoted',
        probability: 0.3, alt: { cashDelta: -10000, scoreDelta: { wellBeing: 8 } } },
    ],
  }),
];
