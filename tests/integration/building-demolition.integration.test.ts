// BlastSimulator2026 — Integration: demolition and upgrade are building_destroyer work (#1392)
//
// `build destroy` / `build upgrade` queue an order a Building Destroyer and a
// truck-licensed driver carry out. Cash moves at order time, the building
// stands until the work finishes, and an upgrade keeps the building's id.

import { describe, it, expect, afterEach } from 'vitest';
import type { GameContext } from '../../src/console/commands/world.js';
import { buildCommand, employeeCommand } from '../../src/console/commands/entities.js';
import { vehicleCommand } from '../../src/console/commands/vehicle.js';
import { tickCommand } from '../../src/console/commands/events.js';
import { makeGameContext } from '../helpers/gameContext.js';
import { equipDemolition, tickUntilDemolished } from '../helpers/demolition.js';
import {
  getBuildingDef, getDefSize, getDemolishCost, getUpgradeCost,
} from '../../src/core/entities/Building.js';
import { computeDemolitionDurationTicks } from '../../src/core/entities/DemolitionDuration.js';
import { computeActionWorkTicks } from '../../src/core/engine/ActionSelection.js';
import { setLocale, t } from '../../src/core/i18n/I18n.js';
import type { PendingAction } from '../../src/core/state/GameState.js';

function staffedCtx(): GameContext {
  return makeGameContext({ mineType: 'desert', seed: 42, size: 32, staffed: true });
}

function tick(ctx: GameContext, n = 1): void {
  for (let i = 0; i < n; i++) tickCommand(ctx, ['1'], {});
}

function demolishAction(ctx: GameContext): PendingAction | undefined {
  return ctx.state!.pendingActions.find(a => a.type === 'demolish_building');
}

/** Construct a building (as the game does: order, then tick until the crew lands it) and return its id. */
function constructBuilding(ctx: GameContext, type = 'living_quarters', at = '9,14'): number {
  const before = ctx.state!.buildings.buildings.length;
  const res = buildCommand(ctx, [type], { at });
  expect(res.success, res.output).toBe(true);
  for (let i = 0; i < 400 && ctx.state!.plannedBuildings.length > 0; i++) tick(ctx);
  expect(ctx.state!.buildings.buildings).toHaveLength(before + 1);
  return ctx.state!.buildings.buildings[before]!.id;
}

function cashSpentBy(ctx: GameContext, act: () => void): number {
  const before = ctx.state!.cash;
  act();
  return before - ctx.state!.cash;
}

afterEach(() => setLocale('en'));

