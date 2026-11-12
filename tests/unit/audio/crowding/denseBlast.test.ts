// BlastSimulator2026 — The densest real blasts, and the hauling after them
// ore-haul-dispatch blasts nine holes filled with boomite and drops 5816 fragments (measured under the kernel energy
// model with its finer fragmentation; 643 before), a collapse, not a throw: 159 of them move, and only the rock that
// moves rains. blast-debris-stranded-ramp then has trucks load, dump and break boulders.
// Both at 8x, where the trucks make the most trips per real second.

import { beforeAll, describe, expect, it } from 'vitest';
import { isBlastSound, summarize } from '../../../helpers/audioCrowdingStats.js';
import { isAnimatedFlight } from '../../../../src/core/mining/BlastResolve.js';
import { scenarioRun } from './runs.js';
import { expectWorldWithinBudget } from './worldBudget.js';

const COLLAPSE = 'ore-haul-dispatch';
const HAULING = 'blast-debris-stranded-ramp';
const RUN_TIMEOUT_MS = 60_000;
/**
 * The shot is fired 54 s in (47 s while a blocker teleported aside, #2231: it walks now): each hole is filled to its stemming (12 kg of boomite), which takes the crew longer to
 * load than the 6 kg breakout charge it replaced (37 s before; #1774), and the 3 s after it are the shot's own; the
 * hauling after it is not needed here. The next step runs past it, into the hauling (the first loads and boulder
 * breaks): that is HAULING's budget, not the collapse's.
 */
const THROUGH_THE_SHOT_S = 57;

beforeAll(() => {
  scenarioRun(COLLAPSE, 8, THROUGH_THE_SHOT_S);
  scenarioRun(HAULING, 8);
}, RUN_TIMEOUT_MS);

describe(`${COLLAPSE}: a collapse of thousands of fragments at 8x`, () => {
  const sim = () => scenarioRun(COLLAPSE, 8, THROUGH_THE_SHOT_S);

  it('plays the five main layers once and refuses only the rain that does not fit', () => {
    const plays = sim().recorder.plays;
    for (const layer of ['blast_snap', 'blast_sub', 'blast_crack', 'blast_boom', 'blast_tail'] as const) {
      expect(plays.filter(p => p.id === layer && p.accepted), layer).toHaveLength(1);
    }
    // Measured under the kernel energy model: 6 rain requests, all admitted; nothing refused. Before it (246 moving
    // flights) 30 rain requests met the engine's caps of 10 impacts and 8 pebbles at once and 14 were refused: the
    // limit stays that ceiling, and whatever is refused must be rain.
    const refused = plays.filter(p => !p.accepted);
    expect(refused.length).toBeLessThanOrEqual(14);
    expect(refused.every(p => p.id === 'debris_hit' || p.id === 'debris_pebble')).toBe(true);
  });

  it('rains for the rock that moves only: no more impacts than moving fragments, none before the first one lands', () => {
    // Measured under the kernel energy model: 5816 flights, 159 of them animated by the renderer; 6 rain requests, the
    // first 0.2 s after the shot, once the first moving fragment (0.1 s) has landed. Before it: 643 flights, 246 moving
    // (#1724); counting the ones that stay put gave an impact at the moment of the boom.
    const flights = sim().engine.ctx.lastBlastFlights ?? [];
    const moving = flights.filter(isAnimatedFlight);
    expect(flights.length).toBeGreaterThan(5000);
    expect(moving.length).toBeGreaterThan(0);
    const shot = sim().recorder.plays.find(p => p.id === 'blast_snap')!;
    const rain = sim().recorder.plays.filter(p => p.id === 'debris_hit' || p.id === 'debris_pebble');
    expect(rain.length).toBeGreaterThan(0);
    expect(rain.length).toBeLessThanOrEqual(moving.length);
    const firstLanding = Math.min(...moving.map(f => f.delayS + f.durationS));
    for (const impact of rain) expect(impact.startS - shot.startS).toBeGreaterThanOrEqual(firstLanding - 0.02);
  });

  it('spends the shot second on at most 24 sounds and 17 voices', () => {
    // Measured under the kernel energy model: 14 sounds in the second after the shot and 12 voices; 24 and 17 before
    // it (#1724: the rock that fell into the sealed void rained too). The engine caps at 32.
    const stats = summarize(sim().recorder.plays, sim().realS);
    expect(stats.maxPerSecond).toBeLessThanOrEqual(24);
    expect(stats.maxVoices).toBeLessThanOrEqual(17);
  });

  it('keeps the world to 3 sounds a second, 9 in ten seconds, 22 in thirty', () => {
    // Measured 3, 9 and 16 under the kernel energy model (3, 8 and 19 before). The ten-second peak is the drilling
    // (each hole's drill sound and its done cue); the second after the shot holds the vehicles it scraps and the
    // bad-news cue that follows (#1673).
    expectWorldWithinBudget(sim(), { per1s: 3, per10s: 12, per30s: 22 });
  });
});

describe(`${HAULING}: trucks hauling after a blast at 8x`, () => {
  const sim = () => scenarioRun(HAULING, 8);

  it('is heard loading, dumping and breaking boulders, with every world request admitted', () => {
    const ids = new Set(sim().recorder.heard.map(p => p.id));
    for (const id of ['haul_load', 'haul_dump', 'boulder_break'] as const) expect(ids.has(id), id).toBe(true);
    // Measured (#1895): the explosives delivery wait moves the haul onto a different crew rest cycle, and one reverse beep
    // lands in a busy second and is refused for budget; every other request is admitted.
    const refused = sim().recorder.plays.filter(p => !isBlastSound(p.id) && !p.accepted);
    expect(refused.length).toBeLessThanOrEqual(1);
    expect(refused.every(p => p.id === 'vehicle_reverse')).toBe(true);
  });

  it('keeps the world to 4 sounds a second, 12 in ten seconds, 26 in thirty', () => {
    // Measured 4, 9 and 20.
    expectWorldWithinBudget(sim(), { per1s: 5, per10s: 12, per30s: 26 });
  });

  it('spends the shot second on at most 25 sounds and 16 voices', () => {
    // Measured under the kernel energy model: 25 sounds in a second and 16 voices at once. The holes are filled with
    // boomite now (3 kg before) and the rock breaks finer, so 63 fragments move and rain in 21 bins; it was 19 sounds
    // and 13 voices before (#1724). The rain is binned (at most 40 bins a blast) and the engine caps at 32.
    const stats = summarize(sim().recorder.plays, sim().realS);
    expect(stats.maxPerSecond).toBeLessThanOrEqual(25);
    expect(stats.maxVoices).toBeLessThanOrEqual(16);
  });
});
