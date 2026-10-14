import { getOperatingProfit, type FinanceState } from '../economy/Finance.js';
import { clampedRatio } from '../math/ClampedRatio.js';
import { getLevel } from './Level.js';
import { SANDBOX_LEVEL_ID } from './Sandbox.js';

interface LevelObjective {
  profit: number;
  target: number;
  /** Progress toward the target, clamped to 0..1. */
  fraction: number;
}

/** Operating-profit progress toward the active level's unlock threshold; null when no target applies. */
export function getLevelObjective(
  activeLevelId: string | null,
  finances: FinanceState,
): LevelObjective | null {
  if (!activeLevelId || activeLevelId === SANDBOX_LEVEL_ID) return null;
  const target = getLevel(activeLevelId)?.unlockThreshold;
  if (target === undefined || target <= 0) return null;
  const profit = getOperatingProfit(finances);
  return { profit, target, fraction: clampedRatio(0, target, profit) };
}

/** Operating profit still missing to the active level's target (0 once met); Infinity when no target applies. */
export function getProfitShortfall(activeLevelId: string | null, finances: FinanceState): number {
  const objective = getLevelObjective(activeLevelId, finances);
  return objective ? Math.max(0, objective.target - objective.profit) : Infinity;
}
