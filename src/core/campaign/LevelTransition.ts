// BlastSimulator2026 — Level completion and transition
// Handles profit threshold detection, level complete summary, and new-level setup.

import { createGame, createWorldState, type GameConfig, type GameState } from '../state/GameState.js';
import { getLevel } from './Level.js';
import { recordProfit, startLevel, type CampaignState } from './Campaign.js';
import type { EventEmitter } from '../state/EventEmitter.js';
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
}

export interface LevelCompleteResult {
  triggered: boolean;
  summary: LevelCompleteSummary | null;
}

// ── Threshold check ──

/**
 * Check whether the current level's profit threshold has been crossed.
 * Call this each time profit changes (or each tick).
 * Emits 'level:complete' event if newly completed.
 * Returns the completion result (triggered=true once, then false on subsequent calls).
 */
export function checkLevelComplete(
  state: GameState,
  campaign: CampaignState,
  emitter: EventEmitter,
): LevelCompleteResult {
  const levelId = campaign.activeLevelId;
  if (!levelId) return { triggered: false, summary: null };

  // Only trigger once (before recordProfit sets completed=true)
  const entry = campaign.levels[levelId];
  if (!entry || entry.completed) return { triggered: false, summary: null };

  const level = getLevel(levelId);
  if (!level) return { triggered: false, summary: null };

  const report = getFinancialReport(state.finances, 0);
  const profit = report.netProfit;
  if (profit < level.unlockThreshold) return { triggered: false, summary: null };

  // Threshold reached — record and build summary
  recordProfit(campaign, levelId, profit);

  const summary: LevelCompleteSummary = {
    levelId,
    totalProfit: profit,
    blastsPerformed: state.damage.blastCount,
    casualties: state.damage.deathCount,
    finalWellBeing: state.scores.wellBeing,
    finalEcology: state.scores.ecology,
    finalSafety: state.scores.safety,
  };

  emitter.emit('level:complete', summary);

  return { triggered: true, summary };
}

/**
 * Create a fresh GameState for the given level, preserving campaign state.
 * Returns null if the level is locked or doesn't exist.
 * `staffed` mirrors `new_game`/`sandbox start`'s own opt-in (#551): a
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
    ...(staffed ? { staffed: true } : {}),
  };

  const newState = createGame(config);
  newState.world = createWorldState(level.gridX, level.gridY, level.gridZ, false);

  return newState;
}
