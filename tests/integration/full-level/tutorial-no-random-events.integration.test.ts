// BlastSimulator2026 — Integration test: Tutorial level blocks random events
// Verifies that eventFreqMultiplier: 0 prevents both timer-based and
// condition-based events from firing during the tutorial.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeCampaignCtx } from './helpers.js';
import { setupEvents, clearEvents } from '../../../src/core/events/index.js';
import { tickCommand, eventCommand } from '../../../src/console/commands/events.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { runTick } from '../../../src/core/engine/TickPipeline.js';
import { bookTaxAuditIncome, tickTaxAudit } from '../../../src/core/events/TaxAudit.js';
import { isRaining } from '../../../src/core/weather/WeatherCycle.js';
import { wetHoles } from '../../../src/core/mining/WetHoles.js';
import { addIncome } from '../../../src/core/economy/Finance.js';
import { createRunner } from '../../../src/console/createRunner.js';

// Wrap tickTaxAudit so tests can assert the roll itself, not just its (~9%) chance outcome.
vi.mock('../../../src/core/events/TaxAudit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/core/events/TaxAudit.js')>();
  return { ...actual, tickTaxAudit: vi.fn(actual.tickTaxAudit) };
});

describe('Tutorial Level — No Random Events', () => {
  let ctx: ReturnType<typeof makeCampaignCtx>;

  beforeEach(() => {
    clearEvents();
    setupEvents();
    ctx = makeCampaignCtx('tutorial_pit');
  });

  it('tutorial_pit starts with eventFreqMultiplier = 0', () => {
    expect(ctx.state!.events.eventFreqMultiplier).toBe(0);
  });

  it('no timer-based events fire after advancing many ticks', () => {
    // Advance 300 ticks — enough for many timer cycles if events were active
    for (let i = 0; i < 300; i++) {
      tickCommand(ctx, ['1'], {});
      // If any event fired, the game would pause
      if (ctx.state!.events.pendingEvent) {
        // Check it's not a random event (should not happen)
        const pid = ctx.state!.events.pendingEvent.eventId;
        expect(pid).not.toMatch(
          /^(union|politics|weather|mafia|lawsuit|traffic|unqualified|legendary|absurdium|lucky|barren)/,
        );
        break;
      }
    }
    // No random events should have fired
    expect(ctx.state!.events.pendingEvent).toBeNull();
  });

  it('manual event fire still works despite eventFreqMultiplier=0', () => {
    expect(ctx.state!.events.pendingEvent).toBeNull();

    const fireResult = eventCommand(ctx, ['fire', 'tutorial_synergy_consultant'], {});
    expect(fireResult.success).toBe(true);

    expect(ctx.state!.events.pendingEvent).not.toBeNull();
    expect(ctx.state!.events.pendingEvent!.eventId).toBe('tutorial_synergy_consultant');
  });

  it('weather is pinned sunny for 2000 ticks and never rains', () => {
    expect(ctx.state!.weather.pinned).toBe(true);
    for (let i = 0; i < 2000; i++) {
      tickCommand(ctx, ['1'], {});
      expect(ctx.state!.weather.current).toBe('sunny');
      expect(isRaining(ctx.state!.weather.current)).toBe(false);
    }
  });

  it('drilled holes stay dry (wetHoleCount 0) through the whole run', () => {
    const { runner, ctx: rctx } = createRunner();
    expect(runner.run('campaign start level:tutorial_pit staffed:true').success).toBe(true);
    expect(runner.run('drill_plan grid rows:2 cols:3 spacing:4 depth:8 start:22,20').success).toBe(true);
    for (let i = 0; i < 1500; i++) {
      for (const emp of rctx.state!.employees.employees) emp.fatigue = 100;
      runner.run('tick 1');
      expect(rctx.state!.weather.current).toBe('sunny');
      expect(wetHoles(rctx.state!)).toHaveLength(0);
    }
    expect(rctx.state!.drillHoles.length).toBeGreaterThan(0);
    expect(rctx.state!.weather.pinned).toBe(true);
  });

  it('no tax audit fires in 2000 ticks even with smuggling on the books', () => {
    const state = ctx.state!;
    const toasts: unknown[] = [];
    ctx.emitter.on('mafia:tax_audit', (e: unknown) => toasts.push(e));
    for (let i = 0; i < 2000; i++) {
      bookTaxAuditIncome(state.taxAudit, state.tickCount, 40_000, 40_000);
      tickCommand(ctx, ['1'], {});
    }
    expect(state.taxAudit.auditsCount).toBe(0);
    expect(toasts).toHaveLength(0);
  });

  it('events-disabled game still books income into the audit books', () => {
    const state = createGame({ seed: 42, eventFreqMultiplier: 0 });
    state.tickCount = 200;
    const emitter = new EventEmitter();
    for (let i = 0; i < 10; i++) {
      // Income dated on the tick being run lands inside runTaxAuditStep's one-tick window.
      addIncome(state.finances, 7_200, 'sales', 'Ore sale', state.tickCount + 1);
      runTick(state, null, new Random(state.seed + state.tickCount), emitter, { checkInvariants: false });
    }
    expect(state.taxAudit.auditsCount).toBe(0);
    expect(state.taxAudit.buckets.length).toBeGreaterThan(0);
  });

  it('with eventFreqMultiplier 1 the same books do draw an audit', () => {
    const state = createGame({ seed: 42, eventFreqMultiplier: 1 });
    state.cash = 20_000;
    const emitter = new EventEmitter();
    for (let i = 0; i < 40_000 && state.taxAudit.auditsCount === 0; i++) {
      bookTaxAuditIncome(state.taxAudit, state.tickCount, 40_000, 40_000);
      runTick(state, null, new Random(state.seed + state.tickCount), emitter, { checkInvariants: false });
    }
    expect(state.taxAudit.auditsCount).toBeGreaterThan(0);
  });

  it('eventFreqMultiplier 0 never rolls the audit; multiplier 1 rolls every tick', () => {
    const rollsFor = (eventFreqMultiplier: number): number => {
      vi.mocked(tickTaxAudit).mockClear();
      const state = createGame({ seed: 42, eventFreqMultiplier });
      const emitter = new EventEmitter();
      for (let i = 0; i < 50; i++) {
        runTick(state, null, new Random(state.seed + state.tickCount), emitter, { checkInvariants: false });
      }
      return vi.mocked(tickTaxAudit).mock.calls.length;
    };
    expect(rollsFor(0)).toBe(0);
    expect(rollsFor(1)).toBe(50);
  });
});

describe('Dusty Hollow keeps its weather cycle (#1585)', () => {
  it('weather is unpinned and varies over 2000 ticks', () => {
    clearEvents();
    setupEvents();
    const ctx2 = makeCampaignCtx('dusty_hollow');
    expect(ctx2.state!.weather.pinned).toBeUndefined();
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      tickCommand(ctx2, ['1'], {});
      seen.add(ctx2.state!.weather.current);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});
