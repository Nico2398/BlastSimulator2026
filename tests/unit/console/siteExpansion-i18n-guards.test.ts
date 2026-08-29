// BlastSimulator2026 — siteExpansion.ts i18n guards (#861)
//
// claimForAction's ClaimRefusalReason → refusal-text mapping (4 distinct
// reasons: protected_structure, not_adjacent, too_far, expansion_disabled —
// not_adjacent and too_far do share the exact same English text in source
// today, verified below) and the outer "Cannot {what} at chunk ({cx}, {cz}):
// {reason}." wrapping template both route through t() (see
// src/core/i18n/I18n.ts). Every test below pins the exact English literal
// and additionally proves the output changes under locale 'fr', so a
// hardcoded string that merely matches en.json cannot pass.
//
// Each reason is reached by mocking `PlayableArea.claimArea` on the real
// instance `newGameCommand` builds — the only way to force a chosen refusal
// reason deterministically without engineering real protected-structure/
// too-far/adjacency terrain (same instance-method mocking technique
// insufficient-funds-guards.test.ts and mining-i18n-guards.test.ts already
// use for module-level functions).

import { describe, it, expect, afterEach, vi } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { type GameContext, newGameCommand } from '../../../src/console/commands/world.js';
import { claimForAction } from '../../../src/console/commands/siteExpansion.js';
import type { ClaimRefusalReason } from '../../../src/core/world/PlayableArea.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';

function makeCtx(): GameContext {
  const ctx: GameContext = {
    state: null,
    grid: null,
    emitter: new EventEmitter(),
    landscape: null,
    playableArea: null,
  };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32' });
  return ctx;
}

/** A cell definitely outside the freshly-generated site, so claimForAction's own offSite filter always calls into (the mocked) claimArea. */
function offSiteCell(ctx: GameContext): { x: number; z: number } {
  return { x: ctx.grid!.maxX + 50, z: ctx.grid!.minZ };
}

function mockClaimRefusal(ctx: GameContext, reason: ClaimRefusalReason): void {
  vi.spyOn(ctx.playableArea!, 'claimArea').mockReturnValue({
    claimed: false,
    chunk: { cx: 5, cz: 6 },
    reason,
  });
}

afterEach(() => {
  setLocale('en');
  vi.restoreAllMocks();
});

describe('claimForAction — ClaimRefusalReason → refusal text + outer wrapping template', () => {
  const cases: Array<{ reason: ClaimRefusalReason; englishLiteral: string }> = [
    {
      reason: 'protected_structure',
      englishLiteral:
        'Cannot drill at chunk (5, 6): protected ground — a village, river or landmark stands there and the site can never take it.',
    },
    {
      reason: 'not_adjacent',
      englishLiteral:
        'Cannot drill at chunk (5, 6): too far — the site cannot bridge that much ground in a single action.',
    },
    {
      reason: 'too_far',
      englishLiteral:
        'Cannot drill at chunk (5, 6): too far — the site cannot bridge that much ground in a single action.',
    },
    {
      reason: 'expansion_disabled',
      englishLiteral: 'Cannot drill at chunk (5, 6): outside the site, and this site cannot be expanded.',
    },
  ];

  for (const { reason, englishLiteral } of cases) {
    it(`${reason} — matches the exact English literal by default`, () => {
      const ctx = makeCtx();
      mockClaimRefusal(ctx, reason);
      const result = claimForAction(ctx, [offSiteCell(ctx)], 'drill');
      expect(result.ok).toBe(false);
      expect(result.output).toBe(englishLiteral);
    });

    it(`${reason} — differs from the English literal under locale fr`, () => {
      const ctx = makeCtx();
      mockClaimRefusal(ctx, reason);
      setLocale('fr');
      const result = claimForAction(ctx, [offSiteCell(ctx)], 'drill');
      expect(result.ok).toBe(false);
      expect(result.output).not.toBe(englishLiteral);
    });
  }

  it('not_adjacent and too_far share the exact same English text in source today', () => {
    const notAdjacent = cases.find(c => c.reason === 'not_adjacent')!.englishLiteral;
    const tooFar = cases.find(c => c.reason === 'too_far')!.englishLiteral;
    expect(notAdjacent).toBe(tooFar);
  });
});

describe('claimForAction — outer template honors the `what` interpolation', () => {
  const BUILD_REFUSAL_EN =
    'Cannot build at chunk (5, 6): outside the site, and this site cannot be expanded.';

  it('matches the exact English literal by default for a non-"drill" action name', () => {
    const ctx = makeCtx();
    mockClaimRefusal(ctx, 'expansion_disabled');
    const result = claimForAction(ctx, [offSiteCell(ctx)], 'build');
    expect(result.ok).toBe(false);
    expect(result.output).toBe(BUILD_REFUSAL_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    mockClaimRefusal(ctx, 'expansion_disabled');
    setLocale('fr');
    const result = claimForAction(ctx, [offSiteCell(ctx)], 'build');
    expect(result.ok).toBe(false);
    expect(result.output).not.toBe(BUILD_REFUSAL_EN);
  });
});
