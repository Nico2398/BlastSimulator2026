// BlastSimulator2026 — time.ts i18n guards (#821)
//
// time.ts's timeCommand carries hardcoded English literals for the
// pause/resume confirmations, the invalid-speed rejection, the speed-set
// confirmation, and the default usage string. #821 routes all of these
// through t() — see src/core/i18n/I18n.ts. Every test below pins the exact
// English literal and additionally proves the output changes under locale
// 'fr', so a hardcoded string that merely matches en.json cannot pass.

import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { type GameContext, newGameCommand } from '../../../src/console/commands/world.js';
import { timeCommand } from '../../../src/console/commands/time.js';
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

describe('time.ts — English literal + fr divergence', () => {
  const cases: Array<{
    name: string;
    englishLiteral: string;
    run: (ctx: GameContext) => { success: boolean; output: string };
  }> = [
    {
      name: 'pause',
      englishLiteral: 'Game paused.',
      run: (ctx) => timeCommand(ctx, ['pause'], {}),
    },
    {
      name: 'resume',
      englishLiteral: 'Game resumed at 1x speed.',
      run: (ctx) => timeCommand(ctx, ['resume'], {}),
    },
    {
      name: 'invalid speed',
      englishLiteral: 'Valid speeds: 1, 2, 4, 8',
      run: (ctx) => timeCommand(ctx, ['speed'], {}),
    },
    {
      name: 'speed set',
      englishLiteral: 'Speed set to 4x.',
      run: (ctx) => timeCommand(ctx, ['speed', '4'], {}),
    },
    {
      name: 'default usage',
      englishLiteral: 'Usage: time (status|pause|resume|speed <1|2|4|8>)',
      run: (ctx) => timeCommand(ctx, ['bogus'], {}),
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
