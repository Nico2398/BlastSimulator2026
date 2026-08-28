// BlastSimulator2026 — console insufficient-funds guards
//
// Console commands that spend cash must refuse an unaffordable purchase
// exactly as the UI control that dispatches them already does, instead of
// overdrawing the balance. Each guard below mirrors one disabled predicate:
//
//   employee hire   ← CrewPanel:  cash < HIRING_COSTS[role]
//   vehicle buy     ← FleetPanel: cash < getVehicleDefByTier(role, tier).purchaseCost
//   build <type>    ← BuildMenu:  cash < getBuildingDef(type, tier).constructionCost
//
// The predicate is `<`, so a balance exactly equal to the price is affordable
// — every command gets a boundary test for that, or the console and the UI
// would disagree on the one value where it matters most.
//
// Each refusal is also checked for partial application: the guard runs before
// the core call, and every one of those core calls mutates (hireEmployee
// pushes the employee, purchaseVehicle pushes the vehicle, placeBuilding
// pushes the building — all before they report a cost), so a guard placed
// after them would leave the entity behind.

import { describe, it, expect } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { newGameCommand } from '../../../src/console/commands/world.js';
import { employeeCommand, buildCommand } from '../../../src/console/commands/entities.js';
import { vehicleCommand } from '../../../src/console/commands/vehicle.js';
import { corruptCommand, mafiaCommand } from '../../../src/console/commands/events.js';
import { campaignStartCommand } from '../../../src/console/commands/campaign.js';
import { getLevel } from '../../../src/core/campaign/Level.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { HIRING_COSTS, hireEmployee } from '../../../src/core/entities/Employee.js';
import { getVehicleDefByTier } from '../../../src/core/entities/Vehicle.js';
import {
  getBuildingDef,
  placeBuilding,
  type BuildingType,
  type BuildingTier,
} from '../../../src/core/entities/Building.js';
import { TARGET_COSTS, MAFIA_THRESHOLD } from '../../../src/core/economy/Corruption.js';
import { ACCIDENT_COST, FRAME_COST, FRAME_EVIDENCE_TICKS } from '../../../src/core/events/MafiaActions.js';
import { Random } from '../../../src/core/math/Random.js';
import { STARTING_CASH } from '../../../src/core/config/balance.js';

function makeCtx(cash: number): MiningContext {
  const ctx: MiningContext = {
    state: null,
    grid: null,
    emitter: new EventEmitter(),
    landscape: null,
    playableArea: null,
  };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32' });
  setCash(ctx, cash);
  return ctx;
}

/** Cash lives in two mirrors — the live balance and the ledger. Keep them in step. */
function setCash(ctx: MiningContext, cash: number): void {
  ctx.state!.cash = cash;
  ctx.state!.finances.cash = cash;
}

/** Everything a refusal must leave untouched. */
function snapshot(ctx: MiningContext): Record<string, unknown> {
  const s = ctx.state!;
  return {
    cash: s.cash,
    ledgerCash: s.finances.cash,
    transactions: s.finances.transactions.length,
    isBankrupt: s.finances.isBankrupt,
    employees: s.employees.employees.length,
    employeeNextId: s.employees.nextId,
    vehicles: s.vehicles.vehicles.length,
    vehicleNextId: s.vehicles.nextId,
    buildings: s.buildings.buildings.length,
    buildingNextId: s.buildings.nextId,
    // The build destroy/upgrade/move and corrupt/mafia guards below all sit
    // in front of state that mutates *before* today's unguarded cost
    // deduction — attemptCorruption pushes an attempt record unconditionally,
    // and arrangeAccident/startFraming/completeFrame raise mafia exposure
    // risk even when the underlying action fails internally. A refusal that
    // still moved one of these would pass the fields above by accident.
    mafiaExposureRisk: s.mafia.exposureRisk,
    mafiaPendingFrames: s.mafia.pendingFrames.length,
    corruptionLevel: s.corruption.level,
    corruptionAttempts: s.corruption.attempts.length,
  };
}

/**
 * Place a building directly through the core `placeBuilding` — bypasses the
 * console layer entirely, so setting up a building to destroy/upgrade/move
 * never touches the cash balance a guard test is trying to control.
 */
function placeTestBuilding(ctx: MiningContext, type: BuildingType = 'management_office', tier: BuildingTier = 1): number {
  const grid = ctx.grid!;
  const result = placeBuilding(ctx.state!.buildings, type, 0, 0, grid.sizeX, grid.sizeZ, tier, grid.minX, grid.minZ);
  if (!result.success) throw new Error(`setup: failed to place test building — ${result.error}`);
  return result.building!.id;
}

