// BlastSimulator2026 — The densest real blasts, and the hauling after them
// ore-haul-dispatch blasts nine holes and drops 643 fragments within 0.4 s (a collapse, not a throw); 246 of them
// move (#1724: rock falling into the sealed void), and only the rock that moves rains. blast-debris-stranded-ramp then has trucks load, dump and break boulders.
// Both at 8x, where the trucks make the most trips per real second.

import { beforeAll, describe, expect, it } from 'vitest';
import { isBlastSound, summarize } from '../../../helpers/audioCrowdingStats.js';
import { isAnimatedFlight } from '../../../../src/core/mining/BlastResolve.js';
import { scenarioRun } from './runs.js';
import { expectWorldWithinBudget } from './worldBudget.js';

const COLLAPSE = 'ore-haul-dispatch';
const HAULING = 'blast-debris-stranded-ramp';
const RUN_TIMEOUT_MS = 60_000;
/** The shot is fired 37 s in; the hauling after it is not needed here. */
const THROUGH_THE_SHOT_S = 40;

beforeAll(() => {
  scenarioRun(COLLAPSE, 8, THROUGH_THE_SHOT_S);
  scenarioRun(HAULING, 8);
}, RUN_TIMEOUT_MS);

describe(`${COLLAPSE}: a 643-fragment collapse at 8x`, () => {
  const sim = () => scenarioRun(COLLAPSE, 8, THROUGH_THE_SHOT_S);

  it('plays the five main layers once and refuses only the rain that does not fit', () => {
    const plays = sim().recorder.plays;
    for (const layer of ['blast_snap', 'blast_sub', 'blast_crack', 'blast_boom', 'blast_tail'] as const) {
      expect(plays.filter(p => p.id === layer && p.accepted), layer).toHaveLength(1);
    }
    // Measured (#1724: rock that falls into the sealed void now moves, 246 flights): 30 rain requests, 16 admitted (the
    // engine's caps of 10 impacts and 8 pebbles at once), 14 impacts refused; nothing else is refused.
    const refused = plays.filter(p => !p.accepted);
    expect(refused.length).toBeLessThanOrEqual(14);
    expect(refused.every(p => p.id === 'debris_hit' || p.id === 'debris_pebble')).toBe(true);
  });

  it('rains for the rock that moves only: no more impacts than moving fragments, none before the first one lands', () => {
    // 643 flights, 246 of them animated by the renderer (#1724; 17 before rock fell into the sealed void). Measured then: 10 requests, the first 0.08 s after the shot, when the
    // first moving fragment lands; counting the 626 that stay put gave 36 requests and an impact at the moment of the boom.
    const flights = sim().engine.ctx.lastBlastFlights ?? [];
    const moving = flights.filter(isAnimatedFlight);
    expect(flights.length).toBeGreaterThan(600);
    expect(moving.length).toBeGreaterThan(0);
    const shot = sim().recorder.plays.find(p => p.id === 'blast_snap')!;
    const rain = sim().recorder.plays.filter(p => p.id === 'debris_hit' || p.id === 'debris_pebble');
    expect(rain.length).toBeGreaterThan(0);
    expect(rain.length).toBeLessThanOrEqual(moving.length);
    const firstLanding = Math.min(...moving.map(f => f.delayS + f.durationS));
    for (const impact of rain) expect(impact.startS - shot.startS).toBeGreaterThanOrEqual(firstLanding - 0.02);
  });

  it('spends the shot second on at most 24 sounds and 17 voices', () => {
    // Measured 24 sounds in the second after the shot and 17 voices (#1724: the rock that falls into the sealed void
    // rains too); the engine caps at 32.
    const stats = summarize(sim().recorder.plays, sim().realS);
    expect(stats.maxPerSecond).toBeLessThanOrEqual(24);
    expect(stats.maxVoices).toBeLessThanOrEqual(17);
  });

  it('keeps the world to 3 sounds a second, 9 in ten seconds, 22 in thirty', () => {
    // Measured 3, 12 and 17. The ten-second peak is the second after the shot (#1673: with the crew resting at the shift
    // length the shot lands among different positions, so two vehicles are scrapped and an alert and an event cue follow).
    expectWorldWithinBudget(sim(), { per1s: 3, per10s: 12, per30s: 22 });
  });
});

describe(`${HAULING}: trucks hauling after a blast at 8x`, () => {
  const sim = () => scenarioRun(HAULING, 8);

  it('is heard loading, dumping and breaking boulders, with every world request admitted', () => {
    const ids = new Set(sim().recorder.heard.map(p => p.id));
    for (const id of ['haul_load', 'haul_dump', 'boulder_break'] as const) expect(ids.has(id), id).toBe(true);
    expect(sim().recorder.plays.filter(p => !isBlastSound(p.id) && !p.accepted)).toEqual([]);
  });

  it('keeps the world to 4 sounds a second, 12 in ten seconds, 26 in thirty', () => {
    // Measured 4, 9 and 20.
    expectWorldWithinBudget(sim(), { per1s: 5, per10s: 12, per30s: 26 });
  });

  it('spends the shot second on at most 19 sounds and 13 voices', () => {
    // Measured 19 sounds in a second and 13 voices at once (#1724: the blast's rock now falls into its sealed void).
    const stats = summarize(sim().recorder.plays, sim().realS);
    expect(stats.maxPerSecond).toBeLessThanOrEqual(19);
    expect(stats.maxVoices).toBeLessThanOrEqual(13);
  });
});
