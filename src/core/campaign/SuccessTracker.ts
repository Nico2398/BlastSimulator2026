// BlastSimulator2026 — Success tracking per level
// Tracks per-level statistics for star rating, world map display, and medals.
// Stars (1-3): based on profit margin, safety, and ecology.

import type { GameState } from '../state/GameState.js';
import type { FragmentData } from '../mining/BlastExecution.js';
import { getFinancialReport } from '../economy/Finance.js';

// ── Types ──

export interface LevelStats {
  /** Total wealth accumulated in this session. */
  totalWealth: number;
  /** Maximum mine depth reached (Y below surface). */
  maxDepthReached: number;
  /** Set of unique ore type IDs extracted at least once. */
  uniqueOresExtracted: Set<string>;
  /** Total rock volume blasted (sum of fragment volumes). */
  totalVolumeBlasted: number;
  /** Total number of blasts performed. */
  blastsPerformed: number;
  /** Total worker deaths. */
  casualties: number;
  /** Best ecology score seen during the session. */
  bestEcology: number;
  /** Best safety score seen during the session. */
  bestSafety: number;
}

export interface StarRating {
  stars: 1 | 2 | 3;
  /** Breakdown of each criterion. */
  details: {
    profitPass: boolean;
    safetyPass: boolean;
    ecologyPass: boolean;
  };
}

// ── Factory ──

export function createLevelStats(): LevelStats {
  return {
    totalWealth: 0,
    maxDepthReached: 0,
    uniqueOresExtracted: new Set(),
    totalVolumeBlasted: 0,
    blastsPerformed: 0,
    casualties: 0,
    bestEcology: 0,
    bestSafety: 0,
  };
}

// ── Updaters ──

/**
 * Snapshot current game state into stats.
 * Call each tick (or at key moments like after a blast or transaction).
 */
export function snapshotStats(stats: LevelStats, state: GameState): void {
  const report = getFinancialReport(state.finances, 0);
  stats.totalWealth = report.netProfit;
  stats.casualties = state.damage.deathCount;
  stats.blastsPerformed = state.damage.blastCount;

  if (state.scores.ecology > stats.bestEcology) {
    stats.bestEcology = state.scores.ecology;
  }
  if (state.scores.safety > stats.bestSafety) {
    stats.bestSafety = state.scores.safety;
  }
}

/**
 * Record blast result into stats (fragment volumes and ore types).
 * Call after each blast execution.
 */
export function recordBlastResult(stats: LevelStats, fragments: FragmentData[]): void {
  for (const f of fragments) {
    stats.totalVolumeBlasted += f.volume;
    for (const oreId of Object.keys(f.oreDensities)) {
      if (f.oreDensities[oreId]! > 0) {
        stats.uniqueOresExtracted.add(oreId);
      }
    }
  }
}

/**
 * Update max depth reached.
 * depthY: voxel Y of the deepest blast/surveyed point, where 0 is deepest.
 * surfaceY: nominal surface Y of the grid.
 */
export function updateDepth(stats: LevelStats, voxelY: number, surfaceY: number): void {
  const depth = surfaceY - voxelY;
  if (depth > stats.maxDepthReached) {
    stats.maxDepthReached = depth;
  }
}

// ── Star rating ──

/**
 * Calculate a 1–3 star rating from level stats.
 *
 * Criteria (each worth 1 star point, minimum 1 star always awarded):
 *   - Profit star:   totalWealth >= profitTarget (level's unlock threshold)
 *   - Safety star:   casualties === 0 (zero deaths)
 *   - Ecology star:  bestEcology >= 60 (maintained good environmental record)
 *
 * Scoring:
 *   0 criteria = 1 star (minimum)
 *   1 criteria = 1 star
 *   2 criteria = 2 stars
 *   3 criteria = 3 stars
 */
export function calculateStarRating(stats: LevelStats, profitTarget: number): StarRating {
  const profitPass = stats.totalWealth >= profitTarget;
  const safetyPass = stats.casualties === 0;
  const ecologyPass = stats.bestEcology >= 60;

  const passCount = [profitPass, safetyPass, ecologyPass].filter(Boolean).length;
  const stars = (Math.max(1, passCount) as 1 | 2 | 3);

  return {
    stars,
    details: { profitPass, safetyPass, ecologyPass },
  };
}

// ── Serialization helpers ──

/** Convert LevelStats to a plain object (Set → Array) for JSON. */
export function serializeLevelStats(stats: LevelStats): object {
  return {
    ...stats,
    uniqueOresExtracted: [...stats.uniqueOresExtracted],
  };
}

/** Restore LevelStats from a plain object (Array → Set). */
export function deserializeLevelStats(raw: Record<string, unknown>): LevelStats {
  const stats = createLevelStats();
  if (typeof raw['totalWealth'] === 'number') stats.totalWealth = raw['totalWealth'];
  if (typeof raw['maxDepthReached'] === 'number') stats.maxDepthReached = raw['maxDepthReached'];
  if (typeof raw['totalVolumeBlasted'] === 'number') stats.totalVolumeBlasted = raw['totalVolumeBlasted'];
  if (typeof raw['blastsPerformed'] === 'number') stats.blastsPerformed = raw['blastsPerformed'];
  if (typeof raw['casualties'] === 'number') stats.casualties = raw['casualties'];
  if (typeof raw['bestEcology'] === 'number') stats.bestEcology = raw['bestEcology'];
  if (typeof raw['bestSafety'] === 'number') stats.bestSafety = raw['bestSafety'];
  if (Array.isArray(raw['uniqueOresExtracted'])) {
    stats.uniqueOresExtracted = new Set(raw['uniqueOresExtracted'] as string[]);
  }
  return stats;
}
