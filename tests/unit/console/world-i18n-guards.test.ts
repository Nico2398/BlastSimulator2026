// BlastSimulator2026 — world.ts i18n guards (#861)
//
// Covers only the 4 functions actually registered/dispatched by
// createRunner.ts: newGameCommand, inspectCommand, terrainInfoCommand, and
// landscapeInfoCommand. world.ts's own `surveyCommand` export is dead/shadowed
// code — createRunner.ts dispatches mining.ts's surveyCommand instead
// (already covered by mining-i18n-guards.test.ts) — so it is out of scope
// here. terrainInfoCommand's multi-line report body also stays unwired
// (out of scope); only its no_game_loaded guard is covered.
//
// Every test below pins the exact English literal and additionally proves
// the output changes under locale 'fr', so a hardcoded string that merely
// matches en.json cannot pass.

import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import {
  type GameContext,
  newGameCommand,
  inspectCommand,
  terrainInfoCommand,
  landscapeInfoCommand,
} from '../../../src/console/commands/world.js';
import { getAllBiomes } from '../../../src/core/world/BiomeCatalog.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { makeEmptyCtx } from './i18nGuardHelpers.js';

function freshCtx(): GameContext {
  return { state: null, grid: null, emitter: new EventEmitter(), landscape: null, playableArea: null };
}

