// BlastSimulator2026 — campaign.ts i18n guards (#861)
//
// campaign.ts's own hardcoded guard/usage/validation/success strings — the
// three `!ctx.state` no-game-loaded guards (campaignStatusCommand,
// campaignCompleteCommand, tutorialStartCommand), campaignCompleteCommand's
// no-active-level and unknown-level guards and its force-complete success
// message, campaignStartCommand's usage/unknown-level/level-locked/
// unknown-biome guards and its start-success message (which embeds
// `console.staffed_suffix` conditionally), and tutorialStartCommand's success
// message — all route through t() (see src/core/i18n/I18n.ts). Every test
// below pins the exact English literal and additionally proves the output
// changes under locale 'fr', so a hardcoded string that merely matches
// en.json cannot pass.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { type GameContext } from '../../../src/console/commands/world.js';
import {
  campaignStatusCommand,
  campaignCompleteCommand,
  campaignStartCommand,
  tutorialStartCommand,
} from '../../../src/console/commands/campaign.js';
import { getLevel } from '../../../src/core/campaign/Level.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import * as BiomeCatalogModule from '../../../src/core/world/BiomeCatalog.js';
import { makeEmptyCtx } from './i18nGuardHelpers.js';
import { makeEmptyGameContext, makeGameContext } from '../../helpers/gameContext.js';

function freshCtx(): GameContext {
  return makeEmptyGameContext();
}

function makeCtx(): GameContext {
  return makeGameContext({ mineType: 'desert', seed: 1, size: 32 });
}

afterEach(() => {
  setLocale('en');
  vi.restoreAllMocks();
});

// ── the 3 no_game_loaded guards in this file ─────────────────────────────
// (reuses the existing `console.no_game_loaded` key, already wired from
// #820/#821 — these prove campaign.ts's own local copies of the literal
// route through the same key as commandUtils.requireGame does.)

describe('campaign.ts no_game_loaded guards', () => {
  const NO_GAME_LOADED_EN = 'No game loaded. Use new_game first.';

  const cases: Array<{
    name: string;
    run: (ctx: GameContext) => { success: boolean; output: string };
  }> = [
    { name: 'campaignStatusCommand', run: (ctx) => campaignStatusCommand(ctx, [], {}) },
    { name: 'campaignCompleteCommand', run: (ctx) => campaignCompleteCommand(ctx, [], {}) },
    { name: 'tutorialStartCommand', run: (ctx) => tutorialStartCommand(ctx, [], {}) },
  ];

  for (const { name, run } of cases) {
    it(`${name} — returns the exact English literal when no game is loaded`, () => {
      const ctx = makeEmptyCtx();
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).toBe(NO_GAME_LOADED_EN);
    });

    it(`${name} — differs from the English literal under locale fr`, () => {
      const ctx = makeEmptyCtx();
      setLocale('fr');
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).not.toBe(NO_GAME_LOADED_EN);
    });
  }
});

// ── campaignCompleteCommand — no active level ────────────────────────────

describe('campaignCompleteCommand — no active level', () => {
  const NO_ACTIVE_LEVEL_EN = 'No active level. Use campaign start level:<id> first.';

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx(); // game loaded, but campaign.activeLevelId is null
    const result = campaignCompleteCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(NO_ACTIVE_LEVEL_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    setLocale('fr');
    const result = campaignCompleteCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(NO_ACTIVE_LEVEL_EN);
  });
});

// ── campaignCompleteCommand — unknown level ──────────────────────────────

