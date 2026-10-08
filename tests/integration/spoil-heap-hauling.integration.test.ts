// BlastSimulator2026 — Integration tests: spoil heap (#1530).
//
// Barren rock (ore fraction <= SPOIL_BARREN_ORE_FRACTION_THRESHOLD) is hauled
// to the nearest spoil heap and accumulates in heap.storedSpoilKg; it never
// touches freight storage or collectedOre. Ore-bearing rock still goes to a
// freight warehouse. A spoil heap takes no crew: `build spoil_heap` charges
// and places it at once. Rubble contracts draw on heap mass first.
//
// Drives the real console layer (createRunner / contractCommand): no DOM.
//
// Red phase: spoilHeapSites and the barren routing are stubs, so every test
// that hauls to, fills or places a heap fails until #1530 is implemented.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { contractCommand } from '../../src/console/commands/economy.js';
import type { GameState } from '../../src/core/state/GameState.js';
import type { FragmentData } from '../../src/core/mining/BlastExecution.js';
import type { Contract } from '../../src/core/economy/Contract.js';
import { addBlastFragments } from '../../src/core/economy/Logistics.js';
import { syncHaulDispatch, haulBlockedReason } from '../../src/core/economy/HaulDispatch.js';
import { isBarrenFragment, totalSpoilKg } from '../../src/core/economy/SpoilHeaps.js';
import { vehicleDriverId } from '../../src/core/entities/Vehicle.js';
import { placeBuilding, getBuildingDef } from '../../src/core/entities/Building.js';
import { refreshLogisticsCapacity } from '../../src/core/engine/BuildingTaskHelpers.js';
import { upgradeFreightWarehousesToTier3, addFreightWarehouseToState, ensureFreightWarehouse } from '../helpers/freightWarehouse.js';
import { makeGameContext } from '../helpers/gameContext.js';
import { drillChargeAndBlast, tickUntilFresh } from '../helpers/blastFixtures.js';
import { expectNoWorldInvariantViolations } from '../helpers/worldInvariants.js';
import { tickUntil } from './helpers.js';

const HEAP_COST = 2000;

function makeFragment(id: number, x: number, z: number, mass: number, oreDensities: Record<string, number>): FragmentData {
  return {
    id, position: { x, y: 0, z }, volume: 0.3, mass, rockId: 'cruite', oreDensities,
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, shapeSeed: 1, origin: { x, y: 0, z },
  };
}
const barren = (id: number, x: number, z: number, mass = 900) => makeFragment(id, x, z, mass, {});
const rich = (id: number, x: number, z: number, mass = 900) => makeFragment(id, x, z, mass, { blingite: 0.5 });

const heaps = (state: GameState) => state.buildings.buildings.filter(b => b.type === 'spoil_heap');
const stateOf = (state: GameState, id: number) => state.logistics.fragments.find(t => t.fragment.id === id);

/** Staffed 32x32 site with an active freight warehouse, a spoil heap and a crewed hauler. */
function haulSite(withHeap = true) {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);
  expect(run('new_game seed:42 size:32 staffed:true')).toMatchObject({ success: true });
  const state = ctx.state!;
  expect(run('build freight_warehouse at:4,18')).toMatchObject({ success: true });
  tickUntil(run, () => state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.active), 300);
  if (withHeap) {
    expect(run('build spoil_heap at:10,18')).toMatchObject({ success: true });
  }
  const vehicle = state.vehicles.vehicles.find(v => v.type === 'debris_hauler')!;
  const driver = state.employees.employees.find(e => e.qualifications.some(q => q.category === 'driving.truck'))!;
  expect(run(`vehicle driver ${vehicle.id} ${driver.id}`)).toMatchObject({ success: true });
  tickUntil(run, () => vehicleDriverId(vehicle) === driver.id, 50);
  return { run, state, vehicle };
}

