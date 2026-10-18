// BlastSimulator2026 — Board of directors: quarterly targets, confidence, bonus, dividends, firing (#1946)

import { describe, it, expect } from 'vitest';
import {
  createBoardState,
  sanitizeBoardState,
  quarterTargets,
  recordBoardOre,
  boardProgress,
  runBoardReview,
  isBoardFired,
  type BoardConfig,
  type BoardState,
} from '../../../src/core/economy/Board.js';
import { addIncome, addExpense, createFinanceState, getOperatingProfit, type FinanceState } from '../../../src/core/economy/Finance.js';
import {
  BOARD_QUARTER_TICKS,
  BOARD_TARGET_GROWTH,
  BOARD_CONFIDENCE_START,
  BOARD_CONFIDENCE_MAX,
  BOARD_CONFIDENCE_MET_GAIN,
  BOARD_CONFIDENCE_MISS_PENALTY,
  BOARD_BONUS_PROFIT_SHARE,
  BOARD_DIVIDEND_RATE,
  BOARD_DIVIDEND_CASH_FLOOR,
} from '../../../src/core/config/balance.js';

const CONFIG: BoardConfig = { quarterTicks: 100, oreTargetT: 10, profitTarget: 1000 };

interface ReviewState {
  board: BoardState | undefined;
  cash: number;
  finances: FinanceState;
  tickCount: number;
}

function makeState(cash = 200_000, config: BoardConfig = CONFIG): ReviewState & { board: BoardState } {
  return { board: createBoardState(config, 0), cash, finances: createFinanceState(cash), tickCount: 0 };
}

/** Deliver the quarter's ore and book profit, then jump to the quarter's end. */
function playQuarter(s: ReviewState & { board: BoardState }, oreKg: number, profit: number): void {
  if (oreKg > 0) recordBoardOre(s.board, 'ore_sale', oreKg);
  if (profit > 0) addIncome(s.finances, profit, 'sales', 'ore', s.tickCount + 1);
  s.tickCount = s.board.quarterStartTick + s.board.config.quarterTicks;
}

describe('balance constants', () => {
  it('pin the spec numbers', () => {
    expect(BOARD_QUARTER_TICKS).toBe(720);
    expect(BOARD_TARGET_GROWTH).toBe(1.25);
    expect(BOARD_CONFIDENCE_START).toBe(60);
    expect(BOARD_CONFIDENCE_MAX).toBe(100);
    expect(BOARD_CONFIDENCE_MET_GAIN).toBe(15);
    expect(BOARD_CONFIDENCE_MISS_PENALTY).toBe(25);
    expect(BOARD_BONUS_PROFIT_SHARE).toBe(0.10);
    expect(BOARD_DIVIDEND_RATE).toBe(0.20);
    expect(BOARD_DIVIDEND_CASH_FLOOR).toBe(100_000);
  });
});

describe('createBoardState', () => {
  it('starts in quarter 1 at confidence 60 with nothing delivered', () => {
    const b = createBoardState(CONFIG, 7);
    expect(b.quarter).toBe(1);
    expect(b.quarterStartTick).toBe(7);
    expect(b.confidence).toBe(60);
    expect(b.oreDeliveredKg).toBe(0);
    expect(b.profitAtQuarterStart).toBe(0);
    expect(b.lastDividend).toBe(0);
    expect(b.lastReview).toBeNull();
  });

  it('defaults the start tick to 0', () => {
    expect(createBoardState(CONFIG).quarterStartTick).toBe(0);
  });

  it('copies the config instead of aliasing it', () => {
    const cfg = { ...CONFIG };
    const b = createBoardState(cfg);
    cfg.oreTargetT = 999;
    expect(b.config.oreTargetT).toBe(10);
    expect(b.config).not.toBe(cfg);
  });

  it.each([0, -5, Number.NaN, 12.5, Number.POSITIVE_INFINITY])('clamps quarterTicks %s to the default', (bad) => {
    expect(createBoardState({ ...CONFIG, quarterTicks: bad }).config.quarterTicks).toBe(BOARD_QUARTER_TICKS);
  });

  it.each([0, -1, Number.NaN])('clamps growth %s to the default', (bad) => {
    const targets = quarterTargets(createBoardState({ ...CONFIG, growth: bad }).config, 2);
    expect(targets.oreT).toBeCloseTo(10 * BOARD_TARGET_GROWTH, 9);
  });

  it.each([-10, Number.NaN])('never keeps a negative or NaN target (%s)', (bad) => {
    const b = createBoardState({ ...CONFIG, oreTargetT: bad, profitTarget: bad });
    expect(Number.isFinite(b.config.oreTargetT)).toBe(true);
    expect(b.config.oreTargetT).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(b.config.profitTarget)).toBe(true);
    expect(b.config.profitTarget).toBeGreaterThanOrEqual(0);
  });

  it('returns independent objects each call', () => {
    const a = createBoardState(CONFIG);
    a.confidence = 1;
    expect(createBoardState(CONFIG).confidence).toBe(60);
  });
});

