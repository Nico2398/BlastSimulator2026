// BlastSimulator2026 — Blast mix scenario
// Heavy rain and wind, the evacuation siren with its quickening beeps, the shot
// (planned by the game's own blast planner, ambience ducked as the blast director
// does it) and the long tail of debris falling.

import type { Random } from '../../core/math/Random.js';
import { AMBIENCE_CONFIG, BLAST_AUDIO_CONFIG, SIREN_CONFIG } from '../../core/config/audio/game.js';
import { LAB_BLAST_SCENARIO as PLAN, LAB_RENDER_CONFIG } from '../../core/config/audio/lab.js';
import { planBlast } from '../director/blastPlan.js';
import type { MixScenario } from './mixTypes.js';
import { syntheticBlast } from './syntheticBlast.js';
import { TimelineBuilder } from './timeline.js';

/** Evacuation beeps from `from` to `to`: the gap closes from slow to fast, the pitch rises as it does. */
function addBeeps(builder: TimelineBuilder, fromS: number, toS: number): void {
  const span = toS - fromS;
  for (let t = fromS; t < toS;) {
    const progress = (t - fromS) / span;
    builder.play(t, 'blast_beep', { pitchCents: progress * SIREN_CONFIG.maxPitchRiseCents });
    t += SIREN_CONFIG.slowIntervalS + (SIREN_CONFIG.fastIntervalS - SIREN_CONFIG.slowIntervalS) * progress;
  }
}

export function buildBlastScenario(random: Random): MixScenario {
  const builder = new TimelineBuilder();
  const rain = AMBIENCE_CONFIG.weather.heavy_rain;
  builder
    .loop(0, 'amb_wind', Math.max(rain.wind, PLAN.windLevel), PLAN.bedRampS)
    .loop(0, 'amb_rain_heavy', PLAN.rainLevel, PLAN.bedRampS)
    .loop(PLAN.sirenOnS, 'blast_siren', 1, SIREN_CONFIG.rampInS);
  addBeeps(builder, PLAN.firstBeepS, PLAN.lastBeepS);
  builder
    .loop(PLAN.sirenOffS, 'blast_siren', 0, SIREN_CONFIG.rampOutS)
    .duck(PLAN.sirenOffS, 'ambient', BLAST_AUDIO_CONFIG.preRollDuck.amountDb, BLAST_AUDIO_CONFIG.preRollDuck.holdS, BLAST_AUDIO_CONFIG.preRollDuck.releaseS)
    .duck(PLAN.blastS, 'ambient', BLAST_AUDIO_CONFIG.duck.amountDb, BLAST_AUDIO_CONFIG.duck.holdS, BLAST_AUDIO_CONFIG.duck.releaseS);
  let lastS: number = PLAN.blastS;
  for (const cue of planBlast(syntheticBlast(random), 0, random)) {
    builder.play(PLAN.blastS + cue.atS, cue.sound, cue.options);
    lastS = Math.max(lastS, PLAN.blastS + cue.atS);
  }
  return {
    name: 'blast',
    title: 'Blast: siren, countdown, shot, debris rain',
    durationS: lastS + LAB_RENDER_CONFIG.tailS,
    listener: LAB_RENDER_CONFIG.listener,
    events: builder.build(),
  };
}
