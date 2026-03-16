// BlastSimulator2026 — Level completion and transition
// Handles profit threshold detection, level complete summary, and new-level setup.

import { createGame, type GameConfig, type GameState } from '../state/GameState.js';
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
 */
export function createGameForLevel(
  campaign: CampaignState,
  levelId: string,
): GameState | null {
  if (!startLevel(campaign, levelId)) return null;

  const level = getLevel(levelId);
  if (!level) return null;

  const config: GameConfig = {
    seed: level.terrainSeed,
    mineType: level.mineType,
    startingCash: level.startingCash,
  };

  const newState = createGame(config);
  newState.world = {
    sizeX: level.gridX,
    sizeY: level.gridY,
    sizeZ: level.gridZ,
    gridReady: false,
  };

  return newState;
}
