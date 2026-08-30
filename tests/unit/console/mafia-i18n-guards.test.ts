// BlastSimulator2026 — mafia.ts i18n guards (#821, #862)
//
// mafia.ts's mafiaCommand carries hardcoded English literals for the
// not-unlocked guard, the accident/frame usage strings, the shared
// "insufficient funds" message (both accident and frame each pay their own
// cost), the smuggle toggle's activated/deactivated lines, and the default
// usage string. #821 routes all of these through t() — see
// src/core/i18n/I18n.ts. Every test below pins the exact English literal and
// additionally proves the output changes under locale 'fr', so a hardcoded
// string that merely matches en.json cannot pass.
//
// #862 reshapes MafiaActions.ts's MafiaActionResult from a hardcoded
// `message: string` to `outcomeKey`/`outcomeParams`, consumed by mafia.ts's
// 3 call sites via `t(result.outcomeKey, result.outcomeParams)`. The blocks
// below (target-not-found, accident success/failed, frame started, frame
// success/detected) cover every MafiaActions.ts outcome reachable through
// this console command file. `mafia.frame_no_ready` has no reachable path
// here — mafia.ts's 'frame' case only calls completeFrame after confirming a
// ready pending frame already exists via its own `pending` lookup, so
// completeFrame's not-ready branch can never fire through this command;
// that outcome is covered directly in MafiaActions.test.ts instead.

import { describe, it, expect, afterEach } from 'vitest';
import { type GameContext } from '../../../src/console/commands/world.js';
import { mafiaCommand } from '../../../src/console/commands/mafia.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { FRAME_EVIDENCE_TICKS } from '../../../src/core/events/MafiaActions.js';
import { makeGameContext } from '../../helpers/gameContext.js';

function makeCtx(seed = 1): GameContext {
  return makeGameContext({ mineType: 'desert', seed, size: 24 });
}

function makeUnlockedCtx(seed = 1): GameContext {
  const ctx = makeCtx(seed);
  ctx.state!.corruption.mafiaUnlocked = true;
  return ctx;
}

