import { describe, it, expect } from 'vitest';
import {
  createCampaignState,
  recordProfit,
  startLevel,
  getLevelProgress,
  returnToWorldMap,
  isCampaignLevel,
  isFinalCampaignLevel,
  isCampaignComplete,
  recordStars,
  getBestStars,
} from '../../../src/core/campaign/Campaign.js';
import { getAllLevels, getLevel } from '../../../src/core/campaign/Level.js';
import { serialize, deserialize } from '../../../src/core/state/SaveLoad.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { parseCampaignProfile } from '../../../src/persistence/CampaignProfile.js';
// LevelProgress is part of campaign state — no extra imports needed

describe('Campaign state and progression (7.2)', () => {
  it('new campaign unlocks tutorial and first campaign level', () => {
    const campaign = createCampaignState();
    const levels = getAllLevels();
    // tutorial_pit (index 0) is unlocked as the tutorial level
    expect(getLevelProgress(campaign, levels[0]!.id)?.unlocked).toBe(true);
    // dusty_hollow (index 1, difficultyTier 1) is unlocked as the first visible campaign level
    expect(getLevelProgress(campaign, levels[1]!.id)?.unlocked).toBe(true);
    // grumpstone_ridge (index 2) stays locked
    expect(getLevelProgress(campaign, levels[2]!.id)?.unlocked).toBe(false);
  });

  it('completing dusty_hollow unlocks grumpstone_ridge', () => {
    const campaign = createCampaignState();
    const levels = getAllLevels();
    const lvl1 = levels[1]!; // dusty_hollow — starts unlocked
    const lvl2 = levels[2]!; // grumpstone_ridge — starts locked

    expect(getLevelProgress(campaign, lvl1.id)?.unlocked).toBe(true);
    expect(getLevelProgress(campaign, lvl2.id)?.unlocked).toBe(false);
    recordProfit(campaign, lvl1.id, lvl1.unlockThreshold);
    expect(getLevelProgress(campaign, lvl2.id)?.unlocked).toBe(true);
  });

  it('completing grumpstone_ridge unlocks treranium_depths', () => {
    const campaign = createCampaignState();
    const levels = getAllLevels();
    // Complete tutorial_pit then dusty_hollow to unlock grumpstone_ridge
    const lvl1 = levels[0]!;
    const lvl2 = levels[1]!;
    const lvl3 = levels[2]!;

    recordProfit(campaign, lvl1.id, lvl1.unlockThreshold);
    expect(getLevelProgress(campaign, lvl2.id)?.unlocked).toBe(true);

    recordProfit(campaign, lvl2.id, lvl2.unlockThreshold);
    expect(getLevelProgress(campaign, lvl3.id)?.unlocked).toBe(true);
  });

  it('completing all campaign levels is tracked as campaign complete', () => {
    const campaign = createCampaignState();
    const levels = getAllLevels();

    expect(campaign.campaignComplete).toBe(false);

    for (const lvl of levels) {
      recordProfit(campaign, lvl.id, lvl.unlockThreshold);
    }

    expect(campaign.campaignComplete).toBe(true);
  });

  it('player can start a game on tutorial level', () => {
    const campaign = createCampaignState();
    const levels = getAllLevels();
    // tutorial_pit (index 0) is unlocked as the tutorial level
    expect(startLevel(campaign, levels[0]!.id)).toBe(true);
    expect(campaign.activeLevelId).toBe(levels[0]!.id);
  });

  it('starting a locked level returns false', () => {
    const campaign = createCampaignState();
    const levels = getAllLevels();
    expect(startLevel(campaign, levels[2]!.id)).toBe(false);
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

describe('campaign completion excludes the tutorial (#1320)', () => {
  const REAL = ['dusty_hollow', 'grumpstone_ridge', 'treranium_depths', 'shareholder_summit'];

  function win(c: ReturnType<typeof createCampaignState>, id: string): void {
    recordProfit(c, id, getLevel(id)!.unlockThreshold);
  }

  it('isCampaignLevel is true for tier > 0 levels', () => {
    for (const id of REAL) expect(isCampaignLevel(getLevel(id)!)).toBe(true);
  });

  it('isCampaignLevel is false for the tutorial (tier 0)', () => {
    expect(isCampaignLevel(getLevel('tutorial_pit')!)).toBe(false);
    expect(isCampaignLevel({ difficultyTier: 0 })).toBe(false);
  });

  it('isFinalCampaignLevel is true only for shareholder_summit (#1949)', () => {
    expect(isFinalCampaignLevel('shareholder_summit')).toBe(true);
    expect(isFinalCampaignLevel('treranium_depths')).toBe(false);
    expect(isFinalCampaignLevel('dusty_hollow')).toBe(false);
    expect(isFinalCampaignLevel('grumpstone_ridge')).toBe(false);
    expect(isFinalCampaignLevel('tutorial_pit')).toBe(false);
    expect(isFinalCampaignLevel('nowhere')).toBe(false);
  });

  it('completing the 4 real levels (tutorial untouched) sets campaignComplete', () => {
    const c = createCampaignState();
    for (const id of REAL) win(c, id);
    expect(getLevelProgress(c, 'tutorial_pit')?.completed).toBe(false);
    expect(c.campaignComplete).toBe(true);
  });

  it('the first three real levels do not complete the campaign: the summit is still open (#1949)', () => {
    const c = createCampaignState();
    for (const id of ['dusty_hollow', 'grumpstone_ridge', 'treranium_depths']) win(c, id);
    expect(c.campaignComplete).toBe(false);
    expect(isCampaignComplete(c)).toBe(false);
    win(c, 'shareholder_summit');
    expect(c.campaignComplete).toBe(true);
    expect(isCampaignComplete(c)).toBe(true);
  });

  it('completing treranium_depths unlocks shareholder_summit, locked until then', () => {
    const c = createCampaignState();
    expect(c.levels['shareholder_summit']!.unlocked).toBe(false);
    win(c, 'treranium_depths');
    expect(c.levels['shareholder_summit']!.unlocked).toBe(true);
    expect(c.campaignComplete).toBe(false);
  });

  it('two real levels do not complete the campaign', () => {
    const c = createCampaignState();
    win(c, 'dusty_hollow');
    win(c, 'grumpstone_ridge');
    expect(c.campaignComplete).toBe(false);
  });

  it('only the tutorial does not complete the campaign', () => {
    const c = createCampaignState();
    win(c, 'tutorial_pit');
    expect(c.campaignComplete).toBe(false);
  });

  it('tutorial plus all 4 real levels completes, in any order', () => {
    const orders = [
      ['tutorial_pit', ...REAL],
      [...REAL, 'tutorial_pit'],
      ['shareholder_summit', 'grumpstone_ridge', 'tutorial_pit', 'treranium_depths', 'dusty_hollow'],
    ];
    for (const order of orders) {
      const c = createCampaignState();
      for (const id of order) win(c, id);
      expect(c.campaignComplete).toBe(true);
    }
  });

  it('replaying a completed level does not flip campaignComplete back', () => {
    const c = createCampaignState();
    for (const id of REAL) win(c, id);
    recordProfit(c, 'dusty_hollow', 1);
    expect(c.campaignComplete).toBe(true);
  });

  it('isCampaignComplete derives from levels, ignoring a stale stored flag', () => {
    const c = createCampaignState();
    expect(isCampaignComplete(c)).toBe(false);
    for (const id of REAL) c.levels[id]!.completed = true;
    c.campaignComplete = false; // stale
    expect(isCampaignComplete(c)).toBe(true);
    c.levels['shareholder_summit']!.completed = false;
    c.campaignComplete = true; // stale the other way
    expect(isCampaignComplete(c)).toBe(false);
  });

  it('isCampaignComplete ignores the tutorial entry', () => {
    const c = createCampaignState();
    c.levels['tutorial_pit']!.completed = true;
    expect(isCampaignComplete(c)).toBe(false);
  });
});

describe('best stars (#1311)', () => {
  it('createCampaignState starts every level at 0 stars', () => {
    const c = createCampaignState();
    for (const lvl of getAllLevels()) {
      expect(c.levels[lvl.id]!.bestStars).toBe(0);
      expect(getBestStars(c.levels[lvl.id])).toBe(0);
    }
  });

  it('recordStars stores a first rating', () => {
    const c = createCampaignState();
    recordStars(c, 'dusty_hollow', 2);
    expect(c.levels['dusty_hollow']!.bestStars).toBe(2);
  });

  it('recordStars only raises: a worse replay keeps the best', () => {
    const c = createCampaignState();
    recordStars(c, 'dusty_hollow', 3);
    recordStars(c, 'dusty_hollow', 1);
    expect(c.levels['dusty_hollow']!.bestStars).toBe(3);
    recordStars(c, 'grumpstone_ridge', 1);
    recordStars(c, 'grumpstone_ridge', 2);
    expect(c.levels['grumpstone_ridge']!.bestStars).toBe(2);
  });

  it('recordStars clamps to 0..3', () => {
    const c = createCampaignState();
    recordStars(c, 'dusty_hollow', 7);
    expect(c.levels['dusty_hollow']!.bestStars).toBe(3);
    recordStars(c, 'grumpstone_ridge', -2);
    expect(c.levels['grumpstone_ridge']!.bestStars).toBe(0);
  });

  it('recordStars ignores an unknown level without throwing', () => {
    const c = createCampaignState();
    const before = JSON.stringify(c);
    expect(() => recordStars(c, 'no_such_level', 3)).not.toThrow();
    expect(JSON.stringify(c)).toBe(before);
    expect(c.levels['no_such_level']).toBeUndefined();
  });

  it('recordStars upgrades a legacy entry that has no bestStars field', () => {
    const c = createCampaignState();
    delete c.levels['dusty_hollow']!.bestStars;
    recordStars(c, 'dusty_hollow', 2);
    expect(c.levels['dusty_hollow']!.bestStars).toBe(2);
  });

  it('getBestStars returns the stored value when present', () => {
    const c = createCampaignState();
    const p = c.levels['dusty_hollow']!;
    p.completed = true;
    p.bestStars = 3;
    expect(getBestStars(p)).toBe(3);
  });

  it('getBestStars: stored 0 on an incomplete level stays 0', () => {
    const c = createCampaignState();
    expect(getBestStars(c.levels['dusty_hollow'])).toBe(0);
  });

  it('getBestStars: legacy completed level without the field reads 1', () => {
    const c = createCampaignState();
    const p = c.levels['dusty_hollow']!;
    delete p.bestStars;
    p.completed = true;
    expect(getBestStars(p)).toBe(1);
  });

  it('getBestStars: legacy uncompleted level without the field reads 0', () => {
    const c = createCampaignState();
    const p = c.levels['dusty_hollow']!;
    delete p.bestStars;
    expect(getBestStars(p)).toBe(0);
  });

  it('getBestStars(undefined) is 0', () => {
    expect(getBestStars(undefined)).toBe(0);
  });

  it('bestStars survives a save/load round trip', () => {
    const state = createGame({ seed: 42 });
    recordStars(state.campaign, 'dusty_hollow', 3);
    const restored = deserialize(serialize(state));
    expect(restored.campaign.levels['dusty_hollow']!.bestStars).toBe(3);
    expect(getBestStars(restored.campaign.levels['dusty_hollow'])).toBe(3);
  });
});

describe('shareholder summit unlock chain and persistence (#1949)', () => {
  it('starts locked on a fresh campaign', () => {
    const c = createCampaignState();
    expect(c.levels['shareholder_summit']).toBeDefined();
    expect(c.levels['shareholder_summit']!.unlocked).toBe(false);
    expect(c.levels['shareholder_summit']!.completed).toBe(false);
    expect(startLevel(c, 'shareholder_summit')).toBe(false);
    expect(c.activeLevelId).toBeNull();
  });

  it('completing treranium_depths unlocks shareholder_summit', () => {
    const c = createCampaignState();
    recordProfit(c, 'dusty_hollow', getLevel('dusty_hollow')!.unlockThreshold);
    recordProfit(c, 'grumpstone_ridge', getLevel('grumpstone_ridge')!.unlockThreshold);
    expect(getLevelProgress(c, 'shareholder_summit')?.unlocked).toBe(false);
    const threshold = getLevel('treranium_depths')!.unlockThreshold;
    expect(recordProfit(c, 'treranium_depths', threshold - 1)).toBe(false);
    expect(getLevelProgress(c, 'shareholder_summit')?.unlocked).toBe(false);
    expect(recordProfit(c, 'treranium_depths', 1)).toBe(true);
    expect(getLevelProgress(c, 'shareholder_summit')?.unlocked).toBe(true);
    expect(startLevel(c, 'shareholder_summit')).toBe(true);
    expect(c.activeLevelId).toBe('shareholder_summit');
  });

  it('completing the summit is reported as a fresh completion and ends the campaign', () => {
    const c = createCampaignState();
    for (const id of ['dusty_hollow', 'grumpstone_ridge', 'treranium_depths']) recordProfit(c, id, getLevel(id)!.unlockThreshold);
    expect(recordProfit(c, 'shareholder_summit', getLevel('shareholder_summit')!.unlockThreshold)).toBe(true);
    expect(c.campaignComplete).toBe(true);
    // replay: no second completion
    expect(recordProfit(c, 'shareholder_summit', 1)).toBe(false);
    expect(c.campaignComplete).toBe(true);
  });

  it('records stars for the summit like any other level', () => {
    const c = createCampaignState();
    recordStars(c, 'shareholder_summit', 2);
    recordStars(c, 'shareholder_summit', 1);
    expect(c.levels['shareholder_summit']!.bestStars).toBe(2);
    recordStars(c, 'shareholder_summit', 9);
    expect(c.levels['shareholder_summit']!.bestStars).toBe(3);
    expect(getBestStars(c.levels['shareholder_summit'])).toBe(3);
  });

  it('an old profile with only the four older level entries loads with the summit locked', () => {
    const entry = (completed: boolean) => ({ levelId: '', unlocked: true, completed, cumulativeProfit: 0, bestSessionProfit: 0 });
    const profile = parseCampaignProfile({
      version: 1,
      campaign: {
        levels: {
          tutorial_pit: entry(true), dusty_hollow: entry(true), grumpstone_ridge: entry(true), treranium_depths: entry(false),
        },
        activeLevelId: null,
        campaignComplete: false,
      },
      bestStars: {},
    });
    const summit = profile.campaign.levels['shareholder_summit'];
    expect(summit).toBeDefined();
    expect(summit!.unlocked).toBe(false);
    expect(summit!.completed).toBe(false);
    expect(isCampaignComplete(profile.campaign)).toBe(false);
  });

  it('an old profile that had completed treranium_depths unlocks the summit but does not complete it', () => {
    const done = { unlocked: true, completed: true, cumulativeProfit: 1e7, bestSessionProfit: 1e7 };
    const profile = parseCampaignProfile({
      version: 1,
      campaign: { levels: { dusty_hollow: done, grumpstone_ridge: done, treranium_depths: done }, activeLevelId: null, campaignComplete: false },
      bestStars: {},
    });
    expect(profile.campaign.levels['shareholder_summit']!.unlocked).toBe(true);
    expect(profile.campaign.levels['shareholder_summit']!.completed).toBe(false);
    expect(isCampaignComplete(profile.campaign)).toBe(false);
  });

  it('a summit completion survives a save round trip', () => {
    const state = createGame({ seed: 42 });
    recordProfit(state.campaign, 'shareholder_summit', getLevel('shareholder_summit')!.unlockThreshold);
    const restored = deserialize(serialize(state));
    expect(getLevelProgress(restored.campaign, 'shareholder_summit')?.completed).toBe(true);
  });
});
