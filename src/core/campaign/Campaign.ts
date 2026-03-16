// BlastSimulator2026 — Campaign state and progression
// Tracks unlocked levels, completed levels, and cumulative profit per level.
// Campaign state persists across level restarts; only the current level's
// GameState is reset when starting a new level.

import { getAllLevels, getLevel } from './Level.js';

// ── Types ──

export interface LevelProgress {
  levelId: string;
  /** Whether this level is available to play. */
  unlocked: boolean;
  /** Whether the player has met the profit threshold. */
  completed: boolean;
  /** Cumulative profit earned across all plays of this level. */
  cumulativeProfit: number;
  /** Best single-session profit (for star rating). */
  bestSessionProfit: number;
}

export interface CampaignState {
  /** Progress entry for each level, keyed by level ID. */
  levels: Record<string, LevelProgress>;
  /** ID of the currently active level, or null if on world map. */
  activeLevelId: string | null;
  /** True when all 3 levels have been completed. */
  campaignComplete: boolean;
}

// ── Factory ──

/** Create a fresh campaign with only level 1 unlocked. */
export function createCampaignState(): CampaignState {
  const all = getAllLevels();
  const levels: Record<string, LevelProgress> = {};

  for (let i = 0; i < all.length; i++) {
    const lvl = all[i]!;
    levels[lvl.id] = {
      levelId: lvl.id,
      unlocked: i === 0, // Only first level starts unlocked
      completed: false,
      cumulativeProfit: 0,
      bestSessionProfit: 0,
    };
  }

  return {
    levels,
    activeLevelId: null,
    campaignComplete: false,
  };
}

// ── Progression ──

/**
 * Record profit earned during a session. Returns true if the level was
 * just completed (threshold reached for the first time this call).
 */
export function recordProfit(
  campaign: CampaignState,
  levelId: string,
  profit: number,
): boolean {
  const entry = campaign.levels[levelId];
  if (!entry) return false;

  const wasCompleted = entry.completed;
  entry.cumulativeProfit += profit;
  if (profit > entry.bestSessionProfit) {
    entry.bestSessionProfit = profit;
  }

  const level = getLevel(levelId);
  if (!level) return false;

  const nowComplete = entry.cumulativeProfit >= level.unlockThreshold;
  if (!wasCompleted && nowComplete) {
    entry.completed = true;
    _unlockNext(campaign, levelId);
    _checkCampaignComplete(campaign);
    return true;
  }

  return false;
}

/** Unlock the level that follows the given level (by difficulty tier order). */
function _unlockNext(campaign: CampaignState, completedId: string): void {
  const all = getAllLevels();
  const idx = all.findIndex(l => l.id === completedId);
  if (idx < 0 || idx + 1 >= all.length) return;
  const next = all[idx + 1]!;
  const entry = campaign.levels[next.id];
  if (entry) entry.unlocked = true;
}

/** Check if all levels are completed; set campaignComplete flag. */
function _checkCampaignComplete(campaign: CampaignState): void {
  const all = getAllLevels();
  campaign.campaignComplete = all.every(l => campaign.levels[l.id]?.completed === true);
}

/**
 * Start a level. Returns false if the level is locked or doesn't exist.
 * Sets activeLevelId. The caller must create a new GameState from the level def.
 */
export function startLevel(campaign: CampaignState, levelId: string): boolean {
  const entry = campaign.levels[levelId];
  if (!entry || !entry.unlocked) return false;
  campaign.activeLevelId = levelId;
  return true;
}

/** Return to world map (clear active level). */
export function returnToWorldMap(campaign: CampaignState): void {
  campaign.activeLevelId = null;
}

/** Get progress for a specific level. */
export function getLevelProgress(
  campaign: CampaignState,
  levelId: string,
): LevelProgress | undefined {
  return campaign.levels[levelId];
}