describe('crewless spoil heap placement (#1530)', () => {
  function bare(cash = 50_000) {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    expect(run(`new_game seed:42 size:32 cash:${cash}`)).toMatchObject({ success: true });
    return { run, state: ctx.state! };
  }

  it('places immediately with an empty roster: building exists, no planned site, no place_building action', () => {
    const { run, state } = bare();
    expect(state.employees.employees).toHaveLength(0);
    expect(run('build spoil_heap at:10,10')).toMatchObject({ success: true });
    expect(heaps(state)).toHaveLength(1);
    expect(heaps(state)[0]!.active).toBe(true);
    expect(state.plannedBuildings).toHaveLength(0);
    expect(state.pendingActions.some(a => a.type === 'place_building')).toBe(false);
  });

  it('charges the construction cost in cash', () => {
    const { run, state } = bare(50_000);
    run('build spoil_heap at:10,10');
    expect(state.cash).toBe(50_000 - HEAP_COST);
  });

  it('a freight warehouse in the same state still queues crewed construction (control)', () => {
    const { run, state } = bare();
    expect(run('build freight_warehouse at:4,18')).toMatchObject({ success: true });
    expect(state.plannedBuildings).toHaveLength(1);
    expect(state.buildings.buildings.some(b => b.type === 'freight_warehouse')).toBe(false);
  });

  it('refuses on insufficient funds and places nothing', () => {
    const { run, state } = bare(HEAP_COST - 1);
    const r = run('build spoil_heap at:10,10') as { success: boolean };
    expect(r.success).toBe(false);
    expect(heaps(state)).toHaveLength(0);
    expect(state.cash).toBe(HEAP_COST - 1);
  });

  it('accepts exactly the construction cost (boundary)', () => {
    const { run, state } = bare(HEAP_COST);
    expect(run('build spoil_heap at:10,10')).toMatchObject({ success: true });
    expect(state.cash).toBe(0);
  });

  it('refuses a blocked footprint and charges nothing', () => {
    const { run, state } = bare();
    expect(run('build spoil_heap at:10,10')).toMatchObject({ success: true });
    const cashAfterFirst = state.cash;
    const r = run('build spoil_heap at:10,10') as { success: boolean };
    expect(r.success).toBe(false);
    expect(heaps(state)).toHaveLength(1);
    expect(state.cash).toBe(cashAfterFirst);
  });

  it('a placed heap starts empty', () => {
    const { run, state } = bare();
    run('build spoil_heap at:10,10');
    expect(totalSpoilKg(state.buildings.buildings)).toBe(0);
  });
});

