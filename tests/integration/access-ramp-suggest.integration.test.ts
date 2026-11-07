// BlastSimulator2026 — Integration: the suggested access ramp into the opening crater (#2144).
//
// The menu-default sandbox fires the standard opening 3x3 shot. Its crater floor lies below every road, so the
// rubble waits `debris_out_of_reach`. The game proposes a ramp (`build_ramp suggest`); it orders, pays and digs
// nothing until the player says so (`build_ramp suggest order`). Everything is driven through console commands.

import { describe, it, expect, beforeAll } from 'vitest';
import { openingCraterGame, tickWhile, outOfReachCount, type OpeningGame } from '../helpers/openingCrater.js';
import { expectNoWorldInvariantViolations } from '../helpers/worldInvariants.js';

/** Ticks the core is given to order something on its own; it must do nothing. */
const IDLE_TICKS = 1500;
/** Ticks allowed for the crew to dig the suggested ramp. */
const DIG_TICKS = 3000;
/** Ticks after the dig for the classifier to see the new road and the haulers to carry ore out. */
const RECLASSIFY_TICKS = 60;
const HAUL_TICKS = 800;
/** "Near zero": at most this share of the orders stranded before the ramp may still be out of reach. */
const MAX_REMAINING_SHARE = 0.1;

const constructionSpend = (g: OpeningGame, since: number) =>
  g.state.finances.transactions.filter(e => e.type === 'expense' && e.category === 'construction' && e.tick >= since);
const oreKg = (g: OpeningGame): number => Object.values(g.state.collectedOre).reduce((a, b) => a + b, 0);

describe('nothing is ordered by itself (C4)', () => {
  it('leaves the opening crater unramped, unpaid and its orders stranded however long it waits', () => {
    const g = openingCraterGame();
    const strandedBefore = outOfReachCount(g.state);
    const since = g.state.tickCount;
    tickWhile(g, () => false, IDLE_TICKS);
    expect(g.state.plannedRamps).toEqual([]);
    expect(g.state.builtRamps).toEqual([]);
    expect(constructionSpend(g, since)).toEqual([]);
    expect(outOfReachCount(g.state)).toBeGreaterThanOrEqual(strandedBefore);
  }, 300_000);

  it('asking for the suggestion over and over still orders nothing', () => {
    const g = openingCraterGame();
    const since = g.state.tickCount;
    for (let i = 0; i < 5; i++) {
      expect(g.run('build_ramp suggest')).toMatchObject({ success: true });
      tickWhile(g, () => false, 20);
    }
    expect(g.state.plannedRamps).toEqual([]);
    expect(constructionSpend(g, since)).toEqual([]);
  }, 300_000);
});

describe('the suggested ramp opens the crater (C5)', () => {
  let g: OpeningGame;
  let strandedBefore = 0;
  let oreBefore = 0;
  let orderedAt = 0;

  beforeAll(() => {
    g = openingCraterGame();
    strandedBefore = outOfReachCount(g.state);
    oreBefore = oreKg(g);
    orderedAt = g.state.tickCount;
    expect(g.run('build_ramp suggest order')).toMatchObject({ success: true });
    tickWhile(g, () => g.state.plannedRamps.length === 0, DIG_TICKS);
    tickWhile(g, () => false, RECLASSIFY_TICKS);
  }, 600_000);

  it('digs the ramp to the end, paid by the one order', () => {
    expect(g.state.plannedRamps).toEqual([]);
    expect(g.state.builtRamps).toHaveLength(1);
    const orders = constructionSpend(g, orderedAt);
    expect(orders.length).toBeGreaterThan(0);
  });

  it('drops the out-of-reach count to near zero', () => {
    expect(strandedBefore).toBeGreaterThan(0);
    expect(outOfReachCount(g.state)).toBeLessThanOrEqual(Math.floor(strandedBefore * MAX_REMAINING_SHARE));
  });

  it('has the crater\'s ore hauled to storage', () => {
    const before = oreKg(g);
    tickWhile(g, () => false, HAUL_TICKS);
    expect(oreKg(g)).toBeGreaterThan(Math.max(before, oreBefore));
    expect(g.state.logistics.storedMassKg).toBeGreaterThan(0);
    expectNoWorldInvariantViolations(g.state);
  }, 300_000);
});
