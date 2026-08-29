// BlastSimulator2026 — corruption.ts i18n guards (#821)
//
// corruption.ts's corruptCommand carries hardcoded English literals for the
// invalid-target rejection, the shared "insufficient funds" message, and the
// per-outcome corruption-attempt lines (success/failure, scandal, mafia
// unlock). #821 routes all of these through t() — see src/core/i18n/I18n.ts.
// Every test below pins the exact English literal and additionally proves
// the output changes under locale 'fr', so a hardcoded string that merely
// matches en.json cannot pass.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { type GameContext, newGameCommand } from '../../../src/console/commands/world.js';
import { corruptCommand } from '../../../src/console/commands/corruption.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import * as CorruptionModule from '../../../src/core/economy/Corruption.js';

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

// ── invalid target ────────────────────────────────────────────────────────

describe('corruption.ts invalid target — English literal + fr divergence', () => {
  const INVALID_TARGET_EN = 'Invalid target. Valid: judge, union_leader, inspector, politician, witness';

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const result = corruptCommand(ctx, [], { target: 'bogus' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(INVALID_TARGET_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    setLocale('fr');
    const result = corruptCommand(ctx, [], { target: 'bogus' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(INVALID_TARGET_EN);
  });
});

// ── insufficient funds (shared console.insufficient_funds key) ─────────────

describe('corruption.ts insufficient funds — English literal + fr divergence', () => {
  const INSUFFICIENT_FUNDS_EN = 'Insufficient funds: need $50,000, have $0';

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    ctx.state!.cash = 0;
    const result = corruptCommand(ctx, [], { target: 'judge' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(INSUFFICIENT_FUNDS_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    ctx.state!.cash = 0;
    setLocale('fr');
    const result = corruptCommand(ctx, [], { target: 'judge' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(INSUFFICIENT_FUNDS_EN);
  });
});

// ── per-outcome lines (attemptCorruption mocked for controlled results) ────

describe('corruption.ts per-outcome lines — English literal + fr divergence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('success line matches the exact English literal by default', () => {
    const ctx = makeCtx();
    vi.spyOn(CorruptionModule, 'attemptCorruption').mockReturnValue({
      success: true,
      cost: 1000,
      scandalTriggered: false,
      mafiaJustUnlocked: false,
    });
    const result = corruptCommand(ctx, [], { target: 'inspector' });
    expect(result.success).toBe(true);
    expect(result.output.split('\n')[0]).toBe('CORRUPTION SUCCESSFUL.');
  });

  it('success line differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    vi.spyOn(CorruptionModule, 'attemptCorruption').mockReturnValue({
      success: true,
      cost: 1000,
      scandalTriggered: false,
      mafiaJustUnlocked: false,
    });
    setLocale('fr');
    const result = corruptCommand(ctx, [], { target: 'inspector' });
    expect(result.success).toBe(true);
    expect(result.output.split('\n')[0]).not.toBe('CORRUPTION SUCCESSFUL.');
  });

  it('failed/scandal header matches the exact English literal by default', () => {
    const ctx = makeCtx();
    vi.spyOn(CorruptionModule, 'attemptCorruption').mockReturnValue({
      success: false,
      cost: 1000,
      scandalTriggered: true,
      mafiaJustUnlocked: false,
    });
    const result = corruptCommand(ctx, [], { target: 'inspector' });
    expect(result.success).toBe(true);
    expect(result.output.split('\n')[0]).toBe('CORRUPTION FAILED — SCANDAL!');
  });

  it('failed/scandal header differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    vi.spyOn(CorruptionModule, 'attemptCorruption').mockReturnValue({
      success: false,
      cost: 1000,
      scandalTriggered: true,
      mafiaJustUnlocked: false,
    });
    setLocale('fr');
    const result = corruptCommand(ctx, [], { target: 'inspector' });
    expect(result.success).toBe(true);
    expect(result.output.split('\n')[0]).not.toBe('CORRUPTION FAILED — SCANDAL!');
  });

  it('scandal-erupted line matches the exact English literal by default', () => {
    const ctx = makeCtx();
    vi.spyOn(CorruptionModule, 'attemptCorruption').mockReturnValue({
      success: false,
      cost: 1000,
      scandalTriggered: true,
      mafiaJustUnlocked: false,
    });
    const result = corruptCommand(ctx, [], { target: 'inspector' });
    expect(result.output.split('\n')[2]).toBe('A scandal has erupted. Expect consequences.');
  });

  it('scandal-erupted line differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    vi.spyOn(CorruptionModule, 'attemptCorruption').mockReturnValue({
      success: false,
      cost: 1000,
      scandalTriggered: true,
      mafiaJustUnlocked: false,
    });
    setLocale('fr');
    const result = corruptCommand(ctx, [], { target: 'inspector' });
    expect(result.output.split('\n')[2]).not.toBe('A scandal has erupted. Expect consequences.');
  });

  it('mafia-unlocked line matches the exact English literal by default', () => {
    const ctx = makeCtx();
    vi.spyOn(CorruptionModule, 'attemptCorruption').mockReturnValue({
      success: true,
      cost: 1000,
      scandalTriggered: false,
      mafiaJustUnlocked: true,
    });
    const result = corruptCommand(ctx, [], { target: 'inspector' });
    expect(result.output.split('\n')[2]).toBe(
      'You have attracted the attention of... certain organizations.',
    );
  });

  it('mafia-unlocked line differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    vi.spyOn(CorruptionModule, 'attemptCorruption').mockReturnValue({
      success: true,
      cost: 1000,
      scandalTriggered: false,
      mafiaJustUnlocked: true,
    });
    setLocale('fr');
    const result = corruptCommand(ctx, [], { target: 'inspector' });
    expect(result.output.split('\n')[2]).not.toBe(
      'You have attracted the attention of... certain organizations.',
    );
  });
});
