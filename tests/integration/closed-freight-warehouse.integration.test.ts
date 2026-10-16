// BlastSimulator2026 — Integration tests: closed freight warehouse keeps its stock (#1813).
//
// A warehouse closed by an out_of_service modifier is still standing: other
// building changes (a spoil heap, a move) must not wipe its stock, pooled
// capacity drops to 0 while it is closed and returns when the closure lapses.
// Only demolition destroys stock.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { addModifier } from '../../src/core/events/ActiveModifiers.js';
import { completeDemolition } from '../../src/core/engine/BuildingDemolition.js';
import { getBuildingDef } from '../../src/core/entities/Building.js';
import { addFreightWarehouseToState, stockWarehouse, storedFragment } from '../helpers/freightWarehouse.js';
import { mod } from '../helpers/eventEffectWorld.js';

const MASS = 5000;
const ORE_KG = 1500;

/** Site with a tier-1 warehouse holding 5000 kg, closed for 50 ticks from tick 0. */
function closedSite() {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);
  expect(run('new_game seed:42 size:48 cash:500000')).toMatchObject({ success: true });
  const state = ctx.state!;
  const id = addFreightWarehouseToState(state, 20, 20, 1);
  stockWarehouse(state, id, storedFragment(1, MASS, { iron: ORE_KG / MASS }));
  addModifier(
    state.events.activeModifiers,
    mod({ kind: 'out_of_service', targetId: id, targetKind: 'building', startTick: 0, endTick: state.tickCount + 50 }),
    state.events.nextModifierId++,
  );
  return { run, state, ctx, id };
}

const storedKg = (s: ReturnType<typeof closedSite>['state'], id: number) =>
  s.logistics.fragments.filter(f => f.state === 'stored' && f.warehouseId === id).reduce((n, f) => n + f.fragment.mass, 0);

describe('closed freight warehouse keeps stock (#1813)', () => {
  it('closure flag is set after one tick', () => {
    const { run, state, id } = closedSite();
    run('tick 1');
    expect(state.buildings.buildings.find(b => b.id === id)!.outOfService).toBe(true);
  });

  it('building a spoil heap while the warehouse is closed leaves its stock intact', () => {
    const { run, state, id } = closedSite();
    run('tick 1');
    expect(run('build spoil_heap at:5,5')).toMatchObject({ success: true });
    expect(storedKg(state, id)).toBe(MASS);
    expect(state.logistics.storedMassKg).toBe(MASS);
    expect(state.collectedOre.iron).toBe(ORE_KG);
  });

  it('moving the closed warehouse keeps its stock', () => {
    const { run, state, id } = closedSite();
    run('tick 1');
    const moved = run(`build move ${id} to:24,24`);
    expect(moved, JSON.stringify(moved)).toMatchObject({ success: true });
    expect(storedKg(state, id)).toBe(MASS);
    expect(state.logistics.storedMassKg).toBe(MASS);
    expect(state.collectedOre.iron).toBe(ORE_KG);
  });

  it('pooled capacity drops to 0 on the tick closure starts, with no other building change', () => {
    const { run, state } = closedSite();
    expect(state.logistics.storageCapacityKg).toBe(getBuildingDef('freight_warehouse', 1).capacity);
    run('tick 1');
    expect(state.logistics.storageCapacityKg).toBe(0);
    expect(state.logistics.storedMassKg).toBe(MASS);
  });

  it('capacity returns to 25000 once the closure lapses, stock intact', () => {
    const { run, state, id } = closedSite();
    run('tick 1');
    run('tick 59');
    expect(state.tickCount).toBe(60);
    expect(state.buildings.buildings.find(b => b.id === id)!.outOfService).toBeFalsy();
    expect(state.logistics.storageCapacityKg).toBe(25000);
    expect(storedKg(state, id)).toBe(MASS);
    expect(state.collectedOre.iron).toBe(ORE_KG);
  });

  it('demolishing the stocked warehouse still loses the stock and emits warehouse_stock_lost', () => {
    const { run, state, ctx, id } = closedSite();
    run('tick 1');
    const events: Array<{ buildingId: number; massKg: number }> = [];
    ctx.emitter.on('logistics:warehouse_stock_lost', e => events.push(e as { buildingId: number; massKg: number }));
    completeDemolition(state, null, ctx.emitter, {
      buildingId: id, cost: 0, durationTicks: 1, footprint: [], rebuildOrderId: null,
    });
    expect(events).toEqual([expect.objectContaining({ buildingId: id, massKg: MASS })]);
    expect(state.logistics.fragments).toHaveLength(0);
    expect(state.logistics.storedMassKg).toBe(0);
    expect(state.collectedOre.iron ?? 0).toBe(0);
  });
});
