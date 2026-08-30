// BlastSimulator2026 — tick.ts i18n guards (#821)
//
// tick.ts's tickCommand carries hardcoded English literals for the
// pending-event refusal and its own two trailing summary lines ("no events
// fired" and "advanced N of M requested ticks"). #821 routes all of these
// through t() — see src/core/i18n/I18n.ts. Every test below pins the exact
// English literal and additionally proves the output changes under locale
// 'fr', so a hardcoded string that merely matches en.json cannot pass.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { type GameContext } from '../../../src/console/commands/world.js';
import { tickCommand } from '../../../src/console/commands/tick.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { getAllEvents } from '../../../src/core/events/EventPool.js';
import { setupEvents } from '../../../src/core/events/index.js';
import * as EventSystemModule from '../../../src/core/events/EventSystem.js';
import { makeGameContext } from '../../helpers/gameContext.js';

function makeCtx(): GameContext {
  return makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
}

// The global event pool (EventPool.ts's module-level array) is populated by
// setupEvents(), which createRunner.ts calls at console-runner construction —
// these unit tests bypass that runner and call newGameCommand directly, so
// setupEvents() must be called explicitly to make getAllEvents() (used by the
// partial-tick case below) non-empty.
beforeEach(() => setupEvents());
afterEach(() => setLocale('en'));

// ── pending event refusal ──────────────────────────────────────────────

describe('tick.ts pending-event refusal — English literal + fr divergence', () => {
  const REFUSAL_EN = 'Pending event! Resolve it first: "event choose <index>".';

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    ctx.state!.events.pendingEvent = { eventId: 'x', firedAtTick: 0 };

    const result = tickCommand(ctx, ['1'], {});

    expect(result.success).toBe(false);
    expect(result.output).toBe(REFUSAL_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    ctx.state!.events.pendingEvent = { eventId: 'x', firedAtTick: 0 };
    setLocale('fr');

    const result = tickCommand(ctx, ['1'], {});

    expect(result.success).toBe(false);
    expect(result.output).not.toBe(REFUSAL_EN);
  });
});

// ── quiet tick — "no events fired" summary line ────────────────────────

describe('tick.ts quiet single tick — English literal + fr divergence', () => {
  // A single tick from a fresh, unstaffed game never reaches a timer's
  // remaining<=0 (every EVENT_BASE_TIMERS category starts at 25+ ticks), so
  // this is a genuinely quiet path — no mocking required.
  const NO_EVENTS_EN = 'Advanced 1 tick(s). Now at tick 1. No events fired.';

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const result = tickCommand(ctx, ['1'], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe(NO_EVENTS_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    setLocale('fr');
    const result = tickCommand(ctx, ['1'], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(NO_EVENTS_EN);
  });
});

// ── partial tick — event fires partway through a multi-tick request ────

describe('tick.ts partial multi-tick request (tickEventSystem mocked to fire) — English literal + fr divergence', () => {
  const PARTIAL_EN = '(Advanced 1 of 5 requested ticks)';

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const realEventId = getAllEvents()[0]!.id;
    vi.spyOn(EventSystemModule, 'tickEventSystem').mockReturnValue({
      eventId: realEventId,
      firedAtTick: 1,
    });

    const result = tickCommand(ctx, ['5'], {});

    expect(result.success).toBe(true);
    expect(result.output.split('\n').at(-1)).toBe(PARTIAL_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const realEventId = getAllEvents()[0]!.id;
    vi.spyOn(EventSystemModule, 'tickEventSystem').mockReturnValue({
      eventId: realEventId,
      firedAtTick: 1,
    });
    setLocale('fr');

    const result = tickCommand(ctx, ['5'], {});

    expect(result.success).toBe(true);
    expect(result.output.split('\n').at(-1)).not.toBe(PARTIAL_EN);
  });
});