describe('hauling barren rock to a spoil heap (#1530)', () => {
  it('a barren fragment is hauled to the heap: heap grows, logistics and collectedOre untouched, fragment removed', () => {
    const { run, state, vehicle } = haulSite();
    addBlastFragments(state.logistics, [barren(9001, 5, 6, 900)], state.navGrid);
    syncHaulDispatch(state);
    const storedBefore = state.logistics.storedMassKg;
    const oreBefore = { ...state.collectedOre };

    expect(run(`vehicle haul ${vehicle.id} fragment:9001`)).toMatchObject({ success: true });
    tickUntil(run, () => stateOf(state, 9001) === undefined, 1500);

    expect(stateOf(state, 9001)).toBeUndefined();
    expect(totalSpoilKg(state.buildings.buildings)).toBe(900);
    expect(heaps(state)[0]!.storedSpoilKg).toBe(900);
    expect(state.logistics.storedMassKg).toBe(storedBefore);
    expect(state.collectedOre).toEqual(oreBefore);
    expect(vehicle.cargo).toEqual([]);
  });

  it('an ore fragment still goes to the warehouse and leaves the heap empty', () => {
    const { run, state, vehicle } = haulSite();
    addBlastFragments(state.logistics, [rich(9101, 5, 6, 900)], state.navGrid);
    syncHaulDispatch(state);
    const storedBefore = state.logistics.storedMassKg;

    expect(run(`vehicle haul ${vehicle.id} fragment:9101`)).toMatchObject({ success: true });
    tickUntil(run, () => stateOf(state, 9101)?.state === 'stored', 1500);

    expect(stateOf(state, 9101)!.state).toBe('stored');
    expect(state.logistics.storedMassKg).toBe(storedBefore + 900);
    expect(state.collectedOre['blingite']).toBeGreaterThan(0);
    expect(totalSpoilKg(state.buildings.buildings)).toBe(0);
  });

  it('a heap trip is not limited by free warehouse room: barren rock beyond the tier-1 warehouse capacity dumps at the heap', () => {
    const { run, state, vehicle } = haulSite();
    const cap = getBuildingDef('freight_warehouse', 1).capacity;
    const each = 900;
    const count = Math.ceil((cap + 1) / each) + 1;
    const frags = Array.from({ length: count }, (_, i) => barren(9201 + i, 5 + (i % 10), 6 + Math.floor(i / 10), each));
    expect(count * each).toBeGreaterThan(cap);
    addBlastFragments(state.logistics, frags, state.navGrid);
    syncHaulDispatch(state);

    expect(run(`vehicle haul ${vehicle.id} fragment:9201`)).toMatchObject({ success: true });
    tickUntil(run, () => frags.every(f => stateOf(state, f.id) === undefined), 6000);

    expect(frags.map(f => stateOf(state, f.id))).toEqual(frags.map(() => undefined));
    expect(totalSpoilKg(state.buildings.buildings)).toBe(count * each);
    expect(state.logistics.storedMassKg).toBe(0);
  });

  it('a trip never mixes barren and ore fragments in one cargo', () => {
    const { run, state, vehicle } = haulSite();
    const frags = [barren(9301, 5, 6, 300), rich(9302, 6, 6, 300), barren(9303, 7, 6, 300), rich(9304, 8, 6, 300)];
    addBlastFragments(state.logistics, frags, state.navGrid);
    syncHaulDispatch(state);
    const barrenIds = new Set([9301, 9303]);
    let mixed = 0;

    expect(run(`vehicle haul ${vehicle.id} fragment:9301`)).toMatchObject({ success: true });
    tickUntil(run, () => {
      const kinds = new Set(vehicle.cargo.map(c => barrenIds.has(c.fragmentId)));
      if (kinds.size > 1) mixed++;
      return stateOf(state, 9301) === undefined && stateOf(state, 9303) === undefined;
    }, 1500);

    expect(mixed).toBe(0);
    expect(totalSpoilKg(state.buildings.buildings)).toBe(600);
  });

  it('with two heaps the nearest one receives the rock', () => {
    const { run, state, vehicle } = haulSite();
    expect(run('build spoil_heap at:24,24')).toMatchObject({ success: true });
    const [near, far] = [heaps(state).find(h => h.x === 10)!, heaps(state).find(h => h.x === 24)!];
    addBlastFragments(state.logistics, [barren(9401, 5, 6, 500)], state.navGrid);
    syncHaulDispatch(state);

    expect(run(`vehicle haul ${vehicle.id} fragment:9401`)).toMatchObject({ success: true });
    tickUntil(run, () => stateOf(state, 9401) === undefined, 1500);

    expect(near.storedSpoilKg ?? 0).toBe(500);
    expect(far.storedSpoilKg ?? 0).toBe(0);
  });
});

