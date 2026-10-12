// BlastSimulator2026 — Weather: the beds stay calm and storms get their rumbles, at any game speed
// Weather lasts game ticks, and the harness ticks once per real second at 1x but eight times per real second at 8x,
// so a storm of 2 to 6 ticks is 2 to 6 real seconds at 1x and under a second at 8x. Played through the real core
// weather cycle and the real director, this holds the beds to a bounded number of retargets per real minute
// (they used to follow every flip, a cross-fade of 3 s begun every 1.6 s at 8x) and shows that a natural storm
// can produce a distant rumble. Nobody can hear it: these are request counts.

import { beforeAll, describe, expect, it } from 'vitest';
import { CrowdSim, type GameSpeed } from '../../../helpers/audioCrowding.js';
import { AMBIENCE_CONFIG } from '../../../../src/core/config/audio/game.js';
import { Random } from '../../../../src/core/math/Random.js';
import { resetCampaignProfile } from '../../../../src/persistence/CampaignProfile.js';

const RUN_TIMEOUT_MS = 90_000;
const SECONDS_PER_MINUTE = 60;
const BED_IDS = new Set(['amb_wind', 'amb_rain_light', 'amb_rain_heavy']);
/** Calm ticks between two storms of the loop, and the length of a natural storm in ticks. */
const CALM_TICKS = 5;
const STORM_TICKS = { min: 2, max: 6 };

interface WeatherRun {
  readonly sim: CrowdSim;
  readonly minutes: number;
  readonly storms: { readonly startS: number; endS: number }[];
  /** Times the weather became something else, counted once per real second. */
  readonly weatherChanges: number;
}

function started(speed: GameSpeed, audioSeed: number): CrowdSim {
  const sim = new CrowdSim({ speed, afk: true, audioSeed });
  resetCampaignProfile(sim.engine.ctx.campaignProfile);
  sim.command('campaign start level:dusty_hollow staffed:true');
  sim.chooseSpeed();
  sim.command('time resume');
  // A rich mine: the game must not end in bankruptcy while the weather is being measured.
  sim.state!.cash = 1e9;
  sim.state!.finances.cash = 1e9;
  return sim;
}

/** Play `seconds` of real time; when `stormLoop`, a new natural storm (2 to 6 ticks) starts after every `CALM_TICKS` calm ticks. */
function playWeather(speed: GameSpeed, seconds: number, stormLoop: boolean): WeatherRun {
  const sim = started(speed, 11);
  const weather = sim.state!.weather;
  const random = new Random(3);
  const storms: WeatherRun['storms'] = [];
  const startS = sim.realS;
  let calmTicks = 0;
  let weatherChanges = 0;
  let previous = weather.current;
  for (let i = 0; i < seconds && !sim.state!.levelEnded; i++) {
    sim.seconds(1);
    if (weather.current !== previous) weatherChanges++;
    previous = weather.current;
    if (weather.current === 'storm') {
      const last = storms.at(-1);
      if (last && last.endS >= sim.realS - 1) last.endS = sim.realS;
      else storms.push({ startS: sim.realS - 1, endS: sim.realS });
    } else if (stormLoop && ++calmTicks >= CALM_TICKS) {
      calmTicks = 0;
      weather.current = 'storm';
      weather.ticksRemaining = STORM_TICKS.min + Math.floor(random.next() * (STORM_TICKS.max - STORM_TICKS.min + 1));
    }
  }
  return { sim, minutes: (sim.realS - startS) / SECONDS_PER_MINUTE, storms, weatherChanges };
}

const bedSends = (run: WeatherRun): number => run.sim.recorder.beds.filter(b => BED_IDS.has(b.id)).length;
const rumbles = (run: WeatherRun) => run.sim.recorder.plays.filter(p => p.key === 'thunder:rumble');

let stormLoop1x: WeatherRun;
let stormLoop8x: WeatherRun;
let natural8x: WeatherRun;

beforeAll(() => {
  stormLoop1x = playWeather(1, 300, true);
  stormLoop8x = playWeather(8, 150, true);
  natural8x = playWeather(8, 300, false);
}, RUN_TIMEOUT_MS);

describe('a loop of natural storms', () => {
  it('rumbles in a share of its storms at 1x, and only while a storm is on', () => {
    // Measured 38 storms and 10 rumbles in 300 s (0.26 a storm); before the rumble clock counted storm time, none.
    const run = stormLoop1x;
    expect(run.storms.length).toBeGreaterThanOrEqual(25);
    expect(rumbles(run).length).toBeGreaterThanOrEqual(Math.floor(run.storms.length * 0.2));
    for (const rumble of rumbles(run)) {
      expect(run.storms.some(s => rumble.tS >= s.startS - 1 && rumble.tS <= s.endS + 1), `rumble at ${rumble.tS.toFixed(1)} s`).toBe(true);
    }
  });

  it('lets a storm of four seconds or more rumble at 1x', () => {
    const long = stormLoop1x.storms.filter(s => s.endS - s.startS >= 4);
    expect(long.length).toBeGreaterThan(0);
    expect(rumbles(stormLoop1x).some(r => long.some(s => r.tS >= s.startS && r.tS <= s.endS + 1))).toBe(true);
  });

  it('still rumbles at 8x, where a storm passes in under a second', () => {
    // Measured 9 storms and 3 rumbles in 150 s: the clock counts storm time across the short calms between storms.
    expect(rumbles(stormLoop8x).length).toBeGreaterThanOrEqual(2);
  });

  it('rumbles no more often than the interval allows once a storm is under way', () => {
    const times = rumbles(stormLoop1x).map(r => r.tS);
    for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeGreaterThan(AMBIENCE_CONFIG.thunder.rumbleFirstMinS);
  });

  it('sends the weather beds at most 26 levels a real minute, at 1x and at 8x', () => {
    // Measured 20.4 a minute at 1x and 19.6 at 8x; before the dwell, 32.2 and 117.8 (a send per bed per flip).
    expect(bedSends(stormLoop1x) / stormLoop1x.minutes).toBeLessThanOrEqual(26);
    expect(bedSends(stormLoop8x) / stormLoop8x.minutes).toBeLessThanOrEqual(26);
  });
});

describe('natural weather at 8x', () => {
  it('flips the sky more often than the beds follow it, and sends at most 21 bed levels a real minute', () => {
    // Measured 16.2 sends a minute (about 5 retargets of three beds) against 33.6 weather changes a minute; before the dwell, 56 sends a minute in a 400 s run of the same level.
    const sends = bedSends(natural8x) / natural8x.minutes;
    expect(natural8x.weatherChanges / natural8x.minutes).toBeGreaterThan(sends / 3);
    expect(sends).toBeLessThanOrEqual(21);
    // Each retarget moves at most the three beds, once per dwell.
    expect(bedSends(natural8x)).toBeLessThanOrEqual(3 * (Math.ceil(natural8x.sim.realS / AMBIENCE_CONFIG.minDwellS) + 1));
  });
});
