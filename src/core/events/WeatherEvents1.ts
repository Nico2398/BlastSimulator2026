// BlastSimulator2026 — Weather events batch 1 (25 events)
// Mother Nature vs. open-pit mining: floods, lightning, heat mirages, and mysterious auroras.
import { ev, r } from './EventBuilder.js';
import type { EventDef } from './EventPool.js';

export const WEATHER_EVENTS_1: EventDef[] = [
  // 1 — Heavy rain floods pit, ducks move in
  ev('weather_pit_flood', 'weather', {
    weight: (s) => 1.0 + 0.8 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.weatherId === 'heavy_rain' || ctx.weatherId === 'storm',
    options: [
      { cashDelta: -20000, scoreDelta: { ecology: 8, safety: 5 }, effectTag: 'pump_pit' },
      { cashDelta: 0, scoreDelta: { ecology: 15, wellBeing: 5 }, effectTag: 'duck_sanctuary' },
      { cashDelta: -5000, scoreDelta: { safety: -5 }, effectTag: 'workers_swim' },
    ],
  }),
  // 2 — Lightning strikes near explosives magazine
  ev('weather_lightning_strike', 'weather', {
    weight: (s) => 1.5 + 1.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'storm' && ctx.hasBuilding('explosives_magazine'),
    options: [
      { cashDelta: -30000, scoreDelta: { safety: 15 }, effectTag: 'lightning_rods' },
      { cashDelta: 0, scoreDelta: { safety: -20 }, probability: 0.4,
        alt: { cashDelta: -80000, scoreDelta: { safety: -40 }, effectTag: 'magazine_explosion' } },
      { cashDelta: -10000, scoreDelta: { safety: 8 }, effectTag: 'emergency_relocation' },
    ],
  }),
  // 3 — 47°C heatstroke, workers fainting
  ev('weather_heatstroke', 'weather', {
    weight: (s) => 1.2 + 1.0 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.weatherId === 'heat_wave',
    options: [
      { cashDelta: -12000, scoreDelta: { wellBeing: 12, safety: 8 }, effectTag: 'cooling_stations' },
      { cashDelta: 0, scoreDelta: { wellBeing: -15, safety: -10 }, effectTag: 'heatstroke_wave' },
      { cashDelta: -5000, scoreDelta: { wellBeing: 6 }, effectTag: 'shortened_shifts' },
    ],
  }),
  // 4 — Mudslide blocks access road
  ev('weather_mudslide', 'weather', {
    weight: (s) => 1.0 + 0.6 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'heavy_rain',
    options: [
      { cashDelta: -18000, scoreDelta: { safety: 10 }, effectTag: 'bulldoze_road' },
      { cashDelta: -3000, scoreDelta: { safety: -5, wellBeing: -8 }, effectTag: 'wait_it_out' },
      { cashDelta: -8000, scoreDelta: { ecology: -5, safety: 6 }, effectTag: 'dynamite_mudslide' },
    ],
  }),
  // 5 — Frost fractures rock bench
  ev('weather_frost_crack', 'weather', {
    weight: (s) => 1.1 + 0.7 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'cold_snap' && ctx.hasDrillPlan,
    options: [
      { cashDelta: -15000, scoreDelta: { safety: 12 }, effectTag: 'bench_reinforcement' },
      { cashDelta: 5000, scoreDelta: { safety: -15 }, effectTag: 'free_fragmentation' },
      { cashDelta: -7000, scoreDelta: { safety: 6 }, effectTag: 'revised_drill_plan' },
    ],
  }),
  // 6 — Dust storm reduces visibility to zero
  ev('weather_dust_storm', 'weather', {
    weight: (s) => 1.0 + 0.5 * r.nu(s),
    canFire: (ctx) => ctx.weatherId === 'heat_wave' || ctx.weatherId === 'sunny',
    options: [
      { cashDelta: -8000, scoreDelta: { safety: 10, nuisance: -5 }, effectTag: 'halt_operations' },
      { cashDelta: 0, scoreDelta: { safety: -12 }, effectTag: 'blind_driving' },
      { cashDelta: -3000, scoreDelta: { safety: 4, nuisance: 3 }, effectTag: 'dust_masks' },
    ],
  }),
  // 7 — Rainbow appears, workers stop to admire
  ev('weather_rainbow_pause', 'weather', {
    weight: (s) => 0.6 + 0.4 * r.wb(s),
    canFire: (ctx) => ctx.weatherId === 'light_rain' || ctx.weatherId === 'cloudy',
    options: [
      { cashDelta: -2000, scoreDelta: { wellBeing: 10 }, effectTag: 'rainbow_break' },
      { cashDelta: 0, scoreDelta: { wellBeing: -6 }, effectTag: 'back_to_work' },
      { cashDelta: -500, scoreDelta: { wellBeing: 7, nuisance: 2 }, effectTag: 'rainbow_selfies' },
    ],
  }),
  // 8 — Fog so thick equipment gets lost
  ev('weather_fog_lost_equipment', 'weather', {
    weight: (s) => 0.9 + 0.6 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'cloudy' || ctx.weatherId === 'light_rain',
    options: [
      { cashDelta: -10000, scoreDelta: { safety: 8 }, effectTag: 'fog_shutdown' },
      { cashDelta: -25000, scoreDelta: { safety: -8 }, effectTag: 'lost_excavator' },
      { cashDelta: -4000, scoreDelta: { safety: 4 }, effectTag: 'fog_horns' },
    ],
  }),
  // 9 — Unexpected snow in desert mine
  ev('weather_desert_snow', 'weather', {
    weight: () => 0.3,
    canFire: (ctx) => ctx.weatherId === 'cold_snap',
    options: [
      { cashDelta: -6000, scoreDelta: { wellBeing: 12 }, effectTag: 'snow_day' },
      { cashDelta: 0, scoreDelta: { safety: -6, wellBeing: -4 }, effectTag: 'slippery_benches' },
      { cashDelta: -2000, scoreDelta: { wellBeing: 8 }, effectTag: 'pit_snowman' },
    ],
  }),
  // 10 — Tornado warning: evacuate or risk it?
  ev('weather_tornado_warning', 'weather', {
    weight: (s) => 1.4 + 1.0 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'storm',
    options: [
      { cashDelta: -15000, scoreDelta: { safety: 18, wellBeing: 5 }, effectTag: 'full_evacuation' },
      { cashDelta: 0, scoreDelta: { safety: -25 }, probability: 0.5,
        alt: { cashDelta: -60000, scoreDelta: { safety: -40 }, effectTag: 'tornado_hit' } },
      { cashDelta: -5000, scoreDelta: { safety: 8 }, effectTag: 'partial_evacuation' },
    ],
  }),
  // 11 — Drought: water supply running low
  ev('weather_drought', 'weather', {
    weight: (s) => 1.0 + 0.8 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.weatherId === 'heat_wave' || ctx.weatherId === 'sunny',
    options: [
      { cashDelta: -20000, scoreDelta: { wellBeing: 10, ecology: 5 }, effectTag: 'water_trucks' },
      { cashDelta: 0, scoreDelta: { wellBeing: -14, ecology: -8 }, effectTag: 'ration_water' },
      { cashDelta: -8000, scoreDelta: { wellBeing: 6, ecology: -3 }, effectTag: 'bore_well' },
    ],
  }),
  // 12 — Sun glare blinds excavator operator
  ev('weather_sun_glare', 'weather', {
    weight: (s) => 0.8 + 0.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'sunny',
    options: [
      { cashDelta: -5000, scoreDelta: { safety: 8 }, effectTag: 'tinted_windshields' },
      { cashDelta: 0, scoreDelta: { safety: -10 }, effectTag: 'squinting_operator' },
      { cashDelta: -2000, scoreDelta: { safety: 4, wellBeing: 3 }, effectTag: 'giant_sunglasses' },
    ],
  }),
  // 13 — Monsoon season arrives early
  ev('weather_early_monsoon', 'weather', {
    weight: (s) => 1.1 + 0.7 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.weatherId === 'heavy_rain' || ctx.weatherId === 'storm',
    options: [
      { cashDelta: -25000, scoreDelta: { safety: 12, ecology: 8 }, effectTag: 'drainage_system' },
      { cashDelta: 0, scoreDelta: { safety: -10, ecology: -12 }, effectTag: 'flooded_operations' },
      { cashDelta: -10000, scoreDelta: { safety: 6, wellBeing: -4 }, effectTag: 'monsoon_shifts' },
    ],
  }),
  // 14 — Wind blows away blast plan paperwork
  ev('weather_wind_paperwork', 'weather', {
    weight: (s) => 0.7 + 0.4 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'storm' && ctx.hasDrillPlan,
    options: [
      { cashDelta: -8000, scoreDelta: { safety: 6 }, effectTag: 'reprint_plans' },
      { cashDelta: 0, scoreDelta: { safety: -12 }, effectTag: 'blast_from_memory' },
      { cashDelta: -3000, scoreDelta: { safety: 10 }, effectTag: 'digital_plans' },
    ],
  }),
  // 15 — Acid rain from neighboring factory
  ev('weather_acid_rain', 'weather', {
    weight: (s) => 0.9 + 1.0 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.weatherId === 'light_rain' || ctx.weatherId === 'heavy_rain',
    options: [
      { cashDelta: -12000, scoreDelta: { ecology: 10, safety: 5 }, effectTag: 'acid_cleanup' },
      { cashDelta: 0, scoreDelta: { ecology: -15, safety: -8 }, effectTag: 'ignore_acid' },
      { cashDelta: -5000, corruptionDelta: 10, scoreDelta: { ecology: 3 }, effectTag: 'blame_neighbor' },
    ],
  }),
  // 16 — Quicksand forms in pit after rain
  ev('weather_quicksand', 'weather', {
    weight: (s) => 0.8 + 0.9 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'heavy_rain',
    options: [
      { cashDelta: -14000, scoreDelta: { safety: 12 }, effectTag: 'quicksand_barrier' },
      { cashDelta: 0, scoreDelta: { safety: -18, wellBeing: -6 }, effectTag: 'worker_sinking' },
      { cashDelta: -6000, scoreDelta: { safety: 6, ecology: -3 }, effectTag: 'fill_with_gravel' },
    ],
  }),
  // 17 — Hailstorm damages vehicle roofs
  ev('weather_hailstorm', 'weather', {
    weight: (s) => 1.0 + 0.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'storm',
    options: [
      { cashDelta: -22000, scoreDelta: { safety: 10 }, effectTag: 'repair_vehicles' },
      { cashDelta: 0, scoreDelta: { safety: -8, wellBeing: -5 }, effectTag: 'dented_fleet' },
      { cashDelta: -10000, scoreDelta: { safety: 6 }, effectTag: 'vehicle_shelters' },
    ],
  }),
  // 18 — Extreme humidity rusts equipment overnight
  ev('weather_humidity_rust', 'weather', {
    weight: (s) => 0.7 + 0.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'heavy_rain' || ctx.weatherId === 'light_rain',
    options: [
      { cashDelta: -16000, scoreDelta: { safety: 8 }, effectTag: 'rust_treatment' },
      { cashDelta: 0, scoreDelta: { safety: -10 }, effectTag: 'rusty_machines' },
      { cashDelta: -6000, scoreDelta: { safety: 5 }, effectTag: 'dehumidifiers' },
    ],
  }),
  // 19 — Flash flood washes away stored rubble
  ev('weather_flash_flood', 'weather', {
    weight: (s) => 1.2 + 0.8 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.weatherId === 'storm' || ctx.weatherId === 'heavy_rain',
    options: [
      { cashDelta: -30000, scoreDelta: { ecology: -15, safety: 8 }, effectTag: 'rubble_downstream' },
      { cashDelta: -15000, scoreDelta: { ecology: 5, safety: 10 }, effectTag: 'flood_barriers' },
      { cashDelta: -8000, scoreDelta: { ecology: -5 }, effectTag: 'let_it_flow' },
    ],
  }),
  // 20 — Ball lightning seen in pit (workers terrified)
  ev('weather_ball_lightning', 'weather', {
    weight: (s) => 0.2 + 0.3 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'storm',
    options: [
      { cashDelta: -10000, scoreDelta: { safety: 10, wellBeing: 8 }, effectTag: 'pit_evacuation' },
      { cashDelta: 0, scoreDelta: { wellBeing: -12, safety: -8 }, effectTag: 'mass_panic' },
      { cashDelta: -3000, corruptionDelta: 5, scoreDelta: { wellBeing: 4 }, effectTag: 'cover_up' },
    ],
  }),
  // 21 — Sandstorm buries half the mine
  ev('weather_sandstorm', 'weather', {
    weight: (s) => 1.0 + 0.6 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'heat_wave',
    options: [
      { cashDelta: -35000, scoreDelta: { safety: 10 }, effectTag: 'excavate_mine' },
      { cashDelta: -15000, scoreDelta: { safety: -5, wellBeing: -8 }, effectTag: 'dig_by_hand' },
      { cashDelta: -20000, scoreDelta: { safety: 6, ecology: -4 }, effectTag: 'blast_the_sand' },
    ],
  }),
  // 22 — Heat mirages confuse surveyor readings
  ev('weather_heat_mirage', 'weather', {
    weight: (s) => 0.7 + 0.4 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'heat_wave' && ctx.hasDrillPlan,
    options: [
      { cashDelta: -6000, scoreDelta: { safety: 8 }, effectTag: 'resurvey' },
      { cashDelta: 0, scoreDelta: { safety: -14 }, effectTag: 'mirage_based_drilling' },
      { cashDelta: -3000, scoreDelta: { safety: 5, wellBeing: 3 }, effectTag: 'night_survey' },
    ],
  }),
  // 23 — Temperature inversion traps dust in pit
  ev('weather_temp_inversion', 'weather', {
    weight: (s) => 0.9 + 0.8 * r.nu(s),
    canFire: (ctx) => ctx.weatherId === 'cloudy' || ctx.weatherId === 'sunny',
    options: [
      { cashDelta: -10000, scoreDelta: { nuisance: -8, wellBeing: 8, safety: 5 }, effectTag: 'dust_suppression' },
      { cashDelta: 0, scoreDelta: { nuisance: 10, wellBeing: -8 }, effectTag: 'breathe_dust' },
      { cashDelta: -4000, scoreDelta: { nuisance: -3, safety: 3 }, effectTag: 'respirators' },
    ],
  }),
  // 24 — Minor earthquake tremor
  ev('weather_minor_tremor', 'weather', {
    weight: (s) => 0.5 + 0.6 * (1 - r.sf(s)),
    options: [
      { cashDelta: -20000, scoreDelta: { safety: 15 }, effectTag: 'structural_inspection' },
      { cashDelta: 0, scoreDelta: { safety: -18, wellBeing: -6 }, effectTag: 'ignore_tremor' },
      { cashDelta: -8000, scoreDelta: { safety: 8, wellBeing: 4 }, effectTag: 'early_warning_system' },
    ],
  }),
  // 25 — Strange aurora visible at midday (fantastical, workers spooked)
  ev('weather_midday_aurora', 'weather', {
    weight: () => 0.15,
    options: [
      { cashDelta: -5000, scoreDelta: { wellBeing: 10 }, effectTag: 'aurora_break' },
      { cashDelta: 0, scoreDelta: { wellBeing: -8, safety: -5 }, effectTag: 'aurora_panic' },
      { cashDelta: -2000, corruptionDelta: 5, scoreDelta: { wellBeing: 5 }, effectTag: 'aurora_coverup' },
      { cashDelta: -15000, scoreDelta: { wellBeing: 15, ecology: 5 }, effectTag: 'aurora_tourism',
        probability: 0.4, alt: { cashDelta: -5000, scoreDelta: { wellBeing: 6 } } },
    ],
  }),
];