/**
 * Unlock the mafia deterministically: `attemptCorruption` bumps
 * `corruption.level` by 1 on both a success and a failure, so 3 calls always
 * clears `MAFIA_UNLOCK_THRESHOLD` regardless of the RNG roll. Cash is bumped
 * for the duration and restored — this is setup, not the guard under test.
 */
function unlockMafia(ctx: MiningContext): void {
  const prevCash = ctx.state!.cash;
  setCash(ctx, 10_000_000);
  for (let i = 0; i < MAFIA_THRESHOLD; i++) {
    corruptCommand(ctx, [], { target: 'witness' });
  }
  setCash(ctx, prevCash);
}

// ── employee hire ──

describe('employee hire — insufficient funds guard', () => {
  const COST = HIRING_COSTS.surveyor;

  it('refuses when cash is one dollar short', () => {
    const ctx = makeCtx(COST - 1);
    const result = employeeCommand(ctx, ['hire'], { role: 'surveyor' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
  });

  it('names both the price and the balance in the refusal', () => {
    const ctx = makeCtx(COST - 1);
    const result = employeeCommand(ctx, ['hire'], { role: 'surveyor' });
    expect(result.output).toContain(COST.toLocaleString('en-US'));
    expect(result.output).toContain((COST - 1).toLocaleString('en-US'));
  });

  it('changes nothing at all when it refuses', () => {
    const ctx = makeCtx(COST - 1);
    const before = snapshot(ctx);
    employeeCommand(ctx, ['hire'], { role: 'surveyor' });
    expect(snapshot(ctx)).toEqual(before);
    expect(ctx.state!.employees.employees).toHaveLength(0);
    expect(ctx.state!.cash).toBe(COST - 1);
  });

  it('hires when cash exactly equals the hiring cost', () => {
    const ctx = makeCtx(COST);
    const result = employeeCommand(ctx, ['hire'], { role: 'surveyor' });
    expect(result.success).toBe(true);
    expect(ctx.state!.employees.employees).toHaveLength(1);
    expect(ctx.state!.cash).toBe(0);
  });

  it('charges HIRING_COSTS for the role it was given, not for another', () => {
    const ctx = makeCtx(HIRING_COSTS.manager);
    employeeCommand(ctx, ['hire'], { role: 'driver' });
    expect(ctx.state!.cash).toBe(HIRING_COSTS.manager - HIRING_COSTS.driver);
  });

  it('refuses the expensive role at a balance that affords the cheap one', () => {
    // Per-role, not one flat price: this balance sits between the two.
    const ctx = makeCtx(HIRING_COSTS.manager - 1);
    expect(employeeCommand(ctx, ['hire'], { role: 'manager' }).success).toBe(false);
    expect(employeeCommand(ctx, ['hire'], { role: 'driver' }).success).toBe(true);
  });
});

// ── vehicle buy ──

describe('vehicle buy — insufficient funds guard', () => {
  const COST_T1 = getVehicleDefByTier('debris_hauler', 1).purchaseCost;

  it('refuses when cash is one dollar short', () => {
    const ctx = makeCtx(COST_T1 - 1);
    const result = vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
  });

  it('changes nothing at all when it refuses', () => {
    const ctx = makeCtx(COST_T1 - 1);
    const before = snapshot(ctx);
    vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    expect(snapshot(ctx)).toEqual(before);
    expect(ctx.state!.vehicles.vehicles).toHaveLength(0);
    expect(ctx.state!.cash).toBe(COST_T1 - 1);
  });

  it('buys when cash exactly equals the purchase cost', () => {
    const ctx = makeCtx(COST_T1);
    const result = vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    expect(result.success).toBe(true);
    expect(ctx.state!.vehicles.vehicles).toHaveLength(1);
    expect(ctx.state!.cash).toBe(0);
  });

  it('prices per tier — a T1 balance does not buy a T3', () => {
    const costT3 = getVehicleDefByTier('debris_hauler', 3).purchaseCost;
    expect(costT3).toBeGreaterThan(COST_T1);
    const ctx = makeCtx(COST_T1);
    expect(vehicleCommand(ctx, ['buy', 'debris_hauler'], { tier: '3' }).success).toBe(false);
    expect(ctx.state!.vehicles.vehicles).toHaveLength(0);
    expect(vehicleCommand(ctx, ['buy', 'debris_hauler'], { tier: '1' }).success).toBe(true);
  });

  it('buys a T3 when cash exactly equals the T3 price', () => {
    const costT3 = getVehicleDefByTier('drill_rig', 3).purchaseCost;
    const ctx = makeCtx(costT3);
    const result = vehicleCommand(ctx, ['buy', 'drill_rig'], { tier: '3' });
    expect(result.success).toBe(true);
    expect(ctx.state!.vehicles.vehicles[0]!.tier).toBe(3);
    expect(ctx.state!.cash).toBe(0);
  });
});

// ── build <type> at: ──

describe('build <type> at: — insufficient funds guard', () => {
  const COST_T1 = getBuildingDef('management_office', 1).constructionCost;

  it('refuses when cash is one dollar short', () => {
    const ctx = makeCtx(COST_T1 - 1);
    const result = buildCommand(ctx, ['management_office'], { at: '0,0' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
  });

  it('changes nothing at all when it refuses', () => {
    const ctx = makeCtx(COST_T1 - 1);
    const before = snapshot(ctx);
    buildCommand(ctx, ['management_office'], { at: '0,0' });
    expect(snapshot(ctx)).toEqual(before);
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
    expect(ctx.state!.cash).toBe(COST_T1 - 1);
  });

  it('builds when cash exactly equals the construction cost', () => {
    const ctx = makeCtx(COST_T1);
    const result = buildCommand(ctx, ['management_office'], { at: '0,0' });
    expect(result.success).toBe(true);
    // Confirming placement only queues a construction site (#556) — the
    // order is charged and accepted immediately, but nothing is built yet.
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
    expect(ctx.state!.plannedBuildings).toHaveLength(1);
    expect(ctx.state!.cash).toBe(0);
  });

  it('prices per tier — a T1 balance does not build a T2', () => {
    const costT2 = getBuildingDef('management_office', 2).constructionCost;
    expect(costT2).toBeGreaterThan(COST_T1);
    const ctx = makeCtx(COST_T1);
    ctx.state!.buildings.unlockedTiers['management_office'] = 3;
    expect(buildCommand(ctx, ['management_office'], { at: '0,0', tier: '2' }).success).toBe(false);
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
  });

  it('reports the research gate, not the funds gap, when the tier is both locked and unaffordable', () => {
    // Precedence copied from `research queue`: cash is the last thing checked,
    // so a refusal names the precondition the player can actually act on.
    // Both terms of BuildMenu's `cash < def.constructionCost || locked` are
    // false here — only the message differs.
    const ctx = makeCtx(0);
    const result = buildCommand(ctx, ['management_office'], { at: '0,0', tier: '2' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('not researched');
    expect(result.output).not.toContain('Insufficient funds');
  });

  it('claims no land for a build it refuses', () => {
    // claimForAction buys off-site cells and rebuilds the navgrid; running it
    // before the funds check would leave land paid for by a build that never
    // happened. Guard sits ahead of it, so an off-site refusal is inert.
    const ctx = makeCtx(COST_T1 - 1);
    const offSiteX = ctx.grid!.maxX + 4;
    const before = snapshot(ctx);
    const boundsBefore = { minX: ctx.grid!.minX, maxX: ctx.grid!.maxX, minZ: ctx.grid!.minZ, maxZ: ctx.grid!.maxZ };
    const result = buildCommand(ctx, ['management_office'], { at: `${offSiteX},0` });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
    expect(snapshot(ctx)).toEqual(before);
    expect({ minX: ctx.grid!.minX, maxX: ctx.grid!.maxX, minZ: ctx.grid!.minZ, maxZ: ctx.grid!.maxZ })
      .toEqual(boundsBefore);
  });
});

// ── build destroy — issue #511 ──

describe('build destroy — insufficient funds guard', () => {
  const DEMOLISH_COST = getBuildingDef('management_office', 1).demolishCost;

  it('refuses when cash is one dollar short', () => {
    const ctx = makeCtx(DEMOLISH_COST - 1);
    const id = placeTestBuilding(ctx);
    const result = buildCommand(ctx, ['destroy', String(id)], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
  });

  it('changes nothing at all when it refuses', () => {
    const ctx = makeCtx(DEMOLISH_COST - 1);
    const id = placeTestBuilding(ctx);
    const before = snapshot(ctx);
    buildCommand(ctx, ['destroy', String(id)], {});
    expect(snapshot(ctx)).toEqual(before);
    expect(ctx.state!.buildings.buildings).toHaveLength(1);
    expect(ctx.state!.buildings.buildings[0]!.id).toBe(id);
  });

  it('demolishes when cash exactly equals the demolish cost', () => {
    const ctx = makeCtx(DEMOLISH_COST);
    const id = placeTestBuilding(ctx);
    const result = buildCommand(ctx, ['destroy', String(id)], {});
    expect(result.success).toBe(true);
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
    expect(ctx.state!.cash).toBe(0);
  });
});

// ── build upgrade — issue #511 ──

describe('build upgrade — insufficient funds guard', () => {
  const OLD_DEF = getBuildingDef('management_office', 1);
  const NEW_DEF = getBuildingDef('management_office', 2);
  const UPGRADE_COST = OLD_DEF.demolishCost + NEW_DEF.constructionCost;

  function unlockTier2(ctx: MiningContext): void {
    ctx.state!.buildings.unlockedTiers['management_office'] = 3;
  }

  it('refuses when cash is one dollar short', () => {
    const ctx = makeCtx(UPGRADE_COST - 1);
    unlockTier2(ctx);
    const id = placeTestBuilding(ctx);
    const result = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
  });

  it('changes nothing at all when it refuses — original building untouched, destroyBuilding never ran', () => {
    const ctx = makeCtx(UPGRADE_COST - 1);
    unlockTier2(ctx);
    const id = placeTestBuilding(ctx);
    const before = snapshot(ctx);
    buildCommand(ctx, ['upgrade', String(id)], {});
    expect(snapshot(ctx)).toEqual(before);
    expect(ctx.state!.buildings.buildings).toHaveLength(1);
    const building = ctx.state!.buildings.buildings[0]!;
    expect(building.id).toBe(id);
    expect(building.tier).toBe(1);
  });

  it('upgrades when cash exactly equals the upgrade cost', () => {
    const ctx = makeCtx(UPGRADE_COST);
    unlockTier2(ctx);
    const id = placeTestBuilding(ctx);
    const result = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(result.success).toBe(true);
    expect(ctx.state!.buildings.buildings).toHaveLength(1);
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(2);
    expect(ctx.state!.cash).toBe(0);
  });

  it('refuses a max-tier building for the tier-bound reason, not cost — even at cash 0', () => {
    // Edge case: the pre-existing tier>=3 check must keep running ahead of
    // the new funds guard, not get shadowed by it.
    const ctx = makeCtx(0);
    unlockTier2(ctx); // also unlocks T3 — placeTestBuilding's own placeBuilding() re-checks the research gate
    const id = placeTestBuilding(ctx, 'management_office', 3);
    const result = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('already at max tier');
    expect(result.output).not.toContain('Insufficient funds');
  });
});

// ── build move — issue #511 ──

describe('build move — insufficient funds guard', () => {
  const MOVE_COST = Math.round(getBuildingDef('management_office', 1).constructionCost * 0.5);

  it('refuses when cash is one dollar short', () => {
    const ctx = makeCtx(MOVE_COST - 1);
    const id = placeTestBuilding(ctx);
    const result = buildCommand(ctx, ['move', String(id)], { to: '5,5' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
  });

  it('changes nothing at all when it refuses — building keeps its original position', () => {
    const ctx = makeCtx(MOVE_COST - 1);
    const id = placeTestBuilding(ctx);
    const before = snapshot(ctx);
    buildCommand(ctx, ['move', String(id)], { to: '5,5' });
    expect(snapshot(ctx)).toEqual(before);
    const building = ctx.state!.buildings.buildings.find(b => b.id === id)!;
    expect(building.x).toBe(0);
    expect(building.z).toBe(0);
  });

  it('moves when cash exactly equals the move cost', () => {
    const ctx = makeCtx(MOVE_COST);
    const id = placeTestBuilding(ctx);
    const result = buildCommand(ctx, ['move', String(id)], { to: '5,5' });
    expect(result.success).toBe(true);
    const building = ctx.state!.buildings.buildings.find(b => b.id === id)!;
    expect(building.x).toBe(5);
    expect(building.z).toBe(5);
    expect(ctx.state!.cash).toBe(0);
  });
});

// ── corrupt — issue #511 ──

describe('corrupt — insufficient funds guard', () => {
  const WITNESS_COST = TARGET_COSTS.witness;

  it('refuses when cash is one dollar short', () => {
    const ctx = makeCtx(WITNESS_COST - 1);
    const result = corruptCommand(ctx, [], { target: 'witness' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
  });

  it('leaves no phantom attempt record on refusal — attemptCorruption today pushes one unconditionally', () => {
    const ctx = makeCtx(WITNESS_COST - 1);
    const before = snapshot(ctx);
    corruptCommand(ctx, [], { target: 'witness' });
    expect(snapshot(ctx)).toEqual(before);
    expect(ctx.state!.corruption.attempts).toHaveLength(0);
    expect(ctx.state!.corruption.level).toBe(0);
    expect(ctx.state!.corruption.mafiaUnlocked).toBe(false);
  });

  it('attempts corruption when cash exactly equals the target cost', () => {
    const ctx = makeCtx(WITNESS_COST);
    const result = corruptCommand(ctx, [], { target: 'witness' });
    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(0);
    expect(ctx.state!.corruption.attempts).toHaveLength(1);
  });

  it('refuses the expensive target at a balance that affords the cheap one', () => {
    const cheapCost = TARGET_COSTS.inspector;
    const expensiveCost = TARGET_COSTS.judge;
    expect(expensiveCost).toBeGreaterThan(cheapCost);
    const ctx = makeCtx(expensiveCost - 1);
    expect(corruptCommand(ctx, [], { target: 'judge' }).success).toBe(false);
    expect(corruptCommand(ctx, [], { target: 'inspector' }).success).toBe(true);
  });
});

// ── corrupt — invalid cost override sanitization (#519) ──
//
// `corrupt target:<t> cost:<n>` lets a player override the default bribe
// cost. Two unsanitized inputs break that: a negative cost passes the funds
// guard (which only rejects cash < cost) and then *increases* cash via
// `state.cash -= result.cost`; a non-numeric cost produces NaN, which
// `?? TARGET_COSTS[target]` does not catch (nullish coalescing only replaces
// null/undefined), poisoning state.cash with NaN for the rest of the session
// — every later `cash < X` guard is false because any NaN comparison is
// false. The fix sanitizes with `Number.isFinite(cost) && cost >= 0`,
// falling back to TARGET_COSTS[target] silently otherwise (same convention
// as `set_policy` and `new_game`'s optional numeric overrides).

describe('corrupt — invalid cost override sanitization (#519)', () => {
  const WITNESS_COST = TARGET_COSTS.witness;

  it('refuses a negative cost override when cash is below the real target cost', () => {
    const ctx = makeCtx(WITNESS_COST - 1);
    const before = ctx.state!.cash;
    const result = corruptCommand(ctx, [], { target: 'witness', cost: '-1000000' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
    expect(ctx.state!.cash).toBe(before);
  });

  it('charges the real target cost, never the negative override, when cash covers it', () => {
    const ctx = makeCtx(WITNESS_COST);
    const before = ctx.state!.cash;
    corruptCommand(ctx, [], { target: 'witness', cost: '-1000000' });
    expect(ctx.state!.cash).toBe(before - WITNESS_COST);
    expect(ctx.state!.cash).not.toBeGreaterThan(before);
  });

  it('never leaves cash as NaN after a non-numeric cost override', () => {
    const ctx = makeCtx(WITNESS_COST);
    corruptCommand(ctx, [], { target: 'witness', cost: 'notanumber' });
    expect(Number.isFinite(ctx.state!.cash)).toBe(true);
  });

  it('does not permanently disable funds guards after a negative cost override', () => {
    const ctx = makeCtx(WITNESS_COST);
    corruptCommand(ctx, [], { target: 'witness', cost: '-1000000' });
    expect(ctx.state!.cash).toBe(0);
    const buildResult = buildCommand(ctx, ['management_office'], { at: '0,0' });
    expect(buildResult.success).toBe(false);
    expect(buildResult.output).toContain('Insufficient funds');
  });

  it('does not permanently disable funds guards after a non-numeric cost override', () => {
    const ctx = makeCtx(WITNESS_COST);
    corruptCommand(ctx, [], { target: 'witness', cost: 'notanumber' });
    expect(ctx.state!.cash).toBe(0);
    const buildResult = buildCommand(ctx, ['management_office'], { at: '0,0' });
    expect(buildResult.success).toBe(false);
    expect(buildResult.output).toContain('Insufficient funds');
  });

  it('accepts cost:0 as a valid override — zero is not negative', () => {
    const ctx = makeCtx(0);
    const result = corruptCommand(ctx, [], { target: 'witness', cost: '0' });
    expect(result.success).toBe(true);
    expect(result.output).not.toContain('Insufficient funds');
    expect(ctx.state!.cash).toBe(0);
  });

  it('rejects cost:-1 and falls back to the default target cost (boundary)', () => {
    const ctx = makeCtx(WITNESS_COST - 1);
    const result = corruptCommand(ctx, [], { target: 'witness', cost: '-1' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
    expect(ctx.state!.cash).toBe(WITNESS_COST - 1);
  });

  it('still honors a legitimate positive cost override below the default target cost', () => {
    const ctx = makeCtx(WITNESS_COST);
    const before = ctx.state!.cash;
    const result = corruptCommand(ctx, [], { target: 'witness', cost: '5000' });
    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(before - 5000);
  });
});

// ── mafia accident — issue #511 ──

describe('mafia accident — insufficient funds guard', () => {
  it('refuses when cash is one dollar short', () => {
    const ctx = makeCtx(ACCIDENT_COST - 1);
    unlockMafia(ctx);
    const { employee } = hireEmployee(ctx.state!.employees, 'driller', new Random(1));
    const before = snapshot(ctx);
    const result = mafiaCommand(ctx, ['accident'], { employee: String(employee.id) });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
    expect(snapshot(ctx)).toEqual(before);
    expect(ctx.state!.employees.employees.find(e => e.id === employee.id)!.alive).toBe(true);
  });

  it('arranges the accident when cash exactly equals the accident cost', () => {
    const ctx = makeCtx(ACCIDENT_COST);
    unlockMafia(ctx);
    const { employee } = hireEmployee(ctx.state!.employees, 'driller', new Random(1));
    const result = mafiaCommand(ctx, ['accident'], { employee: String(employee.id) });
    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(0);
  });
});

// ── mafia frame — issue #511 ──

describe('mafia frame — insufficient funds guard', () => {
  it('refuses the start path when cash is one dollar short', () => {
    const ctx = makeCtx(FRAME_COST - 1);
    unlockMafia(ctx);
    const { employee } = hireEmployee(ctx.state!.employees, 'driller', new Random(1));
    const before = snapshot(ctx);
    const result = mafiaCommand(ctx, ['frame'], { employee: String(employee.id) });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
    expect(snapshot(ctx)).toEqual(before);
    expect(ctx.state!.mafia.pendingFrames).toHaveLength(0);
  });

  it('starts framing when cash exactly equals the frame cost', () => {
    const ctx = makeCtx(FRAME_COST);
    unlockMafia(ctx);
    const { employee } = hireEmployee(ctx.state!.employees, 'driller', new Random(1));
    const result = mafiaCommand(ctx, ['frame'], { employee: String(employee.id) });
    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(0);
    expect(ctx.state!.mafia.pendingFrames).toHaveLength(1);
  });

  it('completes a ready pending frame even at cash === 0 — the complete path must never be gated', () => {
    const ctx = makeCtx(FRAME_COST);
    unlockMafia(ctx);
    const { employee } = hireEmployee(ctx.state!.employees, 'driller', new Random(1));
    const startResult = mafiaCommand(ctx, ['frame'], { employee: String(employee.id) });
    expect(startResult.success).toBe(true);
    expect(ctx.state!.mafia.pendingFrames).toHaveLength(1);

    ctx.state!.tickCount += FRAME_EVIDENCE_TICKS;
    setCash(ctx, 0);
    const completeResult = mafiaCommand(ctx, ['frame'], { employee: String(employee.id) });
    expect(completeResult.success).toBe(true);
    expect(completeResult.output).not.toContain('Insufficient funds');
    expect(ctx.state!.cash).toBe(0);
  });
});

// ── employee raise — invalid amount override sanitization (#534) ──
//
// `employee raise <id> amount:<n>` guards with `isNaN(id) || amount <= 0`.
// A non-numeric amount (`parseFloat('notanumber')` → `NaN`) slips past that:
// `NaN <= 0` is `false`, so the guard never fires, giveRaise runs, and
// `emp.salary += NaN` poisons the employee's salary permanently — later
// picked up by payroll and spread into `state.cash`. `amount:Infinity` is
// the sharper case: `parseFloat('Infinity')` is a legitimate finite-looking
// number to `isNaN` (`isNaN(Infinity)` is `false`) and `Infinity > 0`, so a
// naive `isNaN`-only fix would still let it through — only
// `Number.isFinite(amount) && amount > 0` rejects it. The fix mirrors #519's
// `corrupt cost:` sanitization.

describe('employee raise — invalid amount override sanitization (#534)', () => {
  function hireTestEmployee(ctx: MiningContext) {
    const { employee } = hireEmployee(ctx.state!.employees, 'driller', new Random(1));
    return employee;
  }

  it('refuses amount:notanumber, leaving salary and cash untouched', () => {
    const ctx = makeCtx(100_000);
    const emp = hireTestEmployee(ctx);
    const salaryBefore = emp.salary;
    const cashBefore = ctx.state!.cash;
    const result = employeeCommand(ctx, ['raise', String(emp.id)], { amount: 'notanumber' });
    expect(result.success).toBe(false);
    expect(result.output).toBe('Usage: employee raise <id> amount:500');
    expect(emp.salary).toBe(salaryBefore);
    expect(ctx.state!.cash).toBe(cashBefore);
  });

  it('refuses amount:Infinity — Infinity > 0 passes the naive amount <= 0 check', () => {
    const ctx = makeCtx(100_000);
    const emp = hireTestEmployee(ctx);
    const salaryBefore = emp.salary;
    const cashBefore = ctx.state!.cash;
    const result = employeeCommand(ctx, ['raise', String(emp.id)], { amount: 'Infinity' });
    expect(result.success).toBe(false);
    expect(result.output).toBe('Usage: employee raise <id> amount:500');
    expect(emp.salary).toBe(salaryBefore);
    expect(ctx.state!.cash).toBe(cashBefore);
  });

  it('refuses amount:NaN (literal string), same path as notanumber', () => {
    const ctx = makeCtx(100_000);
    const emp = hireTestEmployee(ctx);
    const salaryBefore = emp.salary;
    const result = employeeCommand(ctx, ['raise', String(emp.id)], { amount: 'NaN' });
    expect(result.success).toBe(false);
    expect(result.output).toBe('Usage: employee raise <id> amount:500');
    expect(emp.salary).toBe(salaryBefore);
  });

  it('rejects amount:-5 (boundary, already correct pre-fix — must stay correct)', () => {
    const ctx = makeCtx(100_000);
    const emp = hireTestEmployee(ctx);
    const salaryBefore = emp.salary;
    const result = employeeCommand(ctx, ['raise', String(emp.id)], { amount: '-5' });
    expect(result.success).toBe(false);
    expect(emp.salary).toBe(salaryBefore);
  });

  it('rejects amount:0 (boundary, already correct pre-fix — must stay correct)', () => {
    const ctx = makeCtx(100_000);
    const emp = hireTestEmployee(ctx);
    const salaryBefore = emp.salary;
    const result = employeeCommand(ctx, ['raise', String(emp.id)], { amount: '0' });
    expect(result.success).toBe(false);
    expect(emp.salary).toBe(salaryBefore);
  });

  it('accepts amount:500 on a valid id — salary increases by exactly 500 and stays finite', () => {
    const ctx = makeCtx(100_000);
    const emp = hireTestEmployee(ctx);
    const salaryBefore = emp.salary;
    const result = employeeCommand(ctx, ['raise', String(emp.id)], { amount: '500' });
    expect(result.success).toBe(true);
    expect(emp.salary).toBe(salaryBefore + 500);
    expect(Number.isFinite(emp.salary)).toBe(true);
  });

  it('does not permanently disable funds guards after a rejected non-numeric raise', () => {
    const ctx = makeCtx(0);
    const emp = hireTestEmployee(ctx);
    employeeCommand(ctx, ['raise', String(emp.id)], { amount: 'notanumber' });
    expect(Number.isFinite(ctx.state!.cash)).toBe(true);
    const buildResult = buildCommand(ctx, ['management_office'], { at: '0,0' });
    expect(buildResult.success).toBe(false);
    expect(buildResult.output).toContain('Insufficient funds');
  });
});

// ── new_game cash: — invalid cash override sanitization (#534) ──
//
// `new_game cash:<n>` gates the override with `named['cash'] ? {...} : {}` —
// a truthy *string* still applies even when `parseInt` on it is `NaN`, so
// `new_game cash:notanumber` spreads `{ startingCash: NaN }` into
// `createGame`, and `NaN ?? STARTING_CASH` keeps the `NaN` (nullish
// coalescing only replaces `null`/`undefined`) — `state.cash` starts the
// session poisoned. Same root cause and fix shape as #519/#533's `corrupt
// cost:` and this file's `employee raise amount:` sanitization above.

describe('new_game cash: — invalid cash override sanitization (#534)', () => {
  function freshCtx(): MiningContext {
    return { state: null, grid: null, emitter: new EventEmitter(), landscape: null, playableArea: null };
  }

  it('falls back to STARTING_CASH for cash:notanumber', () => {
    const ctx = freshCtx();
    const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32', cash: 'notanumber' });
    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(STARTING_CASH);
    expect(Number.isFinite(ctx.state!.cash)).toBe(true);
  });

  it('falls back to STARTING_CASH for cash:Infinity — parseInt("Infinity", 10) is NaN, same path as notanumber', () => {
    const ctx = freshCtx();
    const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32', cash: 'Infinity' });
    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(STARTING_CASH);
    expect(Number.isFinite(ctx.state!.cash)).toBe(true);
  });

  it('honors a legitimate cash:50000 override exactly (must not regress)', () => {
    const ctx = freshCtx();
    const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32', cash: '50000' });
    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(50000);
  });

  it('honors cash:0 as a legitimate override, distinct from absent (must not regress)', () => {
    const ctx = freshCtx();
    const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32', cash: '0' });
    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(0);
  });

  it('falls back to STARTING_CASH when cash: is present but empty (pre-existing behavior, must not regress)', () => {
    const ctx = freshCtx();
    const result = newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32', cash: '' });
    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(STARTING_CASH);
  });
});

// ── start_level — invalid cash override sanitization (#534 campaign.ts) ──
//
// `campaign start level:<id> cash:<n>` guards its override with
// `parseInt(named['cash'], 10)` fed through `isNaN(cashOverride)`. Its own
// issue claimed this "already guards correctly" — wrong, same bug class as
// the other two #534 sites: `isNaN` only catches `NaN`, not `Infinity`, and
// `parseInt` returns `Infinity` for a numeric digit string long enough to
// overflow (e.g. `parseInt('1' + '0'.repeat(400), 10) === Infinity`).
// `isNaN(Infinity)` is `false`, so `!isNaN(cashOverride)` is `true` and the
// guard never fires — `ctx.state.cash` and `ctx.state.finances.cash` both get
// set to `Infinity`, disabling every later `cash < X` funds guard for the
// rest of the session, same end state as the `employee raise` and `new_game
// cash:` sites already covered above. The fix (not made here) replaces
// `!isNaN(cashOverride)` with `Number.isFinite(cashOverride)`.

describe('start_level — invalid cash override sanitization (#534 campaign.ts)', () => {
  const TUTORIAL_START_CASH = getLevel('tutorial_pit')!.startingCash;

  function freshCtx(): MiningContext {
    return { state: null, grid: null, emitter: new EventEmitter(), landscape: null, playableArea: null };
  }

  it('does not set cash to Infinity for a cash override that overflows parseInt', () => {
    const overflowDigits = '1' + '0'.repeat(400);
    expect(parseInt(overflowDigits, 10)).toBe(Infinity); // sanity check on the premise

    const ctx = freshCtx();
    const result = campaignStartCommand(ctx, [], { level: 'tutorial_pit', cash: overflowDigits });

    expect(result.success).toBe(true);
    expect(ctx.state!.cash).not.toBe(Infinity);
    expect(Number.isFinite(ctx.state!.cash)).toBe(true);
    expect(ctx.state!.finances.cash).not.toBe(Infinity);
    expect(Number.isFinite(ctx.state!.finances.cash)).toBe(true);
    // Rejected override falls back to the level's own starting cash, same as
    // the non-numeric case below and the sibling #534 sites.
    expect(ctx.state!.cash).toBe(TUTORIAL_START_CASH);
    expect(ctx.state!.finances.cash).toBe(TUTORIAL_START_CASH);
  });

  it('falls back to the level default for cash:notanumber (regression boundary, already correct pre-fix)', () => {
    const ctx = freshCtx();
    const result = campaignStartCommand(ctx, [], { level: 'tutorial_pit', cash: 'notanumber' });

    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(TUTORIAL_START_CASH);
    expect(ctx.state!.finances.cash).toBe(TUTORIAL_START_CASH);
    expect(Number.isFinite(ctx.state!.cash)).toBe(true);
  });

  it('still honors a legitimate cash:50000 override exactly (must not regress)', () => {
    const ctx = freshCtx();
    const result = campaignStartCommand(ctx, [], { level: 'tutorial_pit', cash: '50000' });

    expect(result.success).toBe(true);
    expect(ctx.state!.cash).toBe(50000);
    expect(ctx.state!.finances.cash).toBe(50000);
  });

  it('does not permanently disable funds guards after an Infinity-overflowing cash override', () => {
    const ctx = freshCtx();
    campaignStartCommand(ctx, [], { level: 'tutorial_pit', cash: '1' + '0'.repeat(400) });
    expect(Number.isFinite(ctx.state!.cash)).toBe(true);

    const buildResult = buildCommand(ctx, ['management_office'], { at: '0,0' });
    // A guard poisoned to Infinity would let any purchase through; a sane
    // guard still enforces affordability against the real (finite) balance.
    if (ctx.state!.cash < getBuildingDef('management_office', 1).constructionCost) {
      expect(buildResult.success).toBe(false);
      expect(buildResult.output).toContain('Insufficient funds');
    }
  });
});