describe('quarterTargets', () => {
  it('quarter 1 is the base target', () => {
    expect(quarterTargets(CONFIG, 1)).toEqual({ oreT: 10, profit: 1000 });
  });

  it('grows 25% per quarter by default', () => {
    const q2 = quarterTargets(CONFIG, 2);
    const q3 = quarterTargets(CONFIG, 3);
    expect(q2.oreT).toBeCloseTo(12.5, 9);
    expect(q2.profit).toBeCloseTo(1250, 9);
    expect(q3.oreT).toBeCloseTo(15.625, 9);
    expect(q3.profit).toBeCloseTo(1562.5, 9);
  });

  it('honours a per-board growth factor', () => {
    const q3 = quarterTargets({ ...CONFIG, growth: 2 }, 3);
    expect(q3.oreT).toBeCloseTo(40, 9);
    expect(q3.profit).toBeCloseTo(4000, 9);
  });

  it('growth 1 keeps targets flat', () => {
    expect(quarterTargets({ ...CONFIG, growth: 1 }, 9)).toEqual({ oreT: 10, profit: 1000 });
  });
});

describe('recordBoardOre', () => {
  it('adds ore_sale and supply kilograms', () => {
    const b = createBoardState(CONFIG);
    recordBoardOre(b, 'ore_sale', 400);
    recordBoardOre(b, 'supply', 600);
    expect(b.oreDeliveredKg).toBe(1000);
  });

  it('ignores rubble disposal', () => {
    const b = createBoardState(CONFIG);
    recordBoardOre(b, 'rubble_disposal', 5000);
    expect(b.oreDeliveredKg).toBe(0);
  });

  it('is a no-op for an undefined board', () => {
    expect(() => recordBoardOre(undefined, 'ore_sale', 100)).not.toThrow();
  });

  it.each([0, -50, Number.NaN])('ignores a non-positive amount (%s)', (kg) => {
    const b = createBoardState(CONFIG);
    recordBoardOre(b, 'ore_sale', kg);
    expect(b.oreDeliveredKg).toBe(0);
  });
});

describe('boardProgress', () => {
  it('reports tonnes delivered and profit earned this quarter against the targets', () => {
    const s = makeState();
    recordBoardOre(s.board, 'ore_sale', 4500);
    addIncome(s.finances, 300, 'sales', 'ore', 1);
    const p = boardProgress(s.board, s.finances);
    expect(p.oreT).toBeCloseTo(4.5, 9);
    expect(p.profit).toBe(300);
    expect(p.targets).toEqual({ oreT: 10, profit: 1000 });
  });

  it('measures profit as a delta from the quarter-start snapshot', () => {
    const s = makeState();
    addIncome(s.finances, 800, 'sales', 'ore', 1);
    s.board.profitAtQuarterStart = 500;
    expect(boardProgress(s.board, s.finances).profit).toBe(300);
  });

  it('excludes capital spending from profit', () => {
    const s = makeState();
    addIncome(s.finances, 800, 'sales', 'ore', 1);
    addExpense(s.finances, 5000, 'equipment', 'truck', 1);
    expect(boardProgress(s.board, s.finances).profit).toBe(800);
  });
});

