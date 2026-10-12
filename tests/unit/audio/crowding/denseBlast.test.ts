// BlastSimulator2026 — The densest real blasts, and the hauling after them
// ore-haul-dispatch blasts nine holes and drops 643 fragments within 0.4 s (a collapse, not a throw), the densest
// debris rain the scenarios produce. blast-debris-stranded-ramp then has trucks load, dump and break boulders.
// Both at 8x, where the trucks make the most trips per real second.

import { beforeAll, describe, expect, it } from 'vitest';
import { isBlastSound, summarize } from '../../../helpers/audioCrowdingStats.js';
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
    // Measured: 36 rain requests, 18 admitted (10 impacts and 8 pebbles: the engine's caps); nothing else is refused.
    const refused = plays.filter(p => !p.accepted);
    expect(refused.every(p => p.id === 'debris_hit' || p.id === 'debris_pebble')).toBe(true);
  });

  it('spends the shot second on at most 26 sounds and 26 voices', () => {
    // Measured 24 sounds in the second after the shot and 23 voices; the engine caps at 32.
    const stats = summarize(sim().recorder.plays, sim().realS);
    expect(stats.maxPerSecond).toBeLessThanOrEqual(26);
    expect(stats.maxVoices).toBeLessThanOrEqual(26);
  });

  it('keeps the world to 3 sounds a second, 10 in ten seconds, 20 in thirty', () => {
    // Measured 2, 7 and 15.
    expectWorldWithinBudget(sim(), { per1s: 3, per10s: 10, per30s: 20 });
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
    // Measured 3, 7 and 18.
    expectWorldWithinBudget(sim(), { per1s: 4, per10s: 12, per30s: 26 });
  });

  it('spends the shot second on at most 26 sounds and 26 voices', () => {
    // Measured 21 sounds in a second and 20 voices at once.
    const stats = summarize(sim().recorder.plays, sim().realS);
    expect(stats.maxPerSecond).toBeLessThanOrEqual(26);
    expect(stats.maxVoices).toBeLessThanOrEqual(26);
  });
});
