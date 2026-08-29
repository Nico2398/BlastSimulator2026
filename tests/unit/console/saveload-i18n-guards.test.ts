// BlastSimulator2026 — saveload.ts i18n guards (#797)
//
// saveCommand carries an inline `if (!ctx.state)` guard returning a
// hardcoded literal identical to `t('console.no_game_loaded')`. #797 routes
// it through t() — see src/core/i18n/I18n.ts. The test below pins the exact
// English literal and additionally proves the output changes under locale
// 'fr', so a hardcoded string that merely matches en.json cannot pass.
//
// loadCommand has no equivalent "no game loaded" guard today — it looks up
// its slot and deserializes into ctx.state regardless of ctx.state's prior
// value (src/console/commands/saveload.ts), so there is no such literal on
// that path to route through t() here.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { saveCommand } from '../../../src/console/commands/saveload.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { makeEmptyCtx } from './i18nGuardHelpers.js';

beforeEach(() => resetHoleIds());
afterEach(() => setLocale('en'));

describe('saveload.ts saveCommand no-game guard', () => {
  const NO_GAME_LOADED_EN = 'No game loaded. Use new_game first.';

  it('returns the exact English literal when no game is loaded', () => {
    const ctx = makeEmptyCtx();
    const result = saveCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(NO_GAME_LOADED_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeEmptyCtx();
    setLocale('fr');

    const result = saveCommand(ctx, [], {});

    expect(result.success).toBe(false);
    expect(result.output).not.toBe(NO_GAME_LOADED_EN);
  });
});