describe('runBoardReview — timing', () => {
  it('returns null without a board and leaves state alone', () => {
    const state: ReviewState = { board: undefined, cash: 5, finances: createFinanceState(5), tickCount: 9999 };
    expect(runBoardReview(state)).toBeNull();
    expect(state.board).toBeUndefined();
    expect('board' in state && state.board !== undefined).toBe(false);
    expect(state.cash).toBe(5);
    expect(state.finances.transactions).toEqual([]);
  });

  it('returns null and changes nothing before the quarter has elapsed', () => {
    const s = makeState();
    s.tickCount = 99;
    const before = JSON.stringify(s);
    expect(runBoardReview(s)).toBeNull();
    expect(JSON.stringify(s)).toBe(before);
  });

  it('reviews exactly when quarterTicks have elapsed', () => {
    const s = makeState();
    s.tickCount = 100;
    expect(runBoardReview(s)).not.toBeNull();
  });

  it('measures the quarter from quarterStartTick, not tick 0', () => {
    const s = makeState();
    s.board.quarterStartTick = 40;
    s.tickCount = 139;
    expect(runBoardReview(s)).toBeNull();
    s.tickCount = 140;
    expect(runBoardReview(s)).not.toBeNull();
  });

  it('does not review twice for the same quarter', () => {
    const s = makeState();
    s.tickCount = 100;
    expect(runBoardReview(s)).not.toBeNull();
    expect(runBoardReview(s)).toBeNull();
    s.tickCount = 199;
    expect(runBoardReview(s)).toBeNull();
    s.tickCount = 200;
    expect(runBoardReview(s)).not.toBeNull();
  });

  it('a late review runs once and restarts the quarter at the current tick', () => {
    const s = makeState();
    s.tickCount = 250;
    expect(runBoardReview(s)).not.toBeNull();
    expect(s.board.quarterStartTick).toBe(250);
    expect(s.board.quarter).toBe(2);
    expect(runBoardReview(s)).toBeNull();
  });
});

describe('runBoardReview — all targets met', () => {
  it('raises confidence by 15, books the bonus, pays the dividend and reports it', () => {
    const s = makeState(200_000);
    playQuarter(s, 10_000, 1000);
    const review = runBoardReview(s)!;

    // bonus = 10% of the profit target; dividend = 20% of (cash after bonus - 100k)
    expect(review).toEqual({
      quarter: 1,
      oreMet: true,
      profitMet: true,
      confidenceBefore: 60,
      confidenceAfter: 75,
      bonus: 100,
      dividend: 20_020,
    });
    expect(s.board.confidence).toBe(75);
    expect(s.board.lastDividend).toBe(20_020);
    expect(s.board.lastReview).toEqual(review);
    expect(s.cash).toBe(200_000 + 100 - 20_020);
  });

  it('books the bonus as bonus income, then the dividend as a dividends expense, in that order', () => {
    const s = makeState(200_000);
    playQuarter(s, 10_000, 1000);
    const before = s.finances.transactions.length;
    runBoardReview(s);
    const booked = s.finances.transactions.slice(before);
    expect(booked).toHaveLength(2);
    expect(booked[0]).toMatchObject({ type: 'income', category: 'bonus', amount: 100 });
    expect(booked[1]).toMatchObject({ type: 'expense', category: 'dividends', amount: 20_020 });
  });

  it('computes the dividend from cash that already includes the bonus', () => {
    const s = makeState(100_000);
    playQuarter(s, 10_000, 1000);
    const review = runBoardReview(s)!;
    expect(review.dividend).toBeCloseTo(BOARD_DIVIDEND_RATE * (100_000 + 100 - BOARD_DIVIDEND_CASH_FLOOR), 6);
    expect(review.dividend).toBeCloseTo(20, 6);
  });

  it('rolls into the next quarter with fresh counters and a post-booking profit snapshot', () => {
    const s = makeState(200_000);
    playQuarter(s, 10_000, 1000);
    runBoardReview(s);
    expect(s.board.quarter).toBe(2);
    expect(s.board.quarterStartTick).toBe(100);
    expect(s.board.oreDeliveredKg).toBe(0);
    expect(s.board.profitAtQuarterStart).toBeCloseTo(getOperatingProfit(s.finances), 9);
    // the dividend is a non-capital expense, so the snapshot sits below the 1000 earned
    expect(s.board.profitAtQuarterStart).toBeLessThan(1000);
  });

  it('exceeding the targets also counts as met', () => {
    const s = makeState();
    playQuarter(s, 50_000, 9000);
    const review = runBoardReview(s)!;
    expect(review.oreMet && review.profitMet).toBe(true);
    expect(review.bonus).toBe(100); // bonus is a share of the target, not of the surplus
  });

  it('the next quarter is judged against the grown targets, from a fresh counter', () => {
    const s = makeState(200_000);
    playQuarter(s, 10_000, 1000);
    runBoardReview(s);
    // quarter 2 needs 12.5 t and 1250 profit: last quarter's numbers no longer suffice
    playQuarter(s, 12_000, 1200);
    const miss = runBoardReview(s)!;
    expect(miss.quarter).toBe(2);
    expect(miss.oreMet).toBe(false);
    expect(miss.profitMet).toBe(false);
  });

  it('meeting quarter 2 exactly passes and books 10% of the quarter-2 target', () => {
    const s = makeState(200_000);
    playQuarter(s, 10_000, 1000);
    runBoardReview(s);
    // dividend of quarter 1 lowered operating profit; the snapshot makes that irrelevant
    playQuarter(s, 12_500, 1250);
    const review = runBoardReview(s)!;
    expect(review.oreMet).toBe(true);
    expect(review.profitMet).toBe(true);
    expect(review.bonus).toBeCloseTo(125, 9);
    expect(review.confidenceAfter).toBe(90);
  });
});

