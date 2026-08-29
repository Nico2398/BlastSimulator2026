// BlastSimulator2026 — eventResolution.ts i18n guards (#821)
//
// eventResolution.ts's eventCommand carries hardcoded English literals for
// every guard/usage/confirmation branch across its status/choose/dismiss/fire
// subcommands and its default usage string. #821 routes all of these through
// t() — see src/core/i18n/I18n.ts. Every test below pins the exact English
// literal and additionally proves the output changes under locale 'fr', so a
// hardcoded string that merely matches en.json cannot pass.

import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { type GameContext, newGameCommand } from '../../../src/console/commands/world.js';
import { eventCommand } from '../../../src/console/commands/eventResolution.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';

function makeCtx(): GameContext {
  const ctx: GameContext = {
    state: null,
    grid: null,
    landscape: null,
    playableArea: null,
    emitter: new EventEmitter(),
  };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '24' });
  return ctx;
}

afterEach(() => setLocale('en'));

describe('eventResolution.ts — English literal + fr divergence', () => {
  const cases: Array<{
    name: string;
    englishLiteral: string;
    run: (ctx: GameContext) => { success: boolean; output: string };
  }> = [
    {
      name: 'status — no pending event',
      englishLiteral: 'No pending event. Use "tick" to advance time.',
      run: (ctx) => eventCommand(ctx, ['status'], {}),
    },
    {
      name: 'status — pending event references an unknown def',
      englishLiteral: 'Pending event not found in pool.',
      run: (ctx) => {
        ctx.state!.events.pendingEvent = { eventId: 'nonexistent_event_xyz', firedAtTick: 0 };
        return eventCommand(ctx, ['status'], {});
      },
    },
    {
      name: 'choose — no index arg',
      englishLiteral: 'Usage: event choose <option_index>',
      run: (ctx) => eventCommand(ctx, ['choose'], {}),
    },
    {
      name: 'choose — no pending event / invalid option',
      englishLiteral: 'No pending event or invalid option.',
      run: (ctx) => eventCommand(ctx, ['choose', '0'], {}),
    },
    {
      name: 'dismiss — no resolved event',
      englishLiteral: 'No resolved event to dismiss.',
      run: (ctx) => eventCommand(ctx, ['dismiss'], {}),
    },
    {
      name: 'dismiss — clears a resolved event',
      englishLiteral: 'Outcome dismissed.',
      run: (ctx) => {
        ctx.state!.events.lastOutcome = { eventId: 'x', resultKey: 'x', effects: [] };
        return eventCommand(ctx, ['dismiss'], {});
      },
    },
    {
      name: 'fire — no eventId arg',
      englishLiteral: 'Usage: event fire <eventId>',
      run: (ctx) => eventCommand(ctx, ['fire'], {}),
    },
    {
      name: 'fire — unknown eventId',
      englishLiteral: 'Event "nonexistent_event_xyz" not found in pool.',
      run: (ctx) => eventCommand(ctx, ['fire', 'nonexistent_event_xyz'], {}),
    },
    {
      name: 'default usage',
      englishLiteral: 'Usage: event (status|choose|timers|fire)',
      run: (ctx) => eventCommand(ctx, ['bogus'], {}),
    },
  ];

  for (const { name, englishLiteral, run } of cases) {
    it(`${name} — matches the exact English literal by default`, () => {
      const ctx = makeCtx();
      const result = run(ctx);
      expect(result.output).toBe(englishLiteral);
    });

    it(`${name} — differs from the English literal under locale fr`, () => {
      const ctx = makeCtx();
      setLocale('fr');
      const result = run(ctx);
      expect(result.output).not.toBe(englishLiteral);
    });
  }
});
