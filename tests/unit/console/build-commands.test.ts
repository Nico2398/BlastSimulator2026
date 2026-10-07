// BlastSimulator2026 — build command unit tests (CH1.7)
// Tests tier placement, upgrade, and demolish-with-cost behaviour.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildCommand } from '../../../src/console/commands/entities.js';
import { tickCommand } from '../../../src/console/commands/events.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import { getBuildingDef } from '../../../src/core/entities/Building.js';
import { makeGameContext } from '../../helpers/gameContext.js';
import { equipDemolition, tickUntilDemolished } from '../../helpers/demolition.js';
import { createRunner } from '../../../src/console/createRunner.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';

function makeCtx(): MiningContext {
  // Staffed (#556): confirming a placement only queues a construction site —
  // an idle employee is needed to actually walk over and finish the
  // `place_building` work before any of these tests can see a real building.
  const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 32, staffed: true });
  // These tests exercise tier placement/upgrade mechanics directly, not the
  // research gate — pre-unlock every tier so placement isn't blocked.
  ctx.state!.buildings.unlockedTiers.management_office = 3;
  return ctx;
}

/** Tick until every ordered building has landed (or maxTicks is exhausted). */
function tickUntilConstructionDone(ctx: MiningContext, maxTicks = 300): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedBuildings.length > 0; i++) {
    tickCommand(ctx as any, ['1'], {});
  }
}

