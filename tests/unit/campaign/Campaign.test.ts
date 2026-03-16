import { describe, it, expect } from 'vitest';
import {
  createCampaignState,
  recordProfit,
  startLevel,
  getLevelProgress,
  returnToWorldMap,
} from '../../../src/core/campaign/Campaign.js';
import { getAllLevels } from '../../../src/core/campaign/Level.js';
import { serialize, deserialize } from '../../../src/core/state/SaveLoad.js';
import { createGame } from '../../../src/core/state/GameState.js';
// LevelProgress is part of campaign state — no extra imports needed

describe('Campaign state and progression (7.2)', () => {
  it('new campaign has only level 1 unlocked', () => {
    const campaign = createCampaignState();
    const levels = getAllLevels();
    expect(getLevelProgress(campaign, levels[0]!.id)?.unlocked).toBe(true);
    expect(getLevelProgress(campaign, levels[1]!.id)?.unlocked).toBe(false);
    expect(getLevelProgress(campaign, levels[2]!.id)?.unlocked).toBe(false);
  });

  it('reaching profit threshold on level 1 unlocks level 2', () => {
    const campaign = createCampaignState();
    const levels = getAllLevels();
    const lvl1 = levels[0]!;
    const lvl2 = levels[1]!;

    expect(getLevelProgress(campaign, lvl2.id)?.unlocked).toBe(false);
    recordProfit(campaign, lvl1.id, lvl1.unlockThreshold);
    expect(getLevelProgress(campaign, lvl2.id)?.unlocked).toBe(true);
  });

  it('reaching profit threshold on level 2 unlocks level 3', () => {
    const campaign = createCampaignState();
    const levels = getAllLevels();
    // Manually unlock and complete level 1 first
    const lvl1 = levels[0]!;
    const lvl2 = levels[1]!;
    const lvl3 = levels[2]!;

    recordProfit(campaign, lvl1.id, lvl1.unlockThreshold);
    expect(getLevelProgress(campaign, lvl2.id)?.unlocked).toBe(true);

    recordProfit(campaign, lvl2.id, lvl2.unlockThreshold);
    expect(getLevelProgress(campaign, lvl3.id)?.unlocked).toBe(true);
  });

  it('completing all 3 levels is tracked as campaign complete', () => {
    const campaign = createCampaignState();
    const levels = getAllLevels();

    expect(campaign.campaignComplete).toBe(false);

    for (const lvl of levels) {
      recordProfit(campaign, lvl.id, lvl.unlockThreshold);
    }

    expect(campaign.campaignComplete).toBe(true);
  });

  it('player can start a new game on any unlocked level', () => {
    const campaign = createCampaignState();
    const levels = getAllLevels();
    // Level 1 is unlocked
    expect(startLevel(campaign, levels[0]!.id)).toBe(true);
    expect(campaign.activeLevelId).toBe(levels[0]!.id);
  });

  it('starting a locked level returns false', () => {
    const campaign = createCampaignState();
    const levels = getAllLevels();
    expect(startLevel(campaign, levels[1]!.id)).toBe(false);
    expect(campaign.activeLevelId).toBeNull();
  });

  it('returnToWorldMap clears activeLevelId', () => {
    const campaign = createCampaignState();
    const levels = getAllLevels();
    startLevel(campaign, levels[0]!.id);
    expect(campaign.activeLevelId).toBe(levels[0]!.id);
    returnToWorldMap(campaign);
    expect(campaign.activeLevelId).toBeNull();
  });

  it('campaign state serializes/deserializes correctly with SaveLoad', () => {
    const state = createGame({ seed: 42 });
    const levels = getAllLevels();
    recordProfit(state.campaign, levels[0]!.id, levels[0]!.unlockThreshold);

    const json = serialize(state);
    const restored = deserialize(json);

    expect(getLevelProgress(restored.campaign, levels[0]!.id)?.completed).toBe(true);
    expect(getLevelProgress(restored.campaign, levels[1]!.id)?.unlocked).toBe(true);
  });
});
