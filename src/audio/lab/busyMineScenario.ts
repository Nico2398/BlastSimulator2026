// BlastSimulator2026 — Busy mine mix scenario
// A minute of a working mine: the diesel bed under two work sites that change
// over time, trucks hauling and backing up, horns and engines, the site radio,
// the odd cash register and alert, a few far-away sounds, a shower and then a
// storm rolling in for the last stretch.

import type { Random } from '../../core/math/Random.js';
import { LAB_BUSY_MINE as MINE, LAB_RENDER_CONFIG } from '../../core/config/audio/lab.js';
import type { OneShotId } from '../SoundCatalog.js';
import type { PlayMixEvent, MixScenario } from './mixTypes.js';
import { jitteredMoments, ringPoint } from './scenarioKit.js';
import { TimelineBuilder } from './timeline.js';

/** Which burst sound the two work sites make in each third of the minute. */
const SITE_SOUNDS: ReadonlyArray<readonly [OneShotId, OneShotId]> = [
  ['work_drill', 'work_dig'],
  ['work_hammer', 'work_compact'],
  ['work_drill', 'work_hammer'],
];

/** [time, sound] moments of the interface and world cues, sprinkled over the minute. */
const CUES: ReadonlyArray<readonly [number, OneShotId]> = [
  [5, 'order_queued'], [8, 'coins_small'], [10, 'hire'], [14, 'order_done'], [18, 'notify_info'],
  [20, 'order_queued'], [20.5, 'build_placed'], [22, 'coins_small'], [26, 'notify_good'], [28, 'order_done'], [30, 'coins_big'],
  [33, 'shift_whistle'], [35, 'purchase'], [42, 'notify_warn'], [46, 'coins_small'], [55, 'cash_till'],
];

/** [time, sound] moments of vehicles and buildings, which sound from a place near the crews. */
const WORLD_CUES: ReadonlyArray<readonly [number, OneShotId]> = [
  [3, 'vehicle_start'], [9, 'vehicle_reverse'], [12, 'vehicle_horn'], [15, 'drill_done'], [17, 'charge_loaded'], [23, 'survey_done'],
  [24, 'vehicle_start'], [25, 'vehicle_reverse'], [27, 'boulder_break'], [29, 'building_built'], [37, 'vehicle_horn'], [38, 'worker_collapse'], [41, 'vehicle_start'],
  [52, 'vehicle_horn'],
];

/** [time, sound] moments heard from far away, on the ambient bus. */
const FAR_CUES: ReadonlyArray<readonly [number, OneShotId]> = [
  [16, 'vehicle_scrap'], [31, 'work_hammer'], [36, 'vehicle_reverse'], [48, 'vehicle_horn'],
];

function addWorkBursts(builder: TimelineBuilder, random: Random): void {
  const thirdS = MINE.durationS / SITE_SOUNDS.length;
  SITE_SOUNDS.forEach((sounds, third) => {
    sounds.forEach((sound, site) => {
      const at = ringPoint(random, MINE.nearM.min, MINE.nearM.max);
      for (const t of jitteredMoments(random, third * thirdS, (third + 1) * thirdS, MINE.workGapS.min, MINE.workGapS.max)) {
        builder.play(t, sound, { at, key: `work:${third}:${site}` });
      }
    });
  });
}

function addHauling(builder: TimelineBuilder, random: Random): void {
  jitteredMoments(random, 0, MINE.durationS, MINE.haulGapS.min, MINE.haulGapS.max).forEach((t, i) => {
    builder.play(t, i % 2 === 0 ? 'haul_load' : 'haul_dump', { at: ringPoint(random, MINE.nearM.min, MINE.nearM.max), key: `haul:${i}` });
  });
}

function addPlaced(builder: TimelineBuilder, random: Random, cues: ReadonlyArray<readonly [number, OneShotId]>, opts: (random: Random) => PlayMixEvent['opts']): void {
  for (const [t, id] of cues) builder.play(t, id, opts(random));
}

function addWeather(builder: TimelineBuilder, random: Random): void {
  builder
    .loop(MINE.lightRain.fromS, 'amb_rain_light', MINE.lightRain.level, MINE.lightRain.rampS)
    .loop(MINE.lightRain.toS, 'amb_rain_light', 0, MINE.lightRain.rampS)
    .loop(MINE.stormFromS, 'amb_wind', 0, MINE.stormRampS)
    .loop(MINE.stormFromS, 'amb_wind_storm', MINE.stormWindLevel, MINE.stormRampS)
    .loop(MINE.stormFromS, 'amb_rain_heavy', MINE.stormRainLevel, MINE.stormRampS);
  for (const t of MINE.thunderAtS) {
    builder.play(t, 'thunder', { gainDb: random.nextFloat(MINE.thunderGainDb.min, MINE.thunderGainDb.max) });
  }
  builder.play(MINE.rumbleAtS, 'thunder', { gainDb: MINE.rumbleGainDb });
}

export function buildBusyMineScenario(random: Random): MixScenario {
  const builder = new TimelineBuilder()
    .loop(0, 'amb_wind', MINE.windLevel, 2)
    .loop(0, 'amb_machinery', MINE.machineryLevel, 3);
  addWorkBursts(builder, random);
  addHauling(builder, random);
  for (const [t, id] of CUES) builder.play(t, id);
  addPlaced(builder, random, WORLD_CUES, r => ({ at: ringPoint(r, MINE.nearM.min, MINE.nearM.max) }));
  addPlaced(builder, random, FAR_CUES, r => ({ at: ringPoint(r, MINE.farM.min, MINE.farM.max), bus: 'ambient', gainDb: MINE.farGainDb }));
  addWeather(builder, random);
  return {
    name: 'busy-mine',
    title: 'Busy mine: work, hauling, alerts, storm for the last 15 s',
    durationS: MINE.durationS,
    listener: LAB_RENDER_CONFIG.listener,
    events: builder.build(),
  };
}