function makeCtx(): GameContext {
  const ctx = freshCtx();
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

afterEach(() => setLocale('en'));

// ── newGameCommand — unknown mine type ───────────────────────────────────

describe('newGameCommand — unknown mine type', () => {
  const validBiomes = getAllBiomes().map(b => b.id).join(', ');
  const UNKNOWN_MINE_TYPE_EN = `Unknown mine type: "moon". Valid: ${validBiomes}`;

  it('matches the exact English literal by default', () => {
    const ctx = freshCtx();
    const result = newGameCommand(ctx, [], { mine_type: 'moon' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(UNKNOWN_MINE_TYPE_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = freshCtx();
    setLocale('fr');
    const result = newGameCommand(ctx, [], { mine_type: 'moon' });
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(UNKNOWN_MINE_TYPE_EN);
  });
});

// ── newGameCommand — new-game-success message ────────────────────────────

describe('newGameCommand — new-game-success message', () => {
  const SUCCESS_UNSTAFFED_EN = 'Game created. 32x32x32 terrain, desert biome, seed 1.';
  const SUCCESS_STAFFED_EN = 'Game created. 32x32x32 terrain, desert biome, seed 1. Staffed.';

  describe('unstaffed', () => {
    it('matches the exact English literal by default', () => {
      const ctx = freshCtx();
      const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32' });
      expect(result.success).toBe(true);
      expect(result.output).toBe(SUCCESS_UNSTAFFED_EN);
    });

    it('differs from the English literal under locale fr', () => {
      const ctx = freshCtx();
      setLocale('fr');
      const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32' });
      expect(result.success).toBe(true);
      expect(result.output).not.toBe(SUCCESS_UNSTAFFED_EN);
    });
  });

  describe('staffed', () => {
    it('matches the exact English literal by default, embedding the staffed suffix', () => {
      const ctx = freshCtx();
      const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32', staffed: 'true' });
      expect(result.success).toBe(true);
      expect(result.output).toBe(SUCCESS_STAFFED_EN);
    });

    it('differs from the English literal under locale fr', () => {
      const ctx = freshCtx();
      setLocale('fr');
      const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32', staffed: 'true' });
      expect(result.success).toBe(true);
      expect(result.output).not.toBe(SUCCESS_STAFFED_EN);
    });
  });
});

// ── inspectCommand — usage guard ─────────────────────────────────────────

describe('inspectCommand — usage guard', () => {
  const USAGE_EN = 'Usage: inspect x,y,z';

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const result = inspectCommand(ctx, ['not,valid'], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(USAGE_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    setLocale('fr');
    const result = inspectCommand(ctx, ['not,valid'], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(USAGE_EN);
  });
});

// ── inspectCommand — off-site guard ──────────────────────────────────────

describe('inspectCommand — off-site guard', () => {
  const OFF_SITE_EN = 'Off site: (100,5,3). The site spans (0,0) to (31,31), height 32.';

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const result = inspectCommand(ctx, ['100,5,3'], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(OFF_SITE_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    setLocale('fr');
    const result = inspectCommand(ctx, ['100,5,3'], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(OFF_SITE_EN);
  });
});

// ── inspectCommand — air-case message ────────────────────────────────────

describe('inspectCommand — air-case message', () => {
  const AIR_EN = '(10,31,10): Air (empty)';

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const result = inspectCommand(ctx, ['10,31,10'], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe(AIR_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    setLocale('fr');
    const result = inspectCommand(ctx, ['10,31,10'], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(AIR_EN);
  });
});

// ── inspectCommand — result-case message ─────────────────────────────────
// seed 42 size 32 at (10,5,3) is a solid cruite voxel with no ores — captured
// directly off a real inspectCommand run (#861), not re-derived from
// RockCatalog/VoxelGrid by hand.

describe('inspectCommand — result-case message', () => {
  const RESULT_EN = '(10,5,3): cruite | composition: cruite 100% | density: 1 | fracture mod: 1\nOres: none';

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const result = inspectCommand(ctx, ['10,5,3'], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe(RESULT_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    setLocale('fr');
    const result = inspectCommand(ctx, ['10,5,3'], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(RESULT_EN);
  });
});

// ── inspectCommand — no_game_loaded guard ────────────────────────────────

describe('inspectCommand — no_game_loaded guard', () => {
  const NO_GAME_LOADED_EN = 'No game loaded. Use new_game first.';

  it('matches the exact English literal by default', () => {
    const ctx = makeEmptyCtx();
    const result = inspectCommand(ctx, ['10,5,3'], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(NO_GAME_LOADED_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeEmptyCtx();
    setLocale('fr');
    const result = inspectCommand(ctx, ['10,5,3'], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(NO_GAME_LOADED_EN);
  });
});

// ── terrainInfoCommand — no_game_loaded guard only ───────────────────────
// The multi-line report body stays unwired (out of scope for #861) — only
// the guard is asserted here.

describe('terrainInfoCommand — no_game_loaded guard', () => {
  const NO_GAME_LOADED_EN = 'No game loaded. Use new_game first.';

  it('matches the exact English literal by default', () => {
    const ctx = makeEmptyCtx();
    const result = terrainInfoCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(NO_GAME_LOADED_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeEmptyCtx();
    setLocale('fr');
    const result = terrainInfoCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(NO_GAME_LOADED_EN);
  });
});

// ── landscapeInfoCommand — no_game_loaded guard ──────────────────────────

describe('landscapeInfoCommand — no_game_loaded guard', () => {
  const NO_GAME_LOADED_EN = 'No game loaded. Use new_game first.';

  it('matches the exact English literal by default', () => {
    const ctx = makeEmptyCtx();
    const result = landscapeInfoCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(NO_GAME_LOADED_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeEmptyCtx();
    setLocale('fr');
    const result = landscapeInfoCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(NO_GAME_LOADED_EN);
  });
});

// ── landscapeInfoCommand — unknown mine type ─────────────────────────────
// Byte-distinct from newGameCommand's own "Unknown mine type" wording — this
// one carries no "Valid: ..." suffix, since it reports on an already-saved
// (and here corrupted) mineType rather than validating a fresh request.

describe('landscapeInfoCommand — unknown mine type', () => {
  const UNKNOWN_MINE_TYPE_EN = 'Unknown mine type: "bogus_mine_type".';

  function setupCorruptedMineType(): GameContext {
    const ctx = makeCtx();
    ctx.state!.mineType = 'bogus_mine_type';
    return ctx;
  }

  it('matches the exact English literal by default', () => {
    const ctx = setupCorruptedMineType();
    const result = landscapeInfoCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(UNKNOWN_MINE_TYPE_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = setupCorruptedMineType();
    setLocale('fr');
    const result = landscapeInfoCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(UNKNOWN_MINE_TYPE_EN);
  });

  it('is byte-distinct from newGameCommand\'s own unknown-mine-type wording', () => {
    const ctx = setupCorruptedMineType();
    const result = landscapeInfoCommand(ctx, [], {});
    const newGameWording = newGameCommand(freshCtx(), [], { mine_type: 'bogus_mine_type' }).output;
    expect(result.output).not.toBe(newGameWording);
  });
});

// ── landscapeInfoCommand — build-failed message ──────────────────────────
// ensureLandscape only returns null when ctx.grid is falsy — but
// landscapeInfoCommand's own guard already requires ctx.grid truthy before
// calling it, so this branch is unreachable through a normal ctx. A getter
// that reports the grid present on the guard's read and absent on
// ensureLandscape's own (later) read reproduces the only state that can
// actually reach this message.

describe('landscapeInfoCommand — build-failed message', () => {
  const BUILD_FAILED_EN = 'Could not build landscape — no grid loaded.';

  function makeFlakyGridCtx(): GameContext {
    const ctx = makeCtx();
    const realGrid = ctx.grid;
    let reads = 0;
    Object.defineProperty(ctx, 'grid', {
      configurable: true,
      get() {
        reads++;
        return reads === 1 ? realGrid : null;
      },
    });
    return ctx;
  }

  it('matches the exact English literal by default', () => {
    const ctx = makeFlakyGridCtx();
    const result = landscapeInfoCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(BUILD_FAILED_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeFlakyGridCtx();
    setLocale('fr');
    const result = landscapeInfoCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(BUILD_FAILED_EN);
  });
});
