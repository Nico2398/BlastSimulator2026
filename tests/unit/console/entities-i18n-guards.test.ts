// BlastSimulator2026 — entities.ts i18n guards (#887)
//
// entities.ts's own hardcoded usage/rejection/success strings for buildCommand
// and zoneCommand — the build list empty message, destroy's usage/success,
// building_not_found shared across destroy/upgrade/move, upgrade's usage/
// max_tier/not_researched/failed/success, move's usage/success, the unknown-
// subcommand and per-type "at:" usage messages, and zone's clear usage/
// success, status "no zone" message, and unknown-subcommand usage — all route
// through t() (see src/core/i18n/I18n.ts and
// src/core/i18n/locales/{en,fr}.json). Every test below pins the exact
// English literal and additionally proves the output changes under locale
// 'fr', so a hardcoded string that merely matches en.json cannot pass.
//
// `build <type> at:x,z`/`build destroy`/`build upgrade`/`build move`'s
// insufficient-funds guards are already covered end-to-end (English literal +
// refusal semantics) by insufficient-funds-guards.test.ts — no duplicate
// coverage is added here.

import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { type GameContext, newGameCommand } from '../../../src/console/commands/world.js';
import { buildCommand, zoneCommand } from '../../../src/console/commands/entities.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import {
  placeBuilding,
  getBuildingDef,
  type BuildingType,
  type BuildingTier,
} from '../../../src/core/entities/Building.js';

function makeCtx(cash = 1_000_000): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter(), landscape: null, playableArea: null };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32' });
  ctx.state!.cash = cash;
  ctx.state!.finances.cash = cash;
  return ctx;
}

/** Place a building directly through core placeBuilding, at an arbitrary cell — bypasses cash and the build console command. */
function placeAt(ctx: GameContext, type: BuildingType, tier: BuildingTier, x: number, z: number): number {
  const grid = ctx.grid!;
  const result = placeBuilding(ctx.state!.buildings, type, x, z, grid.sizeX, grid.sizeZ, tier, grid.minX, grid.minZ);
  if (!result.success) throw new Error(`setup: failed to place test building — ${result.error}`);
  return result.building!.id;
}

/** Place a management_office T1 at the grid origin — the common case for tests that only need one building. */
function placeTestBuilding(ctx: GameContext, type: BuildingType = 'management_office', tier: BuildingTier = 1): number {
  return placeAt(ctx, type, tier, 0, 0);
}

afterEach(() => setLocale('en'));

// ── table-driven: static/simple keys reachable directly through the command ──

