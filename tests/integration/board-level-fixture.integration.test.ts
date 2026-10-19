// BlastSimulator2026 — Integration: a level with a board of directors, run through the real tick loop (#1946)
//
// The fixture level is a mocked-in copy of dusty_hollow with a 48-tick quarter and an
// unreachable profit threshold, so only the board can end it.

import { describe, it, expect, vi } from 'vitest';
import type { LevelDef } from '../../src/core/campaign/Level.js';

vi.mock('../../src/core/campaign/Level.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/core/campaign/Level.js')>();
  const base = real.getLevel('dusty_hollow')!;
  const fixture: LevelDef = {
    ...base,
    id: 'board_fixture',
    difficultyTier: 1,
    unlockThreshold: 1e12,
    board: { quarterTicks: 48, oreTargetT: 1, profitTarget: 1000 },
  };
  const all = [...real.getAllLevels(), fixture];
  return { ...real, getAllLevels: () => all, getLevel: (id: string) => all.find(l => l.id === id) };
});

import { createGameForLevel } from '../../src/core/campaign/LevelTransition.js';
import { createCampaignState } from '../../src/core/campaign/Campaign.js';
import { runTick, type TickReport } from '../../src/core/engine/TickPipeline.js';
import { recordBoardOre } from '../../src/core/economy/Board.js';
import { addIncome } from '../../src/core/economy/Finance.js';
import { serialize, deserialize } from '../../src/core/state/SaveLoad.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { Random } from '../../src/core/math/Random.js';
import { BANKRUPTCY_THRESHOLD, BANKRUPTCY_GRACE_TICKS } from '../../src/core/campaign/Bankruptcy.js';
import type { GameState } from '../../src/core/state/GameState.js';

const QUARTER = 48;

function newGame(): GameState {
  const state = createGameForLevel(createCampaignState(), 'board_fixture')!;
  expect(state).not.toBeNull();
  // The level opens below the dividend floor and an idle mine burns upkeep; start rich so
  // dividends can fire and a quarter's operating profit is judged on income alone.
  state.cash = 200_000;
  return state;
}

function tick(state: GameState): TickReport {
  return runTick(state, null, new Random(state.seed + state.tickCount), new EventEmitter(), { checkInvariants: false });
}

/** Tick to the end of the current quarter and return the report that carried the review. */
function tickThroughQuarter(state: GameState): TickReport | undefined {
  let review: TickReport | undefined;
  for (let i = 0; i < QUARTER && !state.levelEnded; i++) {
    const report = tick(state);
    if (report.boardReview) review = report;
  }
  return review;
}

/** Hit this quarter's targets with margin (quarter 1 needs 1 t / $1000; later ones 25% more each). */
function meetTargets(state: GameState): void {
  recordBoardOre(state.board, 'ore_sale', 5_000);
  addIncome(state.finances, 50_000, 'sales', 'ore', state.tickCount);
}

describe('board level fixture — opening', () => {
  it('opens with a board in quarter 1 at confidence 60', () => {
    const state = newGame();
    expect(state.board).toBeDefined();
    expect(state.board!.quarter).toBe(1);
    expect(state.board!.confidence).toBe(60);
    expect(state.levelEnded).toBe(false);
  });

  it('no review runs before the quarter has elapsed', () => {
    const state = newGame();
    for (let i = 0; i < QUARTER - 1; i++) expect(tick(state).boardReview ?? null).toBeNull();
    expect(state.board!.quarter).toBe(1);
  });
});

describe('board level fixture — meeting the targets', () => {
  it('survives two quarters with rising confidence, a bonus and a dividend each time', () => {
    const state = newGame();

    for (let q = 1; q <= 2; q++) {
      meetTargets(state);
      const txBefore = state.finances.transactions.length;
      const report = tickThroughQuarter(state)!;

      expect(report.boardReview).toMatchObject({ quarter: q, oreMet: true, profitMet: true });
      expect(report.boardReview!.confidenceAfter).toBe(60 + 15 * q);
      const booked = state.finances.transactions.slice(txBefore);
      expect(booked.some(t => t.category === 'bonus' && t.type === 'income')).toBe(true);
      expect(booked.some(t => t.category === 'dividends' && t.type === 'expense')).toBe(true);
    }

    expect(state.board!.confidence).toBeGreaterThan(60);
    expect(state.board!.quarter).toBe(3);
    expect(state.levelEnded).toBe(false);
    expect(state.levelEndReason).toBeNull();
    expect(state.board!.lastDividend).toBeGreaterThan(0);
  });

  it('the bonus is 10% of the quarter profit target and the dividend never takes cash under the floor', () => {
    const state = newGame();
    meetTargets(state);
    const cashBefore = state.cash;
    const review = tickThroughQuarter(state)!.boardReview!;
    expect(review.bonus).toBeCloseTo(100, 6);
    expect(review.dividend).toBeGreaterThan(0);
    expect(state.cash).toBeGreaterThan(100_000);
    expect(cashBefore - state.cash).toBeLessThan(cashBefore); // sanity: cash is not wiped out
  });
});

