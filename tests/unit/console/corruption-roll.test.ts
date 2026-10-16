// #1838 — same-tick bribe rolls draw from independent streams (salted by attempt count).
import { describe, it, expect } from 'vitest';
import { corruptCommand } from '../../../src/console/commands/corruption.js';
import { makeGameContext, type GameContext } from '../../helpers/gameContext.js';
import { Random } from '../../../src/core/math/Random.js';
import { getSuccessRate } from '../../../src/core/economy/Corruption.js';

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

function ctxFor(seed: number, tick = 7): GameContext {
  const ctx = makeGameContext({ seed });
  ctx.state!.tickCount = tick;
  ctx.state!.cash = 100_000_000;
  return ctx;
}

function bribeSequence(seed: number, n: number): { successes: boolean[]; cash: number } {
  const ctx = ctxFor(seed);
  for (let i = 0; i < n; i++) corruptCommand(ctx, [], { target: 'inspector' });
  return { successes: ctx.state!.corruption.attempts.map(a => a.success), cash: ctx.state!.cash };
}

describe('corrupt command — per-attempt roll seed (#1838)', () => {
  it('same-tick repeated bribes include success-after-failure and failure-after-success', () => {
    let failThenSuccess = false;
    let successThenFail = false;
    let allSameEverywhere = true;
    for (const seed of SEEDS) {
      const { successes } = bribeSequence(seed, 6);
      if (new Set(successes).size > 1) allSameEverywhere = false;
      for (let i = 1; i < successes.length; i++) {
        if (!successes[i - 1] && successes[i]) failThenSuccess = true;
        if (successes[i - 1] && !successes[i]) successThenFail = true;
      }
    }
    expect(allSameEverywhere).toBe(false);
    expect(failThenSuccess).toBe(true);
    expect(successThenFail).toBe(true);
  });

  it('is not all-same within a seed for at least one seed', () => {
    expect(SEEDS.some(seed => new Set(bribeSequence(seed, 6).successes).size > 1)).toBe(true);
  });

  it('same seed and sequence replays identical outcomes and cash', () => {
    for (const seed of [1, 5, 12, 33]) {
      expect(bribeSequence(seed, 5)).toEqual(bribeSequence(seed, 5));
    }
  });

  it('a refused call (low cash) leaves attempts unchanged and consumes no salt', () => {
    const ctx = ctxFor(3);
    corruptCommand(ctx, [], { target: 'inspector' });
    const before = ctx.state!.corruption.attempts.length;
    const cash = ctx.state!.cash;
    ctx.state!.cash = 0;
    const res = corruptCommand(ctx, [], { target: 'inspector' });
    expect(res.success).toBe(false);
    expect(ctx.state!.corruption.attempts.length).toBe(before);
    ctx.state!.cash = cash;
    // next accepted call matches a run that never saw the refusal
    corruptCommand(ctx, [], { target: 'inspector' });
    const ref = bribeSequence(3, 2);
    expect(ctx.state!.corruption.attempts.map(a => a.success)).toEqual(ref.successes);
  });

  it('first-call outcome equals the legacy Random(seed + tick) roll', () => {
    for (const seed of SEEDS) {
      const ctx = ctxFor(seed);
      const rate = getSuccessRate(ctx.state!.corruption);
      const expected = new Random(seed + ctx.state!.tickCount).chance(rate);
      corruptCommand(ctx, [], { target: 'inspector' });
      expect(ctx.state!.corruption.attempts[0]!.success).toBe(expected);
    }
  });
});
