// BlastSimulator2026 — tier progression inside the tick: automatic tier-ups and the tier perks they unlock (#2277)

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { CONTRACTS_PER_REFRESH } from '../../../src/core/config/balance.js';
import { gradeRung } from '../../../src/core/economy/MineGrade.js';
import { meetTargets, tierTargets, perkTotals } from '../../helpers/gradeLadder.js';

function sandbox(args = '') {
  const { runner, ctx } = createRunner();
  const started = runner.run(`sandbox start biome:desert_badlands seed:42 ${args}`.trim());
  expect(started.success, started.output).toBe(true);
  ctx.state!.events.eventFreqMultiplier = 0;
  return { runner, ctx, state: ctx.state! };
}

/** Empties the board so the next tick refreshes it, ticks once, and counts the offers the refresh posted. */
function offersPerRefresh(args: string): number {
  const { runner, state } = sandbox(args);
  state.contracts.available = [];
  state.contracts.lastRefreshTick = state.tickCount - 10_000;
  runner.run('tick 1');
  return state.contracts.available.length;
}

describe('automatic tier-up in the tick (#2277)', () => {
  it('raises the tier on the tick after the targets are met and emits progression:tier_up', () => {
    const { runner, ctx, state } = sandbox();
    const seen: { grade: number; tier: number }[] = [];
    ctx.emitter.on('progression:tier_up', e => seen.push(e));
    meetTargets(state, tierTargets(0, 1));
    runner.run('tick 1');
    expect(state.grade!.tier).toBe(2);
    expect(seen).toEqual([{ grade: 0, tier: 2 }]);
  });

  it('does not raise the tier while a target is unmet', () => {
    const { runner, state } = sandbox();
    const need = tierTargets(0, 1)[0]!;
    state.grade!.oreDeliveredKg = need.value - 1;
    runner.run('tick 3');
    expect(state.grade!.tier).toBe(1);
  });

  it('keeps going to tier 3 when the counters already cover tier 2', () => {
    const { runner, state } = sandbox();
    meetTargets(state, tierTargets(0, 3));
    runner.run('tick 1');
    expect(state.grade!.tier).toBe(3);
    expect(state.grade!.grade).toBe(0);
  });

  it('never goes past tier 3 and never raises the grade by itself', () => {
    const { runner, state } = sandbox();
    meetTargets(state, tierTargets(0, 3));
    runner.run('tick 5');
    expect(state.grade!.tier).toBe(3);
    expect(state.grade!.grade).toBe(0);
    expect(state.grade!.pending).toBeNull();
  });

  it('a site started at a class grade stays at tier 1 however much it has', () => {
    const { runner, state } = sandbox('grade:4');
    state.grade!.oreDeliveredKg = 1e12;
    state.grade!.rockBrokenM3 = 1e12;
    runner.run('tick 3');
    expect(state.grade!.tier).toBe(1);
  });
});

describe('tier perks in the tick (#2277)', () => {
  it('a fresh site posts the base number of offers per refresh', () => {
    expect(offersPerRefresh('')).toBe(CONTRACTS_PER_REFRESH);
  });

  it.each([[1, 2], [1, 3], [2, 3], [3, 3]])('grade %i tier %i posts the base offers plus its perk', (grade, tier) => {
    const rung = gradeRung({ grade, tier });
    expect(offersPerRefresh(`grade:${grade} tier:${tier}`)).toBe(CONTRACTS_PER_REFRESH + perkTotals(rung).contract_offers);
  });

  it('the last named step posts more offers than the first', () => {
    expect(offersPerRefresh('grade:3 tier:3')).toBeGreaterThan(offersPerRefresh(''));
  });
});
