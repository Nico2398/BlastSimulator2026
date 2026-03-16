// BlastSimulator2026 — Weather events batch 2 (events 26-50)
// Absurd meteorological phenomena, climate chaos, and atmospheric comedy in open-pit mining.
import { ev, r } from './EventBuilder.js';
import type { EventDef } from './EventPool.js';

export const WEATHER_EVENTS_2: EventDef[] = [
  // 26 — Perfect weather streak makes workers paranoid
  ev('weather_suspiciously_perfect', 'weather', {
    weight: (s) => 0.8 + 0.6 * r.wb(s),
    canFire: (ctx) => ctx.weatherId === 'sunny' && ctx.tickCount > 20,
    options: [
      { cashDelta: -3000, scoreDelta: { wellBeing: 6 }, effectTag: 'paranoia_counseling' },
      { cashDelta: 0, scoreDelta: { wellBeing: -8 }, effectTag: 'superstitious_panic' },
      { cashDelta: -1000, scoreDelta: { wellBeing: 3 }, effectTag: 'weather_shrine' },
    ],
  }),
  // 27 — Freak hailstones shaped like ore chunks
  ev('weather_ore_hail', 'weather', {
    weight: (s) => 0.3 + 0.5 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.weatherId === 'storm',
    options: [
      { cashDelta: 12000, scoreDelta: { ecology: -5 }, effectTag: 'collect_ore_hail' },
      { cashDelta: 0, scoreDelta: { safety: -6 }, effectTag: 'hail_injuries' },
      { cashDelta: -5000, scoreDelta: { safety: 8 }, effectTag: 'hail_shelters' },
    ],
  }),
  // 28 — Wind shifts blast debris toward nearby village
  ev('weather_debris_wind', 'weather', {
    weight: (s) => 1.5 + 2.0 * r.nu(s),
    canFire: (ctx) => ctx.weatherId === 'storm' || ctx.weatherId === 'cloudy',
    options: [
      { cashDelta: -25000, scoreDelta: { nuisance: -12, safety: 5 }, effectTag: 'village_cleanup' },
      { cashDelta: 0, scoreDelta: { nuisance: 15, safety: -10 }, followUp: 'weather_lawsuit_debris' },
      { corruptionDelta: 12, cashDelta: -5000, scoreDelta: { nuisance: -3 }, effectTag: 'bribe_mayor' },
    ],
  }),
  // 29 — Permafrost thawing reveals prehistoric bones
  ev('weather_permafrost_bones', 'weather', {
    weight: (s) => 0.25 + 0.4 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.weatherId === 'heat_wave',
    options: [
      { cashDelta: -15000, scoreDelta: { ecology: 15, wellBeing: 8 }, effectTag: 'museum_donation' },
      { cashDelta: 20000, scoreDelta: { ecology: -20 }, effectTag: 'sell_bones_black_market' },
      { cashDelta: -8000, scoreDelta: { ecology: 8 }, effectTag: 'archaeologist_delay' },
    ],
  }),
  // 30 — Lightning strikes same spot twice
  ev('weather_double_lightning', 'weather', {
    weight: (s) => 0.4 + 0.8 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'storm',
    options: [
      { cashDelta: -10000, scoreDelta: { safety: 10 }, effectTag: 'lightning_rods' },
      { cashDelta: 5000, scoreDelta: { safety: -8, ecology: -5 }, effectTag: 'free_blasting' },
      { cashDelta: -2000, scoreDelta: { wellBeing: -6 }, effectTag: 'workers_spooked' },
    ],
  }),
  // 31 — Fog reveals glowing outlines in the rock (fantastical)
  ev('weather_glowing_fog', 'weather', {
    weight: (s) => 0.15 + 0.3 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.weatherId === 'cloudy',
    options: [
      { cashDelta: 25000, scoreDelta: { ecology: -10 }, effectTag: 'mine_glow_veins' },
      { cashDelta: -5000, scoreDelta: { ecology: 12, wellBeing: 5 }, effectTag: 'geology_study' },
      { cashDelta: 0, scoreDelta: { wellBeing: -10 }, effectTag: 'glow_fear',
        probability: 0.5, alt: { cashDelta: 15000, scoreDelta: { ecology: -5 } } },
    ],
  }),
  // 32 — Seasonal flooding fills pit with fish
  ev('weather_pit_fish', 'weather', {
    weight: (s) => 0.5 + 0.6 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.weatherId === 'heavy_rain',
    options: [
      { cashDelta: 8000, scoreDelta: { wellBeing: 10, ecology: -8 }, effectTag: 'pit_fishing_derby' },
      { cashDelta: -12000, scoreDelta: { ecology: 10 }, effectTag: 'pump_and_relocate_fish' },
      { cashDelta: -3000, scoreDelta: { wellBeing: 5 }, effectTag: 'fish_fry_lunch' },
    ],
  }),
  // 33 — Double rainbow causes work stoppage for photos
  ev('weather_double_rainbow', 'weather', {
    weight: (s) => 0.6 + 0.4 * r.wb(s),
    canFire: (ctx) => ctx.weatherId === 'light_rain' || ctx.weatherId === 'sunny',
    options: [
      { cashDelta: -2000, scoreDelta: { wellBeing: 12 }, effectTag: 'rainbow_break' },
      { cashDelta: 0, scoreDelta: { wellBeing: -8 }, effectTag: 'no_fun_allowed' },
      { cashDelta: 3000, scoreDelta: { wellBeing: 6, nuisance: 3 }, effectTag: 'rainbow_marketing' },
    ],
  }),
  // 34 — Warm winter melts snow, causes mudflow
  ev('weather_mudflow_thaw', 'weather', {
    weight: (s) => 1.0 + 1.2 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'heat_wave',
    options: [
      { cashDelta: -20000, scoreDelta: { safety: 10, ecology: 5 }, effectTag: 'mudflow_barriers' },
      { cashDelta: 0, scoreDelta: { safety: -15, ecology: -10 }, effectTag: 'mudslide_damage' },
      { cashDelta: -8000, scoreDelta: { safety: 5 }, effectTag: 'emergency_drainage' },
    ],
  }),
  // 35 — Cold snap freezes fuel lines
  ev('weather_frozen_fuel', 'weather', {
    weight: (s) => 1.2 + 1.0 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'cold_snap',
    options: [
      { cashDelta: -10000, scoreDelta: { safety: 8 }, effectTag: 'heated_fuel_lines' },
      { cashDelta: -3000, scoreDelta: { safety: -5, wellBeing: -6 }, effectTag: 'manual_thawing' },
      { cashDelta: 0, scoreDelta: { safety: -12 }, effectTag: 'operations_halted' },
    ],
  }),
  // 36 — Humidity causes explosives to sweat
  ev('weather_sweaty_explosives', 'weather', {
    weight: (s) => 1.5 + 2.0 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'heavy_rain' || ctx.weatherId === 'heat_wave',
    options: [
      { cashDelta: -15000, scoreDelta: { safety: 12 }, effectTag: 'climate_storage' },
      { cashDelta: 0, scoreDelta: { safety: -18 }, effectTag: 'ignore_sweating',
        probability: 0.7, alt: { cashDelta: -50000, scoreDelta: { safety: -30 }, effectTag: 'accidental_detonation' } },
      { cashDelta: -5000, scoreDelta: { safety: 5 }, effectTag: 'replace_stock' },
    ],
  }),
  // 37 — Weather forecast completely wrong
  ev('weather_bad_forecast', 'weather', {
    weight: (s) => 0.9 + 0.5 * (1 - r.sf(s)),
    options: [
      { cashDelta: -8000, scoreDelta: { safety: 6, wellBeing: -4 }, effectTag: 'reschedule_everything' },
      { cashDelta: 0, scoreDelta: { safety: -10 }, effectTag: 'proceed_anyway' },
      { cashDelta: -12000, scoreDelta: { safety: 8, wellBeing: 4 }, effectTag: 'private_meteorologist' },
    ],
  }),
  // 38 — Cloud looks like company logo
  ev('weather_logo_cloud', 'weather', {
    weight: (s) => 0.4 + 0.3 * r.wb(s),
    canFire: (ctx) => ctx.weatherId === 'cloudy' || ctx.weatherId === 'sunny',
    options: [
      { cashDelta: 5000, scoreDelta: { wellBeing: 8 }, effectTag: 'divine_marketing' },
      { cashDelta: 0, scoreDelta: { wellBeing: -5 }, effectTag: 'omen_of_doom' },
      { cashDelta: -3000, scoreDelta: { wellBeing: 10, nuisance: 2 }, effectTag: 'cloud_merch' },
    ],
  }),
  // 39 — Static electricity buildup near explosives
  ev('weather_static_charge', 'weather', {
    weight: (s) => 1.8 + 2.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.hasDrillPlan && (ctx.weatherId === 'cold_snap' || ctx.weatherId === 'sunny'),
    options: [
      { cashDelta: -12000, scoreDelta: { safety: 15 }, effectTag: 'grounding_system' },
      { cashDelta: 0, scoreDelta: { safety: -20 }, effectTag: 'static_ignored',
        probability: 0.6, alt: { cashDelta: -40000, scoreDelta: { safety: -25 }, effectTag: 'static_detonation' } },
      { cashDelta: -5000, scoreDelta: { safety: 8 }, effectTag: 'antistatic_suits' },
    ],
  }),
  // 40 — Sunrise creates perfect mine tourism lighting
  ev('weather_tourist_sunrise', 'weather', {
    weight: (s) => 0.6 + 0.5 * r.ec(s),
    canFire: (ctx) => ctx.weatherId === 'sunny',
    options: [
      { cashDelta: 15000, scoreDelta: { nuisance: 8, wellBeing: 5 }, effectTag: 'mine_tours' },
      { cashDelta: 0, scoreDelta: {} },
      { cashDelta: 8000, scoreDelta: { nuisance: 3, ecology: -3 }, effectTag: 'instagram_spot' },
    ],
  }),
  // 41 — Pollen season: allergies reduce workforce
  ev('weather_pollen_plague', 'weather', {
    weight: (s) => 0.8 + 0.7 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.employeeCount > 5 && ctx.weatherId === 'sunny',
    options: [
      { cashDelta: -6000, scoreDelta: { wellBeing: 8 }, effectTag: 'antihistamine_supply' },
      { cashDelta: 0, scoreDelta: { wellBeing: -10 }, effectTag: 'sneezing_workforce' },
      { cashDelta: -15000, scoreDelta: { wellBeing: 12, ecology: 5 }, effectTag: 'air_filtration' },
    ],
  }),
  // 42 — Geomagnetic storm disrupts electronics
  ev('weather_geomagnetic_storm', 'weather', {
    weight: (s) => 0.5 + 0.8 * (1 - r.sf(s)),
    options: [
      { cashDelta: -18000, scoreDelta: { safety: 10 }, effectTag: 'faraday_cages' },
      { cashDelta: 0, scoreDelta: { safety: -12 }, effectTag: 'electronics_fried' },
      { cashDelta: -8000, scoreDelta: { safety: 6 }, effectTag: 'manual_operations' },
    ],
  }),
  // 43 — Tidal bore floods coastal mine
  ev('weather_tidal_bore', 'weather', {
    weight: (s) => 0.3 + 0.6 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.weatherId === 'storm' || ctx.weatherId === 'heavy_rain',
    options: [
      { cashDelta: -30000, scoreDelta: { safety: 8, ecology: 10 }, effectTag: 'tidal_walls' },
      { cashDelta: 0, scoreDelta: { safety: -15, ecology: -12 }, effectTag: 'flooded_pit' },
      { cashDelta: -10000, scoreDelta: { safety: 5, wellBeing: 5 }, effectTag: 'surfing_breaks' },
    ],
  }),
  // 44 — Wind turbine opportunity on ridgeline
  ev('weather_wind_turbine', 'weather', {
    weight: (s) => 0.6 + 0.8 * r.ec(s),
    canFire: (ctx) => ctx.weatherId === 'storm' || ctx.weatherId === 'cloudy',
    options: [
      { cashDelta: -40000, scoreDelta: { ecology: 15, nuisance: 5 }, effectTag: 'wind_farm' },
      { cashDelta: 0, scoreDelta: {} },
      { cashDelta: -15000, scoreDelta: { ecology: 8, nuisance: 3 }, effectTag: 'single_turbine' },
    ],
  }),
  // 45 — Meteor shower visible from pit, workers want to watch
  ev('weather_meteor_shower', 'weather', {
    weight: (s) => 0.4 + 0.5 * (1 - r.wb(s)),
    canFire: (ctx) => ctx.weatherId === 'sunny',
    options: [
      { cashDelta: -4000, scoreDelta: { wellBeing: 14 }, effectTag: 'night_shift_stargazing' },
      { cashDelta: 0, scoreDelta: { wellBeing: -8 }, effectTag: 'no_stargazing' },
      { cashDelta: -2000, scoreDelta: { wellBeing: 8 }, effectTag: 'break_time_viewing' },
    ],
  }),
  // 46 — Drought cracks terrain unpredictably
  ev('weather_drought_cracks', 'weather', {
    weight: (s) => 1.2 + 1.5 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'heat_wave' || ctx.weatherId === 'sunny',
    options: [
      { cashDelta: -20000, scoreDelta: { safety: 12, ecology: -5 }, effectTag: 'terrain_survey' },
      { cashDelta: 0, scoreDelta: { safety: -15 }, effectTag: 'crack_collapse',
        probability: 0.6, alt: { cashDelta: -5000, scoreDelta: { safety: -5 } } },
      { cashDelta: -8000, scoreDelta: { safety: 6 }, effectTag: 'crack_filling' },
    ],
  }),
  // 47 — Bird migration through blast zone
  ev('weather_bird_migration', 'weather', {
    weight: (s) => 0.7 + 1.0 * (1 - r.ec(s)),
    canFire: (ctx) => ctx.hasDrillPlan,
    options: [
      { cashDelta: -10000, scoreDelta: { ecology: 15 }, effectTag: 'blasting_pause_birds' },
      { cashDelta: 0, scoreDelta: { ecology: -18, nuisance: 5 }, effectTag: 'blast_through_flock' },
      { cashDelta: -4000, scoreDelta: { ecology: 8, nuisance: 3 }, effectTag: 'bird_scarers' },
    ],
  }),
  // 48 — Ice formation on equipment overnight
  ev('weather_iced_equipment', 'weather', {
    weight: (s) => 1.0 + 0.8 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'cold_snap',
    options: [
      { cashDelta: -8000, scoreDelta: { safety: 8 }, effectTag: 'de_icing_crew' },
      { cashDelta: 0, scoreDelta: { safety: -10, wellBeing: -5 }, effectTag: 'slip_hazard' },
      { cashDelta: -15000, scoreDelta: { safety: 12 }, effectTag: 'heated_garage' },
    ],
  }),
  // 49 — Waterspout spotted near inland mine (fantastical)
  ev('weather_inland_waterspout', 'weather', {
    weight: (s) => 0.15 + 0.3 * (1 - r.sf(s)),
    canFire: (ctx) => ctx.weatherId === 'storm',
    options: [
      { cashDelta: -20000, scoreDelta: { safety: 12, ecology: 5 }, effectTag: 'emergency_evac' },
      { cashDelta: 0, scoreDelta: { safety: -20, wellBeing: -10 }, effectTag: 'waterspout_hits' },
      { cashDelta: 5000, scoreDelta: { nuisance: 8, wellBeing: 6 }, effectTag: 'waterspout_tours',
        probability: 0.4, alt: { cashDelta: -30000, scoreDelta: { safety: -15 } } },
    ],
  }),
  // 50 — Microclimate forms in pit (different weather inside vs outside)
  ev('weather_pit_microclimate', 'weather', {
    weight: (s) => 0.35 + 0.5 * r.ec(s),
    canFire: (ctx) => ctx.tickCount > 30,
    options: [
      { cashDelta: -5000, scoreDelta: { ecology: 10, wellBeing: 8 }, effectTag: 'microclimate_study' },
      { cashDelta: 10000, scoreDelta: { ecology: -8 }, effectTag: 'pit_greenhouse' },
      { cashDelta: 0, scoreDelta: { wellBeing: 5 }, effectTag: 'tropical_pit_vibes' },
    ],
  }),
];
