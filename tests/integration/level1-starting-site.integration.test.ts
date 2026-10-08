// BlastSimulator2026 — Integration: Dusty Hollow opens staffed and equipped (#1363)
// `campaign start level:dusty_hollow` gives the crew, fleet and warehouse the
// level declares; `staffed:false` a bare site; `staffed:true` the global
// composition. Other levels and the tutorial are unchanged.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { recordProfit } from '../../src/core/campaign/Campaign.js';
import { getLevel } from '../../src/core/campaign/Level.js';
import { STARTING_SITE_STAFFED_COMPOSITION } from '../../src/core/config/balance.js';
import { FREIGHT_WAREHOUSE_CAPACITY_KG } from '../../src/core/config/balance.js';
import { getStorageCapacity } from '../../src/core/entities/Building.js';

function startLevel(levelId: string, args = '') {
  const { runner, ctx } = createRunner();
  recordProfit(ctx.campaignProfile.campaign, 'tutorial_pit', 5000);
  recordProfit(ctx.campaignProfile.campaign, 'dusty_hollow', 80000);
  const result = runner.run(`campaign start level:${levelId}${args ? ` ${args}` : ''}`);
  expect(result.success, result.output).toBe(true);
  return { runner, ctx, state: ctx.state! };
}

describe('campaign start level:dusty_hollow (default) opens staffed (#1363)', () => {
  it('has a driller, a blaster and a driver', () => {
    const { state } = startLevel('dusty_hollow');
    expect(state.employees.employees.map((e) => e.role).sort()).toEqual(['blaster', 'driller', 'driver']);
  });

  it('has a drill rig and a debris hauler', () => {
    const { state } = startLevel('dusty_hollow');
    expect(state.vehicles.vehicles.map((v) => v.type).sort()).toEqual(['debris_hauler', 'drill_rig']);
  });

  it('has one active freight warehouse with its tier-1 storage capacity', () => {
    const { state } = startLevel('dusty_hollow');
    const warehouses = state.buildings.buildings.filter((b) => b.type === 'freight_warehouse');
    expect(warehouses).toHaveLength(1);
    expect(warehouses[0]!.active).toBe(true);
    expect(warehouses[0]!.tier).toBe(1);
    expect(state.logistics.storageCapacityKg).toBeGreaterThanOrEqual(FREIGHT_WAREHOUSE_CAPACITY_KG[1]);
    expect(getStorageCapacity(state.buildings)).toBeGreaterThanOrEqual(FREIGHT_WAREHOUSE_CAPACITY_KG[1]);
  });

  it('keeps the level start cash: crew, fleet and warehouse are free', () => {
    const { state } = startLevel('dusty_hollow');
    expect(state.cash).toBe(getLevel('dusty_hollow')!.startingCash);
    expect(state.finances.cash).toBe(getLevel('dusty_hollow')!.startingCash);
    expect(state.finances.transactions).toHaveLength(0);
  });

  it('places the warehouse on the real grid, inside it', () => {
    const { ctx, state } = startLevel('dusty_hollow');
    const b = state.buildings.buildings[0]!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.z).toBeGreaterThanOrEqual(0);
    expect(b.x).toBeLessThan(ctx.grid!.sizeX);
    expect(b.z).toBeLessThan(ctx.grid!.sizeZ);
  });

  it('the crew can work immediately: the first drill_plan is claimed and drilled without any hire or purchase', () => {
    const { runner, state } = startLevel('dusty_hollow');
    const rig = state.vehicles.vehicles.find((v) => v.type === 'drill_rig')!;
    const plan = runner.run(
      `drill_plan grid rows:2 cols:2 spacing:4 depth:6 start:${Math.round(rig.x) + 6},${Math.round(rig.z) + 6}`,
    );
    expect(plan.success, plan.output).toBe(true);
    for (let i = 0; i < 400 && state.drillHoles.length === 0; i++) runner.run('tick 1');
    expect(state.drillHoles.length).toBeGreaterThan(0);
  });
});

describe('campaign start level:dusty_hollow staffed flag (#1363)', () => {
  it('staffed:false gives a bare site: no crew, fleet or buildings', () => {
    const { state } = startLevel('dusty_hollow', 'staffed:false');
    expect(state.employees.employees).toHaveLength(0);
    expect(state.vehicles.vehicles).toHaveLength(0);
    expect(state.buildings.buildings).toHaveLength(0);
    expect(state.logistics.storageCapacityKg).toBe(0);
    expect(state.cash).toBe(getLevel('dusty_hollow')!.startingCash);
  });

  it('staffed:true gives the global staffed composition, not the level one', () => {
    const { state } = startLevel('dusty_hollow', 'staffed:true');
    expect(state.employees.employees).toHaveLength(STARTING_SITE_STAFFED_COMPOSITION.employees.length);
    expect(state.vehicles.vehicles).toHaveLength(STARTING_SITE_STAFFED_COMPOSITION.vehicles.length);
    expect(state.buildings.buildings).toHaveLength(0);
  });
});

describe('other levels and the tutorial are unchanged (#1363)', () => {
  it('tutorial_pit opens bare', () => {
    const { state } = startLevel('tutorial_pit');
    expect(state.employees.employees).toHaveLength(0);
    expect(state.vehicles.vehicles).toHaveLength(0);
    expect(state.buildings.buildings).toHaveLength(0);
  });

  it('grumpstone_ridge opens bare', () => {
    const { state } = startLevel('grumpstone_ridge');
    expect(state.employees.employees).toHaveLength(0);
    expect(state.vehicles.vehicles).toHaveLength(0);
    expect(state.buildings.buildings).toHaveLength(0);
  });

  it('a level restart re-opens dusty_hollow staffed again, one warehouse, not two', () => {
    const { runner, ctx } = startLevel('dusty_hollow');
    expect(runner.run('campaign start level:dusty_hollow').success).toBe(true);
    expect(ctx.state!.buildings.buildings).toHaveLength(1);
    expect(ctx.state!.employees.employees).toHaveLength(3);
  });
});
