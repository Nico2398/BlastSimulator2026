// BlastSimulator2026 — vehicle.ts i18n guards (#887)
//
// vehicle.ts's own hardcoded usage/rejection/success strings — the list-empty
// message, buy's role/tier usage and success messages, the vehicle.not_found
// rejection shared across assign/move/driver/scrap, assign's usage/success,
// move's usage/success, driver's usage (both the invalid-vehicleId and
// invalid-employeeId branches) and unassign/board success messages, haul's
// usage/success, scrap's usage/success, break's usage/success, and the
// default-subcommand usage string — all route through t() (see
// src/core/i18n/I18n.ts and src/core/i18n/locales/{en,fr}.json). Every test
// below pins the exact English literal and additionally proves the output
// changes under locale 'fr', so a hardcoded string that merely matches
// en.json cannot pass.
//
// `vehicle buy`'s insufficient-funds guard is already covered end-to-end
// (English literal + refusal semantics) by insufficient-funds-guards.test.ts
// — no duplicate coverage is added here.
//
// This file also covers the bonus fix from #887: vehicleCommand's own
// hand-rolled `if (!ctx.state) return { success: false, output: 'No game
// loaded. Use new_game first.' }` guard is byte-identical to the existing
// `console.no_game_loaded` key today, so it passes the English-literal
// assertion even before the fix — only the fr-divergence assertion proves the
// switch to `requireGame(ctx)` actually happened.

import { describe, it, expect, afterEach } from 'vitest';
import type { GameContext } from '../../../src/console/commands/world.js';
import { vehicleCommand } from '../../../src/console/commands/vehicle.js';
import { setLocale, t } from '../../../src/core/i18n/I18n.js';
import { hireEmployee, type EmployeeRole } from '../../../src/core/entities/Employee.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { purchaseVehicle, getAllVehicleRoles, getVehicleDefByTier, vehicleDriverId } from '../../../src/core/entities/Vehicle.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { OVERSIZED_FRAGMENT_THRESHOLD } from '../../../src/core/mining/BlastCalc.js';
import { Random } from '../../../src/core/math/Random.js';
import { syncHaulDispatch } from '../../../src/core/economy/HaulDispatch.js';
import { makeEmptyGameContext, makeGameContext } from '../../helpers/gameContext.js';

function makeCtx(cash = 1_000_000): GameContext {
  return makeGameContext({ mineType: 'desert', seed: 1, size: 32, cash });
}

/** Buys a debris_hauler directly through purchaseVehicle — bypasses cash and the console layer entirely. */
function buyTestVehicle(ctx: GameContext, role: Parameters<typeof purchaseVehicle>[1] = 'debris_hauler', x = 5, z = 5) {
  const { vehicle } = purchaseVehicle(ctx.state!.vehicles, role, x, z);
  return vehicle;
}

/** Hires a driver-role employee directly through hireEmployee — grants the driving.truck qualification hireEmployee assigns by default. */
function hireTestDriver(ctx: GameContext, role: EmployeeRole = 'driver') {
  const { employee } = hireEmployee(ctx.state!.employees, role, new Random(1));
  return employee;
}

/**
 * Hires a driver and mounts them onto `vehicle` directly — bypassing the
 * full walk-to-board flow (Mount.board), which these message-text tests
 * have no need to exercise. #1089: an employee is the only mobile agent, so
 * `vehicle reposition` drives through moveTo, which needs a REAL employee in
 * the driver seat (`occupantIds[0]`) — a bare numeric id no longer satisfies
 * the driver gate.
 */
function mountTestDriver(ctx: GameContext, vehicle: { id: number; x: number; z: number; occupantIds: number[] }) {
  const employee = hireTestDriver(ctx);
  employee.x = vehicle.x;
  employee.z = vehicle.z;
  employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
  vehicle.occupantIds = [employee.id];
  return employee;
}

function makeFragment(id: number, x: number, z: number, volume: number): FragmentData {
  return {
    id,
    position: { x, y: 0, z },
    volume,
    mass: 1000,
    rockId: 'cruite',
    oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: id,
  };
}

