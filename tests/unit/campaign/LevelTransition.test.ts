import { describe, it, expect, vi } from 'vitest';
import { checkGameOverConditions } from '../../../src/core/engine/GameOverConditions.js';
import { checkLevelComplete, createGameForLevel } from '../../../src/core/campaign/LevelTransition.js';
import { createCampaignState, startLevel, recordStars, getBestStars } from '../../../src/core/campaign/Campaign.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { getAllLevels, getLevel } from '../../../src/core/campaign/Level.js';
import { STARTING_SITE_STAFFED_COMPOSITION } from '../../../src/core/config/balance.js';
import { addIncome, addExpense } from '../../../src/core/economy/Finance.js';

describe('Level completion counts operating profit (#1363)', () => {
  function started() {
    const state = createGame({ seed: 42 });
    const campaign = createCampaignState();
    const level = getLevel('dusty_hollow')!;
    campaign.levels['dusty_hollow']!.unlocked = true;
    startLevel(campaign, level.id);
    return { state, campaign, level };
  }

  it('fires when operating profit reaches the threshold despite a large capital outlay', () => {
    const { state, campaign, level } = started();
    addExpense(state.finances, 92800, 'equipment', 'fleet', 0);
    addExpense(state.finances, 15000, 'construction', 'warehouse', 0);
    addIncome(state.finances, level.unlockThreshold, 'contracts', 'c', 1);
    const result = checkLevelComplete(state, campaign, new EventEmitter());
    expect(result.triggered).toBe(true);
    expect(result.summary!.totalProfit).toBe(level.unlockThreshold);
    expect(state.levelEnded).toBe(true);
  });

  it('does not fire when only refunds lift net profit past the threshold', () => {
    const { state, campaign, level } = started();
    addIncome(state.finances, level.unlockThreshold, 'refund', 'r', 0);
    expect(checkLevelComplete(state, campaign, new EventEmitter()).triggered).toBe(false);
  });

  it('does not fire when running costs keep operating profit below the threshold', () => {
    const { state, campaign, level } = started();
    addIncome(state.finances, level.unlockThreshold + 500, 'contracts', 'c', 0);
    addExpense(state.finances, 1000, 'salaries', 'w', 0);
    expect(checkLevelComplete(state, campaign, new EventEmitter()).triggered).toBe(false);
  });
});

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
    // Operating profit (#1363): the 'equipment' purchase is capital outlay, not counted.
    expect(s.totalProfit).toBe(level.unlockThreshold + 5000);
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
    expect(state.levelEnded).toBe(true); // checkLevelComplete closes the session itself
    const result2 = checkLevelComplete(state, campaign, emitter);

    expect(result1.triggered).toBe(true);
    expect(result2.triggered).toBe(false); // Session already ended
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
    expect(newState!.world!.datum).toBe(getLevel(level1.id)!.datum);
  });

  it('createGameForLevel returns null for a locked level', () => {
    const campaign = createCampaignState();
    const level3 = getAllLevels()[2]!;
    // Level 3 (grumpstone_ridge) is locked at start
    expect(createGameForLevel(campaign, level3.id)).toBeNull();
  });

  it('continuing after completion allows further play (threshold check idempotent)', () => {
    const state = createGame({ seed: 42 });
    const campaign = createCampaignState();
    const level = getAllLevels()[0]!;
    startLevel(campaign, level.id);

    addIncome(state.finances, level.unlockThreshold * 2, 'sales', 'test', 0);

    const emitter = new EventEmitter();
    checkLevelComplete(state, campaign, emitter);
    expect(state.levelEnded).toBe(true);

    // Further calls don't re-trigger
    const result = checkLevelComplete(state, campaign, emitter);
    expect(result.triggered).toBe(false);

    // State still has the level active (player can keep playing)
    expect(campaign.activeLevelId).toBe(level.id);
  });

  describe('replay of an already-completed level (#1310)', () => {
    /** Complete level 1 once with session profit `p1`; returns campaign + level. */
    function completeFirstPlay(p1: number) {
      const campaign = createCampaignState();
      const level = getAllLevels()[0]!;
      startLevel(campaign, level.id);
      const first = createGame({ seed: 42 });
      addIncome(first.finances, p1, 'sales', 'test', 0);
      const r = checkLevelComplete(first, campaign, new EventEmitter());
      expect(r.triggered).toBe(true);
      return { campaign, level };
    }

    /** Fresh game on the already-completed level with `income` earned. */
    function freshReplay(campaign: ReturnType<typeof createCampaignState>, levelId: string, income: number) {
      startLevel(campaign, levelId);
      const state = createGame({ seed: 42 });
      state.campaign = campaign;
      if (income > 0) addIncome(state.finances, income, 'sales', 'test', 0);
      return state;
    }

    it('replay beating best profit triggers victory and updates bestSessionProfit', () => {
      const threshold = getAllLevels()[0]!.unlockThreshold;
      const p1 = threshold + 100;
      const p2 = threshold + 5000;
      const { campaign, level } = completeFirstPlay(p1);
      expect(campaign.levels[level.id]!.bestSessionProfit).toBe(p1);

      const state = freshReplay(campaign, level.id, p2);
      const emitter = new EventEmitter();
      const handler = vi.fn();
      emitter.on('level:complete', handler);

      const result = checkLevelComplete(state, campaign, emitter);
      expect(result.triggered).toBe(true);
      expect(result.summary).not.toBeNull();
      expect(result.summary!.totalProfit).toBe(p2);
      expect(campaign.levels[level.id]!.bestSessionProfit).toBe(p2);
      expect(handler).toHaveBeenCalledOnce();
    });

    it('replay through checkGameOverConditions ends the level as completed', () => {
      const threshold = getAllLevels()[0]!.unlockThreshold;
      const { campaign, level } = completeFirstPlay(threshold + 100);
      const state = freshReplay(campaign, level.id, threshold + 5000);

      const report = checkGameOverConditions(state, new EventEmitter());
      expect(report.levelCompleted).toBe(true);
      expect(state.levelEnded).toBe(true);
      expect(state.levelEndReason).toBe('completed');
    });

    it('lower replay at or above threshold still wins but keeps the best profit', () => {
      const threshold = getAllLevels()[0]!.unlockThreshold;
      const p1 = threshold + 5000;
      const p2 = threshold + 10;
      const { campaign, level } = completeFirstPlay(p1);
      const state = freshReplay(campaign, level.id, p2);

      const result = checkLevelComplete(state, campaign, new EventEmitter());
      expect(result.triggered).toBe(true);
      expect(result.summary!.totalProfit).toBe(p2);
      expect(campaign.levels[level.id]!.bestSessionProfit).toBe(p1);
    });

    it('replay never re-unlocks levels or flips campaignComplete twice', () => {
      const all = getAllLevels();
      const threshold = all[0]!.unlockThreshold;
      const { campaign, level } = completeFirstPlay(threshold + 100);
      const next = all[1]!;
      const later = all[2]!;
      expect(campaign.levels[next.id]!.unlocked).toBe(true);
      // Simulate state that a second unlock would visibly overwrite.
      campaign.levels[next.id]!.unlocked = false;
      campaign.levels[later.id]!.unlocked = false;
      campaign.campaignComplete = false;

      const state = freshReplay(campaign, level.id, threshold + 5000);
      const result = checkLevelComplete(state, campaign, new EventEmitter());

      expect(result.triggered).toBe(true);
      expect(campaign.levels[next.id]!.unlocked).toBe(false);
      expect(campaign.levels[later.id]!.unlocked).toBe(false);
      expect(campaign.campaignComplete).toBe(false);
    });

    it('replay keeps campaignComplete true once the whole campaign is done', () => {
      const all = getAllLevels();
      const threshold = all[0]!.unlockThreshold;
      const { campaign, level } = completeFirstPlay(threshold + 100);
      for (const l of all) campaign.levels[l.id]!.completed = true;
      campaign.campaignComplete = true;

      const state = freshReplay(campaign, level.id, threshold + 5000);
      expect(checkLevelComplete(state, campaign, new EventEmitter()).triggered).toBe(true);
      expect(campaign.campaignComplete).toBe(true);
    });

    it('replay below threshold does not trigger and leaves best profit unchanged', () => {
      const threshold = getAllLevels()[0]!.unlockThreshold;
      const p1 = threshold + 100;
      const { campaign, level } = completeFirstPlay(p1);
      const before = campaign.levels[level.id]!.cumulativeProfit;
      const state = freshReplay(campaign, level.id, threshold - 1);

      const emitter = new EventEmitter();
      const handler = vi.fn();
      emitter.on('level:complete', handler);
      const result = checkLevelComplete(state, campaign, emitter);

      expect(result.triggered).toBe(false);
      expect(result.summary).toBeNull();
      expect(campaign.levels[level.id]!.bestSessionProfit).toBe(p1);
      expect(campaign.levels[level.id]!.cumulativeProfit).toBe(before);
      expect(handler).not.toHaveBeenCalled();
    });

    it('triggers at most once per session (the trigger sets levelEnded)', () => {
      const threshold = getAllLevels()[0]!.unlockThreshold;
      const { campaign, level } = completeFirstPlay(threshold + 100);
      const state = freshReplay(campaign, level.id, threshold + 5000);
      const emitter = new EventEmitter();
      const handler = vi.fn();
      emitter.on('level:complete', handler);

      expect(checkLevelComplete(state, campaign, emitter).triggered).toBe(true);
      expect(state.levelEnded).toBe(true);
      const cumulative = campaign.levels[level.id]!.cumulativeProfit;

      for (let i = 0; i < 3; i++) {
        const again = checkLevelComplete(state, campaign, emitter);
        expect(again.triggered).toBe(false);
        expect(again.summary).toBeNull();
      }
      expect(campaign.levels[level.id]!.cumulativeProfit).toBe(cumulative);
      expect(handler).toHaveBeenCalledOnce();
    });
  });
});

