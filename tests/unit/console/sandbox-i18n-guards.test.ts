// BlastSimulator2026 — sandbox.ts i18n guards (#861)
//
// sandbox.ts's own hardcoded unknown-subcommand/unknown-biome/
// unknown-kit guards and its start-success message (which embeds
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
import { SANDBOX_KIT_ORDER } from '../../../src/core/campaign/Sandbox.js';
import { getAllBiomes } from '../../../src/core/world/BiomeCatalog.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { makeEmptyGameContext } from '../../helpers/gameContext.js';

function freshCtx(): GameContext {
  return makeEmptyGameContext();
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

// ── unknown kit (#1891) ───────────────────────────────────────────────────

describe('sandboxCommand — unknown kit', () => {
  const validKits = SANDBOX_KIT_ORDER.join(', ');

  it('lists the valid kits as "digger, full"', () => {
    expect(validKits).toBe('digger, full');
  });

  it.each(['kit', 'difficulty'] as const)('%s:insane fails naming the raw value and the valid kits', (key) => {
    const ctx = freshCtx();
    const result = sandboxCommand(ctx, ['start'], { [key]: 'insane' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('insane');
    expect(result.output).toContain(validKits);
    expect(result.output).not.toMatch(/difficult/i);
  });

  it('is translated under locale fr', () => {
    const ctx = freshCtx();
    const en = sandboxCommand(ctx, ['start'], { kit: 'insane' }).output;
    setLocale('fr');
    const result = sandboxCommand(freshCtx(), ['start'], { kit: 'insane' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(en);
    expect(result.output).toContain('insane');
    expect(result.output).toContain(validKits);
    expect(result.output).not.toMatch(/difficult/i);
  });

  it('keeps the raw value as typed in the message', () => {
    const result = sandboxCommand(freshCtx(), ['start'], { kit: 'Ultra Mega' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Ultra Mega');
  });

  it('i18n keys exist in both locales and the old difficulty keys are gone', () => {
    expect(t('sandbox.unknown_kit', { kit: 'x', valid: 'digger, full' })).not.toBe('sandbox.unknown_kit');
    expect(t('sandbox.kit.digger')).not.toBe('sandbox.kit.digger');
    expect(t('sandbox.kit.full')).not.toBe('sandbox.kit.full');
    expect(t('sandbox.field.kit')).toBe('Starting kit');
    expect(t('sandbox.unknown_difficulty')).toBe('sandbox.unknown_difficulty');
    expect(t('sandbox.field.difficulty')).toBe('sandbox.field.difficulty');
    expect(t('sandbox.difficulty.normal')).toBe('sandbox.difficulty.normal');
  });
});

describe('sandboxCommand — kit and legacy difficulty alias (#1891)', () => {
  it.each([
    [{ kit: 'full' }, 520_000],
    [{ kit: 'digger' }, 480_000],
    [{ difficulty: 'easy' }, 520_000],
    [{ difficulty: 'normal' }, 480_000],
    [{ difficulty: 'hard' }, 480_000],
    [{ kit: ' FULL ' }, 520_000],
  ])('%j starts with cash %i', (named, cash) => {
    const ctx = freshCtx();
    const result = sandboxCommand(ctx, ['start'], named as Record<string, string>);
    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(cash);
  });

  it('kit wins when both kit and difficulty are given', () => {
    const ctx = freshCtx();
    const result = sandboxCommand(ctx, ['start'], { kit: 'digger', difficulty: 'easy' });
    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(480_000);
  });

  it('a valid kit with an invalid difficulty still starts (kit wins)', () => {
    const ctx = freshCtx();
    const result = sandboxCommand(ctx, ['start'], { kit: 'full', difficulty: 'insane' });
    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(520_000);
  });
});

// ── start-success message ─────────────────────────────────────────────────
// SANDBOX_DEFAULTS (biome: desert_badlands, kit: digger, seed: 12345)
// produce the level def sandboxLevelDef(config) resolves to: 64x64 grid
// (datum SANDBOX_DATUM), $480,000 starting cash — captured directly off a
// real sandboxCommand run (#861), not re-derived from Sandbox.ts's config
// tables by hand. #1191 dropped the message's `{gridY}x` segment entirely.

describe('sandboxCommand — start-success message', () => {
  // #1891: the message names the kit, never a difficulty. Exact wording is the
  // implementer's; the facts it must carry are pinned here.
  const FACTS = ['Sandbox started.', '64x64', 'desert_badlands', 'seed 12345', '$480,000'];
  const expectMessage = (output: string, staffed: boolean): void => {
    for (const fact of FACTS) expect(output).toContain(fact);
    expect(output).not.toMatch(/difficult/i);
    expect(output.includes('Staffed.')).toBe(staffed);
  };

  describe('unstaffed', () => {
    it('matches the exact English literal with staffed:false', () => {
      const ctx = freshCtx();
      const result = sandboxCommand(ctx, ['start'], { staffed: 'false' });
      expect(result.success).toBe(true);
      expectMessage(result.output, false);
    });

    it('differs from the English literal under locale fr', () => {
      const ctx = freshCtx();
      setLocale('fr');
      const result = sandboxCommand(ctx, ['start'], { staffed: 'false' });
      expect(result.success).toBe(true);
      expect(result.output).not.toContain('Sandbox started.');
      expect(result.output).not.toMatch(/difficult/i);
    });
  });

  describe('default opening', () => {
    it('carries the level kit by default (staffed suffix)', () => {
      const ctx = freshCtx();
      const result = sandboxCommand(ctx, ['start'], {});
      expect(result.success).toBe(true);
      expectMessage(result.output, true);
    });
  });

  describe('staffed', () => {
    it('matches the exact English literal by default, embedding the staffed suffix', () => {
      const ctx = freshCtx();
      const result = sandboxCommand(ctx, ['start'], { staffed: 'true' });
      expect(result.success).toBe(true);
      expectMessage(result.output, true);
    });

    it('differs from the English literal under locale fr', () => {
      const ctx = freshCtx();
      setLocale('fr');
      const result = sandboxCommand(ctx, ['start'], { staffed: 'true' });
      expect(result.success).toBe(true);
      expect(result.output).not.toContain('Sandbox started.');
      expect(result.output).not.toMatch(/difficult/i);
    });
  });
});