describe('build command — ordered ids (#556)', () => {
  it('numbers buildings in the order they were ordered, not the order they finish', () => {
    const ctx = makeCtx();
    ctx.state!.buildings.unlockedTiers.freight_warehouse = 3;
    // Two orders back to back, far enough apart that the staffed crew builds
    // them in parallel and finishes them in whichever order it reaches them.
    expect(buildCommand(ctx, ['management_office'], { at: '20,20' }).success).toBe(true);
    expect(buildCommand(ctx, ['freight_warehouse'], { at: '2,1' }).success).toBe(true);
    tickUntilConstructionDone(ctx);

    const office = ctx.state!.buildings.buildings.find(b => b.type === 'management_office')!;
    const warehouse = ctx.state!.buildings.buildings.find(b => b.type === 'freight_warehouse')!;
    expect(office.id).toBe(1);
    expect(warehouse.id).toBe(2);
  });

  it('keeps the building list ordered by id whichever site completes first', () => {
    const ctx = makeCtx();
    ctx.state!.buildings.unlockedTiers.freight_warehouse = 3;
    expect(buildCommand(ctx, ['management_office'], { at: '20,20' }).success).toBe(true);
    expect(buildCommand(ctx, ['freight_warehouse'], { at: '2,1' }).success).toBe(true);
    tickUntilConstructionDone(ctx);

    const ids = ctx.state!.buildings.buildings.map(b => b.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('claims the finished building id at order time', () => {
    const ctx = makeCtx();
    expect(buildCommand(ctx, ['management_office'], { at: '2,0' }).success).toBe(true);
    const order = ctx.state!.plannedBuildings[0]!;
    expect(order.buildingId).toBe(1);
    tickUntilConstructionDone(ctx);
    expect(ctx.state!.buildings.buildings[0]!.id).toBe(order.buildingId);
  });
});

describe('build command — tier placement', () => {
  it('places a T1 building by default', () => {
    const ctx = makeCtx();
    const result = buildCommand(ctx, ['management_office'], { at: '2,0' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('T1');
    // Confirming placement only queues a construction site (#556) — nothing
    // is built yet.
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
    expect(ctx.state!.plannedBuildings).toHaveLength(1);
    tickUntilConstructionDone(ctx);
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(1);
  });

  it('places a T2 building when tier:2 is supplied', () => {
    const ctx = makeCtx();
    // #410: tier 2+ placement is gated on Research Center unlock — pre-unlock so
    // this test still exercises tier placement, not the research gate itself.
    ctx.state!.buildings.unlockedTiers['management_office'] = 2;
    const result = buildCommand(ctx, ['management_office'], { at: '2,0', tier: '2' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('T2');
    tickUntilConstructionDone(ctx);
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(2);
  });

  it('places a T3 building when tier:3 is supplied', () => {
    const ctx = makeCtx();
    ctx.state!.buildings.unlockedTiers['management_office'] = 3;
    const result = buildCommand(ctx, ['management_office'], { at: '2,0', tier: '3' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('T3');
    tickUntilConstructionDone(ctx);
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(3);
  });

  it('deducts the correct construction cost for the chosen tier', () => {
    const ctx = makeCtx();
    ctx.state!.buildings.unlockedTiers['management_office'] = 2;
    const cashBefore = ctx.state!.cash;
    buildCommand(ctx, ['management_office'], { at: '2,0', tier: '2' });
    const def = getBuildingDef('management_office', 2);
    // The order confirms and charges immediately (#556) — cost is deducted
    // at order time, not on construction completion.
    expect(ctx.state!.cash).toBe(cashBefore - def.constructionCost);
  });

  it('treats an invalid tier param as tier 1', () => {
    const ctx = makeCtx();
    const result = buildCommand(ctx, ['management_office'], { at: '2,0', tier: '9' });
    expect(result.success).toBe(true);
    tickUntilConstructionDone(ctx);
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(1);
  });

  it('#816: relocates every employee standing on a footprint tile that just closed over them, not only the one who built it', () => {
    const ctx = makeCtx();
    const result = buildCommand(ctx, ['management_office'], { at: '4,4' });
    expect(result.success).toBe(true);

    // Let dispatch settle onto whichever staffed employee ends up building
    // this (cost-based, #549 — not asserted by id, only that someone did).
    for (let i = 0; i < 10 && ctx.state!.plannedBuildings.length > 0; i++) {
      tickCommand(ctx as any, ['1'], {});
    }
    const order = ctx.state!.plannedBuildings[0]!;
    const action = ctx.state!.pendingActions.find(a => a.id === order.actionId);
    expect(action).toBeDefined();
    const builderId = action!.holderId;
    expect(builderId).not.toBeNull();

    // A different, uninvolved employee happens to be standing exactly on the
    // footprint tile — e.g. idling at a spot a later place_building order
    // just closed over. Before #816's fix, tickTaskCompletion.ts only
    // relocated `emp` (the one whose own PendingAction completed); any
    // bystander here was left permanently stranded on now-blocked terrain,
    // where every future findPath from their position fails outright
    // (Pathfinding.ts's start-impassable check).
    const bystander = ctx.state!.employees.employees.find(e => e.id !== builderId)!;
    bystander.x = 5;
    bystander.z = 5;
    bystander.activeActionId = null;
    bystander.destinationX = null;
    bystander.destinationZ = null;

    tickUntilConstructionDone(ctx);

    expect(ctx.state!.buildings.buildings).toHaveLength(1);
    // The footprint tile is now blocked — the bystander must have been
    // moved off it, not left sitting on now-impassable ground.
    expect(bystander.x === 5 && bystander.z === 5).toBe(false);
    const cell = ctx.state!.navGrid!.cellAt(Math.round(bystander.x), Math.round(bystander.z));
    expect(cell).not.toBeNull();
    expect(cell!.type).not.toBe('blocked');
  });
});

describe('build command — upgrade', () => {
  let ctx: MiningContext;
  beforeEach(() => {
    ctx = makeCtx();
    buildCommand(ctx, ['management_office'], { at: '2,0' });
    tickUntilConstructionDone(ctx);
  });

  it('orders an upgrade of a T1 building to T2; the building keeps its id (#1392)', () => {
    // #410: research-gated — unlock tier 2 for management_office before upgrading.
    ctx.state!.buildings.unlockedTiers['management_office'] = 2;
    equipDemolition(ctx);
    const originalId = ctx.state!.buildings.buildings[0]!.id;
    const result = buildCommand(ctx, ['upgrade', String(originalId)], {});
    expect(result.success).toBe(true);
    // Still tier 1 until the Building Destroyer has done its work.
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(1);
    tickUntilDemolished(ctx);
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(2);
    expect(ctx.state!.buildings.buildings[0]!.id).toBe(originalId);
  });

  it('deducts demolish + construction cost at order time', () => {
    ctx.state!.buildings.unlockedTiers['management_office'] = 2;
    equipDemolition(ctx);
    const b = ctx.state!.buildings.buildings[0]!;
    const cashBefore = ctx.state!.cash;
    const oldDef = getBuildingDef(b.type, b.tier);
    const newDef = getBuildingDef(b.type, 2);
    buildCommand(ctx, ['upgrade', String(b.id)], {});
    expect(ctx.state!.cash).toBe(cashBefore - (oldDef.demolishCost + newDef.constructionCost));
  });

  it('rejects upgrade of a T3 building', () => {
    // Research-gated: unlock tiers 2 and 3 so the setup upgrades (T1→T2→T3)
    // succeed, leaving only the max-tier rejection under test.
    ctx.state!.buildings.unlockedTiers['management_office'] = 3;
    // Fund the two setup upgrades (funds-guarded, #511) so only the max-tier
    // rejection is under test here, not affordability.
    ctx.state!.cash += 100000;
    equipDemolition(ctx);
    // upgrade to T2 then T3 — the id is stable across upgrades (#1392)
    const id = ctx.state!.buildings.buildings[0]!.id;
    buildCommand(ctx, ['upgrade', String(id)], {});
    tickUntilDemolished(ctx);
    buildCommand(ctx, ['upgrade', String(id)], {});
    tickUntilDemolished(ctx);
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(3);
    const result = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('T3');
  });

  it('returns error for unknown building ID on upgrade', () => {
    const result = buildCommand(ctx, ['upgrade', '9999'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('not found');
  });
});

// ── build command — research gate (#410) ──────────────────────────────────

describe('build command — research gate', () => {
  it('rejects direct T2 placement when the tier has not been researched', () => {
    const ctx = makeCtx();
    // makeCtx() pre-unlocks every tier for the other suites; re-lock here so
    // this test exercises the unresearched state it claims to.
    ctx.state!.buildings.unlockedTiers.management_office = 1;
    const result = buildCommand(ctx, ['management_office'], { at: '0,0', tier: '2' });
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/research/i);
    expect(ctx.state!.buildings.buildings).toHaveLength(0);
  });

  it('rejects upgrade past T1 when the tier has not been researched', () => {
    const ctx = makeCtx();
    ctx.state!.buildings.unlockedTiers.management_office = 1;
    buildCommand(ctx, ['management_office'], { at: '2,0' });
    tickUntilConstructionDone(ctx);
    const id = ctx.state!.buildings.buildings[0]!.id;

    const result = buildCommand(ctx, ['upgrade', String(id)], {});
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/research/i);
    expect(ctx.state!.buildings.buildings[0]!.tier).toBe(1);
  });
});

describe('build command — demolish with cost', () => {
  it('deducts demolish cost at order time and removes the building when the work completes', () => {
    const ctx = makeCtx();
    buildCommand(ctx, ['management_office'], { at: '2,0' });
    tickUntilConstructionDone(ctx);
    equipDemolition(ctx);
    const b = ctx.state!.buildings.buildings[0]!;
    const cashBefore = ctx.state!.cash;
    const def = getBuildingDef(b.type, b.tier);
    const result = buildCommand(ctx, ['destroy', String(b.id)], {});
    expect(result.success).toBe(true);
    // Cash moves at order time; the building stands until the work completes (#1392).
    expect(ctx.state!.cash).toBe(cashBefore - def.demolishCost);
    expect(ctx.state!.buildings.buildings.length).toBe(1);
    tickUntilDemolished(ctx);
    expect(ctx.state!.buildings.buildings.length).toBe(0);
  });

  it('returns error for unknown building ID on destroy', () => {
    const ctx = makeCtx();
    const result = buildCommand(ctx, ['destroy', '9999'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('not found');
  });
});

// ── build — ramp and drill-hole reservations (#1390) ──────────────────────

describe('build command — terrain reservations (#1390)', () => {
  afterEach(() => setLocale('en'));

  function setup() {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42 staffed:true').success).toBe(true);
    ctx.state!.cash += 1_000_000;
    ctx.state!.buildings.unlockedTiers.management_office = 3;
    return { runner, ctx, state: ctx.state! };
  }

  function snapshot(state: ReturnType<typeof setup>['state']) {
    return {
      cash: state.cash,
      planned: state.plannedBuildings.length,
      actions: state.pendingActions.length,
      buildings: state.buildings.buildings.length,
    };
  }

  function tickUntilBuilt(runner: ReturnType<typeof setup>['runner'], state: ReturnType<typeof setup>['state']): void {
    for (let i = 0; i < 300 && state.plannedBuildings.length > 0; i++) {
      for (const e of state.employees.employees) e.fatigue = 100;
      runner.run('tick 1');
    }
  }

  it('refuses a building ordered over a planned ramp footprint', () => {
    const { runner, state } = setup();
    expect(runner.run('build_ramp start:30,20 end:30,40 depth:8').success).toBe(true);
    const before = snapshot(state);
    const r = runner.run('build vehicle_depot at:28,19');
    expect(r.success).toBe(false);
    expect(r.output.toLowerCase()).toContain('blocks a ramp');
    expect(snapshot(state)).toEqual(before);
  });

  it('refuses management_office at 40,14 on a planned ramp', () => {
    const { runner, state } = setup();
    expect(runner.run('build_ramp start:40,8 end:40,28 depth:8').success).toBe(true);
    const fp = state.plannedRamps[0]!.footprint;
    expect(fp.minX).toBeLessThanOrEqual(40);
    expect(fp.maxX).toBeGreaterThanOrEqual(40);
    expect(fp.minZ).toBeLessThanOrEqual(14);
    expect(fp.maxZ).toBeGreaterThanOrEqual(14);
    const before = snapshot(state);
    const r = runner.run('build management_office at:40,14');
    expect(r.success).toBe(false);
    expect(r.output.toLowerCase()).toContain('blocks a ramp');
    expect(snapshot(state)).toEqual(before);
  });

  it('refuses an order that lands on a built ramp', () => {
    const { runner, state } = setup();
    state.builtRamps.push({
      id: 1, def: {} as any, width: 3, footprint: { minX: 10, maxX: 12, minZ: 10, maxZ: 20 },
    } as any);
    const before = snapshot(state);
    const r = runner.run('build management_office at:11,15');
    expect(r.success).toBe(false);
    expect(r.output.toLowerCase()).toContain('blocks a ramp');
    expect(snapshot(state)).toEqual(before);
  });

  it('refuses a building ordered on an ordered drill hole', () => {
    const { runner, state } = setup();
    expect(runner.run('drill_plan add x:20 z:40 depth:6').success).toBe(true);
    expect(state.plannedDrillHoles.length).toBe(1);
    const before = snapshot(state);
    const r = runner.run('build management_office at:20,40');
    expect(r.success).toBe(false);
    expect(r.output.toLowerCase()).toContain('blocks a drill hole');
    expect(snapshot(state)).toEqual(before);
  });

  it('accepts an order clear of the ramp and holes', () => {
    const { runner, state } = setup();
    expect(runner.run('build_ramp start:30,20 end:30,40 depth:8').success).toBe(true);
    const r = runner.run('build management_office at:10,10');
    expect(r.success).toBe(true);
    expect(state.plannedBuildings.length).toBe(1);
  });

  it('localizes the refusal in French and not as the English text', () => {
    const { runner } = setup();
    runner.run('build_ramp start:30,20 end:30,40 depth:8');
    setLocale('fr');
    const r = runner.run('build vehicle_depot at:28,19');
    expect(r.success).toBe(false);
    expect(r.output.toLowerCase()).not.toContain('blocks a ramp');
    expect(r.output).not.toContain('shell.placement.refused_ramp');
  });

  it('refuses build move onto a ramp and leaves the building where it was', () => {
    const { runner, state } = setup();
    expect(runner.run('build management_office at:10,10').success).toBe(true);
    tickUntilBuilt(runner, state);
    const b = state.buildings.buildings[0]!;
    expect(runner.run('build_ramp start:30,20 end:30,40 depth:8').success).toBe(true);
    const cash = state.cash;
    const r = runner.run(`build move ${b.id} to:30,25`);
    expect(r.success).toBe(false);
    expect(r.output.toLowerCase()).toContain('blocks a ramp');
    expect(state.buildings.buildings[0]!.x).toBe(10);
    expect(state.buildings.buildings[0]!.z).toBe(10);
    expect(state.cash).toBe(cash);
  });

  it('refuses build upgrade when the larger tier hits a ramp, keeping the old building', () => {
    const { runner, state } = setup();
    expect(runner.run('build management_office at:10,10').success).toBe(true);
    tickUntilBuilt(runner, state);
    const b = state.buildings.buildings[0]!;
    // Column x+2 and row z+2 are outside T1 (2x2) but inside T2 whichever way it extends.
    state.builtRamps.push(
      { id: 1, def: {} as any, width: 3, footprint: { minX: b.x + 2, maxX: b.x + 2, minZ: b.z, maxZ: b.z + 2 } } as any,
      { id: 2, def: {} as any, width: 3, footprint: { minX: b.x, maxX: b.x + 2, minZ: b.z + 2, maxZ: b.z + 2 } } as any,
    );
    const cash = state.cash;
    const r = runner.run(`build upgrade ${b.id}`);
    expect(r.success).toBe(false);
    expect(r.output.toLowerCase()).toContain('blocks a ramp');
    expect(state.buildings.buildings).toHaveLength(1);
    expect(state.buildings.buildings[0]!.id).toBe(b.id);
    expect(state.buildings.buildings[0]!.tier).toBe(1);
    expect(state.cash).toBe(cash);
  });
});
