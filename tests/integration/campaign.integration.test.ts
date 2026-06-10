// BlastSimulator2026 — Integration tests: Campaign system (Phase 7)
// Covers level progression, star ratings, and campaign commands.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import {
  campaignStartCommand,
  campaignStatusCommand,
  campaignCompleteCommand,
  statsCommand,
} from '../../src/console/commands/campaign.js';
import { tickCommand } from '../../src/console/commands/events.js';
import {
  drillPlanCommand,
  chargeCommand,
  sequenceCommand,
  blastCommand,
} from '../../src/console/commands/mining.js';
import { employeeCommand, buildCommand } from '../../src/console/commands/entities.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import {
  createCampaignState,
  recordProfit,
  startLevel,
  returnToWorldMap,
  type CampaignState,
} from '../../src/core/campaign/Campaign.js';
import { getLevel, getAllLevels } from '../../src/core/campaign/Level.js';
import {
  createLevelStats,
  snapshotStats,
  recordBlastResult,
  calculateStarRating,
  type LevelStats,
  type StarRating,
} from '../../src/core/campaign/SuccessTracker.js';
import { createGame } from '../../src/core/state/GameState.js';
import { createFinanceState, addIncome, addExpense } from '../../src/core/economy/Finance.js';
import { Random } from '../../src/core/math/Random.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

// ── Campaign ────────────────────────────────────────────────────────────────

