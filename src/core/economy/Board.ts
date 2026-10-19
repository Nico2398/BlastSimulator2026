// BlastSimulator2026 — Board of directors: optional quarterly targets, confidence, dividends (#1946)

import type { GameState } from '../state/GameState.js';
import type { ContractType } from './Contract.js';
import { addIncome, deductExpense, getOperatingProfit, type FinanceState } from './Finance.js';
import { countsAsOreDelivery } from './MineGrade.js';
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
} from '../config/balance.js';

export interface BoardConfig {
  quarterTicks: number;
  oreTargetT: number;
  profitTarget: number;
  growth?: number;
}

export interface BoardReview {
  quarter: number;
  oreMet: boolean;
  profitMet: boolean;
  confidenceBefore: number;
  confidenceAfter: number;
  bonus: number;
  dividend: number;
}

export interface BoardState {
  config: BoardConfig;
  quarter: number;
  quarterStartTick: number;
  oreDeliveredKg: number;
  profitAtQuarterStart: number;
  confidence: number;
  lastDividend: number;
  lastReview: BoardReview | null;
}

interface QuarterTargets {
  oreT: number;
  profit: number;
}

function isPositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/** Config copy with invalid cadence/growth replaced by defaults; undefined when a target is unusable. */
function cleanConfig(raw: Partial<Record<keyof BoardConfig, unknown>>): BoardConfig | undefined {
  if (!isPositive(raw.oreTargetT) || !isPositive(raw.profitTarget)) return undefined;
  return {
    quarterTicks: isPositive(raw.quarterTicks) && Number.isInteger(raw.quarterTicks) ? raw.quarterTicks : BOARD_QUARTER_TICKS,
    oreTargetT: raw.oreTargetT,
    profitTarget: raw.profitTarget,
    growth: isPositive(raw.growth) ? raw.growth : BOARD_TARGET_GROWTH,
  };
}

/** Fresh board: quarter 1 starting at `startTick`, confidence at its start value. Targets must be positive. */
export function createBoardState(config: BoardConfig, startTick = 0): BoardState {
  const clean = cleanConfig(config) ?? {
    quarterTicks: BOARD_QUARTER_TICKS,
    oreTargetT: Math.max(1, config.oreTargetT || 1),
    profitTarget: Math.max(1, config.profitTarget || 1),
    growth: BOARD_TARGET_GROWTH,
  };
  return {
    config: clean,
    quarter: 1,
    quarterStartTick: startTick,
    oreDeliveredKg: 0,
    profitAtQuarterStart: 0,
    confidence: BOARD_CONFIDENCE_START,
    lastDividend: 0,
    lastReview: null,
  };
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function sanitizeReview(raw: unknown): BoardReview | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  if (!isFiniteNum(r['quarter']) || !isFiniteNum(r['confidenceBefore']) || !isFiniteNum(r['confidenceAfter'])
    || !isFiniteNum(r['bonus']) || !isFiniteNum(r['dividend'])
    || typeof r['oreMet'] !== 'boolean' || typeof r['profitMet'] !== 'boolean') return undefined;
  return {
    quarter: r['quarter'], oreMet: r['oreMet'], profitMet: r['profitMet'],
    confidenceBefore: r['confidenceBefore'], confidenceAfter: r['confidenceAfter'], bonus: r['bonus'], dividend: r['dividend'],
  };
}

/** Validate a loaded board sub-state; undefined when malformed. */
export function sanitizeBoardState(raw: unknown): BoardState | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const cfg = r['config'];
  if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) return undefined;
  // A saved cadence must already be valid; only a fresh level config gets defaults.
  const ticks = (cfg as Record<string, unknown>)['quarterTicks'];
  if (!isPositive(ticks) || !Number.isInteger(ticks)) return undefined;
  const config = cleanConfig(cfg as Record<string, unknown>);
  const { quarter, quarterStartTick, oreDeliveredKg, profitAtQuarterStart, confidence, lastDividend } = r;
  if (!config || !isFiniteNum(quarter) || !Number.isInteger(quarter) || quarter < 1) return undefined;
  if (!isFiniteNum(quarterStartTick) || !isFiniteNum(oreDeliveredKg) || oreDeliveredKg < 0) return undefined;
  if (!isFiniteNum(profitAtQuarterStart) || !isFiniteNum(lastDividend) || lastDividend < 0) return undefined;
  if (!isFiniteNum(confidence) || confidence < 0 || confidence > BOARD_CONFIDENCE_MAX) return undefined;
  const lastReview = sanitizeReview(r['lastReview'] ?? null);
  if (lastReview === undefined) return undefined;
  return { config, quarter, quarterStartTick, oreDeliveredKg, profitAtQuarterStart, confidence, lastDividend, lastReview };
}

