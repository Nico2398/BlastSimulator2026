// BlastSimulator2026 — mafia.ts i18n guards (#821)
//
// mafia.ts's mafiaCommand carries hardcoded English literals for the
// not-unlocked guard, the accident/frame usage strings, the shared
// "insufficient funds" message (both accident and frame each pay their own
// cost), the smuggle toggle's activated/deactivated lines, and the default
// usage string. #821 routes all of these through t() — see
// src/core/i18n/I18n.ts. Every test below pins the exact English literal and
// additionally proves the output changes under locale 'fr', so a hardcoded
// string that merely matches en.json cannot pass.

import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { type GameContext, newGameCommand } from '../../../src/console/commands/world.js';
import { mafiaCommand } from '../../../src/console/commands/mafia.js';
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

function makeUnlockedCtx(): GameContext {
  const ctx = makeCtx();
  ctx.state!.corruption.mafiaUnlocked = true;
  return ctx;
}

afterEach(() => setLocale('en'));

// ── mafia not unlocked ──────────────────────────────────────────────────

describe('mafia.ts not-unlocked guard — English literal + fr divergence', () => {
  const NOT_UNLOCKED_EN = 'Mafia not unlocked. Increase your corruption level first.';

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const result = mafiaCommand(ctx, ['accident'], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(NOT_UNLOCKED_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    setLocale('fr');
    const result = mafiaCommand(ctx, ['accident'], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(NOT_UNLOCKED_EN);
  });
});

// ── accident / frame usage strings ──────────────────────────────────────

describe('mafia.ts accident/frame usage strings — English literal + fr divergence', () => {
  const cases: Array<{
    name: string;
    englishLiteral: string;
    run: (ctx: GameContext) => { success: boolean; output: string };
  }> = [
    {
      name: 'accident usage — no employee param',
      englishLiteral: 'Usage: mafia accident employee:<id>',
      run: (ctx) => mafiaCommand(ctx, ['accident'], {}),
    },
    {
      name: 'frame usage — no employee param',
      englishLiteral: 'Usage: mafia frame employee:<id>',
      run: (ctx) => mafiaCommand(ctx, ['frame'], {}),
    },
  ];

  for (const { name, englishLiteral, run } of cases) {
    it(`${name} — matches the exact English literal by default`, () => {
      const ctx = makeUnlockedCtx();
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).toBe(englishLiteral);
    });

    it(`${name} — differs from the English literal under locale fr`, () => {
      const ctx = makeUnlockedCtx();
      setLocale('fr');
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).not.toBe(englishLiteral);
    });
  }
});

// ── insufficient funds (shared console.insufficient_funds key) ──────────

describe('mafia.ts insufficient funds — English literal + fr divergence', () => {
  const cases: Array<{
    name: string;
    englishLiteral: string;
    run: (ctx: GameContext) => { success: boolean; output: string };
  }> = [
    {
      name: 'accident — insufficient funds',
      englishLiteral: 'Insufficient funds: need $10,000, have $0',
      run: (ctx) => mafiaCommand(ctx, ['accident'], { employee: '1' }),
    },
    {
      name: 'frame — insufficient funds',
      englishLiteral: 'Insufficient funds: need $5,000, have $0',
      run: (ctx) => mafiaCommand(ctx, ['frame'], { employee: '1' }),
    },
  ];

  for (const { name, englishLiteral, run } of cases) {
    it(`${name} — matches the exact English literal by default`, () => {
      const ctx = makeUnlockedCtx();
      ctx.state!.cash = 0;
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).toBe(englishLiteral);
    });

    it(`${name} — differs from the English literal under locale fr`, () => {
      const ctx = makeUnlockedCtx();
      ctx.state!.cash = 0;
      setLocale('fr');
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).not.toBe(englishLiteral);
    });
  }
});

// ── smuggle toggle ────────────────────────────────────────────────────

describe('mafia.ts smuggle toggle — English literal + fr divergence', () => {
  const ACTIVATED_EN = 'Smuggling ACTIVATED. Income: $8000/tick. Watch your exposure.';
  const DEACTIVATED_EN = 'Smuggling DEACTIVATED.';

  it('first call activates — matches the exact English literal by default', () => {
    const ctx = makeUnlockedCtx();
    expect(ctx.state!.mafia.smugglingActive).toBe(false);

    const result = mafiaCommand(ctx, ['smuggle'], {});

    expect(result.success).toBe(true);
    expect(result.output).toBe(ACTIVATED_EN);
    expect(ctx.state!.mafia.smugglingActive).toBe(true);
  });

  it('first call activates — differs from the English literal under locale fr', () => {
    const ctx = makeUnlockedCtx();
    setLocale('fr');

    const result = mafiaCommand(ctx, ['smuggle'], {});

    expect(result.success).toBe(true);
    expect(result.output).not.toBe(ACTIVATED_EN);
  });

  it('second call deactivates — matches the exact English literal by default', () => {
    const ctx = makeUnlockedCtx();
    mafiaCommand(ctx, ['smuggle'], {}); // first call: activate

    const result = mafiaCommand(ctx, ['smuggle'], {}); // second call: deactivate

    expect(result.success).toBe(true);
    expect(result.output).toBe(DEACTIVATED_EN);
    expect(ctx.state!.mafia.smugglingActive).toBe(false);
  });

  it('second call deactivates — differs from the English literal under locale fr', () => {
    const ctx = makeUnlockedCtx();
    mafiaCommand(ctx, ['smuggle'], {}); // first call: activate
    setLocale('fr');

    const result = mafiaCommand(ctx, ['smuggle'], {}); // second call: deactivate

    expect(result.success).toBe(true);
    expect(result.output).not.toBe(DEACTIVATED_EN);
  });
});

// ── default usage string ──────────────────────────────────────────────

describe('mafia.ts default usage string — English literal + fr divergence', () => {
  const USAGE_EN = 'Usage: mafia (status|accident|frame|smuggle) [employee:<id>]';

  it('matches the exact English literal by default', () => {
    const ctx = makeUnlockedCtx();
    const result = mafiaCommand(ctx, ['bogus'], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(USAGE_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeUnlockedCtx();
    setLocale('fr');
    const result = mafiaCommand(ctx, ['bogus'], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(USAGE_EN);
  });
});