describe('Campaign', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  // ── 1. Initial campaign state ─────────────────────────────────────────────

  it('createCampaignState unlocks only level 1 by default', () => {
    const campaign = createCampaignState();

    // dusty_hollow (tier 1) should be unlocked
    expect(campaign.levels['dusty_hollow']).toBeDefined();
    expect(campaign.levels['dusty_hollow']!.unlocked).toBe(true);
    expect(campaign.levels['dusty_hollow']!.completed).toBe(false);
    expect(campaign.levels['dusty_hollow']!.cumulativeProfit).toBe(0);
    expect(campaign.levels['dusty_hollow']!.bestSessionProfit).toBe(0);

    // grumpstone_ridge (tier 2) should be locked
    expect(campaign.levels['grumpstone_ridge']).toBeDefined();
    expect(campaign.levels['grumpstone_ridge']!.unlocked).toBe(false);

    // treranium_depths (tier 3) should be locked
    expect(campaign.levels['treranium_depths']).toBeDefined();
    expect(campaign.levels['treranium_depths']!.unlocked).toBe(false);

    // No active level, campaign not complete
    expect(campaign.activeLevelId).toBeNull();
    expect(campaign.campaignComplete).toBe(false);
  });

  // ── 2. getLevel returns LevelDef ───────────────────────────────────────────

  it('getLevel returns LevelDef for valid IDs', () => {
    const level = getLevel('dusty_hollow');

    expect(level).toBeDefined();
    expect(level!.id).toBe('dusty_hollow');
    expect(level!.nameKey).toBe('level.dusty_hollow.name');
    expect(level!.descKey).toBe('level.dusty_hollow.desc');
    expect(level!.mineType).toBe('desert');
    expect(level!.terrainSeed).toBe(1138);
    expect(level!.gridX).toBe(40);
    expect(level!.gridY).toBe(20);
    expect(level!.gridZ).toBe(40);
    expect(level!.startingCash).toBe(50000);
    expect(level!.unlockThreshold).toBe(80000);
    expect(level!.difficultyTier).toBe(1);
    expect(level!.eventFreqMultiplier).toBe(0.5);
    expect(level!.contractPriceMultiplier).toBe(1.2);
    expect(level!.scoreDecayRate).toBe(0.03);
    expect(level!.mixedRockHardness).toBe(false);
    // Should include basic explosives
    expect(level!.availableExplosives).toContain('pop_rock');
    expect(level!.availableExplosives).toContain('boomite');
    expect(level!.availableExplosives).toContain('krackle');
  });

  // ── 3. getAllLevels returns all 3 ──────────────────────────────────────────

  it('getAllLevels returns all 3 levels in order', () => {
    const all = getAllLevels();

    expect(all).toHaveLength(3);

    // Order must be by difficulty tier
    expect(all[0]!.id).toBe('dusty_hollow');
    expect(all[0]!.difficultyTier).toBe(1);
    expect(all[0]!.startingCash).toBe(50000);
    expect(all[0]!.unlockThreshold).toBe(80000);

    expect(all[1]!.id).toBe('grumpstone_ridge');
    expect(all[1]!.difficultyTier).toBe(2);
    expect(all[1]!.startingCash).toBe(75000);
    expect(all[1]!.unlockThreshold).toBe(250000);

    expect(all[2]!.id).toBe('treranium_depths');
    expect(all[2]!.difficultyTier).toBe(3);
    expect(all[2]!.startingCash).toBe(100000);
    expect(all[2]!.unlockThreshold).toBe(800000);

    // Verify progressive difficulty
    expect(all[0]!.unlockThreshold).toBeLessThan(all[1]!.unlockThreshold);
    expect(all[1]!.unlockThreshold).toBeLessThan(all[2]!.unlockThreshold);
    expect(all[0]!.eventFreqMultiplier).toBeLessThan(all[1]!.eventFreqMultiplier!);
    expect(all[1]!.eventFreqMultiplier).toBeLessThan(all[2]!.eventFreqMultiplier!);
    expect(all[0]!.contractPriceMultiplier).toBeGreaterThan(all[1]!.contractPriceMultiplier!);
    expect(all[1]!.contractPriceMultiplier).toBeGreaterThan(all[2]!.contractPriceMultiplier!);
  });

  // ── 4. recordProfit completes level at threshold ───────────────────────────

  it('recordProfit completes level at threshold', () => {
    const campaign = createCampaignState();
    const level = getLevel('dusty_hollow')!;
    const threshold = level.unlockThreshold; // 80000

    // Below threshold — not completed
    const belowResult = recordProfit(campaign, 'dusty_hollow', threshold - 1);
    expect(belowResult).toBe(false);
    expect(campaign.levels['dusty_hollow']!.completed).toBe(false);

    // At threshold — completes
    const atResult = recordProfit(campaign, 'dusty_hollow', threshold);
    expect(atResult).toBe(true);
    expect(campaign.levels['dusty_hollow']!.completed).toBe(true);
  });

  // ── 5. recordProfit unlocks next level ─────────────────────────────────────

  it('recordProfit unlocks next level on completion', () => {
    const campaign = createCampaignState();

    // Initially only level 1 unlocked
    expect(campaign.levels['grumpstone_ridge']!.unlocked).toBe(false);
    expect(campaign.levels['treranium_depths']!.unlocked).toBe(false);

    // Complete level 1 at threshold
    recordProfit(campaign, 'dusty_hollow', 80000);

    // Level 2 should now be unlocked, level 3 stays locked
    expect(campaign.levels['grumpstone_ridge']!.unlocked).toBe(true);
    expect(campaign.levels['treranium_depths']!.unlocked).toBe(false);

    // Complete level 2
    recordProfit(campaign, 'grumpstone_ridge', 250000);

    // Level 3 should now be unlocked
    expect(campaign.levels['treranium_depths']!.unlocked).toBe(true);

    // Complete level 3
    recordProfit(campaign, 'treranium_depths', 800000);

    // Campaign should be complete
    expect(campaign.campaignComplete).toBe(true);
  });

  // ── 6. recordProfit tracks cumulative and best profit ──────────────────────

  it('recordProfit tracks cumulative and best profit across calls', () => {
    const campaign = createCampaignState();
    const progress = campaign.levels['dusty_hollow']!;

    // First session profit
    recordProfit(campaign, 'dusty_hollow', 30000);
    expect(progress.cumulativeProfit).toBe(30000);
    expect(progress.bestSessionProfit).toBe(30000);

    // Second session profit (larger)
    recordProfit(campaign, 'dusty_hollow', 50000);
    expect(progress.cumulativeProfit).toBe(80000);
    expect(progress.bestSessionProfit).toBe(50000); // 50000 > 30000

    // Third session profit (smaller — does not replace best)
    recordProfit(campaign, 'dusty_hollow', 20000);
    expect(progress.cumulativeProfit).toBe(100000);
    expect(progress.bestSessionProfit).toBe(50000); // 50000 still best

    // Fourth session profit (new best)
    recordProfit(campaign, 'dusty_hollow', 75000);
    expect(progress.cumulativeProfit).toBe(175000);
    expect(progress.bestSessionProfit).toBe(75000);
  });

  // ── 7. startLevel sets active level ────────────────────────────────────────

  it('startLevel sets active level for unlocked levels', () => {
    const campaign = createCampaignState();

    // Starting unlocked level 1 succeeds
    const result = startLevel(campaign, 'dusty_hollow');
    expect(result).toBe(true);
    expect(campaign.activeLevelId).toBe('dusty_hollow');

    // Return to map
    returnToWorldMap(campaign);
    expect(campaign.activeLevelId).toBeNull();

    // Starting locked level 2 fails
    const lockedResult = startLevel(campaign, 'grumpstone_ridge');
    expect(lockedResult).toBe(false);
    expect(campaign.activeLevelId).toBeNull();

    // Starting nonexistent level fails
    const missingResult = startLevel(campaign, 'nonexistent_level');
    expect(missingResult).toBe(false);
    expect(campaign.activeLevelId).toBeNull();
  });

  // ── 8. returnToWorldMap clears active level ────────────────────────────────

  it('returnToWorldMap clears active level', () => {
    const campaign = createCampaignState();

    startLevel(campaign, 'dusty_hollow');
    expect(campaign.activeLevelId).toBe('dusty_hollow');

    returnToWorldMap(campaign);
    expect(campaign.activeLevelId).toBeNull();

    // Calling again on already-clear state is safe
    returnToWorldMap(campaign);
    expect(campaign.activeLevelId).toBeNull();
  });

  // ── 9. calculateStarRating returns 1-3 stars ───────────────────────────────

  it('calculateStarRating returns 1-3 stars based on profit, safety, and ecology', () => {
    const profitTarget = 80000;
    const threshold = 80000;

    // ── 3 stars: all criteria met ──
    const stats3 = createLevelStats();
    stats3.totalWealth = 100000; // >= profitTarget
    stats3.casualties = 0;      // zero deaths
    stats3.bestEcology = 80;    // >= 60

    const rating3 = calculateStarRating(stats3, threshold);
    expect(rating3.stars).toBe(3);
    expect(rating3.details.profitPass).toBe(true);
    expect(rating3.details.safetyPass).toBe(true);
    expect(rating3.details.ecologyPass).toBe(true);

    // ── 2 stars: two criteria met ──
    const stats2 = createLevelStats();
    stats2.totalWealth = 100000; // pass
    stats2.casualties = 0;       // pass
    stats2.bestEcology = 30;    // fail (< 60)

    const rating2 = calculateStarRating(stats2, threshold);
    expect(rating2.stars).toBe(2);
    expect(rating2.details.profitPass).toBe(true);
    expect(rating2.details.safetyPass).toBe(true);
    expect(rating2.details.ecologyPass).toBe(false);

    // ── 1 star: only profit passes ──
    const stats1a = createLevelStats();
    stats1a.totalWealth = 100000; // pass
    stats1a.casualties = 3;       // fail
    stats1a.bestEcology = 30;    // fail

    const rating1a = calculateStarRating(stats1a, threshold);
    expect(rating1a.stars).toBe(1);
    expect(rating1a.details.profitPass).toBe(true);
    expect(rating1a.details.safetyPass).toBe(false);
    expect(rating1a.details.ecologyPass).toBe(false);

    // ── 1 star: no criteria met (minimum 1) ──
    const stats1b = createLevelStats();
    stats1b.totalWealth = 0;    // fail
    stats1b.casualties = 5;     // fail
    stats1b.bestEcology = 0;    // fail

    const rating1b = calculateStarRating(stats1b, threshold);
    expect(rating1b.stars).toBe(1);
    expect(rating1b.details.profitPass).toBe(false);
    expect(rating1b.details.safetyPass).toBe(false);
    expect(rating1b.details.ecologyPass).toBe(false);

    // ── Edge: exactly at thresholds ──
    const statsEdge = createLevelStats();
    statsEdge.totalWealth = 80000;  // exactly profitTarget
    statsEdge.casualties = 0;       // zero deaths
    statsEdge.bestEcology = 60;     // exactly 60

    const ratingEdge = calculateStarRating(statsEdge, threshold);
    expect(ratingEdge.stars).toBe(3);
    expect(ratingEdge.details.profitPass).toBe(true);
    expect(ratingEdge.details.safetyPass).toBe(true);
    expect(ratingEdge.details.ecologyPass).toBe(true);
  });

  // ── 10. campaign start command loads a level ──────────────────────────────

  it('campaign start command loads a level correctly', () => {
    // Starting level 1 (dusty_hollow) should succeed
    const result = campaignStartCommand(ctx, [], { level: 'dusty_hollow' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('dusty_hollow');
    expect(result.output).toContain('40×20×40');
    expect(result.output).toContain('$50,000');

    // State should be set up
    expect(ctx.state).not.toBeNull();
    expect(ctx.state!.cash).toBe(50000);
    expect(ctx.state!.campaign.activeLevelId).toBe('dusty_hollow');
    expect(ctx.state!.world).not.toBeNull();
    expect(ctx.state!.world!.gridReady).toBe(true);
    expect(ctx.state!.world!.sizeX).toBe(40);
    expect(ctx.state!.world!.sizeY).toBe(20);
    expect(ctx.state!.world!.sizeZ).toBe(40);

    // Grid should be generated
    expect(ctx.grid).not.toBeNull();
    expect(ctx.grid!.sizeX).toBe(40);
    expect(ctx.grid!.sizeY).toBe(20);
    expect(ctx.grid!.sizeZ).toBe(40);
  });

  // ── 11. Starting a locked level returns error ──────────────────────────────

  it('campaign start command rejects locked levels', () => {
    // grumpstone_ridge is locked (only level 1 unlocked by default)
    const result = campaignStartCommand(ctx, [], { level: 'grumpstone_ridge' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('locked');

    // State should remain unchanged
    expect(ctx.state!.campaign.activeLevelId).toBeNull();
  });

  // ── 12. campaign status command output ─────────────────────────────────────

  it('campaign status command reports level progress', () => {
    // Should work without starting a level
    let status = campaignStatusCommand(ctx, [], {});
    expect(status.success).toBe(true);
    expect(status.output).toContain('Campaign Status');
    expect(status.output).toContain('dusty_hollow');
    expect(status.output).toContain('grumpstone_ridge');
    expect(status.output).toContain('treranium_depths');
    expect(status.output).toContain('(world map)');

    // Start a level and check status again
    campaignStartCommand(ctx, [], { level: 'dusty_hollow' });
    status = campaignStatusCommand(ctx, [], {});
    expect(status.output).toContain('dusty_hollow');
    expect(status.output).not.toContain('(world map)');
  });

  // ── 13. campaign complete command force-completes level ─────────────────────

  it('campaign complete command force-completes the active level', () => {
    campaignStartCommand(ctx, [], { level: 'dusty_hollow' });

    const completeResult = campaignCompleteCommand(ctx, [], {});
    expect(completeResult.success).toBe(true);
    expect(completeResult.output).toContain('dusty_hollow');
    expect(completeResult.output).toContain('force-completed');

    // Level end flags should be set
    expect(ctx.state!.levelEnded).toBe(true);
    expect(ctx.state!.levelEndReason).toBe('completed');

    // Profit should have been recorded in finances
    expect(ctx.state!.cash).toBeGreaterThanOrEqual(50000 + 80000);
  });

  // ── 14. stats command output ───────────────────────────────────────────────

  it('stats command shows level statistics and star rating', () => {
    campaignStartCommand(ctx, [], { level: 'dusty_hollow' });

    const result = statsCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('Level Statistics');
    expect(result.output).toContain('Total wealth');
    expect(result.output).toContain('Casualties');
    expect(result.output).toContain('Star rating');
  });

  // ── 15. snapshotStats captures game state into stats ───────────────────────

  it('snapshotStats captures current game state', () => {
    const state = createGame({ seed: 42, mineType: 'desert' });
    const stats = createLevelStats();

    // Initial snapshot — net profit is 0 with no transactions
    snapshotStats(stats, state);
    expect(stats.blastsPerformed).toBe(0);
    expect(stats.casualties).toBe(0);
    expect(stats.totalWealth).toBe(0);

    // Add income and take another snapshot
    addIncome(state.finances, 15000, 'sales', 'ore sale', 10);
    snapshotStats(stats, state);
    expect(stats.totalWealth).toBe(15000); // net profit reflects income

    // Adding expense reduces net profit
    addExpense(state.finances, 5000, 'maintenance', 'truck repair', 12);
    snapshotStats(stats, state);
    expect(stats.totalWealth).toBe(10000); // 15000 - 5000
  });

  // ── 16. recordBlastResult updates fragment tracking ────────────────────────

  it('recordBlastResult tracks volumes and ore types from fragments', () => {
    const stats = createLevelStats();

    const fragments = [
      {
        volume: 25,
        density: 2.0,
        oreDensities: { blingite: 0.3, dirtite: 0.1 },
        velocity: { x: 0, y: 0, z: 0 },
        position: { x: 0, y: 0, z: 0 },
      },
      {
        volume: 15,
        density: 1.5,
        oreDensities: { blingite: 0.0, dirtite: 0.5 },
        velocity: { x: 0, y: 0, z: 0 },
        position: { x: 0, y: 0, z: 0 },
      },
    ];

    recordBlastResult(stats, fragments);

    expect(stats.totalVolumeBlasted).toBe(40); // 25 + 15
    expect(stats.uniqueOresExtracted.has('blingite')).toBe(true);
    expect(stats.uniqueOresExtracted.has('dirtite')).toBe(true);
    expect(stats.uniqueOresExtracted.has('nonexistent')).toBe(false);

    // Adding another blast with a new ore
    recordBlastResult(stats, [{
      volume: 10,
      density: 1.0,
      oreDensities: { treranium: 0.8 },
      velocity: { x: 0, y: 0, z: 0 },
      position: { x: 0, y: 0, z: 0 },
    }]);

    expect(stats.totalVolumeBlasted).toBe(50);
    expect(stats.uniqueOresExtracted.has('treranium')).toBe(true);
  });

  // ── 17. recordProfit with invalid level returns false ──────────────────────

  it('recordProfit with invalid level ID returns false', () => {
    const campaign = createCampaignState();
    const result = recordProfit(campaign, 'nonexistent', 1000);
    expect(result).toBe(false);
  });
});