describe('board level fixture — idling', () => {
  // An idle mine delivers no ore and burns upkeep, so it misses both targets: -50 a review.
  it('is fired at the second review: 60 -> 10 -> 0', () => {
    const state = newGame();
    const seen: number[] = [];
    for (let q = 0; q < 2; q++) {
      const report = tickThroughQuarter(state);
      seen.push(report!.boardReview!.confidenceAfter);
    }
    expect(seen).toEqual([10, 0]);
    expect(state.levelEnded).toBe(true);
    expect(state.levelEndReason).toBe('fired');
  });

  it('is not fired after one bad quarter', () => {
    const state = newGame();
    tickThroughQuarter(state);
    expect(state.levelEnded).toBe(false);
    expect(state.board!.confidence).toBe(10);
  });

  it('a mine that earns money but delivers no ore is fired at the third review: 60 -> 35 -> 10 -> 0', () => {
    const state = newGame();
    const seen: number[] = [];
    for (let q = 0; q < 3; q++) {
      addIncome(state.finances, 50_000, 'sales', 'ore', state.tickCount);
      seen.push(tickThroughQuarter(state)!.boardReview!.confidenceAfter);
    }
    expect(seen).toEqual([35, 10, 0]);
    expect(state.levelEnded).toBe(true);
    expect(state.levelEndReason).toBe('fired');
  });

  it('reports the firing in the game-over report of the same tick', () => {
    const state = newGame();
    tickThroughQuarter(state);
    let fired = false;
    for (let i = 0; i < QUARTER; i++) {
      const report = tick(state);
      if (report.gameOver.fired) fired = true;
    }
    expect(fired).toBe(true);
  });

  it('no further reviews run once the level ended', () => {
    const state = newGame();
    for (let q = 0; q < 2; q++) tickThroughQuarter(state);
    const quarter = state.board!.quarter;
    for (let i = 0; i < QUARTER * 2; i++) expect(tick(state).boardReview ?? null).toBeNull();
    expect(state.board!.quarter).toBe(quarter);
    expect(state.levelEndReason).toBe('fired');
  });
});

describe('board level fixture — one target missed', () => {
  it('missing only profit costs 25, books no bonus, still pays a dividend', () => {
    const state = newGame();
    recordBoardOre(state.board, 'ore_sale', 5_000); // ore met, profit not (upkeep makes it negative)
    const txBefore = state.finances.transactions.length;
    const review = tickThroughQuarter(state)!.boardReview!;

    expect(review.oreMet).toBe(true);
    expect(review.profitMet).toBe(false);
    expect(review.confidenceAfter).toBe(35);
    expect(review.bonus).toBe(0);
    const booked = state.finances.transactions.slice(txBefore);
    expect(booked.some(t => t.category === 'bonus')).toBe(false);
    expect(booked.some(t => t.category === 'dividends')).toBe(true);
  });

  it('missing only ore costs 25', () => {
    const state = newGame();
    addIncome(state.finances, 50_000, 'sales', 'ore', 1);
    const review = tickThroughQuarter(state)!.boardReview!;
    expect(review).toMatchObject({ oreMet: false, profitMet: true, confidenceAfter: 35 });
  });

  it('rubble disposal does not satisfy the ore target', () => {
    const state = newGame();
    recordBoardOre(state.board, 'rubble_disposal', 50_000);
    addIncome(state.finances, 50_000, 'sales', 'ore', 1);
    expect(tickThroughQuarter(state)!.boardReview!.oreMet).toBe(false);
  });
});

describe('board level fixture — save and load mid-quarter', () => {
  it('a reloaded game carries the board and reviews at the same tick with the same result', () => {
    const original = newGame();
    meetTargets(original);
    for (let i = 0; i < 20; i++) tick(original);

    const reloaded = deserialize(serialize(original));
    expect(reloaded.board).toEqual(original.board);

    for (let i = 0; i < QUARTER - 20 - 1; i++) {
      expect(tick(original).boardReview ?? null).toBeNull();
      expect(tick(reloaded).boardReview ?? null).toBeNull();
    }
    const a = tick(original).boardReview;
    const b = tick(reloaded).boardReview;
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
    expect(reloaded.board!.confidence).toBe(original.board!.confidence);
  });
});

describe('board level fixture — precedence', () => {
  it('bankruptcy beats being fired on the same tick', () => {
    const state = newGame();
    state.board!.confidence = 10; // an idle review this tick would take it to 0
    state.board!.quarterStartTick = state.tickCount - (QUARTER - 1);
    state.cash = BANKRUPTCY_THRESHOLD - 1;
    state.bankruptcy.ticksBelowThreshold = BANKRUPTCY_GRACE_TICKS - 1;

    const report = tick(state);

    expect(report.boardReview?.confidenceAfter).toBe(0);
    expect(state.levelEnded).toBe(true);
    expect(state.levelEndReason).toBe('bankruptcy');
  });
});
