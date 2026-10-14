// BlastSimulator2026 — A blast-heavy game: five shots, a big crew, every shot a bounded event
// blast-execution-visual hires 28 people, buys 19 vehicles and fires five blasts, played at 8x. Each shot is the
// loudest thing in the game by design; what is checked here is that it stays one event: five main layers, a rain
// bounded by its bins, the work around it hushed for a moment, the ambience ducked, and no shot running into the next.

import { beforeAll, describe, expect, it } from 'vitest';
import { isBlastSound, peakIn, summarize } from '../../../helpers/audioCrowdingStats.js';
import { scenarioRun } from './runs.js';
import { expectWorldWithinBudget } from './worldBudget.js';
import { BLAST_AUDIO_CONFIG } from '../../../../src/core/config/audio/game.js';

const SCENARIO = 'blast-execution-visual';
const RUN_TIMEOUT_MS = 90_000;
const TIMELINE_S = 20;
const MAIN_LAYERS = ['blast_snap', 'blast_sub', 'blast_crack', 'blast_boom', 'blast_tail'] as const;

beforeAll(() => {
  scenarioRun(SCENARIO, 8);
}, RUN_TIMEOUT_MS);

const sim = () => scenarioRun(SCENARIO, 8);
const shots = () => sim().recorder.plays.filter(p => p.id === 'blast_snap');

describe(`${SCENARIO} at 8x`, () => {
  it('fires five blasts and plays each main layer once per shot', () => {
    expect(shots()).toHaveLength(5);
    for (const layer of MAIN_LAYERS) expect(sim().recorder.heard.filter(p => p.id === layer), layer).toHaveLength(5);
  });

  it('keeps every shot to 39 sounds in twenty seconds', () => {
    // Measured 15, 13, 30, 27 and 8 sounds (the rain of the rock that moves after the four layers, duds and a tail).
    for (const shot of shots()) {
      const timeline = sim().recorder.heard.filter(p => isBlastSound(p.id) && p.id !== 'blast_beep' && p.startS >= shot.startS - 0.01 && p.startS < shot.startS + TIMELINE_S);
      expect(timeline.length).toBeLessThanOrEqual(39);
      expect(peakIn(timeline, 1)).toBeLessThanOrEqual(20); // measured 15 at most in any one second of any shot
    }
  });

  it('never lets a shot run into the next', () => {
    const starts = shots().map(p => p.startS);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThan(10);
  });

  it('hushes the work around a shot and ducks the ambience under it', () => {
    const work = sim().recorder.heard.filter(p => p.id.startsWith('work_'));
    for (const shot of shots()) {
      expect(work.filter(p => p.startS > shot.startS && p.startS < shot.startS + BLAST_AUDIO_CONFIG.workSuppressS - 0.1)).toEqual([]);
    }
    // Two ducks per shot: the pre-roll as it arms, then the heavy one under the shot. Measured 5 shots, 10 ducks.
    expect(sim().recorder.ducks.filter(d => d.bus === 'ambient').length).toBeGreaterThanOrEqual(shots().length * 2);
  });

  it('keeps the busiest second under 22 sounds and 17 voices, the shots and 28 hires included', () => {
    // Measured 17 sounds in a second and 13 voices at once; the engine caps at 32.
    const stats = summarize(sim().recorder.plays, sim().realS);
    expect(stats.maxPerSecond).toBeLessThanOrEqual(22);
    expect(stats.maxVoices).toBeLessThanOrEqual(17);
  });

  it('keeps the world to 5 sounds a second, 17 in ten seconds and 38 in thirty', () => {
    // Measured 4, 13 and 32. vehicle_start reaches 7, drill_done and charge_loaded 9, because the scripted player buys 19 vehicles back
    // to back (each one starts its engine, the director's answer to a purchase), drills and charges holes in bulk (blasters now hold the truck licence, #1667, so the second pattern is drilled and charged sooner after the first shot); vehicle_scrap
    // reaches 4 because flyrock destroys vehicles in two shots 27 s apart, two scrap cues from each (the blast plan's cap).
    expectWorldWithinBudget(sim(), { per1s: 5, per10s: 17, per30s: 38 }, { drill_done: 9, charge_loaded: 9, vehicle_scrap: 4 });
  });

  it('plays under 97 sounds a minute, a scripted player hiring 28 people included', () => {
    // Measured 74.4 a minute over 280 s at 8x.
    expect(summarize(sim().recorder.plays, sim().realS).totalPerMinute).toBeLessThan(97);
  });
});
