// BlastSimulator2026 — economy.ts i18n guards (#797)
//
// economy.ts carries its own local `requireGame` returning a hardcoded
// literal identical to `commandUtils.requireGame`'s `t('console.no_game_loaded')`
// output, plus six hardcoded "Usage:" strings across contractCommand and
// fragmentsCommand. #797 routes all of these through t() — see
// src/core/i18n/I18n.ts. Every test below pins the exact English literal and
// additionally proves the output changes under locale 'fr', so a hardcoded
// string that merely matches en.json cannot pass.

import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { type GameContext, newGameCommand } from '../../../src/console/commands/world.js';
import { contractCommand, fragmentsCommand } from '../../../src/console/commands/economy.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';

function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '24' });
  return ctx;
}

afterEach(() => setLocale('en'));

// ── requireGame guard dedup (proves economy.ts's own local copy, once
// removed in favor of commandUtils.requireGame, produces the same output) ──

describe('economy.ts requireGame guard', () => {
  const NO_GAME_LOADED_EN = 'No game loaded. Use new_game first.';

  it('contractCommand returns the exact English literal when no game is loaded', () => {
    const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
    const result = contractCommand(ctx, ['list'], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(NO_GAME_LOADED_EN);
  });

  it('contractCommand differs from the English literal under locale fr', () => {
    const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
    setLocale('fr');

    const result = contractCommand(ctx, ['list'], {});

    expect(result.success).toBe(false);
    expect(result.output).not.toBe(NO_GAME_LOADED_EN);
  });

  it('fragmentsCommand returns the exact English literal when no game is loaded', () => {
    const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
    const result = fragmentsCommand(ctx, ['status'], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(NO_GAME_LOADED_EN);
  });

  it('fragmentsCommand differs from the English literal under locale fr', () => {
    const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
    setLocale('fr');

    const result = fragmentsCommand(ctx, ['status'], {});

    expect(result.success).toBe(false);
    expect(result.output).not.toBe(NO_GAME_LOADED_EN);
  });
});

// ── "Usage:" strings ─────────────────────────────────────────────────────

describe('economy.ts usage strings — English literal + fr divergence', () => {
  const cases: Array<{
    name: string;
    englishLiteral: string;
    run: (ctx: GameContext) => { success: boolean; output: string };
  }> = [
    {
      name: 'contract accept — no id/material selector',
      englishLiteral:
        'Usage: contract accept <id> | material:<materialId> [type:<ore_sale|rubble_disposal|supply>]',
      run: (ctx) => contractCommand(ctx, ['accept'], {}),
    },
    {
      name: 'contract decline — no id/material selector',
      englishLiteral:
        'Usage: contract decline <id> | material:<materialId> [type:<ore_sale|rubble_disposal|supply>]',
      run: (ctx) => contractCommand(ctx, ['decline'], {}),
    },
    {
      name: 'contract deliver — missing amount',
      englishLiteral:
        'Usage: contract deliver <id> amount:<kg> | material:<materialId> [type:<ore_sale|rubble_disposal|supply>] amount:<kg>',
      run: (ctx) => contractCommand(ctx, ['deliver'], {}),
    },
    {
      name: 'contract negotiate — no id/material selector',
      englishLiteral:
        'Usage: contract negotiate <id> | material:<materialId> [type:<ore_sale|rubble_disposal|supply>]',
      run: (ctx) => contractCommand(ctx, ['negotiate'], {}),
    },
    {
      name: 'contract — unknown subcommand',
      englishLiteral: 'Usage: contract (list|accept|decline|status|deliver|negotiate) [id] [amount:X]',
      run: (ctx) => contractCommand(ctx, ['bogus'], {}),
    },
    {
      name: 'fragments — unknown subcommand',
      englishLiteral: 'Usage: fragments status',
      run: (ctx) => fragmentsCommand(ctx, ['bogus'], {}),
    },
  ];

  for (const { name, englishLiteral, run } of cases) {
    it(`${name} — matches the exact English literal by default`, () => {
      const ctx = makeCtx();
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).toBe(englishLiteral);
    });

    it(`${name} — differs from the English literal under locale fr`, () => {
      const ctx = makeCtx();
      setLocale('fr');
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).not.toBe(englishLiteral);
    });
  }
});
