// BlastSimulator2026 — Tests for tutorial-level event firing via console (event fire <id>)
// Verifies that the `event fire <eventId>` subcommand sets the pending event,
// pauses the game, and displays event details to the player.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../../src/console/commands/world.js';
import { eventCommand } from '../../../src/console/commands/events.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { setupEvents, clearEvents } from '../../../src/core/events/index.js';
import { getEventById } from '../../../src/core/events/EventPool.js';

/** Build a fresh context with a real GameState (seed=42, desert biome). */
function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

describe('event fire subcommand', () => {
  let ctx: GameContext;

  beforeEach(() => {
    clearEvents();
    setupEvents();
    ctx = makeCtx();
  });

  it('event fire <validId> sets pendingEvent and pauses game', () => {
    // Arrange
    // Act: call eventCommand(ctx, ['fire', 'union_coffee_uprising'], {})
    // Assert: state.events.pendingEvent is not null
    //         state.events.pendingEvent.eventId === 'union_coffee_uprising'
    //         state.isPaused === true
    expect(true).toBe(false);
  });

  it('event fire <validId> shows event details in output', () => {
    // Arrange
    // Act: call eventCommand(ctx, ['fire', 'union_coffee_uprising'], {})
    // Assert: result.success === true
    //         result.output contains event title (i18n-resolved)
    //         result.output contains event description
    //         result.output contains option labels
    expect(true).toBe(false);
  });

  it('event fire <invalidId> returns error', () => {
    // Arrange: use a non-existent event ID
    // Act: call eventCommand(ctx, ['fire', 'nonexistent_event_id'], {})
    // Assert: result.success === false
    //         result.output indicates the event was not found
    expect(true).toBe(false);
  });

  it('event fire (no args) returns error', () => {
    // Arrange: pass only ['fire'] without an event ID
    // Act: call eventCommand(ctx, ['fire'], {})
    // Assert: result.success === false
    //         result.output contains usage instructions
    expect(true).toBe(false);
  });
});