describe('runBoardReview — missed targets', () => {
  it('one target missed (ore): -25, no bonus', () => {
    const s = makeState();
    playQuarter(s, 9_999, 1000);
    const review = runBoardReview(s)!;
    expect(review).toMatchObject({ oreMet: false, profitMet: true, confidenceAfter: 35, bonus: 0 });
    expect(s.finances.transactions.some(t => t.category === 'bonus')).toBe(false);
  });

  it('one target missed (profit only): -25, no bonus', () => {
    const s = makeState();
    playQuarter(s, 10_000, 999);
    const review = runBoardReview(s)!;
    expect(review).toMatchObject({ oreMet: true, profitMet: false, confidenceAfter: 35, bonus: 0 });
    expect(s.finances.transactions.some(t => t.category === 'bonus')).toBe(false);
  });

  it('both missed: -50 total', () => {
    const s = makeState();
    playQuarter(s, 0, 0);
    const review = runBoardReview(s)!;
    expect(review).toMatchObject({ oreMet: false, profitMet: false, confidenceBefore: 60, confidenceAfter: 10, bonus: 0 });
  });

  it('still pays the dividend on rich cash after a miss', () => {
    const s = makeState(300_000);
    playQuarter(s, 0, 0);
    const review = runBoardReview(s)!;
    expect(review.dividend).toBeCloseTo(40_000, 6);
    expect(s.cash).toBeCloseTo(260_000, 6);
  });

  it('still rolls into the next quarter after a miss', () => {
    const s = makeState();
    playQuarter(s, 0, 0);
    runBoardReview(s);
    expect(s.board.quarter).toBe(2);
    expect(s.board.oreDeliveredKg).toBe(0);
  });

  it('profit earned before the quarter began does not count toward it', () => {
    const s = makeState();
    addIncome(s.finances, 5000, 'sales', 'old', 0);
    s.board.profitAtQuarterStart = getOperatingProfit(s.finances);
    playQuarter(s, 10_000, 0);
    expect(runBoardReview(s)!.profitMet).toBe(false);
  });
});

describe('runBoardReview — dividend floor', () => {
  it.each([100_000, 99_999, 50_000, 0, -40_000])('pays no dividend at cash %s', (cash) => {
    const s = makeState(cash);
    playQuarter(s, 0, 0);
    const review = runBoardReview(s)!;
    expect(review.dividend).toBe(0);
    expect(s.board.lastDividend).toBe(0);
    expect(s.cash).toBe(cash);
    expect(s.finances.transactions.some(t => t.category === 'dividends')).toBe(false);
  });

  it('a bonus that lifts cash over the floor creates a (small) dividend', () => {
    const s = makeState(99_950);
    playQuarter(s, 10_000, 1000); // bonus 100 -> 100,050 -> dividend 10
    const review = runBoardReview(s)!;
    expect(review.dividend).toBeCloseTo(10, 6);
  });

  it('the dividend is a non-capital expense and lowers operating profit', () => {
    const s = makeState(300_000);
    playQuarter(s, 0, 0);
    const before = getOperatingProfit(s.finances);
    const review = runBoardReview(s)!;
    expect(getOperatingProfit(s.finances)).toBeCloseTo(before - review.dividend, 6);
  });
});

describe('confidence clamp and firing', () => {
  it('caps at 100', () => {
    const s = makeState();
    s.board.confidence = 95;
    playQuarter(s, 10_000, 1000);
    expect(runBoardReview(s)!.confidenceAfter).toBe(100);
    expect(s.board.confidence).toBe(100);
  });

  it('stays at 100 when already maxed', () => {
    const s = makeState();
    s.board.confidence = 100;
    playQuarter(s, 10_000, 1000);
    expect(runBoardReview(s)!.confidenceAfter).toBe(100);
  });

  it('floors at 0, never negative', () => {
    const s = makeState();
    s.board.confidence = 20;
    playQuarter(s, 10_000, 0);
    expect(runBoardReview(s)!.confidenceAfter).toBe(0);
    expect(s.board.confidence).toBe(0);
  });

  it('an idle board falls 60 -> 35 -> 10 -> 0 over three reviews', () => {
    const s = makeState();
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      playQuarter(s, 0, 0);
      seen.push(runBoardReview(s)!.confidenceAfter);
    }
    expect(seen).toEqual([35, 10, 0]);
  });
});