describe('level completion records stars (#1311)', () => {
  /** Session at the profit threshold with the given safety/ecology end state. */
  function finishedSession(opts: { deaths: number; ecology: number; profitMultiple?: number }) {
    const state = createGame({ seed: 42 });
    const campaign = createCampaignState();
    const level = getAllLevels()[0]!;
    startLevel(campaign, level.id);
    addIncome(state.finances, level.unlockThreshold * (opts.profitMultiple ?? 1), 'sales', 'test', 0);
    state.damage.deathCount = opts.deaths;
    state.scores.ecology = opts.ecology;
    state.levelStats.casualties = opts.deaths;
    state.levelStats.finalEcology = opts.ecology;
    state.levelStats.bestEcology = opts.ecology;
    state.levelStats.totalWealth = level.unlockThreshold * (opts.profitMultiple ?? 1);
    return { state, campaign, level };
  }

  it('clean run with good ecology records and reports 3 stars', () => {
    const { state, campaign, level } = finishedSession({ deaths: 0, ecology: 75 });
    const result = checkLevelComplete(state, campaign, new EventEmitter());
    expect(result.summary!.stars).toBe(3);
    expect(campaign.levels[level.id]!.bestStars).toBe(3);
    expect(getBestStars(campaign.levels[level.id])).toBe(3);
  });

  it('a death costs the safety star', () => {
    const { state, campaign, level } = finishedSession({ deaths: 2, ecology: 75 });
    const result = checkLevelComplete(state, campaign, new EventEmitter());
    expect(result.summary!.stars).toBe(2);
    expect(campaign.levels[level.id]!.bestStars).toBe(2);
  });

  it('poor ecology costs the ecology star', () => {
    const { state, campaign } = finishedSession({ deaths: 0, ecology: 59 });
    expect(checkLevelComplete(state, campaign, new EventEmitter()).summary!.stars).toBe(2);
  });

  it('deaths and poor ecology still leave the profit star: 1 star', () => {
    const { state, campaign, level } = finishedSession({ deaths: 3, ecology: 10 });
    const result = checkLevelComplete(state, campaign, new EventEmitter());
    expect(result.summary!.stars).toBe(1);
    expect(campaign.levels[level.id]!.bestStars).toBe(1);
  });

  it('the level:complete event carries the stars', () => {
    const { state, campaign } = finishedSession({ deaths: 0, ecology: 75 });
    const emitter = new EventEmitter();
    const handler = vi.fn();
    emitter.on('level:complete', handler);
    checkLevelComplete(state, campaign, emitter);
    expect(handler.mock.calls[0]![0].stars).toBe(3);
  });

  it('a worse replay does not lower the stored stars', () => {
    const { state, campaign, level } = finishedSession({ deaths: 0, ecology: 75 });
    checkLevelComplete(state, campaign, new EventEmitter());
    expect(campaign.levels[level.id]!.bestStars).toBe(3);

    const replay = finishedSession({ deaths: 4, ecology: 5 });
    replay.campaign.levels[level.id] = campaign.levels[level.id]!;
    replay.campaign.activeLevelId = level.id;
    const result = checkLevelComplete(replay.state, replay.campaign, new EventEmitter());
    expect(result.summary!.stars).toBe(1);
    expect(replay.campaign.levels[level.id]!.bestStars).toBe(3);
  });

  it('a better replay raises the stored stars', () => {
    const { state, campaign, level } = finishedSession({ deaths: 5, ecology: 5 });
    checkLevelComplete(state, campaign, new EventEmitter());
    expect(campaign.levels[level.id]!.bestStars).toBe(1);

    recordStars(campaign, level.id, 1); // idempotent at same value
    const replay = finishedSession({ deaths: 0, ecology: 80 });
    replay.campaign.levels[level.id] = campaign.levels[level.id]!;
    checkLevelComplete(replay.state, replay.campaign, new EventEmitter());
    expect(replay.campaign.levels[level.id]!.bestStars).toBe(3);
  });

  it('no stars are recorded when the threshold is not reached', () => {
    const state = createGame({ seed: 42 });
    const campaign = createCampaignState();
    const level = getAllLevels()[0]!;
    startLevel(campaign, level.id);
    addIncome(state.finances, level.unlockThreshold - 1, 'sales', 'test', 0);
    checkLevelComplete(state, campaign, new EventEmitter());
    expect(campaign.levels[level.id]!.bestStars).toBe(0);
  });
});

