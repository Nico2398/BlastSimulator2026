// BlastSimulator2026 — Console commands for event context building and resolution
// Split from events.ts (#695).

import type { CommandResult } from '../ConsoleRunner.js';
import type { GameContext } from './world.js';
import type { EventDef, EventContext } from '../../core/events/EventPool.js';

/** Build the EventContext from the current GameState. */
export function buildEventContext(ctx: GameContext): EventContext {
  void ctx;
  throw new Error('not implemented');
}

/**
 * Appends the numbered option list and the "how to decide" hint shared by
 * every place a pending event gets reported to the player (auto-fired mid-tick
 * and the "event fire" debug command) — mutates `lines` in place.
 */
export function pushEventOptionLines(lines: string[], def: EventDef): void {
  void lines;
  void def;
  throw new Error('not implemented');
}

export function eventCommand(
  ctx: GameContext,
  args: string[],
  _named: Record<string, string>,
): CommandResult {
  void ctx;
  void args;
  void _named;
  throw new Error('not implemented');
}
