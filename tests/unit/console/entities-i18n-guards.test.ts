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
import { type GameContext } from '../../../src/console/commands/world.js';
import { buildCommand, zoneCommand } from '../../../src/console/commands/entities.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import {
  placeBuilding,
  getBuildingDef,
  checkFootprintPlacement,
  type BuildingType,
  type BuildingTier,
} from '../../../src/core/entities/Building.js';
import { makeGameContext } from '../../helpers/gameContext.js';
import { refusalText } from '../../../src/console/commands/commandUtils.js';
import { employeeCommand } from '../../../src/console/commands/employees.js';
import { vehicleCommand } from '../../../src/console/commands/vehicle.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { OVERSIZED_FRAGMENT_THRESHOLD } from '../../../src/core/mining/BlastCalc.js';
import { syncHaulDispatch } from '../../../src/core/economy/HaulDispatch.js';
import { BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD } from '../../../src/core/config/balance.js';
import { formatMoney } from '../../../src/core/economy/formatMoney.js';
import { Random } from '../../../src/core/math/Random.js';
import enLocale from '../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocale from '../../../src/core/i18n/locales/fr.json' assert { type: 'json' };

function makeCtx(cash = 1_000_000): GameContext {
  return makeGameContext({ mineType: 'desert', seed: 1, size: 32, cash });
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
    // Upgrade re-places through the real console path, which checks the
    // new tier's footprint against terrain flatness (#1008) — (0,0) sits on
    // sloped ground on this seed/size/mineType, so place at a flat spot
    // that stays flat across T1/T2/T3 footprints instead.
    return placeAt(ctx, 'management_office', 1, 2, 0);
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
    // Move re-places at the destination through the real console path, which
    // checks flatness (#1008) — (5,5) is sloped on this seed/size/mineType;
    // (4,4) is a flat T1-footprint spot nearby.
    const result = buildCommand(ctx, ['move', String(id)], { to: '4,4' });
    expect(result.success).toBe(true);
    expect(result.output).toBe(`Building #${id} moved. Cost: $${MOVE_COST}`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const id = placeTestBuilding(ctx);
    setLocale('fr');
    const result = buildCommand(ctx, ['move', String(id)], { to: '4,4' });
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

// ── Refusals (#1397): core refusals reach the console in the active locale ──
//
// Core results keep their English `error` and add `errorKey`/`errorParams`;
// the console translates. Each fr assertion pins the exact interpolated
// fr.json value, looked up by key so the test fails until the key exists.

type Locale = Record<string, string>;
const EN = enLocale as Locale;
const FR = frLocale as Locale;

/** Interpolated fr.json text for `key`; throws when the key is missing from fr.json. */
function fr(key: string, params: Record<string, string | number> = {}): string {
  const template = FR[key];
  if (template === undefined) throw new Error(`fr.json lacks key ${key}`);
  return template.replace(/\{(\w+)\}/g, (_m, n: string) => (params[n] !== undefined ? String(params[n]) : `{${n}}`));
}

/** Interpolated en.json text for `key`; throws when the key is missing from en.json. */
function en(key: string, params: Record<string, string | number> = {}): string {
  const template = EN[key];
  if (template === undefined) throw new Error(`en.json lacks key ${key}`);
  return template.replace(/\{(\w+)\}/g, (_m, n: string) => (params[n] !== undefined ? String(params[n]) : `{${n}}`));
}

/** English output is either today's literal or the en.json rendering of the new key. */
function expectEnglish(output: string, literal: string, key: string, params: Record<string, string | number> = {}): void {
  expect([literal, en(key, params)]).toContain(output);
}

describe('refusals — new locale keys exist in both languages', () => {
  const keys = [
    'shell.placement.refused_out_of_bounds',
    'entities.build_not_researched',
    'entities.build_no_approach',
    'employees.fire_unionized',
    'vehicle.not_debris_hauler',
    'vehicle.not_rock_fragmenter',
    'vehicle.already_hauling',
    'vehicle.already_breaking',
    'vehicle.fragment_unavailable',
    'vehicle.fragment_oversized',
    'vehicle.fragment_not_oversized',
  ];
  for (const key of keys) {
    it(`${key} is defined in en.json and fr.json, and differs between them`, () => {
      expect(EN[key]).toBeTruthy();
      expect(FR[key]).toBeTruthy();
      expect(FR[key]).not.toBe(EN[key]);
    });
  }
});

/** Top-left cell whose T1 management_office footprint spans too much height (seed 1, size 32, desert). */
const UNEVEN_AT = '0,20';

describe('build <type> at: — placement refusals', () => {
  it('uneven ground — en keeps the English text', () => {
    const ctx = makeCtx();
    const result = buildCommand(ctx, ['management_office'], { at: UNEVEN_AT });
    expect(result.success).toBe(false);
    expectEnglish(result.output, 'Uneven surface', 'shell.placement.refused_uneven_ground', { max: BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD });
  });

  it('uneven ground — fr prints the exact refused_uneven_ground text with {max}', () => {
    const ctx = makeCtx();
    setLocale('fr');
    const result = buildCommand(ctx, ['management_office'], { at: UNEVEN_AT });
    expect(result.success).toBe(false);
    expect(result.output).toBe(fr('shell.placement.refused_uneven_ground', { max: BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD }));
  });

  // The site grid grows to claim any off-site cell a build targets, so the
  // console never reaches the out-of-bounds rule; the core result carries the
  // key and the console translates it (refusalText).
  it('out of bounds — core keeps the English error and carries the key; refusalText translates it', () => {
    const check = checkFootprintPlacement([], 'management_office', -5, -5, 1, 32, 32, 0, 0);
    expect(check.valid).toBe(false);
    expect(check.error).toBe('Out of bounds');
    expect(check.errorKey).toBe('shell.placement.refused_out_of_bounds');
    expectEnglish(refusalText(check), 'Out of bounds', 'shell.placement.refused_out_of_bounds');
    setLocale('fr');
    expect(refusalText(check)).toBe(fr('shell.placement.refused_out_of_bounds'));
  });

  it('occupied — en keeps the English text', () => {
    const ctx = makeCtx();
    placeTestBuilding(ctx);
    const result = buildCommand(ctx, ['management_office'], { at: '0,0' });
    expect(result.success).toBe(false);
    expectEnglish(result.output, 'Space is occupied', 'shell.placement.refused_occupied');
  });

  it('occupied — fr prints the exact refused_occupied text', () => {
    const ctx = makeCtx();
    placeTestBuilding(ctx);
    setLocale('fr');
    const result = buildCommand(ctx, ['management_office'], { at: '0,0' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(fr('shell.placement.refused_occupied'));
  });
});

describe('build <type> at: — order refusals', () => {
  it('unresearched tier — en keeps the English literal', () => {
    const ctx = makeCtx();
    const result = buildCommand(ctx, ['management_office'], { at: '4,4', tier: '2' });
    expect(result.success).toBe(false);
    expect(result.output).toBe('Tier 2 management_office is not researched — research required before placement.');
  });

  it('unresearched tier — fr prints the exact build_not_researched text', () => {
    const ctx = makeCtx();
    setLocale('fr');
    const result = buildCommand(ctx, ['management_office'], { at: '4,4', tier: '2' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(fr('entities.build_not_researched', { tier: 2, type: 'management_office' }));
  });

  it('insufficient funds — en keeps the English literal', () => {
    const ctx = makeCtx(0);
    const cost = getBuildingDef('management_office', 1).constructionCost;
    const result = buildCommand(ctx, ['management_office'], { at: '4,4' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(`Insufficient funds: need $${formatMoney(cost)}, have $${formatMoney(0)}`);
  });

  it('insufficient funds — fr prints the exact console.insufficient_funds text', () => {
    const ctx = makeCtx(0);
    const cost = getBuildingDef('management_office', 1).constructionCost;
    setLocale('fr');
    const result = buildCommand(ctx, ['management_office'], { at: '4,4' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(fr('console.insufficient_funds', { need: formatMoney(cost), have: formatMoney(0) }));
  });

  /** Three offices seal the (0,0) pocket's approach ring (see navgrid-patching.test.ts). */
  function sealPocket(ctx: GameContext): void {
    for (const at of ['2,0', '0,2', '2,2']) {
      expect(buildCommand(ctx, ['management_office'], { at }).success).toBe(true);
    }
  }

  it('no reachable approach — en keeps the English text', () => {
    const ctx = makeCtx();
    sealPocket(ctx);
    const result = buildCommand(ctx, ['management_office'], { at: '0,0' });
    expect(result.success).toBe(false);
    expect(result.output).toBe('No reachable approach to this site — surroundings are fully blocked');
  });

  it('no reachable approach — fr prints the exact build_no_approach text', () => {
    const ctx = makeCtx();
    sealPocket(ctx);
    setLocale('fr');
    const result = buildCommand(ctx, ['management_office'], { at: '0,0' });
    expect(result.success).toBe(false);
    expect(result.output).toBe(fr('entities.build_no_approach'));
  });
});

describe('build move — placement refusals', () => {
  it('uneven destination — en keeps the English text, fr prints refused_uneven_ground', () => {
    const ctx = makeCtx();
    const id = placeAt(ctx, 'management_office', 1, 4, 4);
    const enResult = buildCommand(ctx, ['move', String(id)], { to: UNEVEN_AT });
    expect(enResult.success).toBe(false);
    expectEnglish(enResult.output, 'Uneven surface', 'shell.placement.refused_uneven_ground', { max: BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD });
    setLocale('fr');
    const frResult = buildCommand(ctx, ['move', String(id)], { to: UNEVEN_AT });
    expect(frResult.success).toBe(false);
    expect(frResult.output).toBe(fr('shell.placement.refused_uneven_ground', { max: BUILDING_PLACEMENT_MAX_HEIGHT_SPREAD }));
  });

  it('occupied destination — en keeps the English text, fr prints refused_occupied', () => {
    const ctx = makeCtx();
    const id = placeAt(ctx, 'management_office', 1, 4, 4);
    placeAt(ctx, 'management_office', 1, 8, 8);
    const enResult = buildCommand(ctx, ['move', String(id)], { to: '8,8' });
    expect(enResult.success).toBe(false);
    expectEnglish(enResult.output, 'Space is occupied', 'shell.placement.refused_occupied');
    setLocale('fr');
    const frResult = buildCommand(ctx, ['move', String(id)], { to: '8,8' });
    expect(frResult.success).toBe(false);
    expect(frResult.output).toBe(fr('shell.placement.refused_occupied'));
  });
});

describe('build upgrade — blocked upgrade wraps the translated inner refusal', () => {
  function setupBlockedUpgrade(ctx: GameContext): number {
    ctx.state!.buildings.unlockedTiers['management_office'] = 3;
    const id = placeAt(ctx, 'management_office', 1, 0, 0);
    placeAt(ctx, 'management_office', 1, 0, 2);
    return id;
  }

  it('fr output is build_upgrade_failed around the fr refused_occupied text', () => {
    const ctx = makeCtx();
    const id = setupBlockedUpgrade(ctx);
    setLocale('fr');
    const result = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(fr('entities.build_upgrade_failed', { error: fr('shell.placement.refused_occupied') }));
    expect(result.output).not.toContain('Space is occupied');
  });

  it('en output still names the occupied space', () => {
    const ctx = makeCtx();
    const id = setupBlockedUpgrade(ctx);
    const result = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/^Upgrade failed: /);
    expect(result.output).toContain('Space is occupied');
  });
});

describe('employee fire — refusals', () => {
  function hireUnionized(ctx: GameContext) {
    const { employee } = hireEmployee(ctx.state!.employees, 'driller', new Random(1));
    employee.unionized = true;
    return employee;
  }

  it('unionized — en keeps the English text', () => {
    const ctx = makeCtx();
    const emp = hireUnionized(ctx);
    const result = employeeCommand(ctx, ['fire', String(emp.id)], {});
    expect(result.success).toBe(false);
    expectEnglish(result.output, 'Cannot fire unionized employee', 'employees.fire_unionized');
  });

  it('unionized — fr prints the exact fire_unionized text', () => {
    const ctx = makeCtx();
    const emp = hireUnionized(ctx);
    setLocale('fr');
    const result = employeeCommand(ctx, ['fire', String(emp.id)], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(fr('employees.fire_unionized'));
  });

  it('nonexistent id — en keeps the English text', () => {
    const ctx = makeCtx();
    const result = employeeCommand(ctx, ['fire', '4242'], {});
    expect(result.success).toBe(false);
    expectEnglish(result.output, 'Employee not found', 'employees.employee_not_found', { id: 4242 });
  });

  it('nonexistent id — fr prints the exact employee_not_found text', () => {
    const ctx = makeCtx();
    setLocale('fr');
    const result = employeeCommand(ctx, ['fire', '4242'], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(fr('employees.employee_not_found', { id: 4242 }));
  });
});

describe('vehicle haul / break — refusals', () => {
  function makeFragment(id: number, x: number, z: number, volume: number): FragmentData {
    return {
      id, position: { x, y: 0, z }, volume, mass: 1000, rockId: 'cruite', oreDensities: {},
      initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false, halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
      shapeSeed: id, origin: { x, y: 0, z },
    };
  }

  function buy(ctx: GameContext, role: 'debris_hauler' | 'rock_fragmenter') {
    return purchaseVehicle(ctx.state!.vehicles, role, 5, 5).vehicle;
  }

  function mountDriver(ctx: GameContext, vehicle: { id: number; x: number; z: number; occupantIds: number[] }) {
    const { employee } = hireEmployee(ctx.state!.employees, 'driver', new Random(1));
    employee.x = vehicle.x;
    employee.z = vehicle.z;
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    vehicle.occupantIds = [employee.id];
  }

  /** Staffed vehicle of `role` plus a ground fragment of `volume`; returns ids. */
  function setup(ctx: GameContext, role: 'debris_hauler' | 'rock_fragmenter', volume: number) {
    const vehicle = buy(ctx, role);
    mountDriver(ctx, vehicle);
    placeAt(ctx, 'freight_warehouse', 1, 0, 0);
    addBlastFragments(ctx.state!.logistics, [makeFragment(1, vehicle.x, vehicle.z, volume)]);
    syncHaulDispatch(ctx.state!);
    return { vehicleId: vehicle.id, fragmentId: 1 };
  }

  const SMALL = OVERSIZED_FRAGMENT_THRESHOLD - 0.1;
  const BIG = OVERSIZED_FRAGMENT_THRESHOLD + 0.5;

  const cases: Array<{
    name: string;
    sub: 'haul' | 'break';
    en: string;
    expectedFr: () => string;
    prepare: (ctx: GameContext) => { vehicleId: number; fragmentId: number };
  }> = [
    {
      name: 'haul — no driver', sub: 'haul', en: 'Vehicle has no driver',
      expectedFr: () => fr('mount.vehicle_no_driver'),
      prepare: (ctx) => ({ vehicleId: buy(ctx, 'debris_hauler').id, fragmentId: 1 }),
    },
    {
      name: 'break — no driver', sub: 'break', en: 'Vehicle has no driver',
      expectedFr: () => fr('mount.vehicle_no_driver'),
      prepare: (ctx) => ({ vehicleId: buy(ctx, 'rock_fragmenter').id, fragmentId: 1 }),
    },
    {
      name: 'haul — wrong role', sub: 'haul', en: 'Vehicle is not a debris hauler',
      expectedFr: () => fr('vehicle.not_debris_hauler'),
      prepare: (ctx) => ({ vehicleId: buy(ctx, 'rock_fragmenter').id, fragmentId: 1 }),
    },
    {
      name: 'break — wrong role', sub: 'break', en: 'Vehicle is not a rock fragmenter',
      expectedFr: () => fr('vehicle.not_rock_fragmenter'),
      prepare: (ctx) => ({ vehicleId: buy(ctx, 'debris_hauler').id, fragmentId: 1 }),
    },
    {
      name: 'haul — already hauling', sub: 'haul', en: 'Vehicle is already hauling',
      expectedFr: () => fr('vehicle.already_hauling'),
      prepare: (ctx) => {
        const ids = setup(ctx, 'debris_hauler', SMALL);
        expect(vehicleCommand(ctx, ['haul', String(ids.vehicleId)], { fragment: '1' }).success).toBe(true);
        return ids;
      },
    },
    {
      name: 'break — already breaking', sub: 'break', en: 'Vehicle is already breaking a fragment',
      expectedFr: () => fr('vehicle.already_breaking'),
      prepare: (ctx) => {
        const ids = setup(ctx, 'rock_fragmenter', BIG);
        expect(vehicleCommand(ctx, ['break', String(ids.vehicleId)], { fragment: '1' }).success).toBe(true);
        return ids;
      },
    },
    {
      name: 'haul — fragment unavailable', sub: 'haul', en: 'Fragment not found or not on the ground',
      expectedFr: () => fr('vehicle.fragment_unavailable'),
      prepare: (ctx) => ({ ...setup(ctx, 'debris_hauler', SMALL), fragmentId: 999 }),
    },
    {
      name: 'break — fragment unavailable', sub: 'break', en: 'Fragment not found or not on the ground',
      expectedFr: () => fr('vehicle.fragment_unavailable'),
      prepare: (ctx) => ({ ...setup(ctx, 'rock_fragmenter', BIG), fragmentId: 999 }),
    },
    {
      name: 'haul — fragment oversized', sub: 'haul', en: 'Fragment is oversized and needs a Rock Fragmenter first',
      expectedFr: () => fr('vehicle.fragment_oversized'),
      prepare: (ctx) => setup(ctx, 'debris_hauler', BIG),
    },
    {
      name: 'break — fragment not oversized', sub: 'break', en: 'Fragment is not oversized',
      expectedFr: () => fr('vehicle.fragment_not_oversized'),
      prepare: (ctx) => setup(ctx, 'rock_fragmenter', SMALL),
    },
  ];

  for (const c of cases) {
    it(`${c.name} — en keeps the English literal`, () => {
      const ctx = makeCtx();
      const { vehicleId, fragmentId } = c.prepare(ctx);
      const result = vehicleCommand(ctx, [c.sub, String(vehicleId)], { fragment: String(fragmentId) });
      expect(result.success).toBe(false);
      expect(result.output).toBe(c.en);
    });

    it(`${c.name} — fr prints the exact fr.json text`, () => {
      const ctx = makeCtx();
      const { vehicleId, fragmentId } = c.prepare(ctx);
      setLocale('fr');
      const result = vehicleCommand(ctx, [c.sub, String(vehicleId)], { fragment: String(fragmentId) });
      expect(result.success).toBe(false);
      expect(result.output).toBe(c.expectedFr());
    });
  }

  for (const sub of ['haul', 'break'] as const) {
    it(`${sub} — unknown vehicle id: en English, fr translated`, () => {
      const ctx = makeCtx();
      const enResult = vehicleCommand(ctx, [sub, '777'], { fragment: '1' });
      expect(enResult.success).toBe(false);
      expect(enResult.output).toBe('Vehicle not found');
      setLocale('fr');
      const frResult = vehicleCommand(ctx, [sub, '777'], { fragment: '1' });
      expect(frResult.success).toBe(false);
      expect([fr('mount.vehicle_not_found'), fr('vehicle.not_found', { id: 777 })]).toContain(frResult.output);
    });
  }
});
