// BlastSimulator2026 — Integration test: union events obey the same player-activity gate (#1996)
//
// Since #1907 union events skipped MIN_EVENT_INTERVAL_ACTIONS, so a player who only watches got
// ~90% union events while every other category scaled with how many commands were sent. With one
// activity rule for every category the union share stays moderate at any activity level.
// A player who sends no command at all gets no event of any category (the shared gate), so the
// "light" player below issues one read-only command per LIGHT_CLICK_EVERY ticks.
// Measured (6 seeds, 3000 ticks): union share 0.50 at every 250 / 120 / 60 ticks, 0.30 at every 15.

import { describe, it, expect } from 'vitest';
import { createRunner, runCommand } from '../../src/console/createRunner.js';
import { getEventById } from '../../src/core/events/EventPool.js';

const TICKS = 3000;
const LIGHT_CLICK_EVERY = 250;
const SEEDS = [42, 7, 1234, 99, 2024, 5];

interface Mix { total: number; union: number }

/** Play `TICKS` ticks; option 0 on every event; optionally one read-only command per `clickEvery` ticks. */
function playMix(seed: number, clickEvery: number | null): Mix {
  const engine = createRunner();
  runCommand(engine, `new_game mine_type:desert_badlands seed:${seed} size:32 staffed:true cash:5000000`);
  const s = engine.ctx.state!;
  let total = 0;
  let union = 0;
  for (let tick = 1; tick <= TICKS; tick++) {
    if (clickEvery !== null && tick % clickEvery === 0) runCommand(engine, 'employee list');
    runCommand(engine, 'tick 1');
    if (s.events.pendingEvent) {
      total++;
      if (getEventById(s.events.pendingEvent.eventId)?.category === 'union') union++;
      runCommand(engine, 'event choose 0');
      if (s.events.lastOutcome) runCommand(engine, 'event dismiss');
    }
  }
  return { total, union };
}

function share(clickEvery: number | null): { share: number; mix: Mix } {
  const mix: Mix = { total: 0, union: 0 };
  for (const seed of SEEDS) {
    const m = playMix(seed, clickEvery);
    mix.total += m.total;
    mix.union += m.union;
  }
  return { share: mix.total === 0 ? 0 : mix.union / mix.total, mix };
}

describe('event pacing: one activity rule for every category (#1996)', () => {
  const lightClicker = share(LIGHT_CLICK_EVERY);

  it('a light-clicking player does not get an event mix dominated by union events', () => {
    expect(lightClicker.mix.total).toBeGreaterThan(0);
    expect(lightClicker.share).toBeLessThan(0.75);
  }, 120_000);

  it('the union share of events is about equal for a light and a moderately clicking player', () => {
    const clicking = share(60);
    expect(clicking.mix.total).toBeGreaterThan(0);
    expect(Math.abs(lightClicker.share - clicking.share)).toBeLessThan(0.2);
  }, 240_000);
});