describe('entities.ts — English literal + fr divergence (table-driven)', () => {
  const cases: Array<{
    name: string;
    englishLiteral: string;
    run: (ctx: GameContext) => { success: boolean; output: string };
  }> = [
    {
      name: 'build list (empty roster)',
      englishLiteral: 'No buildings placed.',
      run: (ctx) => buildCommand(ctx, ['list'], {}),
    },
    {
      name: 'build destroy usage (invalid id)',
      englishLiteral: 'Usage: build destroy <id>',
      run: (ctx) => buildCommand(ctx, ['destroy'], {}),
    },
    {
      name: 'build upgrade usage (invalid id)',
      englishLiteral: 'Usage: build upgrade <id>',
      run: (ctx) => buildCommand(ctx, ['upgrade'], {}),
    },
    {
      name: 'build move usage (invalid args)',
      englishLiteral: 'Usage: build move <id> to:x,z',
      run: (ctx) => buildCommand(ctx, ['move'], {}),
    },
    {
      name: 'build unknown subcommand',
      englishLiteral: 'Unknown subcommand or building type: "bogus". Use: build (list|destroy|upgrade|move|types|<type> at:x,z [tier:N])',
      run: (ctx) => buildCommand(ctx, ['bogus'], {}),
    },
    {
      name: 'build <type> at: usage (bad coords for a real building type)',
      englishLiteral: 'Usage: build management_office at:x,z [tier:1|2|3]',
      run: (ctx) => buildCommand(ctx, ['management_office'], { at: 'bad,coords' }),
    },
    {
      name: 'zone clear usage (invalid coords)',
      englishLiteral: 'Usage: zone clear x1:10 y1:10 x2:30 y2:30',
      run: (ctx) => zoneCommand(ctx, ['clear'], {}),
    },
    {
      name: 'zone status (no zone defined)',
      englishLiteral: 'No safety zone defined.',
      run: (ctx) => zoneCommand(ctx, ['status'], {}),
    },
    {
      name: 'zone unknown subcommand',
      englishLiteral: 'Usage: zone (clear|status)',
      run: (ctx) => zoneCommand(ctx, ['bogus'], {}),
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

// ── entities.building_not_found — shared across destroy/upgrade/move ────────

describe('entities.ts — building_not_found (shared across destroy/upgrade/move)', () => {
  const NOT_FOUND_ID = 999999;
  const NOT_FOUND_EN = `Building #${NOT_FOUND_ID} not found.`;

  const cases: Array<{
    name: string;
    run: (ctx: GameContext) => { success: boolean; output: string };
  }> = [
    { name: 'destroy', run: (ctx) => buildCommand(ctx, ['destroy', String(NOT_FOUND_ID)], {}) },
    { name: 'upgrade', run: (ctx) => buildCommand(ctx, ['upgrade', String(NOT_FOUND_ID)], {}) },
    { name: 'move', run: (ctx) => buildCommand(ctx, ['move', String(NOT_FOUND_ID)], { to: '5,5' }) },
  ];

  for (const { name, run } of cases) {
    it(`${name} — resolves to the exact English literal by default`, () => {
      const ctx = makeCtx();
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).toBe(NOT_FOUND_EN);
    });

    it(`${name} — differs from the English literal under locale fr`, () => {
      const ctx = makeCtx();
      setLocale('fr');
      const result = run(ctx);
      expect(result.success).toBe(false);
      expect(result.output).not.toBe(NOT_FOUND_EN);
    });
  }
});

// ── build_destroy_success ────────────────────────────────────────────────

describe('entities.ts — build destroy success message', () => {
  it('matches the exact English literal, embedding the real id and raw demolishCost (no thousands separator)', () => {
    const ctx = makeCtx();
    const id = placeTestBuilding(ctx);
    const demolishCost = getBuildingDef('management_office', 1).demolishCost;
    const result = buildCommand(ctx, ['destroy', String(id)], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe(`Building #${id} demolished. Cost: $${demolishCost}`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const id = placeTestBuilding(ctx);
    const demolishCost = getBuildingDef('management_office', 1).demolishCost;
    setLocale('fr');
    const result = buildCommand(ctx, ['destroy', String(id)], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(`Building #${id} demolished. Cost: $${demolishCost}`);
  });
});

// ── build_upgrade_max_tier ────────────────────────────────────────────────

describe('entities.ts — build upgrade at max tier (T3)', () => {
  function expectedEn(id: number): string {
    return `Building #${id} is already at max tier (T3).`;
  }

  function placeMaxTierBuilding(ctx: GameContext): number {
    ctx.state!.buildings.unlockedTiers['management_office'] = 3;
    return placeTestBuilding(ctx, 'management_office', 3);
  }

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const id = placeMaxTierBuilding(ctx);
    const result = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(expectedEn(id));
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const id = placeMaxTierBuilding(ctx);
    setLocale('fr');
    const result = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(expectedEn(id));
  });
});

// ── build_upgrade_not_researched ─────────────────────────────────────────

describe('entities.ts — build upgrade to an unresearched tier', () => {
  const EN = 'Tier 2 management_office is not researched — research required before upgrade.';

  it('matches the exact English literal by default (tier 2 never unlocked)', () => {
    const ctx = makeCtx();
    const id = placeTestBuilding(ctx, 'management_office', 1);
    const result = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const id = placeTestBuilding(ctx, 'management_office', 1);
    setLocale('fr');
    const result = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(EN);
  });
});

// ── build_upgrade_failed ─────────────────────────────────────────────────
//
// placeBuilding rejects the upgrade's re-placement when the *new* tier's
// larger footprint collides with an unrelated building the old, smaller
// footprint did not overlap: management_office T1 is 2x2, T2 is 2x3
// (BuildingDefs.ts), so a second building placed directly south of the one
// being upgraded blocks only the T2 footprint's extra row — reachable
// through buildCommand without mocking anything.

describe('entities.ts — build upgrade failure (re-placement rejected by an overlap)', () => {
  const EN = 'Upgrade failed: Space is occupied';

  function setupBlockedUpgrade(ctx: GameContext): number {
    ctx.state!.buildings.unlockedTiers['management_office'] = 3;
    const id = placeAt(ctx, 'management_office', 1, 0, 0); // occupies z:0-1
    placeAt(ctx, 'management_office', 1, 0, 2); // occupies z:2-3 — blocks T2's z:0-2 footprint
    return id;
  }

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const id = setupBlockedUpgrade(ctx);
    const result = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const id = setupBlockedUpgrade(ctx);
    setLocale('fr');
    const result = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(EN);
  });
});

// ── build_upgrade_success ────────────────────────────────────────────────

describe('entities.ts — build upgrade success message', () => {
  function setupUpgradableBuilding(ctx: GameContext): number {
    ctx.state!.buildings.unlockedTiers['management_office'] = 3;
    return placeTestBuilding(ctx, 'management_office', 1);
  }

  const OLD_DEF = getBuildingDef('management_office', 1);
  const NEW_DEF = getBuildingDef('management_office', 2);
  const TOTAL_COST = OLD_DEF.demolishCost + NEW_DEF.constructionCost;

  it('matches the exact English literal, embedding the real type/id/tier/newId/cost', () => {
    const ctx = makeCtx();
    const id = setupUpgradableBuilding(ctx);
    const result = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(result.success).toBe(true);
    const newId = ctx.state!.buildings.buildings[0]!.id;
    expect(result.output).toBe(`Upgraded management_office #${id} to T2 (new #${newId}). Cost: $${TOTAL_COST}`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const id = setupUpgradableBuilding(ctx);
    setLocale('fr');
    const result = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(result.success).toBe(true);
    const newId = ctx.state!.buildings.buildings[0]!.id;
    expect(result.output).not.toBe(`Upgraded management_office #${id} to T2 (new #${newId}). Cost: $${TOTAL_COST}`);
  });
});

// ── build_move_success ───────────────────────────────────────────────────

describe('entities.ts — build move success message', () => {
  const MOVE_COST = Math.round(getBuildingDef('management_office', 1).constructionCost * 0.5);

  it('matches the exact English literal, embedding the real id and raw cost', () => {
    const ctx = makeCtx();
    const id = placeTestBuilding(ctx);
    const result = buildCommand(ctx, ['move', String(id)], { to: '5,5' });
    expect(result.success).toBe(true);
    expect(result.output).toBe(`Building #${id} moved. Cost: $${MOVE_COST}`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const id = placeTestBuilding(ctx);
    setLocale('fr');
    const result = buildCommand(ctx, ['move', String(id)], { to: '5,5' });
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(`Building #${id} moved. Cost: $${MOVE_COST}`);
  });
});

// ── zone_clear_success ───────────────────────────────────────────────────

describe('entities.ts — zone clear success message (fresh game, 0 vehicles/employees)', () => {
  const EN = 'Evacuation ordered. Routing 0 vehicles and 0 employees clear of the zone.';

  it('matches the exact English literal by default', () => {
    const ctx = makeCtx();
    const result = zoneCommand(ctx, ['clear'], { x1: '0', y1: '0', x2: '10', y2: '10' });
    expect(result.success).toBe(true);
    expect(result.output).toBe(EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    setLocale('fr');
    const result = zoneCommand(ctx, ['clear'], { x1: '0', y1: '0', x2: '10', y2: '10' });
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(EN);
  });
});
