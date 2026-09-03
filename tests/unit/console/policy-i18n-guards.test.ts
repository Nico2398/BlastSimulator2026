// BlastSimulator2026 — policy.ts i18n guards (#797)
//
// policy.ts carries its own local `requireGame` returning a hardcoded
// literal identical to `commandUtils.requireGame`'s `t('console.no_game_loaded')`
// output, plus one hardcoded "Usage:" string (USAGE_MSG). #797 routes both
// through t() — see src/core/i18n/I18n.ts. Every test below pins the exact
// English literal and additionally proves the output changes under locale
// 'fr', so a hardcoded string that merely matches en.json cannot pass.

import { describe, it, expect, afterEach } from 'vitest';
import { type GameContext } from '../../../src/console/commands/world.js';
import { setPolicyCommand } from '../../../src/console/commands/policy.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { makeEmptyCtx } from './i18nGuardHelpers.js';
import { makeGameContext } from '../../helpers/gameContext.js';

function makeCtx(): GameContext {
  return makeGameContext({ mineType: 'desert', seed: 1, size: 24 });
}

afterEach(() => setLocale('en'));

describe('policy.ts requireGame guard', () => {
  const NO_GAME_LOADED_EN = 'No game loaded. Use new_game first.';

  it('returns the exact English literal when no game is loaded', () => {
    const ctx = makeEmptyCtx();
    const result = setPolicyCommand(ctx, [], { mode: 'shift_8h' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(NO_GAME_LOADED_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeEmptyCtx();
    setLocale('fr');

    const result = setPolicyCommand(ctx, [], { mode: 'shift_8h' });

    expect(result.success).toBe(false);
    expect(result.output).not.toBe(NO_GAME_LOADED_EN);
  });
});

describe('policy.ts usage string — English literal + fr divergence', () => {
  const USAGE_EN =
    'Usage: set_policy mode:(shift_8h|shift_12h|continuous|custom) [fatigue:N]';

  it('matches the exact English literal by default when mode is missing/invalid', () => {
    const ctx = makeCtx();
    const result = setPolicyCommand(ctx, [], { mode: 'bogus_mode' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(USAGE_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    setLocale('fr');

    const result = setPolicyCommand(ctx, [], { mode: 'bogus_mode' });

    expect(result.success).toBe(false);
    expect(result.output).not.toBe(USAGE_EN);
  });
});
