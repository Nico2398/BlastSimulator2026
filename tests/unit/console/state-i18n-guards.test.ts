// BlastSimulator2026 — state.ts i18n guards (#797)
//
// state.ts uses MiningContext/an inline `if (!ctx.state)` guard (not
// commandUtils.requireGame) that returns a hardcoded literal identical to
// `t('console.no_game_loaded')`, plus one hardcoded "Usage:" string for an
// invalid subcommand. #797 routes both through t() — see
// src/core/i18n/I18n.ts. Every test below pins the exact English literal and
// additionally proves the output changes under locale 'fr', so a hardcoded
// string that merely matches en.json cannot pass.

import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { newGameCommand } from '../../../src/console/commands/world.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { stateCommand } from '../../../src/console/commands/state.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { makeEmptyCtx } from './i18nGuardHelpers.js';

function makeCtx(): MiningContext {
  const ctx: MiningContext = {
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

describe('state.ts inline no-game guard', () => {
  const NO_GAME_LOADED_EN = 'No game loaded. Use new_game first.';

  it('returns the exact English literal when no game is loaded', () => {
    const ctx = makeEmptyCtx();
    const result = stateCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(NO_GAME_LOADED_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeEmptyCtx();
    setLocale('fr');

    const result = stateCommand(ctx, [], {});

    expect(result.success).toBe(false);
    expect(result.output).not.toBe(NO_GAME_LOADED_EN);
  });
});

describe('state.ts usage string — English literal + fr divergence', () => {
  const USAGE_EN = 'Usage: state [full|summary]';

  it('matches the exact English literal by default for an invalid subcommand', () => {
    const ctx = makeCtx();
    const result = stateCommand(ctx, ['bogus'], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(USAGE_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    setLocale('fr');

    const result = stateCommand(ctx, ['bogus'], {});

    expect(result.success).toBe(false);
    expect(result.output).not.toBe(USAGE_EN);
  });
});