describe('createGameForLevel staffed is tri-state (#1363)', () => {
  function unlocked() {
    const campaign = createCampaignState();
    campaign.levels['dusty_hollow']!.unlocked = true;
    return campaign;
  }

  it('undefined on dusty_hollow opens with the level starting site roster and fleet', () => {
    const state = createGameForLevel(unlocked(), 'dusty_hollow')!;
    expect(state.employees.employees.map(e => e.role).sort()).toEqual(['blaster', 'driller', 'driver']);
    expect(state.vehicles.vehicles.map(v => v.type).sort()).toEqual(['debris_hauler', 'drill_rig']);
  });

  it('undefined deducts no cash for the free crew and fleet', () => {
    const state = createGameForLevel(unlocked(), 'dusty_hollow')!;
    expect(state.cash).toBe(getLevel('dusty_hollow')!.startingCash);
  });

  it('false on dusty_hollow opens a bare site', () => {
    const state = createGameForLevel(unlocked(), 'dusty_hollow', false)!;
    expect(state.employees.employees).toHaveLength(0);
    expect(state.vehicles.vehicles).toHaveLength(0);
  });

  it('true on dusty_hollow uses the global staffed composition, not the level one', () => {
    const state = createGameForLevel(unlocked(), 'dusty_hollow', true)!;
    expect(state.employees.employees).toHaveLength(STARTING_SITE_STAFFED_COMPOSITION.employees.length);
    expect(state.vehicles.vehicles).toHaveLength(STARTING_SITE_STAFFED_COMPOSITION.vehicles.length);
  });

  it('undefined on the tutorial stays bare', () => {
    const state = createGameForLevel(createCampaignState(), 'tutorial_pit')!;
    expect(state.employees.employees).toHaveLength(0);
    expect(state.vehicles.vehicles).toHaveLength(0);
  });

  it('undefined on grumpstone_ridge stays bare', () => {
    const campaign = createCampaignState();
    campaign.levels['grumpstone_ridge']!.unlocked = true;
    const state = createGameForLevel(campaign, 'grumpstone_ridge')!;
    expect(state.employees.employees).toHaveLength(0);
  });
});

describe('createGameForLevel fixed weather (#1585)', () => {
  it('tutorial_pit game has a pinned sunny weather cycle', () => {
    const state = createGameForLevel(createCampaignState(), 'tutorial_pit')!;
    expect(state.weather.pinned).toBe(true);
    expect(state.weather.current).toBe('sunny');
  });

  it('dusty_hollow game has an unpinned weather cycle', () => {
    const campaign = createCampaignState();
    campaign.levels['dusty_hollow']!.unlocked = true;
    const state = createGameForLevel(campaign, 'dusty_hollow')!;
    expect(state.weather.pinned).toBeUndefined();
  });
});
