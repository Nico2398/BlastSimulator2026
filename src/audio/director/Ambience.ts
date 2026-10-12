// BlastSimulator2026 — Ambience
// The weather beds (wind, light and heavy rain), thunder and the way a pause or
// a menu quiets them. Beds follow the weather by cross-fading over a few
// seconds; behind a full-screen menu everything fades away except a very quiet
// wind, so the menu is not dead. Thunder follows the sky: a lightning flash
// brings a clap after a delay that feels like distance, and storms add distant
// rumbles between flashes.

import type { LoopHandle } from '../AudioPlayer.js';
import type { LoopId } from '../SoundCatalog.js';
import type { WeatherState } from '../../core/weather/WeatherCycle.js';
import { AMBIENCE_CONFIG } from '../../core/config/audio/game.js';
import { clamp } from '../engine/units.js';
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
  private readonly beds: Record<BedName, LoopHandle>;
  private readonly sent: Record<BedName, number> = { wind: 0, rainLight: 0, rainHeavy: 0 };
  private weather: WeatherState | null = null;
  private heard = false;
  private rumbleTimerS: number | null = null;
  private lastMenuUp = false;

  constructor(private readonly env: DirectorEnv) {
    const { player } = env;
    this.beds = { wind: player.loop(BED_IDS.wind), rainLight: player.loop(BED_IDS.rainLight), rainHeavy: player.loop(BED_IDS.rainHeavy) };
  }

  update(dtS: number, input: AmbienceInput): void {
    this.weather = input.weather;
    this.heard = input.weather !== null && !input.menuUp;
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
    for (const name of Object.keys(this.beds) as BedName[]) this.send(name, 0, AMBIENCE_CONFIG.menuRampS);
    this.weather = null;
    this.heard = false;
    this.rumbleTimerS = null;
  }

  private targets(input: AmbienceInput): Record<BedName, number> {
    if (input.menuUp || input.weather === null) {
      return { wind: input.menuUp ? AMBIENCE_CONFIG.menuWindLevel : 0, rainLight: 0, rainHeavy: 0 };
    }
    const levels = AMBIENCE_CONFIG.weather[input.weather];
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
    for (const name of Object.keys(this.beds) as BedName[]) this.send(name, targets[name], rampS);
  }

  private send(name: BedName, level: number, rampS: number): void {
    const reachedSilence = level === 0 && this.sent[name] !== 0;
    if (!reachedSilence && Math.abs(level - this.sent[name]) < AMBIENCE_CONFIG.epsilon) return;
    this.sent[name] = level;
    this.beds[name].setLevel(level, rampS);
  }

  /** Distant rumbles between flashes, during storms only. */
  private runRumbles(dtS: number, input: AmbienceInput): void {
    const config = AMBIENCE_CONFIG.thunder;
    if (this.weather !== 'storm' || input.paused || input.menuUp) {
      this.rumbleTimerS = null;
      return;
    }
    this.rumbleTimerS ??= this.env.random.nextFloat(config.rumbleMinIntervalS, config.rumbleMaxIntervalS);
    this.rumbleTimerS -= dtS;
    if (this.rumbleTimerS > 0) return;
    this.rumbleTimerS = this.env.random.nextFloat(config.rumbleMinIntervalS, config.rumbleMaxIntervalS);
    this.env.player.play('thunder', { gainDb: this.env.random.nextFloat(config.rumbleMinDb, config.rumbleMaxDb), key: 'thunder:rumble' });
  }
}
