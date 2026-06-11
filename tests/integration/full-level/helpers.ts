// BlastSimulator2026 — Shared helper functions for full-level integration tests
// TODO: Implement all functions in this file.

import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { campaignStartCommand } from '../../src/console/commands/campaign.js';
import { tickCommand, eventCommand } from '../../src/console/commands/events.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { recordProfit } from '../../src/core/campaign/Campaign.js';

/**
 * Create a GameContext with a fresh campaign started for the given level.
 * Calls campaignStartCommand to initialise the level.
 */
export function makeCampaignCtx(levelId: string): GameContext {
  // TODO: implement
  throw new Error('Not implemented');
}

/**
 * Create a GameContext with all prior levels marked completed so the
 * target level is unlocked. Useful for levels 2 and 3 which require
 * earlier levels to be finished first.
 */
export function makeCampaignCtxWithUnlock(levelId: string): GameContext {
  // TODO: implement
  throw new Error('Not implemented');
}

/**
 * Advance the simulation by `n` ticks, running `tickCommand` each tick
 * and accumulating any events triggered during the tick window.
 */
export function tickWithEvents(ctx: GameContext, n: number): void {
  // TODO: implement
  throw new Error('Not implemented');
}

/**
 * Return a summary object of the current game state (profit, balance,
 * scores, employee count, etc.) for use in test assertions.
 */
export function getStateSummary(ctx: GameContext): Record<string, unknown> {
  // TODO: implement
  throw new Error('Not implemented');
}