/** Targets of a quarter: the base targets grown by `growth` for every quarter after the first. */
export function quarterTargets(config: BoardConfig, quarter: number): QuarterTargets {
  const factor = (config.growth ?? BOARD_TARGET_GROWTH) ** (quarter - 1);
  return { oreT: config.oreTargetT * factor, profit: config.profitTarget * factor };
}

/** Book delivered ore kg toward the quarter (rubble disposal excluded). No-op without a board. */
export function recordBoardOre(board: BoardState | undefined, type: ContractType, kg: number): void {
  if (!board || !countsAsOreDelivery(type) || !(kg > 0)) return;
  board.oreDeliveredKg += kg;
}

/** This quarter's targets and progress so far. */
export function boardProgress(
  board: BoardState,
  finances: FinanceState,
): { targets: QuarterTargets; oreT: number; profit: number } {
  return {
    targets: quarterTargets(board.config, board.quarter),
    oreT: board.oreDeliveredKg / 1000,
    profit: getOperatingProfit(finances) - board.profitAtQuarterStart,
  };
}

/** Ticks until the quarter's review is due. */
export function boardTicksLeft(board: BoardState, tickCount: number): number {
  return Math.max(0, board.quarterStartTick + board.config.quarterTicks - tickCount);
}

/**
 * Quarter-end review, once the quarter has run its ticks: confidence moves, a met-all bonus is
 * booked, then the dividend sweep, then the next quarter opens. Null when no review is due.
 */
export function runBoardReview(
  state: Pick<GameState, 'cash' | 'finances' | 'tickCount'> & { board?: BoardState | undefined },
): BoardReview | null {
  const board = state.board;
  if (!board || state.tickCount - board.quarterStartTick < board.config.quarterTicks) return null;

  const { targets, oreT, profit } = boardProgress(board, state.finances);
  const oreMet = oreT >= targets.oreT;
  const profitMet = profit >= targets.profit;
  const confidenceBefore = board.confidence;
  let confidence = confidenceBefore;
  let bonus = 0;
  if (oreMet && profitMet) {
    confidence += BOARD_CONFIDENCE_MET_GAIN;
    bonus = targets.profit * BOARD_BONUS_PROFIT_SHARE;
    state.cash += bonus;
    addIncome(state.finances, bonus, 'bonus', `Board bonus Q${board.quarter}`, state.tickCount);
  } else {
    confidence -= (oreMet ? 0 : BOARD_CONFIDENCE_MISS_PENALTY) + (profitMet ? 0 : BOARD_CONFIDENCE_MISS_PENALTY);
  }
  board.confidence = Math.min(BOARD_CONFIDENCE_MAX, Math.max(0, confidence));

  const dividend = Math.max(0, state.cash - BOARD_DIVIDEND_CASH_FLOOR) * BOARD_DIVIDEND_RATE;
  deductExpense(state, dividend, 'dividends', `Dividends Q${board.quarter}`);
  board.lastDividend = dividend;

  const review: BoardReview = {
    quarter: board.quarter, oreMet, profitMet,
    confidenceBefore, confidenceAfter: board.confidence, bonus, dividend,
  };
  board.quarter += 1;
  board.quarterStartTick = state.tickCount;
  board.oreDeliveredKg = 0;
  board.profitAtQuarterStart = getOperatingProfit(state.finances);
  board.lastReview = review;
  return review;
}

/** True once board confidence has run out. */
export function isBoardFired(board: BoardState | undefined): boolean {
  return !!board && board.confidence <= 0;
}

/** Add `amount` to board confidence, clamped to its range; false when no board is attached (#1947). */
export function addBoardConfidence(board: BoardState | undefined, amount: number): boolean {
  // TODO: implement
  void board; void amount;
  return false;
}