describe('build destroy as a queued order', () => {
  it('debits the demolish cost at order time and leaves the building standing', () => {
    const ctx = staffedCtx();
    const id = constructBuilding(ctx);
    equipDemolition(ctx);
    const building = ctx.state!.buildings.buildings.find(b => b.id === id)!;

    const spent = cashSpentBy(ctx, () => {
      const res = buildCommand(ctx, ['destroy', String(id)], {});
      expect(res.success, res.output).toBe(true);
    });

    expect(spent).toBe(getDemolishCost(building));
    expect(ctx.state!.buildings.buildings.some(b => b.id === id)).toBe(true);
    expect(demolishAction(ctx)).toBeDefined();
  });

  it('removes the building only after the work completes, charging nothing more', () => {
    const ctx = staffedCtx();
    const id = constructBuilding(ctx);
    equipDemolition(ctx);
    buildCommand(ctx, ['destroy', String(id)], {});
    const cashAfterOrder = ctx.state!.cash;

    tick(ctx, 2);
    expect(ctx.state!.buildings.buildings.some(b => b.id === id)).toBe(true);

    const ticks = 2 + tickUntilDemolished(ctx);
    expect(ctx.state!.buildings.buildings.some(b => b.id === id)).toBe(false);
    expect(demolishAction(ctx)).toBeUndefined();
    // Wages and fuel drain cash every tick whatever happens; compare against an
    // identical site that never placed the order, so only a second demolish fee shows.
    const control = staffedCtx();
    constructBuilding(control);
    equipDemolition(control);
    const controlBefore = control.state!.cash;
    tick(control, ticks);
    const runningCosts = controlBefore - control.state!.cash;
    const extra = (cashAfterOrder - ctx.state!.cash) - runningCosts;
    expect(extra).toBeLessThan(getBuildingDef('living_quarters', 1).demolishCost);
  });

  it('frees the nav footprint once the building is gone', () => {
    const ctx = staffedCtx();
    const id = constructBuilding(ctx);
    const b = ctx.state!.buildings.buildings.find(x => x.id === id)!;
    const navGrid = ctx.state!.navGrid!;
    expect(navGrid.cellAt(b.x, b.z)?.type).toBe('blocked');

    equipDemolition(ctx);
    buildCommand(ctx, ['destroy', String(id)], {});
    tickUntilDemolished(ctx);

    expect(navGrid.cellAt(b.x, b.z)?.type).not.toBe('blocked');
  });

  it('refreshes logistics capacity when a freight warehouse goes', () => {
    const ctx = staffedCtx();
    const id = constructBuilding(ctx, 'freight_warehouse', '9,14');
    expect(ctx.state!.logistics.storageCapacityKg).toBeGreaterThan(0);
    equipDemolition(ctx);
    buildCommand(ctx, ['destroy', String(id)], {});
    tickUntilDemolished(ctx);
    expect(ctx.state!.logistics.storageCapacityKg).toBe(0);
  });

  it('releases an occupant when their building is demolished', () => {
    const ctx = staffedCtx();
    const id = constructBuilding(ctx);
    const emp = ctx.state!.employees.employees.find(e => e.role === 'blaster')!;
    emp.locomotion = { kind: 'inside', buildingId: id };
    equipDemolition(ctx);
    buildCommand(ctx, ['destroy', String(id)], {});
    tickUntilDemolished(ctx);
    expect(emp.locomotion.kind).not.toBe('inside');
  });

  it('refuses a second destroy on a building already ordered, with the localized message', () => {
    const ctx = staffedCtx();
    const id = constructBuilding(ctx);
    equipDemolition(ctx);
    buildCommand(ctx, ['destroy', String(id)], {});
    const cash = ctx.state!.cash;

    const again = buildCommand(ctx, ['destroy', String(id)], {});
    expect(again.success).toBe(false);
    expect(again.output).toBe(t('entities.build_demolish_already_ordered', { id }));
    expect(ctx.state!.cash).toBe(cash);
    expect(ctx.state!.pendingActions.filter(a => a.type === 'demolish_building')).toHaveLength(1);
  });

  it('refuses an upgrade on a building already ordered for demolition', () => {
    const ctx = staffedCtx();
    ctx.state!.buildings.unlockedTiers['living_quarters'] = 3;
    const id = constructBuilding(ctx);
    equipDemolition(ctx);
    buildCommand(ctx, ['destroy', String(id)], {});
    const cash = ctx.state!.cash;

    const res = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(res.success).toBe(false);
    expect(res.output).toBe(t('entities.build_demolish_already_ordered', { id }));
    expect(ctx.state!.cash).toBe(cash);
  });

  it('refuses a destroy on a building with a pending upgrade', () => {
    const ctx = staffedCtx();
    ctx.state!.buildings.unlockedTiers['living_quarters'] = 3;
    const id = constructBuilding(ctx);
    equipDemolition(ctx);
    expect(buildCommand(ctx, ['upgrade', String(id)], {}).success).toBe(true);
    const res = buildCommand(ctx, ['destroy', String(id)], {});
    expect(res.success).toBe(false);
    expect(res.output).toBe(t('entities.build_demolish_already_ordered', { id }));
  });

  it('refuses unknown ids and insufficient funds at order time with no cash change', () => {
    const ctx = staffedCtx();
    const id = constructBuilding(ctx);
    equipDemolition(ctx);
    const missing = buildCommand(ctx, ['destroy', '999'], {});
    expect(missing.success).toBe(false);
    expect(missing.output).toContain('not found');

    ctx.state!.cash = 0;
    const broke = buildCommand(ctx, ['destroy', String(id)], {});
    expect(broke.success).toBe(false);
    expect(ctx.state!.cash).toBe(0);
    expect(demolishAction(ctx)).toBeUndefined();
  });
});

