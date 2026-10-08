import type { FinanceState } from '../economy/Finance.js';

export interface LevelObjective {
  profit: number;
  target: number;
  /** Progress toward the target, clamped to 0..1. */
  fraction: number;
}

export function getLevelObjective(
  _activeLevelId: string | null,
  _finances: FinanceState,
): LevelObjective | null {
  // TODO: implement
  return null;
}
