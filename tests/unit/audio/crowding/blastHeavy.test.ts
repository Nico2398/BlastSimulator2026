// BlastSimulator2026 — A blast-heavy game: five shots, a big crew, every shot a bounded event
// blast-execution-visual hires 37 people, buys 19 vehicles and fires five blasts, played at 8x. Each shot is the
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

  it('keeps every shot to 42 sounds in twenty seconds', () => {
    // Measured 19, 23, 35, 34 and 11 sounds (a 15 s rain of up to 30 impacts after the four layers, duds and a tail).
    for (const shot of shots()) {
      const timeline = sim().recorder.heard.filter(p => isBlastSound(p.id) && p.id !== 'blast_beep' && p.startS >= shot.startS - 0.01 && p.startS < shot.startS + TIMELINE_S);
      expect(timeline.length).toBeLessThanOrEqual(42);
      expect(peakIn(timeline, 1)).toBeLessThanOrEqual(24); // measured 19: four layers, 10 impacts and 4 pebbles in the first second
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

  it('keeps the busiest second under 26 sounds and 26 voices, the shots and 37 hires included', () => {
    // Measured 23 sounds in a second and 20 voices at once; the engine caps at 32.
    const stats = summarize(sim().recorder.plays, sim().realS);
    expect(stats.maxPerSecond).toBeLessThanOrEqual(26);
    expect(stats.maxVoices).toBeLessThanOrEqual(26);
  });

  it('keeps the world to 5 sounds a second, 18 in ten seconds and 40 in thirty', () => {
    // Measured 4, 14 and 33. vehicle_start reaches 9 because the scripted player buys 19 vehicles back to back and
    // each one starts its engine (the director's answer to a purchase); work_drill and charge_loaded reach 9 too.
    expectWorldWithinBudget(sim(), { per1s: 5, per10s: 18, per30s: 40 }, { vehicle_start: 11, work_drill: 12, charge_loaded: 11, drill_done: 10 });
  });

  it('plays under 100 sounds a minute, a scripted player hiring 37 people included', () => {
    // Measured 79.4 a minute over 280 s at 8x.
    expect(summarize(sim().recorder.plays, sim().realS).totalPerMinute).toBeLessThan(100);
  });
});
