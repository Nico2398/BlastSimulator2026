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
import { resolveEvent } from '../../../src/core/events/EventResolver.js';
import { createScoreState } from '../../../src/core/scores/ScoreManager.js';
import { createFinanceState } from '../../../src/core/economy/Finance.js';
import { createEventSystemState } from '../../../src/core/events/EventSystem.js';
import { Random } from '../../../src/core/math/Random.js';

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

  it('event fire tutorial_synergy_consultant sets pendingEvent and shows tutorial details', () => {
    // Arrange — look up the event definition to know what i18n keys to expect
    const def = getEventById('tutorial_synergy_consultant');
    expect(def).not.toBeNull();

    // Act
    const result = eventCommand(ctx, ['fire', 'tutorial_synergy_consultant'], {});

    // Assert — pending event state
    expect(result.success).toBe(true);
    expect(ctx.state!.events.pendingEvent).not.toBeNull();
    expect(ctx.state!.events.pendingEvent!.eventId).toBe('tutorial_synergy_consultant');
    expect(ctx.state!.isPaused).toBe(true);
    expect(ctx.state!.events.firedEventIds).toContain('tutorial_synergy_consultant');

    // Assert — output contains tutorial details
    expect(result.output).toContain(t(def!.titleKey));
    expect(result.output).toContain(t(def!.descKey));
    expect(result.output).toContain('[0]');
    expect(result.output).toContain('[1]');
    expect(result.output).toContain('[2]');
  });
});

describe('tutorial event definitions', () => {
  beforeEach(() => {
    clearEvents();
    setupEvents();
  });

  it('getEventById returns the tutorial_synergy_consultant event', () => {
    const ev = getEventById('tutorial_synergy_consultant');
    expect(ev).toBeDefined();
    expect(ev!.category).toBe('tutorial');
    expect(ev!.options.length).toBe(3);
    expect(ev!.consequences.length).toBe(ev!.options.length);
  });

  it('option 0 — Hire consultant: cash cost and well-being boost', () => {
    const ev = getEventById('tutorial_synergy_consultant')!;
    const con = ev.consequences[0]!;

    expect(con.cashDelta).toBe(-3000);
    expect(con.scoreDelta?.wellBeing).toBe(15);
    expect(con.corruptionDelta).toBeUndefined();
  });

  it('option 1 — Dismiss consultant: well-being and safety penalties, no cash change', () => {
    const ev = getEventById('tutorial_synergy_consultant')!;
    const con = ev.consequences[1]!;

    expect(con.scoreDelta?.wellBeing).toBe(-10);
    expect(con.scoreDelta?.safety).toBe(-5);
    expect(con.cashDelta).toBeUndefined();
  });

  it('option 2 — Equity deal: well-being boost, safety penalty, no cash change', () => {
    const ev = getEventById('tutorial_synergy_consultant')!;
    const con = ev.consequences[2]!;

    expect(con.scoreDelta?.wellBeing).toBe(5);
    expect(con.scoreDelta?.safety).toBe(-5);
    expect(con.cashDelta).toBeUndefined();
  });

  it('weightCoeff returns a constant 0.5 regardless of scores', () => {
    const ev = getEventById('tutorial_synergy_consultant')!;
    const highScores = { wellBeing: 100, safety: 100, ecology: 100, nuisance: 100 };
    const lowScores = { wellBeing: 0, safety: 0, ecology: 0, nuisance: 0 };

    expect(ev.weightCoeff(highScores)).toBe(0.5);
    expect(ev.weightCoeff(lowScores)).toBe(0.5);
  });

  it('canFire returns true for any context', () => {
    const ev = getEventById('tutorial_synergy_consultant')!;
    // Tutorial events should always be fireable
    const ctx = {
      scores: { wellBeing: 50, safety: 50, ecology: 50, nuisance: 50 },
      employeeCount: 0,
      deathCount: 0,
      corruptionLevel: 0,
      hasBuilding: () => false,
      hasDrillPlan: false,
      tickCount: 0,
      lawsuitCount: 0,
      activeContractCount: 0,
      weatherId: 'sunny',
    };

    expect(ev.canFire(ctx)).toBe(true);
  });
});

describe('tutorial event resolution', () => {
  beforeEach(() => {
    clearEvents();
    setupEvents();
  });

  it('option 0 — Hire consultant: deducts $3000 and boosts well-being to 65', () => {
    const def = getEventById('tutorial_synergy_consultant')!;
    expect(def).toBeDefined();

    const eventSystem = createEventSystemState();
    eventSystem.pendingEvent = { eventId: 'tutorial_synergy_consultant', firedAtTick: 10 };
    const finances = createFinanceState(100000);
    const scores = createScoreState();
    const result = resolveEvent(eventSystem, finances, scores, 0, 10, new Random(42));

    expect(result).not.toBeNull();
    expect(result!.cashChange).toBe(-3000);
    expect(finances.cash).toBe(97000);
    expect(scores.wellBeing).toBe(65);
    expect(scores.safety).toBe(50);
    expect(scores.ecology).toBe(50);
    expect(scores.nuisance).toBe(50);
    expect(eventSystem.pendingEvent).toBeNull();
  });

  it('option 1 — Dismiss consultant: penalizes well-being to 40 and safety to 45', () => {
    const def = getEventById('tutorial_synergy_consultant')!;
    expect(def).toBeDefined();

    const eventSystem = createEventSystemState();
    eventSystem.pendingEvent = { eventId: 'tutorial_synergy_consultant', firedAtTick: 10 };
    const finances = createFinanceState(100000);
    const scores = createScoreState();
    const result = resolveEvent(eventSystem, finances, scores, 1, 10, new Random(42));

    expect(result).not.toBeNull();
    expect(result!.cashChange).toBe(0);
    expect(finances.cash).toBe(100000);
    expect(scores.wellBeing).toBe(40);
    expect(scores.safety).toBe(45);
    expect(scores.ecology).toBe(50);
    expect(scores.nuisance).toBe(50);
    expect(eventSystem.pendingEvent).toBeNull();
  });

  it('option 2 — Equity deal: boosts well-being to 55, penalizes safety to 45', () => {
    const def = getEventById('tutorial_synergy_consultant')!;
    expect(def).toBeDefined();

    const eventSystem = createEventSystemState();
    eventSystem.pendingEvent = { eventId: 'tutorial_synergy_consultant', firedAtTick: 10 };
    const finances = createFinanceState(100000);
    const scores = createScoreState();
    const result = resolveEvent(eventSystem, finances, scores, 2, 10, new Random(42));

    expect(result).not.toBeNull();
    expect(result!.cashChange).toBe(0);
    expect(finances.cash).toBe(100000);
    expect(scores.wellBeing).toBe(55);
    expect(scores.safety).toBe(45);
    expect(scores.ecology).toBe(50);
    expect(scores.nuisance).toBe(50);
    expect(eventSystem.pendingEvent).toBeNull();
  });
});
