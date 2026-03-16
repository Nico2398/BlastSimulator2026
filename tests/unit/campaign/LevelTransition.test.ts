import { describe, it, expect, vi } from 'vitest';
import { checkLevelComplete, createGameForLevel } from '../../../src/core/campaign/LevelTransition.js';
import { createCampaignState, startLevel } from '../../../src/core/campaign/Campaign.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { getAllLevels, getLevel } from '../../../src/core/campaign/Level.js';
import { addIncome, addExpense } from '../../../src/core/economy/Finance.js';

describe('Level completion and transition (7.3)', () => {
  it('profit reaching threshold triggers level complete flag', () => {
    const state = createGame({ seed: 42 });
    const campaign = createCampaignState();
    const level = getAllLevels()[0]!;
    startLevel(campaign, level.id);

    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('level:complete', handler);

    // Below threshold — should not trigger
    addIncome(state.finances, level.unlockThreshold - 1, 'sales', 'test', 0);
    let result = checkLevelComplete(state, campaign, emitter);
    expect(result.triggered).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    // Reset and add enough to hit threshold
    state.finances.transactions = [];
    state.finances.cash = level.startingCash;
    addIncome(state.finances, level.unlockThreshold, 'sales', 'test', 0);
    result = checkLevelComplete(state, campaign, emitter);
    expect(result.triggered).toBe(true);
    expect(result.summary).not.toBeNull();
    expect(result.summary!.levelId).toBe(level.id);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('level completion summary contains correct stats', () => {
    const state = createGame({ seed: 42 });
    const campaign = createCampaignState();
    const level = getAllLevels()[0]!;
    startLevel(campaign, level.id);

    addIncome(state.finances, level.unlockThreshold + 5000, 'sales', 'test', 0);
    addExpense(state.finances, 1000, 'equipment', 'test', 0);
    state.damage.blastCount = 7;
    state.damage.deathCount = 2;
    state.scores.wellBeing = 65;
    state.scores.ecology = 70;
    state.scores.safety = 80;

    const emitter = new EventEmitter();
    const result = checkLevelComplete(state, campaign, emitter);

    expect(result.triggered).toBe(true);
    const s = result.summary!;
    expect(s.totalProfit).toBe(level.unlockThreshold + 5000 - 1000);
    expect(s.blastsPerformed).toBe(7);
    expect(s.casualties).toBe(2);
    expect(s.finalWellBeing).toBe(65);
    expect(s.finalEcology).toBe(70);
    expect(s.finalSafety).toBe(80);
  });

  it('checkLevelComplete only triggers once', () => {
    const state = createGame({ seed: 42 });
    const campaign = createCampaignState();
    const level = getAllLevels()[0]!;
    startLevel(campaign, level.id);

    addIncome(state.finances, level.unlockThreshold, 'sales', 'test', 0);

    const emitter = new EventEmitter();
    const result1 = checkLevelComplete(state, campaign, emitter);
    const result2 = checkLevelComplete(state, campaign, emitter);

    expect(result1.triggered).toBe(true);
    expect(result2.triggered).toBe(false); // Already completed
  });

  it('starting a new level resets GameState but preserves campaign state', () => {
    const campaign = createCampaignState();
    const level1 = getAllLevels()[0]!;

    const newState = createGameForLevel(campaign, level1.id);
    expect(newState).not.toBeNull();
    expect(newState!.seed).toBe(level1.terrainSeed);
    expect(newState!.cash).toBe(level1.startingCash);
    // Fresh state has no blasts
    expect(newState!.damage.blastCount).toBe(0);
  });

  it('createGameForLevel returns null for a locked level', () => {
    const campaign = createCampaignState();
    const level2 = getAllLevels()[1]!;
    // Level 2 is locked at start
    expect(createGameForLevel(campaign, level2.id)).toBeNull();
  });

  it('continuing after completion allows further play (threshold check idempotent)', () => {
    const state = createGame({ seed: 42 });
    const campaign = createCampaignState();
    const level = getAllLevels()[0]!;
    startLevel(campaign, level.id);

    addIncome(state.finances, level.unlockThreshold * 2, 'sales', 'test', 0);

    const emitter = new EventEmitter();
    checkLevelComplete(state, campaign, emitter);

    // Further calls don't re-trigger
    const result = checkLevelComplete(state, campaign, emitter);
    expect(result.triggered).toBe(false);

    // State still has the level active (player can keep playing)
    expect(campaign.activeLevelId).toBe(level.id);
  });
});
