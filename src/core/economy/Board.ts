// BlastSimulator2026 — Board of directors: optional quarterly targets, confidence, dividends (#1946)

import type { GameState } from '../state/GameState.js';
import type { ContractType } from './Contract.js';
import type { FinanceState } from './Finance.js';

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

export interface QuarterTargets {
  oreT: number;
  profit: number;
}

export function createBoardState(_config: BoardConfig, _startTick?: number): BoardState {
  throw new Error('not implemented');
}

export function sanitizeBoardState(_raw: unknown): BoardState | undefined {
  return undefined;
}

export function quarterTargets(_config: BoardConfig, _quarter: number): QuarterTargets {
  throw new Error('not implemented');
}

export function recordBoardOre(_board: BoardState | undefined, _type: ContractType, _kg: number): void {
  // TODO: implement
}

export function boardProgress(
  _board: BoardState,
  _finances: FinanceState,
): { targets: QuarterTargets; oreT: number; profit: number; ticksLeft: number } {
  throw new Error('not implemented');
}

export function runBoardReview(_state: Pick<GameState, 'board' | 'cash' | 'finances' | 'tickCount'>): BoardReview | null {
  return null;
}

export function isBoardFired(_board: BoardState | undefined): boolean {
  return false;
}
