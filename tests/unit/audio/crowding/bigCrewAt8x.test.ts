// BlastSimulator2026 — A big crew at 8x does not turn the mine into a wall of acknowledgements
// The opening of level3-playthrough-win hires ten people, buys five vehicles, builds, drills and charges two dozen
// holes. Played at 8x, holes and charges finish a real second apart, which is where an acknowledgement per
// finished job used to pile up: before the real-time spacing of drill and charge acknowledgements, collapses
// and vehicle starts, this game asked for 17 drill_done and 18 charge_loaded in thirty seconds (1x: 8 and 5).

import { beforeAll, describe, expect, it } from 'vitest';
import { summarize } from '../../../helpers/audioCrowdingStats.js';
import { scenarioRun } from './runs.js';
import { expectWorldWithinBudget, worldPlays } from './worldBudget.js';

const SCENARIO = 'level3-playthrough-win';
const RUN_TIMEOUT_MS = 90_000;
/** The opening of the game: hiring, buying, building, drilling and charging. The win comes much later. */
const OPENING_S = 100;

beforeAll(() => {
  scenarioRun(SCENARIO, 8, OPENING_S);
}, RUN_TIMEOUT_MS);

describe(`${SCENARIO} at 8x`, () => {
  it('keeps the world to 3 sounds a second, 12 in ten seconds, 30 in thirty', () => {
    // Measured 2, 9 and 23. Command cues (ten hires in a row, five purchases) are the player's own and not counted.
    expectWorldWithinBudget(scenarioRun(SCENARIO, 8, OPENING_S), { per1s: 3, per10s: 12, per30s: 30 });
  });

  it('plays under 60 sounds a minute and 8 voices at once, commands included', () => {
    // Measured 37.3 a minute over the 138 s opening (the scripted player issues its orders back to back) and 3 voices.
    const stats = summarize(scenarioRun(SCENARIO, 8, OPENING_S).recorder.plays, scenarioRun(SCENARIO, 8, OPENING_S).realS);
    expect(stats.totalPerMinute).toBeLessThan(60);
    expect(stats.maxVoices).toBeLessThanOrEqual(8);
  });

  it('keeps the world audible: a long game is not silent', () => {
    // Measured 53 world sounds in the 138 s opening.
    expect(worldPlays(scenarioRun(SCENARIO, 8, OPENING_S)).length).toBeGreaterThan(30);
  });
});