describe('no spoil heap placed (#1530)', () => {
  it('barren haul_debris is blocked no_spoil_heap, never storage_full; ore is not blocked', () => {
    const { state } = haulSite(false);
    addBlastFragments(state.logistics, [barren(9501, 5, 6), rich(9502, 6, 6)], state.navGrid);
    syncHaulDispatch(state);
    refreshLogisticsCapacity(state);
    const orderFor = (id: number) => state.pendingActions.find(a => a.type === 'haul_debris' && a.payload['fragmentId'] === id)!;
    expect(haulBlockedReason(state, orderFor(9501))).toBe('no_spoil_heap');
    expect(haulBlockedReason(state, orderFor(9502))).toBeNull();
  });

  it('after ticking, the barren order carries blockedReason no_spoil_heap', () => {
    const { run, state } = haulSite(false);
    addBlastFragments(state.logistics, [barren(9601, 5, 6)], state.navGrid);
    syncHaulDispatch(state);
    run('tick 5');
    const action = state.pendingActions.find(a => a.type === 'haul_debris' && a.payload['fragmentId'] === 9601);
    expect(action?.blockedReason).toBe('no_spoil_heap');
  });
});

describe('rubble_disposal contracts draw on heap mass (#1530)', () => {
  function rubbleOffer(ctx: ReturnType<typeof makeGameContext>, quantityKg: number): Contract {
    const pool = ctx.state!.contracts;
    const c: Contract = {
      id: pool.nextId++, type: 'rubble_disposal', materialId: '', description: `[fixture] ${quantityKg} kg rubble`,
      quantityKg, deliveredKg: 0, pricePerKg: 2, deadlineTicks: 500, acceptedAtTick: 0,
      penaltyAmount: 100, earlyBonus: 50, completed: false, expired: false,
    };
    pool.available.push(c);
    return c;
  }

  function site(heapKg: number, warehouseKg: number) {
    const ctx = makeGameContext({ mineType: 'desert', seed: '42', size: '32' });
    const state = ctx.state!;
    state.contracts.available = [];
    ensureFreightWarehouse(ctx);
    const heap = placeBuilding(state.buildings, 'spoil_heap', 40, 40, 200, 200);
    if (!heap.success || !heap.building) throw new Error('fixture heap refused');
    heap.building.storedSpoilKg = heapKg;
    if (warehouseKg > 0) {
      const id = state.buildings.buildings.find(b => b.type === 'freight_warehouse')!.id;
      state.logistics.fragments.push({ fragment: barren(7000, 0, 0, warehouseKg), state: 'stored', vehicleId: null, warehouseId: id });
      state.logistics.storedMassKg += warehouseKg;
    }
    return { ctx, state, heapBuilding: heap.building };
  }

  it('an offer larger than the warehouse stock alone but covered by heap + warehouse is fillable', () => {
    const { ctx } = site(300, 100);
    rubbleOffer(ctx, 350);
    const r = contractCommand(ctx, ['accept'], { type: 'rubble_disposal', fillable: 'true' });
    expect(r.success).toBe(true);
  });

  it('an offer larger than heap + warehouse is not fillable', () => {
    const { ctx } = site(300, 100);
    rubbleOffer(ctx, 450);
    const r = contractCommand(ctx, ['accept'], { type: 'rubble_disposal', fillable: 'true' });
    expect(r.success).toBe(false);
  });

  it('a heap-only site (empty warehouse) can fill a rubble offer', () => {
    const { ctx } = site(500, 0);
    rubbleOffer(ctx, 400);
    expect(contractCommand(ctx, ['accept'], { type: 'rubble_disposal', fillable: 'true' }).success).toBe(true);
  });

  it('delivery takes heap mass first, then the warehouse', () => {
    const { ctx, state, heapBuilding } = site(300, 100);
    const offer = rubbleOffer(ctx, 350);
    expect(contractCommand(ctx, ['accept', String(offer.id)], {}).success).toBe(true);
    const storedBefore = state.logistics.storedMassKg;

    const r = contractCommand(ctx, ['deliver', String(offer.id)], { amount: '350' });

    expect(r.success).toBe(true);
    expect(r.output).toContain('COMPLETED');
    expect(heapBuilding.storedSpoilKg ?? 0).toBe(0);
    expect(storedBefore - state.logistics.storedMassKg).toBeCloseTo(50, 3);
  });

  it('a delivery smaller than the heap leaves the warehouse untouched', () => {
    const { ctx, state, heapBuilding } = site(300, 100);
    const offer = rubbleOffer(ctx, 200);
    expect(contractCommand(ctx, ['accept', String(offer.id)], {}).success).toBe(true);
    const storedBefore = state.logistics.storedMassKg;

    expect(contractCommand(ctx, ['deliver', String(offer.id)], { amount: '200' }).success).toBe(true);

    expect(heapBuilding.storedSpoilKg).toBe(100);
    expect(state.logistics.storedMassKg).toBe(storedBefore);
  });

  it('an ore_sale delivery never draws on the heap', () => {
    const { ctx, state, heapBuilding } = site(300, 0);
    const pool = state.contracts;
    pool.available.push({
      id: pool.nextId++, type: 'ore_sale', materialId: 'blingite', description: '[fixture] ore',
      quantityKg: 100, deliveredKg: 0, pricePerKg: 10, deadlineTicks: 500, acceptedAtTick: 0,
      penaltyAmount: 100, earlyBonus: 50, completed: false, expired: false,
    });
    const r = contractCommand(ctx, ['accept'], { type: 'ore_sale', fillable: 'true' });
    expect(r.success).toBe(false);
    expect(heapBuilding.storedSpoilKg).toBe(300);
  });
});

