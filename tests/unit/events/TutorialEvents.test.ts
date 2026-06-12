// BlastSimulator2026 — Tests for tutorial-level event firing via console (event fire <id>)
// Verifies that the `event fire <eventId>` subcommand sets the pending event,
// pauses the game, and displays event details to the player.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../../src/console/commands/world.js';
import { eventCommand } from '../../../src/console/commands/events.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { setupEvents } from '../../../src/core/events/index.js';
import { getEventById, clearEvents } from '../../../src/core/events/EventPool.js';
import { t } from '../../../src/core/i18n/I18n.js';

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
    // Act
    const result = eventCommand(ctx, ['fire', 'union_coffee_uprising'], {});

    // Assert
    expect(result.success).toBe(true);
    expect(ctx.state!.events.pendingEvent).not.toBeNull();
    expect(ctx.state!.events.pendingEvent!.eventId).toBe('union_coffee_uprising');
    expect(ctx.state!.events.pendingEvent!.firedAtTick).toBe(ctx.state!.tickCount);
    expect(ctx.state!.isPaused).toBe(true);
    expect(ctx.state!.events.firedEventIds).toContain('union_coffee_uprising');
    expect(ctx.state!.events.lastEventTick).toBe(ctx.state!.tickCount);
    expect(ctx.state!.events.actionCountSinceEvent).toBe(0);
  });

  it('event fire <validId> shows event details in output', () => {
    // Arrange — look up the event definition to know what i18n keys to expect
    const def = getEventById('union_coffee_uprising');
    expect(def).not.toBeNull();

    // Act
    const result = eventCommand(ctx, ['fire', 'union_coffee_uprising'], {});

    // Assert
    expect(result.success).toBe(true);
    // Should contain the resolved event title
    expect(result.output).toContain(t(def!.titleKey));
    // Should contain the event description
    expect(result.output).toContain(t(def!.descKey));
    // Should contain the resolution hint
    expect(result.output).toContain('→ Use "event choose <index>" to decide.');
    // Should list option numbers for all options
    for (let i = 0; i < def!.options.length; i++) {
      expect(result.output).toContain(`[${i}]`);
    }
  });

  it('event fire <invalidId> returns error', () => {
    // Act
    const result = eventCommand(ctx, ['fire', 'nonexistent_event'], {});

    // Assert
    expect(result.success).toBe(false);
    expect(result.output.toLowerCase()).toContain('not found');
  });

  it('event fire with no arguments returns usage error', () => {
    // Act — pass only ['fire'] without an event ID
    const result = eventCommand(ctx, ['fire'], {});

    // Assert
    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage');
  });
});