/** Hires one driller via the same core entry point used elsewhere in this suite. */
function hireTestEmployee(ctx: GameContext, seed = 1) {
  const { employee } = hireEmployee(ctx.state!.employees, 'driller', new Random(seed));
  return employee;
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

// ── target not found (accident + frame) — issue #862 ────────────────────

describe('mafia.ts target-not-found outcome — English literal + fr divergence', () => {
  const TARGET_NOT_FOUND_EN = 'Target not found';

  const cases: Array<{
    name: string;
    run: (ctx: GameContext) => { success: boolean; output: string };
  }> = [
    {
      name: 'accident — nonexistent employee id',
      run: (ctx) => mafiaCommand(ctx, ['accident'], { employee: '999999' }),
    },
    {
      name: 'frame — nonexistent employee id',
      run: (ctx) => mafiaCommand(ctx, ['frame'], { employee: '999999' }),
    },
  ];

  for (const { name, run } of cases) {
    it(`${name} — matches the exact English literal`, () => {
      const ctx = makeUnlockedCtx();
      const result = run(ctx);
      expect(result.success).toBe(true);
      expect(result.output).toBe(TARGET_NOT_FOUND_EN);
    });

    it(`${name} — differs from the English literal under locale fr`, () => {
      const ctx = makeUnlockedCtx();
      setLocale('fr');
      const result = run(ctx);
      expect(result.success).toBe(true);
      expect(result.output).not.toBe(TARGET_NOT_FOUND_EN);
    });
  }
});

// ── accident success / accident failed — issue #862 ─────────────────────

describe('mafia.ts accident success/failed outcomes — English literal + fr divergence', () => {
  function accidentSuccessEn(name: string): string {
    return `A tragic "accident" befell ${name}. Very unfortunate.`;
  }
  function accidentFailedEn(name: string): string {
    return `The "accident" was botched. ${name} is suspicious. Police may investigate.`;
  }

  it('covers both branches across seeds 0..49, matching the exact English literal built from the hired employee name', () => {
    let sawSuccess = false;
    let sawFailed = false;
    for (let seed = 0; seed < 50; seed++) {
      const ctx = makeUnlockedCtx(seed);
      const employee = hireTestEmployee(ctx, seed);
      const result = mafiaCommand(ctx, ['accident'], { employee: String(employee.id) });
      expect(result.success).toBe(true);
      if (result.output === accidentSuccessEn(employee.name)) {
        sawSuccess = true;
      } else {
        expect(result.output).toBe(accidentFailedEn(employee.name));
        sawFailed = true;
      }
    }
    if (!sawSuccess) expect.unreachable('No successful accident in 50 seeds');
    if (!sawFailed) expect.unreachable('No failed accident in 50 seeds');
  });

  it('differs from both English literals under locale fr, whichever branch fires', () => {
    for (let seed = 0; seed < 50; seed++) {
      const ctx = makeUnlockedCtx(seed);
      const employee = hireTestEmployee(ctx, seed);
      setLocale('fr');
      const result = mafiaCommand(ctx, ['accident'], { employee: String(employee.id) });
      expect(result.success).toBe(true);
      expect(result.output).not.toBe(accidentSuccessEn(employee.name));
      expect(result.output).not.toBe(accidentFailedEn(employee.name));
      setLocale('en');
    }
  });
});

// ── frame started — issue #862 ───────────────────────────────────────────

describe('mafia.ts frame-started outcome — English literal + fr divergence', () => {
  function frameStartedEn(name: string): string {
    return `Evidence is being planted against ${name}. Ready in ${FRAME_EVIDENCE_TICKS} ticks.`;
  }

  it('matches the exact English literal, including FRAME_EVIDENCE_TICKS', () => {
    const ctx = makeUnlockedCtx();
    const employee = hireTestEmployee(ctx);
    const result = mafiaCommand(ctx, ['frame'], { employee: String(employee.id) });
    expect(result.success).toBe(true);
    expect(result.output).toBe(frameStartedEn(employee.name));
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeUnlockedCtx();
    const employee = hireTestEmployee(ctx);
    setLocale('fr');
    const result = mafiaCommand(ctx, ['frame'], { employee: String(employee.id) });
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(frameStartedEn(employee.name));
  });
});

// ── frame success / frame detected — issue #862 ──────────────────────────
//
// Advancing tickCount to the pending frame's readyTick and calling `mafia
// frame` again routes through completeFrame (mafia.ts's 'frame' case finds
// the now-ready pending frame and completes it instead of starting a new
// one).

describe('mafia.ts frame success/detected outcomes — English literal + fr divergence', () => {
  const FRAME_SUCCESS_EN = 'Evidence was convincing. Employee terminated for cause.';
  const FRAME_DETECTED_EN = 'The frame was detected! Internal affairs is investigating.';

  it('covers both branches across seeds 0..49, matching the exact English literal for each', () => {
    let sawSuccess = false;
    let sawDetected = false;
    for (let seed = 0; seed < 50; seed++) {
      const ctx = makeUnlockedCtx(seed);
      const employee = hireTestEmployee(ctx, seed);
      const startResult = mafiaCommand(ctx, ['frame'], { employee: String(employee.id) });
      expect(startResult.success).toBe(true);
      ctx.state!.tickCount += FRAME_EVIDENCE_TICKS;
      const result = mafiaCommand(ctx, ['frame'], { employee: String(employee.id) });
      expect(result.success).toBe(true);
      if (result.output === FRAME_SUCCESS_EN) {
        sawSuccess = true;
      } else {
        expect(result.output).toBe(FRAME_DETECTED_EN);
        sawDetected = true;
      }
    }
    if (!sawSuccess) expect.unreachable('No successful frame completion in 50 seeds');
    if (!sawDetected) expect.unreachable('No detected frame completion in 50 seeds');
  });

  it('differs from both English literals under locale fr, whichever branch fires', () => {
    for (let seed = 0; seed < 50; seed++) {
      const ctx = makeUnlockedCtx(seed);
      const employee = hireTestEmployee(ctx, seed);
      mafiaCommand(ctx, ['frame'], { employee: String(employee.id) });
      ctx.state!.tickCount += FRAME_EVIDENCE_TICKS;
      setLocale('fr');
      const result = mafiaCommand(ctx, ['frame'], { employee: String(employee.id) });
      expect(result.success).toBe(true);
      expect(result.output).not.toBe(FRAME_SUCCESS_EN);
      expect(result.output).not.toBe(FRAME_DETECTED_EN);
      setLocale('en');
    }
  });
});

// ── status subcommand — issue #885 ───────────────────────────────────────
//
// mafia.ts's 'status' case still builds output from hardcoded English
// literals directly (never routed through t()) — see the 6 new
// mafia.status_* keys added to en.json/fr.json ahead of this wiring:
// status_unlocked_yes, status_unlocked_no, status_exposure,
// status_smuggling_active, status_smuggling_inactive, status_pending_frames.
// The two states below cover both branches of every one of those 6 keys.

describe('mafia.ts status subcommand — English literal + fr divergence', () => {
  const DEFAULT_STATUS_EN =
    'Mafia unlocked: No\nExposure risk: 0%\nSmuggling: inactive\nPending frames: 0';

  it('default/locked state — matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const result = mafiaCommand(ctx, ['status'], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe(DEFAULT_STATUS_EN);
  });

  it('default/locked state — differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    setLocale('fr');
    const result = mafiaCommand(ctx, ['status'], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(DEFAULT_STATUS_EN);
  });

  /**
   * Unlocks mafia, starts a frame (pendingFrames.length -> 1, exposureRisk
   * bumped) and toggles smuggling on (smugglingActive -> true), then builds
   * the exact English literal from the resulting state values — not
   * hardcoded guesses, since exposureRisk/smugglingIncome are derived from
   * MafiaActions.ts constants this test does not duplicate.
   */
  function setUpUnlockedSmugglingWithPendingFrame(): { ctx: GameContext; expectedEn: string } {
    const ctx = makeUnlockedCtx();
    const employee = hireTestEmployee(ctx);
    mafiaCommand(ctx, ['frame'], { employee: String(employee.id) });
    mafiaCommand(ctx, ['smuggle'], {});

    const mafia = ctx.state!.mafia;
    expect(mafia.pendingFrames.length).toBe(1);
    expect(mafia.smugglingActive).toBe(true);
    expect(mafia.exposureRisk).toBeGreaterThan(0);

    const expectedEn = [
      'Mafia unlocked: YES',
      `Exposure risk: ${(mafia.exposureRisk * 100).toFixed(0)}%`,
      `Smuggling: ACTIVE ($${mafia.smugglingIncome}/tick)`,
      `Pending frames: ${mafia.pendingFrames.length}`,
    ].join('\n');

    return { ctx, expectedEn };
  }

  it('unlocked/smuggling-active/pending-frame state — matches the exact English literal built from actual state values', () => {
    const { ctx, expectedEn } = setUpUnlockedSmugglingWithPendingFrame();
    const result = mafiaCommand(ctx, ['status'], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe(expectedEn);
  });

  it('unlocked/smuggling-active/pending-frame state — differs from the English literal under locale fr', () => {
    const { ctx, expectedEn } = setUpUnlockedSmugglingWithPendingFrame();
    setLocale('fr');
    const result = mafiaCommand(ctx, ['status'], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(expectedEn);
  });
});