describe('isBoardFired', () => {
  it('is false without a board', () => {
    expect(isBoardFired(undefined)).toBe(false);
  });

  it('is false at positive confidence', () => {
    const b = createBoardState(CONFIG);
    expect(isBoardFired(b)).toBe(false);
    b.confidence = 0.5;
    expect(isBoardFired(b)).toBe(false);
  });

  it('is true at confidence 0 and below', () => {
    const b = createBoardState(CONFIG);
    b.confidence = 0;
    expect(isBoardFired(b)).toBe(true);
    b.confidence = -3;
    expect(isBoardFired(b)).toBe(true);
  });
});

describe('sanitizeBoardState', () => {
  function valid(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(createBoardState(CONFIG, 5)));
  }

  it('round-trips a well-formed board', () => {
    const b = createBoardState(CONFIG, 5);
    b.confidence = 42;
    b.quarter = 3;
    b.oreDeliveredKg = 1234;
    b.lastDividend = 777;
    expect(sanitizeBoardState(JSON.parse(JSON.stringify(b)))).toEqual(b);
  });

  it('keeps a stored lastReview', () => {
    const s = makeState();
    playQuarter(s, 0, 0);
    runBoardReview(s);
    const out = sanitizeBoardState(JSON.parse(JSON.stringify(s.board)));
    expect(out?.lastReview).toEqual(s.board.lastReview);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'board'],
    ['a number', 7],
    ['an array', []],
    ['an array of fields', [1, 2, 3]],
  ])('rejects %s', (_label, raw) => {
    expect(sanitizeBoardState(raw)).toBeUndefined();
  });

  it.each([
    ['NaN confidence', { confidence: Number.NaN }],
    ['string confidence', { confidence: '60' }],
    ['negative confidence', { confidence: -1 }],
    ['confidence over 100', { confidence: 100.5 }],
    ['quarter 0', { quarter: 0 }],
    ['negative quarter', { quarter: -2 }],
    ['fractional quarter', { quarter: 1.5 }],
    ['NaN quarter', { quarter: Number.NaN }],
    ['NaN quarterStartTick', { quarterStartTick: Number.NaN }],
    ['negative oreDeliveredKg', { oreDeliveredKg: -1 }],
    ['NaN oreDeliveredKg', { oreDeliveredKg: Number.NaN }],
    ['NaN profitAtQuarterStart', { profitAtQuarterStart: Number.NaN }],
    ['NaN lastDividend', { lastDividend: Number.NaN }],
    ['missing config', { config: undefined }],
    ['config null', { config: null }],
    ['config array', { config: [] }],
    ['config with NaN quarterTicks', { config: { quarterTicks: Number.NaN, oreTargetT: 1, profitTarget: 1 } }],
    ['config with zero quarterTicks', { config: { quarterTicks: 0, oreTargetT: 1, profitTarget: 1 } }],
    ['config with string target', { config: { quarterTicks: 10, oreTargetT: '1', profitTarget: 1 } }],
    ['config with negative profit target', { config: { quarterTicks: 10, oreTargetT: 1, profitTarget: -1 } }],
  ])('rejects %s', (_label, patch) => {
    const raw = { ...valid(), ...patch };
    // JSON turns NaN into null, which must be rejected as well
    expect(sanitizeBoardState(raw)).toBeUndefined();
    expect(sanitizeBoardState(JSON.parse(JSON.stringify(raw)))).toBeUndefined();
  });

  it('accepts the confidence boundaries 0 and 100', () => {
    expect(sanitizeBoardState({ ...valid(), confidence: 0 })?.confidence).toBe(0);
    expect(sanitizeBoardState({ ...valid(), confidence: 100 })?.confidence).toBe(100);
  });

  it('does not alias the raw object', () => {
    const raw = valid();
    const out = sanitizeBoardState(raw)!;
    out.confidence = 1;
    expect(raw['confidence']).toBe(60);
  });
});

describe('a board-less game', () => {
  it('has no board key and review/record stay inert', () => {
    const state: Partial<ReviewState> = { cash: 1, finances: createFinanceState(1), tickCount: 5000 };
    expect(runBoardReview(state as ReviewState)).toBeNull();
    recordBoardOre(state.board, 'ore_sale', 1000);
    expect('board' in state).toBe(false);
  });
});
