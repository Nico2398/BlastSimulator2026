// BlastSimulator2026 — Shared helper functions for full-level integration tests

import { type GameContext, newGameCommand } from '../../../src/console/commands/world.js';
import { campaignStartCommand } from '../../../src/console/commands/campaign.js';
import { tickCommand, eventCommand } from '../../../src/console/commands/events.js';
import { drillPlanCommand, chargeCommand, sequenceCommand, blastCommand } from '../../../src/console/commands/mining.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { recordProfit } from '../../../src/core/campaign/Campaign.js';

/**
 * Create a fresh GameContext with a new game of the default mine preset.
 * Used as the base for all full-level test helpers.
 */
function createBaseContext(): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

/** Complete tutorial_pit (threshold 5000) to unlock dusty_hollow. */
function _unlockDustyHollow(campaign: any): void {
  recordProfit(campaign, 'tutorial_pit', 5000);
}

/** Complete dusty_hollow to unlock grumpstone_ridge. */
function _unlockGrumpstoneRidge(campaign: any): void {
  _unlockDustyHollow(campaign);
  recordProfit(campaign, 'dusty_hollow', 80000);
}

/** Complete grumpstone_ridge to unlock treranium_depths. */
function _unlockTreraniumDepths(campaign: any): void {
  _unlockGrumpstoneRidge(campaign);
  recordProfit(campaign, 'grumpstone_ridge', 250000);
}

/**
 * Create a GameContext with a fresh campaign started for the given level.
 * Automatically completes any prior levels needed to unlock the target.
 * Calls campaignStartCommand to initialise the level.
 * @param levelId The campaign level identifier (e.g. 'dusty_hollow').
 * @returns A fully initialised GameContext ready for test commands.
 */
export function makeCampaignCtx(levelId: string): GameContext {
  const ctx = createBaseContext();
  if (levelId === 'dusty_hollow') {
    _unlockDustyHollow(ctx.state!.campaign);
  } else if (levelId === 'grumpstone_ridge') {
    _unlockGrumpstoneRidge(ctx.state!.campaign);
  } else if (levelId === 'treranium_depths') {
    _unlockTreraniumDepths(ctx.state!.campaign);
  }
  // tutorial_pit is unlocked by default — no unlock needed
  campaignStartCommand(ctx, [], { level: levelId });
  return ctx;
}

/**
 * Create a GameContext with the given level started.
 * Alias for makeCampaignCtx — retained for API compatibility.
 * makeCampaignCtx now handles all prerequisite unlocking automatically.
 * @param levelId The campaign level identifier to start.
 * @returns A fully initialised GameContext with preceding levels completed.
 */
export function makeCampaignCtxWithUnlock(levelId: string): GameContext {
  return makeCampaignCtx(levelId);
}

/**
 * Advance the simulation by `n` ticks, running `tickCommand` each tick
 * and resolving any events that fire during the tick window.
 * @param ctx The game context.
 * @param n Number of ticks to advance.
 */
export function tickWithEvents(ctx: GameContext, n: number): void {
  for (let i = 0; i < n; i++) {
    tickCommand(ctx, ['1'], {});
    if (ctx.state!.events.pendingEvent) {
      eventCommand(ctx, ['choose', '0'], {});
    }
    if (ctx.state!.isPaused) {
      ctx.state!.isPaused = false;
    }
  }
}

/**
 * Perform a standard blast cycle: drill grid, charge all, auto-sequence, blast.
 * Uses a 2×2 grid with 4m spacing, 8m depth, boomite explosive.
 * @param ctx The game context (cast to MiningContext internally for command compatibility).
 * @param originX X-coordinate of the drill grid origin.
 * @param originZ Z-coordinate of the drill grid origin.
 * @returns The blast command output text.
 */
export function performBlast(ctx: GameContext, originX: number, originZ: number): string {
  drillPlanCommand(ctx as any, ['grid'], {
    origin: `${originX},${originZ}`,
    rows: '2',
    cols: '2',
    spacing: '4',
    depth: '8',
  });
  chargeCommand(ctx as any, [], {
    hole: '*',
    explosive: 'boomite',
    amount: '5kg',
    stemming: '2m',
  });
  sequenceCommand(ctx as any, ['auto'], {});
  const result = blastCommand(ctx as any, [], {});
  return result.output;
}

/**
 * Return a summary object of the current game state (profit, balance,
 * scores, employee count, etc.) for use in test assertions.
 * @param ctx The game context.
 * @returns A plain object with key state properties for assertion.
 */
export function getStateSummary(ctx: GameContext): Record<string, unknown> {
  return {
    tickCount: ctx.state!.tickCount,
    cash: ctx.state!.cash,
    scores: ctx.state!.scores,
    buildings: ctx.state!.buildings.buildings.length,
    employees: ctx.state!.employees.employees.length,
    levelEnded: ctx.state!.levelEnded,
    levelEndReason: ctx.state!.levelEndReason,
    campaignLevel: ctx.state!.campaign.activeLevelId,
  };
}
