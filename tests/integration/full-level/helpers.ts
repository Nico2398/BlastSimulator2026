// BlastSimulator2026 — Shared helper functions for full-level integration tests

import { type GameContext, newGameCommand } from '../../../src/console/commands/world.js';
import { campaignStartCommand } from '../../../src/console/commands/campaign.js';
import { tickCommand, eventCommand } from '../../../src/console/commands/events.js';
import { drillPlanCommand, chargeCommand, sequenceCommand, blastCommand } from '../../../src/console/commands/mining.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { recordProfit } from '../../../src/core/campaign/Campaign.js';

/**
 * Create a GameContext with a fresh campaign started for the given level.
 * Calls campaignStartCommand to initialise the level.
 */
export function makeCampaignCtx(levelId: string): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  campaignStartCommand(ctx, [], { level: levelId });
  return ctx;
}

/**
 * Create a GameContext with all prior levels marked completed so the
 * target level is unlocked. Useful for levels 2 and 3 which require
 * earlier levels to be finished first.
 */
export function makeCampaignCtxWithUnlock(levelId: string): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  if (levelId === 'grumpstone_ridge') {
    recordProfit(ctx.state!.campaign, 'dusty_hollow', 80000);
  } else if (levelId === 'treranium_depths') {
    recordProfit(ctx.state!.campaign, 'dusty_hollow', 80000);
    recordProfit(ctx.state!.campaign, 'grumpstone_ridge', 250000);
  }
  campaignStartCommand(ctx, [], { level: levelId });
  return ctx;
}

/**
 * Advance the simulation by `n` ticks, running `tickCommand` each tick
 * and resolving any events that fire during the tick window.
 */
export function tickWithEvents(ctx: GameContext, n: number): void {
  for (let i = 0; i < n; i++) {
    const result = tickCommand(ctx, ['1'], {});
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
 * Returns the blast command output text.
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