describe('demolition without a destroyer or driver', () => {
  it('queues the order, then flags no_vehicle_in_fleet', () => {
    const ctx = staffedCtx();
    const id = constructBuilding(ctx);
    const res = buildCommand(ctx, ['destroy', String(id)], {});
    expect(res.success, res.output).toBe(true);

    tick(ctx);
    const action = demolishAction(ctx)!;
    expect(action.status).toBe('queued');
    expect(action.blockedReason).toBe('no_vehicle_in_fleet');
    expect(ctx.state!.buildings.buildings.some(b => b.id === id)).toBe(true);

  });

  it('flags no_licensed_driver when a destroyer exists but nobody holds the truck licence', () => {
    const ctx = staffedCtx();
    const id = constructBuilding(ctx);
    const state = ctx.state!;
    state.cash = 500_000;
    expect(vehicleCommand(ctx, ['buy', 'building_destroyer'], {}).success).toBe(true);
    // Strip the licence from everyone on the roster.
    for (const e of state.employees.employees) {
      e.qualifications = e.qualifications.filter(q => q.category !== 'driving.truck');
    }
    buildCommand(ctx, ['destroy', String(id)], {});
    tick(ctx);
    const action = demolishAction(ctx)!;
    expect(action.blockedReason).toBe('no_licensed_driver');
    expect(state.buildings.buildings.some(b => b.id === id)).toBe(true);
  });

  it('proceeds once a destroyer and driver arrive after the order', () => {
    const ctx = staffedCtx();
    const id = constructBuilding(ctx);
    buildCommand(ctx, ['destroy', String(id)], {});
    tick(ctx, 3);
    expect(ctx.state!.buildings.buildings.some(b => b.id === id)).toBe(true);

    equipDemolition(ctx);
    tickUntilDemolished(ctx);
    expect(ctx.state!.buildings.buildings.some(b => b.id === id)).toBe(false);
    expect(employeeCommand(ctx, ['list'], {}).success).toBe(true);
  });
});

describe('demolition timing', () => {
  it('the estimate (computeActionWorkTicks) matches the ticks actually worked', () => {
    const ctx = staffedCtx();
    const id = constructBuilding(ctx);
    equipDemolition(ctx);
    buildCommand(ctx, ['destroy', String(id)], {});
    const actionId = demolishAction(ctx)!.id;

    // Tick until the holder is mid-work, then compare the estimate to the seeded timer.
    let seeded: number | null = null;
    let estimate = -1;
    for (let i = 0; i < 400 && seeded === null; i++) {
      tick(ctx);
      const action = ctx.state!.pendingActions.find(a => a.id === actionId);
      const emp = action?.holderId != null
        ? ctx.state!.employees.employees.find(e => e.id === action.holderId)
        : undefined;
      if (emp && emp.taskTicksRemaining !== null && action) {
        seeded = emp.taskTicksRemaining;
        estimate = computeActionWorkTicks(ctx.state!, emp, action, ctx.grid ?? undefined);
      }
    }
    expect(seeded).not.toBeNull();
    // taskTicksRemaining has ticked down at most one step since seeding.
    expect(seeded!).toBeLessThanOrEqual(estimate);
    expect(seeded!).toBeGreaterThanOrEqual(estimate - 1);

    // And the building goes exactly when that timer is spent.
    const remaining = seeded!;
    let guard = 0;
    while (ctx.state!.buildings.buildings.some(b => b.id === id) && guard++ < estimate + 5) tick(ctx);
    expect(ctx.state!.buildings.buildings.some(b => b.id === id)).toBe(false);
    expect(guard).toBeLessThanOrEqual(remaining + 2);
  });

  it('order payload duration is the tier-1-destroyer duration for the building', () => {
    const ctx = staffedCtx();
    const id = constructBuilding(ctx);
    const b = ctx.state!.buildings.buildings.find(x => x.id === id)!;
    const { sizeX, sizeZ } = getDefSize(getBuildingDef(b.type, b.tier));
    buildCommand(ctx, ['destroy', String(id)], {});
    expect(demolishAction(ctx)!.payload['durationTicks'])
      .toBe(computeDemolitionDurationTicks(sizeX * sizeZ, b.tier, 1));
  });

  it('a tier-3 destroyer finishes the same demolition in fewer ticks than a tier-1', () => {
    const run = (vehicleTier: 1 | 3): number => {
      const ctx = staffedCtx();
      const id = constructBuilding(ctx);
      equipDemolition(ctx, vehicleTier);
      buildCommand(ctx, ['destroy', String(id)], {});
      return tickUntilDemolished(ctx);
    };
    expect(run(3)).toBeLessThan(run(1));
  });
});