afterEach(() => setLocale('en'));

// ── table-driven: static/simple keys reachable directly through the command ──

describe('vehicle.ts — English literal + fr divergence (table-driven)', () => {
  const cases: Array<{
    name: string;
    englishLiteral: string;
    run: (ctx: GameContext) => { success: boolean; output: string };
  }> = [
    {
      name: 'list (empty fleet)',
      englishLiteral: 'No vehicles.',
      run: (ctx) => vehicleCommand(ctx, ['list'], {}),
    },
    {
      name: 'buy usage (invalid role)',
      englishLiteral: `Usage: vehicle buy (${getAllVehicleRoles().join('|')})`,
      run: (ctx) => vehicleCommand(ctx, ['buy', 'bogus_role'], {}),
    },
    {
      name: 'buy usage (invalid tier)',
      englishLiteral: 'Usage: vehicle buy <role> tier:(1|2|3)',
      run: (ctx) => vehicleCommand(ctx, ['buy', 'debris_hauler'], { tier: '9' }),
    },
    {
      name: 'reposition usage (missing args)',
      englishLiteral: 'Usage: vehicle reposition <id> <x> <z>',
      run: (ctx) => vehicleCommand(ctx, ['reposition'], {}),
    },
    {
      name: 'reposition usage (non-numeric coordinates)',
      englishLiteral: 'Usage: vehicle reposition <id> <x> <z>',
      run: (ctx) => vehicleCommand(ctx, ['reposition', '1', 'east', 'north'], {}),
    },
    {
      name: 'driver usage (invalid vehicleId)',
      englishLiteral: 'Usage: vehicle driver <vehicleId> <employeeId|none>',
      run: (ctx) => vehicleCommand(ctx, ['driver'], {}),
    },
    {
      name: 'driver usage (invalid employeeId)',
      englishLiteral: 'Usage: vehicle driver <vehicleId> <employeeId|none>',
      run: (ctx) => vehicleCommand(ctx, ['driver', '1', 'not_an_id'], {}),
    },
    {
      name: 'haul usage (invalid args)',
      englishLiteral: 'Usage: vehicle haul <vehicleId> fragment:<fragmentId>',
      run: (ctx) => vehicleCommand(ctx, ['haul'], {}),
    },
    {
      name: 'scrap usage (invalid id)',
      englishLiteral: 'Usage: vehicle scrap <id>',
      run: (ctx) => vehicleCommand(ctx, ['scrap'], {}),
    },
    {
      name: 'break usage (invalid args)',
      englishLiteral: 'Usage: vehicle break <vehicleId> fragment:<fragmentId>',
      run: (ctx) => vehicleCommand(ctx, ['break'], {}),
    },
    {
      name: 'default/unknown subcommand usage',
      englishLiteral: 'Usage: vehicle (list|buy|reposition|driver|haul|scrap|break)',
      run: (ctx) => vehicleCommand(ctx, ['bogus'], {}),
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

// ── vehicle.not_found — shared across reposition/driver/scrap ───────────────

describe('vehicle.ts — not_found (shared across reposition/driver/scrap)', () => {
  const NOT_FOUND_ID = 999999;
  const NOT_FOUND_EN = `Vehicle #${NOT_FOUND_ID} not found.`;

  const cases: Array<{
    name: string;
    run: (ctx: GameContext) => { success: boolean; output: string };
  }> = [
    { name: 'reposition', run: (ctx) => vehicleCommand(ctx, ['reposition', String(NOT_FOUND_ID), '5', '5'], {}) },
    { name: 'driver', run: (ctx) => vehicleCommand(ctx, ['driver', String(NOT_FOUND_ID), '1'], {}) },
    { name: 'scrap', run: (ctx) => vehicleCommand(ctx, ['scrap', String(NOT_FOUND_ID)], {}) },
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

// ── reposition_no_driver — refuses a vehicle nobody idle can crew (#1092) ──
// Replaces the old move_no_driver/assign-task:moving guards (#947): both
// subcommands are gone, and `reposition` answers the same question — a
// vehicle with nobody aboard and nobody idle and licensed to board it cannot
// be sent anywhere.

describe('vehicle.ts — reposition refuses a vehicle no idle licensed driver can crew', () => {
  const noDriverEn = (id: number) => `No idle licensed driver is available for vehicle #${id}.`;

  it('resolves to the exact English literal and does not move the vehicle', () => {
    const ctx = makeCtx();
    const vehicle = buyTestVehicle(ctx);
    expect(vehicleDriverId(vehicle)).toBeNull();
    const result = vehicleCommand(ctx, ['reposition', String(vehicle.id), '7', '9'], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(noDriverEn(vehicle.id));
    expect(vehicle.x).toBe(5);
    expect(vehicle.z).toBe(5);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const vehicle = buyTestVehicle(ctx);
    setLocale('fr');
    const result = vehicleCommand(ctx, ['reposition', String(vehicle.id), '7', '9'], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(noDriverEn(vehicle.id));
  });
});

// ── reposition_reserved — refuses a vehicle already reserved for work ──────

describe('vehicle.ts — reposition refuses a vehicle reserved for a task', () => {
  const reservedEn = (id: number) => `Vehicle #${id} is busy with a task and cannot be repositioned.`;

  it('resolves to the exact English literal by default', () => {
    const ctx = makeCtx();
    const vehicle = buyTestVehicle(ctx);
    mountTestDriver(ctx, vehicle);
    reserveVehicle(ctx.state!.vehicles, vehicle.id, 7);
    const result = vehicleCommand(ctx, ['reposition', String(vehicle.id), '7', '9'], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(reservedEn(vehicle.id));
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const vehicle = buyTestVehicle(ctx);
    mountTestDriver(ctx, vehicle);
    reserveVehicle(ctx.state!.vehicles, vehicle.id, 7);
    setLocale('fr');
    const result = vehicleCommand(ctx, ['reposition', String(vehicle.id), '7', '9'], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(reservedEn(vehicle.id));
  });
});

// ── buy_success ───────────────────────────────────────────────────────────

describe('vehicle.ts — buy success message', () => {
  it('matches the exact English literal, embedding the real type/id/cost', () => {
    const ctx = makeCtx();
    const cost = getVehicleDefByTier('debris_hauler', 1).purchaseCost;
    const result = vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    expect(result.success).toBe(true);
    const vehicle = ctx.state!.vehicles.vehicles[0]!;
    expect(result.output).toBe(`Purchased debris_hauler #${vehicle.id}. Cost: $${cost}`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const cost = getVehicleDefByTier('debris_hauler', 1).purchaseCost;
    setLocale('fr');
    const result = vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    expect(result.success).toBe(true);
    const vehicle = ctx.state!.vehicles.vehicles[0]!;
    expect(result.output).not.toBe(`Purchased debris_hauler #${vehicle.id}. Cost: $${cost}`);
  });
});

// ── reposition_success ────────────────────────────────────────────────────
// Exact literal has no space after the comma between x and z — matching
// vehicle.ts's own template literal precisely.

describe('vehicle.ts — reposition success message', () => {
  it('matches the exact English literal, embedding the real id/x/z with no space after the comma', () => {
    const ctx = makeCtx();
    const vehicle = buyTestVehicle(ctx);
    // A real, mounted driver — moveTo needs one to plan an itinerary, and
    // this test's own point is the success message's exact text rather than
    // the driver auto-selection `reposition` would otherwise run.
    mountTestDriver(ctx, vehicle);
    const result = vehicleCommand(ctx, ['reposition', String(vehicle.id), '7', '9'], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe(`Vehicle #${vehicle.id} repositioning to (7,9).`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const vehicle = buyTestVehicle(ctx);
    mountTestDriver(ctx, vehicle);
    setLocale('fr');
    const result = vehicleCommand(ctx, ['reposition', String(vehicle.id), '7', '9'], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(`Vehicle #${vehicle.id} repositioning to (7,9).`);
  });
});

// ── driver <id> none: vehicle-not-found routes through mount.vehicle_not_found (#1101) ──
//
// Mount.alight's own hardcoded 'Vehicle not found' string is forwarded
// verbatim as `result.error` by vehicleCommand's `driver <id> none` branch
// (src/console/commands/vehicle.ts) without going through t() at all today —
// this only starts passing once alight() itself calls
// t('mount.vehicle_not_found') and that key exists in en.json/fr.json.

describe('vehicle.ts — driver <id> none: not-found routes through mount.vehicle_not_found', () => {
  const NOT_FOUND_ID = 999999;

  it('resolves to the exact t(\'mount.vehicle_not_found\') literal by default', () => {
    const ctx = makeCtx();
    const englishLiteral = t('mount.vehicle_not_found');
    const result = vehicleCommand(ctx, ['driver', String(NOT_FOUND_ID), 'none'], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(englishLiteral);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const englishLiteral = t('mount.vehicle_not_found');
    setLocale('fr');
    const result = vehicleCommand(ctx, ['driver', String(NOT_FOUND_ID), 'none'], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(englishLiteral);
    // A missing key falls back to the raw key string itself, which trivially
    // "differs" from the English literal regardless of locale — that would
    // make this check pass even with no French translation wired up at all.
    // Rule it out explicitly so this only passes once a real fr string exists.
    expect(result.output).not.toBe('mount.vehicle_not_found');
  });
});

// ── driver_unassign_success ───────────────────────────────────────────────

describe('vehicle.ts — driver unassign success message', () => {
  function buyVehicleWithBypassedDriver(ctx: GameContext) {
    const vehicle = buyTestVehicle(ctx);
    // bypass canAssignDriver entirely — only canReleaseDriver's own state matters here
    vehicle.occupantIds = [42];
    return vehicle;
  }

  it('matches the exact English literal, embedding the real id', () => {
    const ctx = makeCtx();
    const vehicle = buyVehicleWithBypassedDriver(ctx);
    const result = vehicleCommand(ctx, ['driver', String(vehicle.id), 'none'], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe(`Vehicle #${vehicle.id} driver unassigned.`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const vehicle = buyVehicleWithBypassedDriver(ctx);
    setLocale('fr');
    const result = vehicleCommand(ctx, ['driver', String(vehicle.id), 'none'], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(`Vehicle #${vehicle.id} driver unassigned.`);
  });
});

// ── driver_board_success ──────────────────────────────────────────────────

describe('vehicle.ts — driver board success message', () => {
  it('matches the exact English literal, embedding the real employeeId/vehicleId', () => {
    const ctx = makeCtx();
    const vehicle = buyTestVehicle(ctx);
    const driver = hireTestDriver(ctx);
    const result = vehicleCommand(ctx, ['driver', String(vehicle.id), String(driver.id)], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe(`Driver #${driver.id} walking to vehicle #${vehicle.id} to board.`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const vehicle = buyTestVehicle(ctx);
    const driver = hireTestDriver(ctx);
    setLocale('fr');
    const result = vehicleCommand(ctx, ['driver', String(vehicle.id), String(driver.id)], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(`Driver #${driver.id} walking to vehicle #${vehicle.id} to board.`);
  });
});

// ── haul_success ──────────────────────────────────────────────────────────

describe('vehicle.ts — haul success message', () => {
  function setupHaulableVehicle(ctx: GameContext): { vehicleId: number; fragmentId: number } {
    const vehicle = buyTestVehicle(ctx, 'debris_hauler');
    // #1091: requestHaulFragment now installs a real itinerary via moveTo,
    // which needs a genuine employee record at vehicle.driverId — the old
    // `vehicle.driverId = 42` bare-number bypass no longer resolves to
    // anyone (mountTestDriver's own doc comment above).
    mountTestDriver(ctx, vehicle);
    placeBuilding(ctx.state!.buildings, 'freight_warehouse', 0, 0, ctx.grid!.sizeX, ctx.grid!.sizeZ);
    const fragmentId = 1;
    addBlastFragments(ctx.state!.logistics, [makeFragment(fragmentId, vehicle.x, vehicle.z, OVERSIZED_FRAGMENT_THRESHOLD - 0.1)]);
    // requestHaulFragment claims an already-self-dispatched haul_debris
    // action (#1091 — see HaulDispatch.ts's syncHaulDispatch) rather than
    // creating one itself.
    syncHaulDispatch(ctx.state!);
    return { vehicleId: vehicle.id, fragmentId };
  }

  it('matches the exact English literal, embedding the real id/fragmentId', () => {
    const ctx = makeCtx();
    const { vehicleId, fragmentId } = setupHaulableVehicle(ctx);
    const result = vehicleCommand(ctx, ['haul', String(vehicleId)], { fragment: String(fragmentId) });
    expect(result.success).toBe(true);
    expect(result.output).toBe(`Vehicle #${vehicleId} hauling fragment #${fragmentId}.`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const { vehicleId, fragmentId } = setupHaulableVehicle(ctx);
    setLocale('fr');
    const result = vehicleCommand(ctx, ['haul', String(vehicleId)], { fragment: String(fragmentId) });
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(`Vehicle #${vehicleId} hauling fragment #${fragmentId}.`);
  });
});

// ── scrap_success ─────────────────────────────────────────────────────────

describe('vehicle.ts — scrap success message', () => {
  it('matches the exact English literal, embedding the real id/residual value', () => {
    const ctx = makeCtx();
    const vehicle = buyTestVehicle(ctx);
    // Fresh debris_hauler tier 1: hp === maxHp, so hpFraction is 1 and
    // residualValue is purchaseCost (25_000) * VEHICLE_SCRAP_RESIDUAL_FRACTION (0.4) = 10_000.
    const result = vehicleCommand(ctx, ['scrap', String(vehicle.id)], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe(`Vehicle #${vehicle.id} scrapped. Residual value: $10000`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const vehicle = buyTestVehicle(ctx);
    setLocale('fr');
    const result = vehicleCommand(ctx, ['scrap', String(vehicle.id)], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(`Vehicle #${vehicle.id} scrapped. Residual value: $10000`);
  });
});

// ── break_success ─────────────────────────────────────────────────────────

describe('vehicle.ts — break success message', () => {
  function setupBreakableVehicle(ctx: GameContext): { vehicleId: number; fragmentId: number } {
    const vehicle = buyTestVehicle(ctx, 'rock_fragmenter');
    // #1091: requestBreakBoulder now installs a real itinerary via moveTo,
    // which needs a genuine employee record at vehicle.driverId — see
    // setupHaulableVehicle's own identical fix above.
    mountTestDriver(ctx, vehicle);
    const fragmentId = 1;
    addBlastFragments(ctx.state!.logistics, [makeFragment(fragmentId, vehicle.x, vehicle.z, OVERSIZED_FRAGMENT_THRESHOLD + 0.5)]);
    // requestBreakBoulder claims an already-self-dispatched fragment_debris
    // action (#1091 — see HaulDispatch.ts's syncHaulDispatch) rather than
    // creating one itself.
    syncHaulDispatch(ctx.state!);
    return { vehicleId: vehicle.id, fragmentId };
  }

  it('matches the exact English literal, embedding the real id/fragmentId', () => {
    const ctx = makeCtx();
    const { vehicleId, fragmentId } = setupBreakableVehicle(ctx);
    const result = vehicleCommand(ctx, ['break', String(vehicleId)], { fragment: String(fragmentId) });
    expect(result.success).toBe(true);
    expect(result.output).toBe(`Vehicle #${vehicleId} breaking fragment #${fragmentId}.`);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const { vehicleId, fragmentId } = setupBreakableVehicle(ctx);
    setLocale('fr');
    const result = vehicleCommand(ctx, ['break', String(vehicleId)], { fragment: String(fragmentId) });
    expect(result.success).toBe(true);
    expect(result.output).not.toBe(`Vehicle #${vehicleId} breaking fragment #${fragmentId}.`);
  });
});

// ── bonus fix regression: vehicleCommand with no game loaded ────────────────
//
// vehicle.ts's own hand-rolled `if (!ctx.state) return {...}` guard must
// switch to the shared `requireGame(ctx)` helper (same as buildCommand/
// zoneCommand/employeeCommand already do), so it reads console.no_game_loaded
// through t() instead of a second, independently hardcoded copy.

describe('vehicle.ts — no game loaded (bonus fix: requireGame(ctx))', () => {
  function noGameCtx(): GameContext {
    return makeEmptyGameContext();
  }

  it('matches the exact English console.no_game_loaded literal by default', () => {
    const ctx = noGameCtx();
    const result = vehicleCommand(ctx, ['list'], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(t('console.no_game_loaded'));
  });

  it('differs from the English literal under locale fr — proves requireGame(ctx) routes through t()', () => {
    const ctx = noGameCtx();
    const enText = t('console.no_game_loaded');
    setLocale('fr');
    const result = vehicleCommand(ctx, ['list'], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(enText);
    expect(result.output).toBe(t('console.no_game_loaded'));
  });
});

// ── MoveTo.ts errors, reachable because reposition/driver both route
// through moveTo instead of the old void moveVehicle (#1103, #1092) ──
//
// MoveTo.ts's own error strings (src/core/engine/MoveTo.ts) are wrapped
// through t('move_to.*') at the source, the same pattern #1108 used for
// Mount.ts's errors — result.error already arrives translated, so vehicle.ts
// needs no code change to surface it correctly.

describe('vehicle.ts — reposition: no route available (MoveTo.ts, #1103)', () => {
  const NO_ROUTE_EN = 'No route available';

  it('resolves to the exact English literal when the target is unreachable', () => {
    const ctx = makeCtx();
    const vehicle = buyTestVehicle(ctx);
    mountTestDriver(ctx, vehicle); // real, mounted driver — moveTo needs one to plan an itinerary
    // z=9999 is far outside the 32x32 grid — findPath's own clampToGrid
    // cannot make the leg's real (unclamped) destination reachable.
    const result = vehicleCommand(ctx, ['reposition', String(vehicle.id), '5', '9999'], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(NO_ROUTE_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const vehicle = buyTestVehicle(ctx);
    mountTestDriver(ctx, vehicle);
    setLocale('fr');
    const result = vehicleCommand(ctx, ['reposition', String(vehicle.id), '5', '9999'], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(NO_ROUTE_EN);
  });
});

describe('vehicle.ts — driver <id> <employee>: no route to vehicle (MoveTo.ts, #1103)', () => {
  const NO_ROUTE_TO_VEHICLE_EN = 'No route to vehicle';

  it('resolves to the exact English literal when the vehicle sits outside the reachable grid', () => {
    const ctx = makeCtx();
    // Placed far outside the 32x32 grid — canAssignDriver's own checks (licence,
    // availability) all pass, so moveTo's own buildBoardLeg is what fails here.
    const vehicle = buyTestVehicle(ctx, 'debris_hauler', 5, -9999);
    const driver = hireTestDriver(ctx);
    const result = vehicleCommand(ctx, ['driver', String(vehicle.id), String(driver.id)], {});
    expect(result.success).toBe(false);
    expect(result.output).toBe(NO_ROUTE_TO_VEHICLE_EN);
  });

  it('differs from the English literal under locale fr', () => {
    const ctx = makeCtx();
    const vehicle = buyTestVehicle(ctx, 'debris_hauler', 5, -9999);
    const driver = hireTestDriver(ctx);
    setLocale('fr');
    const result = vehicleCommand(ctx, ['driver', String(vehicle.id), String(driver.id)], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe(NO_ROUTE_TO_VEHICLE_EN);
  });
});
