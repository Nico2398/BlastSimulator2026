// BlastSimulator2026 — Level completion and transition
// Handles profit threshold detection, level complete summary, and new-level setup.

import { createGame, createWorldState, type GameConfig, type GameState } from '../state/GameState.js';
import { getLevel } from './Level.js';
import { recordProfit, recordStars, startLevel, type CampaignState } from './Campaign.js';
import type { EventEmitter } from '../state/EventEmitter.js';
import { calculateStarRating, snapshotStats } from './SuccessTracker.js';
import { getFinancialReport } from '../economy/Finance.js';

// ── Types ──

export interface LevelCompleteSummary {
  levelId: string;
  totalProfit: number;
  blastsPerformed: number;
  casualties: number;
  finalWellBeing: number;
  finalEcology: number;
  finalSafety: number;
  /** Star rating earned this session (0..3). */
  stars: number;
}

export interface LevelCompleteResult {
  triggered: boolean;
  summary: LevelCompleteSummary | null;
}

// ── Result settlement ──

/**
 * Snapshot the session's stats and record profit and stars on the campaign.
 * `profit` defaults to the snapshot's total wealth. Returns the star rating.
 */
export function settleLevelResult(
  state: GameState,
  campaign: CampaignState,
  levelId: string,
  unlockThreshold: number,
  profit?: number,
): number {
  snapshotStats(state.levelStats, state);
  recordProfit(campaign, levelId, profit ?? state.levelStats.totalWealth);
  const { stars } = calculateStarRating(state.levelStats, unlockThreshold);
  recordStars(campaign, levelId, stars);
  return stars;
}

// ── Threshold check ──

/**
 * Check whether the current level's profit threshold has been crossed.
 * Call this each time profit changes (or each tick).
 * Emits 'level:complete' once per session when the threshold is reached, on a
 * first completion and on a replay of an already-completed level alike. The
 * session's `levelEnded` flag (set here on trigger) stops repeat triggers;
 * recordProfit only unlocks on the first completion. A session already ended
 * for another reason (e.g. bankruptcy) cannot be won: the flag blocks it.
 */
export function checkLevelComplete(
  state: GameState,
  campaign: CampaignState,
  emitter: EventEmitter,
): LevelCompleteResult {
  const levelId = campaign.activeLevelId;
  if (!levelId) return { triggered: false, summary: null };

  // Once per session: a trigger sets levelEnded.
  if (state.levelEnded) return { triggered: false, summary: null };

  const entry = campaign.levels[levelId];
  if (!entry) return { triggered: false, summary: null };

  const level = getLevel(levelId);
  if (!level) return { triggered: false, summary: null };

  const report = getFinancialReport(state.finances, 0);
  const profit = report.netProfit;
  if (profit < level.unlockThreshold) return { triggered: false, summary: null };

  // Threshold reached — close the session (guards repeat triggers), record, build summary
  state.levelEnded = true;
  const stars = settleLevelResult(state, campaign, levelId, level.unlockThreshold, profit);

  const summary: LevelCompleteSummary = {
    levelId,
    totalProfit: profit,
    blastsPerformed: state.damage.blastCount,
    casualties: state.damage.deathCount,
    finalWellBeing: state.scores.wellBeing,
    finalEcology: state.scores.ecology,
    finalSafety: state.scores.safety,
    stars,
  };

  emitter.emit('level:complete', summary);

  return { triggered: true, summary };
}

/**
 * Create a fresh GameState for the given level, preserving campaign state.
 * Returns null if the level is locked or doesn't exist.
 * `staffed` is tri-state (#1363): undefined uses the level's own
 * `startingSite`, true the global staffed composition, false a bare site.
 * It mirrors `new_game`/`sandbox start`'s own opt-in (#551): a
 * pre-hired roster and pre-purchased fleet, applied inside `createGame`
 * before terrain generation.
 */
export function createGameForLevel(
  campaign: CampaignState,
  levelId: string,
  staffed?: boolean,
): GameState | null {
  if (!startLevel(campaign, levelId)) return null;

  const level = getLevel(levelId);
  if (!level) return null;

  const config: GameConfig = {
    seed: level.terrainSeed,
    mineType: level.biome,
    startingCash: level.startingCash,
    eventFreqMultiplier: level.eventFreqMultiplier,
    scoreDecayRate: level.scoreDecayRate,
    ...(staffed ? { staffed: true } : {}),
  };

  const newState = createGame(config);
  newState.world = createWorldState(level.gridX, level.datum, level.gridZ, false);

  return newState;
}
