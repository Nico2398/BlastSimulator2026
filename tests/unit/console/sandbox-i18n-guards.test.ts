// BlastSimulator2026 — sandbox.ts i18n guards (#861)
//
// sandbox.ts's own hardcoded unknown-subcommand/unknown-biome/
// unknown-difficulty guards and its start-success message (which embeds
// `console.staffed_suffix` conditionally, reusing the same key
// campaign.ts/world.ts's own success messages already share) all route
// through t() (see src/core/i18n/I18n.ts). Every test below pins the exact
// English literal and additionally proves the output changes under locale
// 'fr', so a hardcoded string that merely matches en.json cannot pass.
//
// `sandboxCommand`'s own `staffed:` validation (`console.invalid_staffed_flag`)
// is already wired via `parseStaffedFlag` (#820/#821) — not re-tested here.

import { describe, it, expect, afterEach } from 'vitest';
import { type GameContext } from '../../../src/console/commands/world.js';
import { sandboxCommand } from '../../../src/console/commands/sandbox.js';
import { SANDBOX_DIFFICULTY_ORDER } from '../../../src/core/campaign/Sandbox.js';
import { getAllBiomes } from '../../../src/core/world/BiomeCatalog.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';

function freshCtx(): GameContext {
  return { state: null, grid: null, emitter: new EventEmitter(), landscape: null, playableArea: null };
}

afterEach(() => setLocale('en'));

// ── unknown sub-command ───────────────────────────────────────────────────

describe('sandboxCommand — unknown sub-command', () => {
  const UNKNOWN_SUB_EN = 'Unknown sub-command: "bogus". Use: start';

  it('matches the exact English literal by default', () => {
    const ctx = freshCtx();
    const result = sandboxCommand(ctx, ['bogus'], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(UNKNOWN_SUB_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = freshCtx();
    setLocale('fr');
    const result = sandboxCommand(ctx, ['bogus'], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(UNKNOWN_SUB_EN);
  });
});

// ── unknown biome ─────────────────────────────────────────────────────────

describe('sandboxCommand — unknown biome', () => {
  const validBiomes = getAllBiomes().map(b => b.id).join(', ');
  const UNKNOWN_BIOME_EN = `Unknown biome: "moon". Valid: ${validBiomes}`;

  it('matches the exact English literal by default', () => {
    const ctx = freshCtx();
    const result = sandboxCommand(ctx, ['start'], { biome: 'moon' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(UNKNOWN_BIOME_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = freshCtx();
    setLocale('fr');
    const result = sandboxCommand(ctx, ['start'], { biome: 'moon' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(UNKNOWN_BIOME_EN);
  });
});

// ── unknown difficulty ────────────────────────────────────────────────────

describe('sandboxCommand — unknown difficulty', () => {
  const validDifficulties = SANDBOX_DIFFICULTY_ORDER.join(', ');
  const UNKNOWN_DIFFICULTY_EN = `Unknown difficulty: "insane". Valid: ${validDifficulties}`;

  it('matches the exact English literal by default', () => {
    const ctx = freshCtx();
    const result = sandboxCommand(ctx, ['start'], { difficulty: 'insane' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(UNKNOWN_DIFFICULTY_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = freshCtx();
    setLocale('fr');
    const result = sandboxCommand(ctx, ['start'], { difficulty: 'insane' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(UNKNOWN_DIFFICULTY_EN);
  });
});

// ── start-success message ─────────────────────────────────────────────────
// SANDBOX_DEFAULTS (biome: desert_badlands, difficulty: normal, seed: 12345)
// produce the level def sandboxLevelDef(config) resolves to: 64x32x64 grid,
// $100,000 starting cash — captured directly off a real sandboxCommand run
// (#861), not re-derived from Sandbox.ts's config tables by hand.

describe('sandboxCommand — start-success message', () => {
  const SUCCESS_UNSTAFFED_EN =
    'Sandbox started. 64x32x64 desert_badlands, difficulty normal, seed 12345, cash $100,000.';
  const SUCCESS_STAFFED_EN =
    'Sandbox started. 64x32x64 desert_badlands, difficulty normal, seed 12345, cash $100,000. Staffed.';

  describe('unstaffed', () => {
    it('matches the exact English literal by default', () => {
      const ctx = freshCtx();
      const result = sandboxCommand(ctx, ['start'], {});
      expect(result.success).toBe(true);
      expect(result.output).toBe(SUCCESS_UNSTAFFED_EN);
    });

    it('differs from the English literal under locale fr', () => {
      const ctx = freshCtx();
      setLocale('fr');
      const result = sandboxCommand(ctx, ['start'], {});
      expect(result.success).toBe(true);
      expect(result.output).not.toBe(SUCCESS_UNSTAFFED_EN);
    });
  });

  describe('staffed', () => {
    it('matches the exact English literal by default, embedding the staffed suffix', () => {
      const ctx = freshCtx();
      const result = sandboxCommand(ctx, ['start'], { staffed: 'true' });
      expect(result.success).toBe(true);
      expect(result.output).toBe(SUCCESS_STAFFED_EN);
    });

    it('differs from the English literal under locale fr', () => {
      const ctx = freshCtx();
      setLocale('fr');
      const result = sandboxCommand(ctx, ['start'], { staffed: 'true' });
      expect(result.success).toBe(true);
      expect(result.output).not.toBe(SUCCESS_STAFFED_EN);
    });
  });
});