describe('build upgrade as demolition then construction', () => {
  function upgradeSetup() {
    const ctx = staffedCtx();
    ctx.state!.buildings.unlockedTiers['living_quarters'] = 3;
    const id = constructBuilding(ctx);
    equipDemolition(ctx);
    const old = { ...ctx.state!.buildings.buildings.find(b => b.id === id)! };
    return { ctx, id, old };
  }

  it('charges getUpgradeCost at order time and nothing changes in the building yet', () => {
    const { ctx, id, old } = upgradeSetup();
    const spent = cashSpentBy(ctx, () => {
      const res = buildCommand(ctx, ['upgrade', String(id)], {});
      expect(res.success, res.output).toBe(true);
    });
    expect(spent).toBe(getUpgradeCost(old, 2));
    const still = ctx.state!.buildings.buildings.find(b => b.id === id)!;
    expect(still.tier).toBe(1);
  });

  it('the old building keeps operating until demolition finishes', () => {
    const { ctx, id } = upgradeSetup();
    buildCommand(ctx, ['upgrade', String(id)], {});
    tick(ctx, 2);
    expect(ctx.state!.buildings.buildings.find(b => b.id === id)?.tier).toBe(1);
  });

  it('reserves the upgraded site at order time so nothing else can claim it', () => {
    const { ctx, id, old } = upgradeSetup();
    buildCommand(ctx, ['upgrade', String(id)], {});
    const reserved = ctx.state!.plannedBuildings.find(pb => pb.buildingId === id);
    expect(reserved).toBeDefined();
    expect(reserved!.tier).toBe(2);
    expect([reserved!.x, reserved!.z]).toEqual([old.x, old.z]);
  });

  it('ends with the SAME id at tier+1 and the same position', () => {
    const { ctx, id, old } = upgradeSetup();
    buildCommand(ctx, ['upgrade', String(id)], {});
    tickUntilDemolished(ctx);
    const after = ctx.state!.buildings.buildings.filter(b => b.type === 'living_quarters');
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(id);
    expect(after[0]!.tier).toBe(2);
    expect([after[0]!.x, after[0]!.z]).toEqual([old.x, old.z]);
    expect(ctx.state!.plannedBuildings).toHaveLength(0);
  });

  it('the building is absent from state while the rebuild runs, then dispatches a place_building order', () => {
    const { ctx, id } = upgradeSetup();
    buildCommand(ctx, ['upgrade', String(id)], {});
    let sawGap = false;
    for (let i = 0; i < 1500 && (demolishAction(ctx) || ctx.state!.plannedBuildings.length > 0); i++) {
      tick(ctx);
      const present = ctx.state!.buildings.buildings.some(b => b.id === id);
      const rebuilding = ctx.state!.pendingActions.some(a => a.type === 'place_building');
      if (!present) {
        expect(demolishAction(ctx)).toBeUndefined();
        if (rebuilding) sawGap = true;
      }
    }
    expect(sawGap).toBe(true);
    expect(ctx.state!.buildings.buildings.some(b => b.id === id && b.tier === 2)).toBe(true);
  });

  it('upgrade refusals happen at order time with no cash change', () => {
    const ctx = staffedCtx();
    const id = constructBuilding(ctx);
    equipDemolition(ctx);
    const cash = ctx.state!.cash;

    const unresearched = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(unresearched.success).toBe(false);
    expect(unresearched.output).toMatch(/research/i);

    ctx.state!.buildings.unlockedTiers['living_quarters'] = 3;
    ctx.state!.cash = 1;
    const broke = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(broke.success).toBe(false);
    expect(ctx.state!.cash).toBe(1);

    ctx.state!.cash = cash;
    expect(buildCommand(ctx, ['upgrade', '999'], {}).success).toBe(false);
    expect(demolishAction(ctx)).toBeUndefined();
    expect(ctx.state!.plannedBuildings).toHaveLength(0);
  });

  it('refuses an upgrade past max tier at order time', () => {
    const ctx = staffedCtx();
    ctx.state!.buildings.unlockedTiers['living_quarters'] = 3;
    buildCommand(ctx, ['living_quarters'], { at: '9,14', tier: '3' });
    for (let i = 0; i < 400 && ctx.state!.plannedBuildings.length > 0; i++) tick(ctx);
    equipDemolition(ctx);
    const cash = ctx.state!.cash;
    const res = buildCommand(ctx, ['upgrade', '1'], {});
    expect(res.success).toBe(false);
    expect(res.output).toMatch(/max tier/i);
    expect(ctx.state!.cash).toBe(cash);
  });

  it('refuses at order time when the larger footprint is blocked, with no cash change and no reservation', () => {
    const ctx = staffedCtx();
    ctx.state!.buildings.unlockedTiers['living_quarters'] = 3;
    const id = constructBuilding(ctx, 'living_quarters', '9,14');
    equipDemolition(ctx);
    // Tier 1 covers x 9..11; tier 2 (4 wide) reaches x 12. Reserve a site there.
    ctx.state!.plannedBuildings.push({
      id: 99, buildingId: 99, type: 'management_office', tier: 1, x: 12, z: 14, actionId: 9999, cost: 0,
    });
    const cash = ctx.state!.cash;
    const res = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(res.success).toBe(false);
    expect(ctx.state!.cash).toBe(cash);
    expect(ctx.state!.plannedBuildings.filter(pb => pb.buildingId === id)).toHaveLength(0);
    expect(demolishAction(ctx)).toBeUndefined();
  });
});

