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
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { HIRING_COSTS } from '../../../src/core/entities/Employee.js';
import { getVehicleDefByTier } from '../../../src/core/entities/Vehicle.js';
import { getBuildingDef } from '../../../src/core/entities/Building.js';

function makeCtx(cash: number): MiningContext {
  const ctx: MiningContext = {
    state: null,
    grid: null,
    emitter: new EventEmitter(),
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
  };
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
    expect(ctx.state!.buildings.buildings).toHaveLength(1);
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
