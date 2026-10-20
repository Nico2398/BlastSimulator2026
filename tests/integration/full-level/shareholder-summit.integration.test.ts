// BlastSimulator2026 — Full-level integration test: Shareholder Summit (#1949)
// The fourth campaign level: board of directors, progression ladder, production market.
// An idle mine is fired by the board; a competent player (the probe's `ladder` strategy,
// console commands only) completes the profit target before the board runs out of patience.

import { describe, it, expect } from 'vitest';
import {
  makeCampaignCtxWithUnlock,
  tickWithEvents,
  _unlockShareholderSummit,
} from './helpers.js';
import { campaignCompleteCommand, campaignStartCommand } from '../../../src/console/commands/campaign.js';
import { runCommand } from '../../../src/console/createRunner.js';
import { runProbe } from '../../../scripts/shared/probe-strategies.js';
import { getLevel } from '../../../src/core/campaign/Level.js';
import { isCampaignComplete } from '../../../src/core/campaign/Campaign.js';
import {
  SHAREHOLDER_SUMMIT_STARTING_CASH,
  SHAREHOLDER_SUMMIT_BOARD,
  SHAREHOLDER_SUMMIT_STARTING_SITE,
} from '../../../src/core/config/balance.js';

const LEVEL_ID = 'shareholder_summit';

/**
 * Tick budget of the competent run: the level is meant to be won in about six quarters;
 * twice that leaves slack for variance while still bounding the test.
 * The run stops at the first terminal state, so a win ends it early.
 */
const COMPETENT_HORIZON_QUARTERS = 12;
/** A competent run is ~minutes of simulation; fixed, deterministic seed. */
const COMPETENT_TIMEOUT_MS = 900_000;

describe('Shareholder Summit — opening', () => {
  it('starts with the level state: cash, board, ladder, production market', () => {
    const ctx = makeCampaignCtxWithUnlock(LEVEL_ID, { levelDefaultStart: true });
    const state = ctx.state!;
    const level = getLevel(LEVEL_ID)!;

    expect(state.campaign.activeLevelId).toBe(LEVEL_ID);
    expect(state.cash).toBe(SHAREHOLDER_SUMMIT_STARTING_CASH);
    expect(state.board).toBeDefined();
    expect(state.board!.quarter).toBe(1);
    expect(state.board!.confidence).toBe(60);
    expect(state.board!.config).toMatchObject({
      quarterTicks: SHAREHOLDER_SUMMIT_BOARD.quarterTicks,
      oreTargetT: SHAREHOLDER_SUMMIT_BOARD.oreTargetT,
      profitTarget: SHAREHOLDER_SUMMIT_BOARD.profitTarget,
    });
    expect(state.grade).toBeDefined();
    expect(state.grade!.grade).toBe(0);
    expect(state.contracts.market).toBe('production');
    expect(ctx.grid!.sizeX).toBe(level.gridX);
    expect(ctx.grid!.sizeZ).toBe(level.gridZ);
    expect(state.levelEnded).toBe(false);
  });

  it('opens with the free digger crew, fleet and a tier-1 freight warehouse', () => {
    const state = makeCampaignCtxWithUnlock(LEVEL_ID, { levelDefaultStart: true }).state!;
    expect(state.employees.employees).toHaveLength(SHAREHOLDER_SUMMIT_STARTING_SITE.employees.length);
    expect(state.vehicles.vehicles.map(v => v.type).sort())
      .toEqual(SHAREHOLDER_SUMMIT_STARTING_SITE.vehicles.map(v => v.role).sort());
    expect(state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.tier === 1)).toBe(true);
  });

  it('a bare start (staffed:false) opens without crew or fleet but keeps the board and ladder', () => {
    const state = makeCampaignCtxWithUnlock(LEVEL_ID).state!;
    expect(state.employees.employees).toHaveLength(0);
    expect(state.vehicles.vehicles).toHaveLength(0);
    expect(state.board).toBeDefined();
    expect(state.grade).toBeDefined();
  });

  it('is locked until treranium_depths is completed', () => {
    const ctx = makeCampaignCtxWithUnlock('treranium_depths', { levelDefaultStart: true });
    const campaign = ctx.campaignProfile.campaign;
    expect(campaign.levels[LEVEL_ID]!.unlocked).toBe(false);
    expect(campaignStartCommand(ctx, [], { level: LEVEL_ID }).success).toBe(false);
  });

  it('completing treranium_depths unlocks it', () => {
    const ctx = makeCampaignCtxWithUnlock('treranium_depths', { levelDefaultStart: true });
    _unlockShareholderSummit(ctx.campaignProfile.campaign);
    expect(ctx.campaignProfile.campaign.levels[LEVEL_ID]!.unlocked).toBe(true);
  });

  it('force-completing it ends the level as completed and completes the campaign', () => {
    const ctx = makeCampaignCtxWithUnlock(LEVEL_ID, { levelDefaultStart: true });
    const result = campaignCompleteCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(ctx.state!.levelEnded).toBe(true);
    expect(ctx.state!.levelEndReason).toBe('completed');
    expect(ctx.campaignProfile.campaign.levels[LEVEL_ID]!.completed).toBe(true);
    expect(isCampaignComplete(ctx.campaignProfile.campaign)).toBe(true);
    expect(ctx.campaignProfile.campaign.campaignComplete).toBe(true);
  });
});

describe('Shareholder Summit — idle strategy is fired', () => {
  it('an idle mine is fired by the board at or before the third quarterly review', () => {
    const ctx = makeCampaignCtxWithUnlock(LEVEL_ID, { levelDefaultStart: true });
    const state = ctx.state!;
    const quarterTicks = state.board!.config.quarterTicks;
    // Four quarters is a hard bound: the board must have acted long before.
    for (let i = 0; i < quarterTicks * 4 && !state.levelEnded; i++) tickWithEvents(ctx, 1);

    expect(state.levelEnded).toBe(true);
    expect(state.levelEndReason).toBe('fired');
    expect(state.board!.lastReview).not.toBeNull();
    expect(state.board!.lastReview!.quarter).toBeLessThanOrEqual(3);
    expect(state.board!.confidence).toBe(0);
  }, 300_000);
});

describe('Shareholder Summit — competent strategy wins', () => {
  it('the scripted ladder player reaches the profit target (levelEndReason completed)', () => {
    const horizon = SHAREHOLDER_SUMMIT_BOARD.quarterTicks * COMPETENT_HORIZON_QUARTERS;
    const result = runProbe(
      { seed: 42, biome: 'volcanic_flats', kit: 'digger', strategy: 'ladder', horizon },
      (engine) => {
        _unlockShareholderSummit(engine.ctx.campaignProfile.campaign);
        return runCommand(engine, `campaign start level:${LEVEL_ID}`).success;
      },
    );

    // 'game_over:completed' is the run loop's name for a win; null would mean the horizon passed first.
    expect(result.endReason).toBe('game_over:completed');
    expect(result.endTick).toBeGreaterThan(0);
    expect(result.endTick).toBeLessThanOrEqual(horizon);
  }, COMPETENT_TIMEOUT_MS);
});