describe('cancelling demolition orders', () => {
  it('cancelling a plain destroy refunds its cost and keeps the building', () => {
    const ctx = staffedCtx();
    const id = constructBuilding(ctx);
    equipDemolition(ctx);
    const before = ctx.state!.cash;
    buildCommand(ctx, ['destroy', String(id)], {});
    const actionId = demolishAction(ctx)!.id;
    const res = employeeCommand(ctx, ['cancel', String(actionId)], {});
    expect(res.success, res.output).toBe(true);
    expect(ctx.state!.cash).toBe(before);
    expect(demolishAction(ctx)).toBeUndefined();
    expect(ctx.state!.buildings.buildings.some(b => b.id === id)).toBe(true);
  });

  it('cancelling a pending upgrade refunds the full cost and releases the reserved site', () => {
    const ctx = staffedCtx();
    ctx.state!.buildings.unlockedTiers['living_quarters'] = 3;
    const id = constructBuilding(ctx);
    equipDemolition(ctx);
    const before = ctx.state!.cash;
    buildCommand(ctx, ['upgrade', String(id)], {});
    expect(ctx.state!.plannedBuildings.some(pb => pb.buildingId === id)).toBe(true);

    const actionId = demolishAction(ctx)!.id;
    expect(employeeCommand(ctx, ['cancel', String(actionId)], {}).success).toBe(true);

    expect(ctx.state!.cash).toBe(before);
    expect(ctx.state!.plannedBuildings.some(pb => pb.buildingId === id)).toBe(false);
    expect(ctx.state!.buildings.buildings.find(b => b.id === id)?.tier).toBe(1);
  });

  it('after a cancel the building can be ordered again', () => {
    const ctx = staffedCtx();
    const id = constructBuilding(ctx);
    equipDemolition(ctx);
    buildCommand(ctx, ['destroy', String(id)], {});
    employeeCommand(ctx, ['cancel', String(demolishAction(ctx)!.id)], {});
    expect(buildCommand(ctx, ['destroy', String(id)], {}).success).toBe(true);
  });
});
