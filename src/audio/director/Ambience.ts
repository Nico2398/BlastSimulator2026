// BlastSimulator2026 — Ambience
// The weather beds (wind, light and heavy rain), thunder and the way a pause or
// a menu quiets them. Beds follow the weather by cross-fading over a few
// seconds; behind a full-screen menu everything fades away except a very quiet
// wind, so the menu is not dead. Thunder follows the sky: a lightning flash
// brings a clap after a delay that feels like distance, and storms add distant
// rumbles between flashes.

import type { LoopId } from '../SoundCatalog.js';
import type { WeatherState } from '../../core/weather/WeatherCycle.js';
import { AMBIENCE_CONFIG } from '../../core/config/audio/game.js';
import { clamp } from '../engine/units.js';
import { BedFeed } from './BedFeed.js';
import { lerp } from './scalar.js';
import type { DirectorEnv } from './types.js';

interface AmbienceInput {
  /** Weather of the running game; null with no game. */
  readonly weather: WeatherState | null;
  /** The simulation is paused or the level is over. */
  readonly paused: boolean;
  /** A full-screen menu hides the game. */
  readonly menuUp: boolean;
  /** Camera distance to its target (m); null with no listener. */
  readonly viewDistance: number | null;
}

type BedName = 'wind' | 'rainLight' | 'rainHeavy';

const BED_IDS: Readonly<Record<BedName, LoopId>> = {
  wind: 'amb_wind',
  rainLight: 'amb_rain_light',
  rainHeavy: 'amb_rain_heavy',
};

/** Wind swells as the camera pulls back and eases as it zooms in. */
function windViewFactor(viewDistance: number | null): number {
  if (viewDistance === null) return 1;
  const { windViewNearM, windViewFarM, windViewSwing } = AMBIENCE_CONFIG;
  const t = clamp((viewDistance - windViewNearM) / (windViewFarM - windViewNearM), 0, 1);
  return lerp(1 - windViewSwing, 1 + windViewSwing, t);
}

export class Ambience {
  private readonly beds: Record<BedName, BedFeed>;
  /** The real weather, for thunder. */
  private weather: WeatherState | null = null;
  /** The weather the beds follow: the real one, a change at a time. */
  private bedWeather: WeatherState | null = null;
  private bedWeatherAgeS = 0;
  private heard = false;
  private rumbleTimerS: number | null = null;
  /** Real seconds since the last storm, to tell a short gap between storms from the end of them. */
  private calmS = 0;
  private lastMenuUp = false;

  constructor(private readonly env: DirectorEnv) {
    const { player } = env;
    const feed = (id: LoopId): BedFeed => new BedFeed(player.loop(id), AMBIENCE_CONFIG.epsilon);
    this.beds = { wind: feed(BED_IDS.wind), rainLight: feed(BED_IDS.rainLight), rainHeavy: feed(BED_IDS.rainHeavy) };
  }

  update(dtS: number, input: AmbienceInput): void {
    this.weather = input.weather;
    this.heard = input.weather !== null && !input.menuUp;
    this.followWeather(dtS, input.weather);
    this.setBeds(input);
    this.lastMenuUp = input.menuUp;
    this.runRumbles(dtS, input);
  }

  /** The sky flashed: thunder follows after a delay that feels like distance. */
  onLightning(): void {
    if (!this.heard) return;
    const { minDelayS, maxDelayS, farthestDb } = AMBIENCE_CONFIG.thunder;
    const delayS = this.env.random.nextFloat(minDelayS, maxDelayS);
    const gainDb = lerp(0, farthestDb, (delayS - minDelayS) / (maxDelayS - minDelayS));
    this.env.player.play('thunder', { delayS, gainDb, key: 'thunder' });
  }

  /** Fade every bed to silence and forget the weather. */
  clear(): void {
    for (const name of Object.keys(this.beds) as BedName[]) this.beds[name].set(0, AMBIENCE_CONFIG.menuRampS);
    this.weather = null;
    this.bedWeather = null;
    this.heard = false;
    this.rumbleTimerS = null;
    this.calmS = 0;
  }

  /** The beds take a new weather at once from silence or a quiet game, and otherwise at most once per dwell. */
  private followWeather(dtS: number, weather: WeatherState | null): void {
    this.bedWeatherAgeS += dtS;
    if (weather === this.bedWeather) return;
    if (weather !== null && this.bedWeather !== null && this.bedWeatherAgeS < AMBIENCE_CONFIG.minDwellS) return;
    this.bedWeather = weather;
    this.bedWeatherAgeS = 0;
  }

  private targets(input: AmbienceInput): Record<BedName, number> {
    if (input.menuUp || this.bedWeather === null) {
      return { wind: input.menuUp ? AMBIENCE_CONFIG.menuWindLevel : 0, rainLight: 0, rainHeavy: 0 };
    }
    const levels = AMBIENCE_CONFIG.weather[this.bedWeather];
    const calm = input.paused ? AMBIENCE_CONFIG.pausedFactor : 1;
    return {
      wind: clamp(levels.wind * windViewFactor(input.viewDistance), 0, 1) * calm,
      rainLight: levels.rainLight * calm,
      rainHeavy: levels.rainHeavy * calm,
    };
  }

  private setBeds(input: AmbienceInput): void {
    const targets = this.targets(input);
    const rampS = input.menuUp !== this.lastMenuUp || input.menuUp ? AMBIENCE_CONFIG.menuRampS : AMBIENCE_CONFIG.rampS;
    for (const name of Object.keys(this.beds) as BedName[]) this.beds[name].set(targets[name], rampS);
  }

  /**
   * Distant rumbles between flashes, during storms only. The clock counts storm time: it starts at the first
   * storm second (a short wait, so even a brief storm can rumble), stands still through a pause, a menu or a
   * calm gap between two storms, and starts over only after a calm that long that the storm is truly over.
   */
  private runRumbles(dtS: number, input: AmbienceInput): void {
    const config = AMBIENCE_CONFIG.thunder;
    if (this.weather !== 'storm') {
      this.calmS += dtS;
      if (this.calmS >= config.rumbleResetCalmS) this.rumbleTimerS = null;
      return;
    }
    this.calmS = 0;
    if (input.paused || input.menuUp) return;
    this.rumbleTimerS ??= this.env.random.nextFloat(config.rumbleFirstMinS, config.rumbleFirstMaxS);
    this.rumbleTimerS -= dtS;
    if (this.rumbleTimerS > 0) return;
    this.rumbleTimerS = this.env.random.nextFloat(config.rumbleMinIntervalS, config.rumbleMaxIntervalS);
    this.env.player.play('thunder', { gainDb: this.env.random.nextFloat(config.rumbleMinDb, config.rumbleMaxDb), key: 'thunder:rumble' });
  }
}