describe('campaignCompleteCommand — unknown level on complete', () => {
  const UNKNOWN_LEVEL_EN = 'Unknown level: nonexistent_level';

  function setupUnknownActiveLevel(): GameContext {
    const ctx = makeCtx();
    ctx.state!.campaign.activeLevelId = 'nonexistent_level';
    return ctx;
  }

  it('matches the exact English literal by default', () => {
    const ctx = setupUnknownActiveLevel();
    const result = campaignCompleteCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(UNKNOWN_LEVEL_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = setupUnknownActiveLevel();
    setLocale('fr');
    const result = campaignCompleteCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(UNKNOWN_LEVEL_EN);
  });
});

// ── campaignCompleteCommand — force-complete success message ────────────

describe('campaignCompleteCommand — force-complete success message', () => {
  const FORCE_COMPLETE_EN = 'Debug: force-completed level "tutorial_pit". Profit threshold met.';

  function setupActiveTutorial(): GameContext {
    const ctx = freshCtx();
    campaignStartCommand(ctx, [], { level: 'tutorial_pit' });
    return ctx;
  }

  it('matches the exact English literal by default', () => {
    const ctx = setupActiveTutorial();
    const result = campaignCompleteCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe(FORCE_COMPLETE_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = setupActiveTutorial();
    setLocale('fr');
    const result = campaignCompleteCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(FORCE_COMPLETE_EN);
  });
});

// ── campaignStartCommand — usage guard ───────────────────────────────────

describe('campaignStartCommand — usage guard (no level: given)', () => {
  const USAGE_EN = 'Usage: campaign start level:<id>';

  it('matches the exact English literal by default', () => {
    const ctx = freshCtx();
    const result = campaignStartCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(USAGE_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = freshCtx();
    setLocale('fr');
    const result = campaignStartCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(USAGE_EN);
  });
});

// ── campaignStartCommand — unknown level ─────────────────────────────────

describe('campaignStartCommand — unknown level', () => {
  const UNKNOWN_LEVEL_EN = 'Unknown level: "bogus_level".';

  it('matches the exact English literal by default', () => {
    const ctx = freshCtx();
    const result = campaignStartCommand(ctx, [], { level: 'bogus_level' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(UNKNOWN_LEVEL_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = freshCtx();
    setLocale('fr');
    const result = campaignStartCommand(ctx, [], { level: 'bogus_level' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(UNKNOWN_LEVEL_EN);
  });
});

// ── campaignStartCommand — level locked ──────────────────────────────────

describe('campaignStartCommand — level locked', () => {
  // grumpstone_ridge is difficultyTier 2 — locked by a fresh CampaignState,
  // whose only unlocked levels are index 0 (tutorial_pit) and any
  // difficultyTier === 1 level (dusty_hollow).
  const LOCKED_EN = 'Level "grumpstone_ridge" is locked. Complete previous levels first.';

  it('matches the exact English literal by default', () => {
    const ctx = freshCtx();
    const result = campaignStartCommand(ctx, [], { level: 'grumpstone_ridge' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(LOCKED_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = freshCtx();
    setLocale('fr');
    const result = campaignStartCommand(ctx, [], { level: 'grumpstone_ridge' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(LOCKED_EN);
  });
});

// ── campaignStartCommand — unknown biome ─────────────────────────────────
// Every real level carries a valid biome id, so this branch is only
// reachable by mocking getBiome to return undefined for a legitimate,
// unlocked level (tutorial_pit) — same technique mining-i18n-guards.test.ts
// uses on SurveyCalcModule/BlastExecutionModule.

describe('campaignStartCommand — unknown biome', () => {
  const level = getLevel('tutorial_pit')!;
  const UNKNOWN_BIOME_EN = `Unknown biome: ${level.biome}`;

  it('matches the exact English literal by default', () => {
    const ctx = freshCtx();
    vi.spyOn(BiomeCatalogModule, 'getBiome').mockReturnValue(undefined);
    const result = campaignStartCommand(ctx, [], { level: 'tutorial_pit' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(UNKNOWN_BIOME_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = freshCtx();
    vi.spyOn(BiomeCatalogModule, 'getBiome').mockReturnValue(undefined);
    setLocale('fr');
    const result = campaignStartCommand(ctx, [], { level: 'tutorial_pit' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(UNKNOWN_BIOME_EN);
  });
});

// ── campaignStartCommand — start-success message ─────────────────────────
// tutorial_pit: gridX×gridY×gridZ = 32×20×32, startingCash = $290,000 (#861
// captured directly off getLevel — verify against getLevel('tutorial_pit')
// rather than re-deriving the level def's own numbers by hand).

describe('campaignStartCommand — start-success message', () => {
  const tutorialLevel = getLevel('tutorial_pit')!;

  function expectedSuccess(cash: number, staffed: boolean): string {
    return `Started level "tutorial_pit". Grid: ${tutorialLevel.gridX}×${tutorialLevel.gridY}×${tutorialLevel.gridZ}. Cash: $${cash.toLocaleString('en-US')}.${staffed ? ' Staffed.' : ''}`;
  }

  describe('unstaffed', () => {
    it('matches the exact English literal by default', () => {
      const ctx = freshCtx();
      const result = campaignStartCommand(ctx, [], { level: 'tutorial_pit' });
      expect(result.success).toBe(true);
      expect(ctx.state!.cash).toBe(tutorialLevel.startingCash);
      expect(result.output).toBe(expectedSuccess(tutorialLevel.startingCash, false));
    });

    it('differs from the English literal under locale fr', () => {
      const ctx = freshCtx();
      setLocale('fr');
      const result = campaignStartCommand(ctx, [], { level: 'tutorial_pit' });
      expect(result.success).toBe(true);
      expect(result.output).not.toBe(expectedSuccess(tutorialLevel.startingCash, false));
    });
  });

  describe('staffed', () => {
    it('matches the exact English literal by default, embedding the staffed suffix', () => {
      const ctx = freshCtx();
      const result = campaignStartCommand(ctx, [], { level: 'tutorial_pit', staffed: 'true' });
      expect(result.success).toBe(true);
      expect(ctx.state!.cash).toBe(tutorialLevel.startingCash);
      expect(result.output).toBe(expectedSuccess(tutorialLevel.startingCash, true));
    });

    it('differs from the English literal under locale fr', () => {
      const ctx = freshCtx();
      setLocale('fr');
      const result = campaignStartCommand(ctx, [], { level: 'tutorial_pit', staffed: 'true' });
      expect(result.success).toBe(true);
      expect(result.output).not.toBe(expectedSuccess(tutorialLevel.startingCash, true));
    });
  });
});

// ── tutorialStartCommand — success message ───────────────────────────────

describe('tutorialStartCommand — success message', () => {
  const TUTORIAL_STARTED_EN = 'Tutorial started';

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const result = tutorialStartCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe(TUTORIAL_STARTED_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    setLocale('fr');
    const result = tutorialStartCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(TUTORIAL_STARTED_EN);
  });
});
