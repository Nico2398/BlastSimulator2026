// BlastSimulator2026 — blast records its charge share of the permit cap for the petition event (#1927)

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { fundForDeliveryWait } from '../../helpers/playthrough.js';

const SEED = 42;

/** Sandbox site with a 3x3 pattern drilled and charged at `kgPerHole`, ready to fire. */
function loadedSite(kgPerHole: number) {
  const { runner, ctx } = createRunner();
  const run = (c: string) => runner.run(c);
  expect(run(`sandbox start biome:desert_badlands difficulty:normal seed:${SEED}`).success).toBe(true);
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0;
  const refresh = () => {
    fundForDeliveryWait(state);
    for (const e of state.employees.employees) e.fatigue = 100;
  };
  refresh();
  expect(run('drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:36,30').success).toBe(true);
  expect(run(`charge hole:* explosive:krackle amount:${kgPerHole} stemming:2`).success).toBe(true);
  for (let i = 0; i < 5000 && !(state.drillHoles.length === 9 && Object.keys(state.chargesByHole).length === 9); i++) {
    refresh();
    run('tick 1');
  }
  expect(state.drillHoles).toHaveLength(9);
  state.cash = 100_000;
  return { run, state };
}

describe('blast records the charge share (#1927)', () => {
  it('starts at 0 before any blast', () => {
    const { state } = loadedSite(4);
    expect(state.grade!.lastBlastChargeShare).toBe(0);
  });

  it('within the limit: 36 kg against the 40 kg grade-0 cap is 0.9', () => {
    const { run, state } = loadedSite(4);
    expect(run('blast').success).toBe(true);
    expect(state.grade!.lastBlastChargeShare).toBeCloseTo(0.9, 5);
  });

  it('over the limit: 45 kg against 40 kg is 1.125', () => {
    const { run, state } = loadedSite(5);
    expect(run('blast').success).toBe(true);
    expect(state.grade!.lastBlastChargeShare).toBeCloseTo(1.125, 5);
  });

  it('feeds the event context after the blast', async () => {
    const { buildTickEventContext } = await import('../../../src/core/engine/TickEventContext.js');
    const { run, state } = loadedSite(4);
    run('blast');
    const ctx = buildTickEventContext(state);
    expect(ctx.hasProgression).toBe(true);
    expect(ctx.lastBlastChargeShare).toBeCloseTo(0.9, 5);
    expect(ctx.applicationPending).toBe(false);
  });
});

describe('applicationPending in the event context (#1927)', () => {
  it('is true while an application is being processed', async () => {
    const { buildTickEventContext } = await import('../../../src/core/engine/TickEventContext.js');
    const { state } = loadedSite(4);
    state.grade!.pending = { toGrade: 1, ticksLeft: 30 };
    expect(buildTickEventContext(state).applicationPending).toBe(true);
  });
});
