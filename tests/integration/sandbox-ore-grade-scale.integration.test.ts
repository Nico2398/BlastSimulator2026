// Ore grade scale lever through the real console runner (#1932).
//
// `sandbox start ... ore_grade:0.2` leaves the same rock (same voxels, same
// fragments, same mass) but a fifth of the ore grade, so the blast report
// shows about a fifth of the ore value.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { EXPLOSIVE_DELIVERY_TICKS } from '../../src/core/config/balance.js';
import { fundForDeliveryWait } from '../helpers/playthrough.js';

const SEED = 42;
const SHOT_START = '36,30';
const SCALE = 0.2;

function refresh(state: GameState): void {
  fundForDeliveryWait(state);
  for (const e of state.employees.employees) e.fatigue = 100;
}

function tickWhile(run: (c: string) => unknown, state: GameState, until: () => boolean, max: number): void {
  for (let n = 0; n < max && !until(); n++) { refresh(state); run('tick 1'); }
}

function openingBlast(extra: string) {
  const { runner, ctx } = createRunner();
  const run = (c: string) => runner.run(c);
  expect(run(`sandbox start biome:desert_badlands seed:${SEED} kit:digger${extra}`)).toMatchObject({ success: true });
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0;
  refresh(state);
  expect(run(`drill_plan grid rows:3 cols:3 spacing:4 depth:6 start:${SHOT_START}`)).toMatchObject({ success: true });
  tickWhile(run, state, () => state.plannedDrillHoles.length === 0, 1500);
  expect(run('charge hole:* explosive:krackle amount:6 stemming:2')).toMatchObject({ success: true });
  tickWhile(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, EXPLOSIVE_DELIVERY_TICKS + 1500);
  expect(run('blast detonate')).toMatchObject({ success: true });
  tickWhile(run, state, () => state.lastBlastReport !== null, 600);
  expect(state.lastBlastReport).not.toBeNull();
  const oreSum = state.logistics.fragments.reduce(
    (a, f) => a + Object.values(f.fragment.oreDensities).reduce((x, y) => x + y, 0), 0);
  return { report: state.lastBlastReport!, oreSum };
}

describe('ore grade scale: standard opening blast (#1932)', () => {
  let base: ReturnType<typeof openingBlast>;
  let scaled: ReturnType<typeof openingBlast>;
  beforeAll(() => {
    base = openingBlast('');
    scaled = openingBlast(` ore_grade:${SCALE}`);
  }, 600_000);

  it('the default site yields ore from the opening shot', () => {
    expect(base.report.totalOreValue).toBeGreaterThan(0);
  });

  it('the scaled site yields about a fifth of the ore value', () => {
    expect(scaled.report.totalOreValue / base.report.totalOreValue).toBeGreaterThan(SCALE * 0.8);
    expect(scaled.report.totalOreValue / base.report.totalOreValue).toBeLessThan(SCALE * 1.2);
  });

  it('the fragments carry about a fifth of the summed ore density', () => {
    expect(scaled.oreSum / base.oreSum).toBeGreaterThan(SCALE * 0.8);
    expect(scaled.oreSum / base.oreSum).toBeLessThan(SCALE * 1.2);
  });

  it('fragment count and rock mass are unchanged', () => {
    expect(scaled.report.fragmentCount).toBe(base.report.fragmentCount);
    expect(scaled.report.totalRockVolume).toBeCloseTo(base.report.totalRockVolume, 9);
    expect(scaled.report.clearedVoxels).toBe(base.report.clearedVoxels);
  });
});