describe('seeded blast with a heap and a warehouse (#1530)', () => {
  it('warehouse mass equals the ore-bearing delivered fragments; heap mass equals the barren delivered fragments', () => {
    const { run, state } = drillChargeAndBlast(18, 10, 3, 5_000_000);
    const initial = new Map(state.logistics.fragments.map(f => [f.fragment.id, f.fragment]));
    expect([...initial.values()].some(f => isBarrenFragment(f.oreDensities))).toBe(true);
    expect([...initial.values()].some(f => !isBarrenFragment(f.oreDensities))).toBe(true);

    addFreightWarehouseToState(state, 1, 8);
    upgradeFreightWarehousesToTier3(state, 75_000);
    expect(run('build spoil_heap at:1,4')).toMatchObject({ success: true });

    // Crew: one debris_hauler (oversized rock stays put: no fragmenter, so no child fragments).
    expect(run('employee hire role:driver')).toMatchObject({ success: true });
    const haulDriver = [...state.employees.employees].reverse().find(e => e.role === 'driver')!;
    expect(run('vehicle buy debris_hauler')).toMatchObject({ success: true });
    const hauler = state.vehicles.vehicles.find(v => v.type === 'debris_hauler')!;
    expect(run(`vehicle driver ${hauler.id} ${haulDriver.id}`)).toMatchObject({ success: true });

    tickUntilFresh(run, state, () => {
      const unfinished = state.pendingActions.filter(a => a.type === 'haul_debris' && a.blockedReason !== 'debris_out_of_reach');
      const moving = state.logistics.fragments.some(f => f.state === 'in_transit');
      return totalSpoilKg(state.buildings.buildings) > 0 && state.logistics.storedMassKg > 0 && unfinished.length === 0 && !moving;
    }, 3000);

    const stored = state.logistics.fragments.filter(f => f.state === 'stored');
    const storedMass = stored.reduce((sum, f) => sum + f.fragment.mass, 0);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every(f => !isBarrenFragment(f.fragment.oreDensities))).toBe(true);
    expect(state.logistics.storedMassKg).toBeCloseTo(storedMass, 3);

    const onGroundIds = new Set(state.logistics.fragments.map(f => f.fragment.id));
    let deliveredBarrenKg = 0;
    for (const [id, f] of initial) {
      if (isBarrenFragment(f.oreDensities) && !onGroundIds.has(id)) deliveredBarrenKg += f.mass;
    }
    expect(deliveredBarrenKg).toBeGreaterThan(0);
    expect(totalSpoilKg(state.buildings.buildings)).toBeCloseTo(deliveredBarrenKg, 3);
    expectNoWorldInvariantViolations(state);
  });
});
