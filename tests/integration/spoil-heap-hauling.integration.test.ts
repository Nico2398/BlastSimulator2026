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
import { playContracts, playTick, clearBlastZone, FORBIDDEN_COMMAND, type Run } from '../helpers/playthrough.js';
import { resolveActionCost } from '../../src/core/engine/ActionSelection.js';
import { octileHeuristic } from '../../src/core/nav/Pathfinding.js';

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
function haulSite(withHeap = true, size = 32) {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);
  expect(run(`new_game seed:42 size:${size} staffed:true`)).toMatchObject({ success: true });
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
    const each = 9000;
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

describe('rock left after an ore sale leaves the warehouse as spoil (#1690)', () => {
  const ORE_PER_FRAGMENT_KG = 0.3 * 0.5 * 2500; // volume x density x ORE_DENSITY_KG_M3 = 375
  const MASS = 900;
  const LEFTOVER_KG = MASS * 0.5; // a sale removes mass x density; the rest is barren rock

  /** Haul site whose tier-1 warehouse is filled (to within 500 kg) with ore-bearing fragments. */
  function fullWarehouseSite() {
    const site = haulSite();
    const { state } = site;
    const warehouse = state.buildings.buildings.find(b => b.type === 'freight_warehouse')!;
    refreshLogisticsCapacity(state);
    const cap = state.logistics.storageCapacityKg;
    const count = Math.floor((cap - 500) / MASS);
    for (let i = 0; i < count; i++) {
      state.logistics.fragments.push({ fragment: rich(7001 + i, 0, 0, MASS), state: 'stored', vehicleId: null, warehouseId: warehouse.id });
      state.logistics.storedMassKg += MASS;
    }
    state.collectedOre['blingite'] = (state.collectedOre['blingite'] ?? 0) + count * ORE_PER_FRAGMENT_KG;
    return { ...site, count, cap };
  }

  function sellOre(state: GameState, quantityKg: number): void {
    const ctx = { state } as unknown as Parameters<typeof contractCommand>[0];
    const pool = state.contracts;
    const c: Contract = {
      id: pool.nextId++, type: 'ore_sale', materialId: 'blingite', description: '[fixture] ore sale',
      quantityKg, deliveredKg: 0, pricePerKg: 10, deadlineTicks: 5000, acceptedAtTick: 0,
      penaltyAmount: 100, earlyBonus: 50, completed: false, expired: false,
    };
    pool.available.push(c);
    expect(contractCommand(ctx, ['accept', String(c.id)], {}).success).toBe(true);
    expect(contractCommand(ctx, ['deliver', String(c.id)], { amount: String(quantityKg) }).success).toBe(true);
  }

  it('a full warehouse blocks an ore haul as storage_full before any ore is sold (control)', () => {
    const { state } = fullWarehouseSite();
    addBlastFragments(state.logistics, [rich(9701, 5, 6, MASS)], state.navGrid);
    syncHaulDispatch(state);
    const order = state.pendingActions.find(a => a.type === 'haul_debris' && a.payload['fragmentId'] === 9701)!;
    expect(haulBlockedReason(state, order)).toBe('storage_full');
  });

  it('selling the warehouse ore frees its storage: stored mass drops to zero and the rock lands on the heap', () => {
    const { state, count } = fullWarehouseSite();
    const storedBefore = state.logistics.storedMassKg;

    sellOre(state, count * ORE_PER_FRAGMENT_KG);

    expect(state.logistics.fragments.filter(f => f.state === 'stored')).toHaveLength(0);
    expect(state.logistics.storedMassKg).toBeCloseTo(0, 3);
    expect(state.collectedOre['blingite'] ?? 0).toBeCloseTo(0, 3);
    expect(totalSpoilKg(state.buildings.buildings)).toBeCloseTo(count * LEFTOVER_KG, 3);
    expect(state.logistics.storedMassKg + totalSpoilKg(state.buildings.buildings)).toBeCloseTo(storedBefore - count * LEFTOVER_KG, 3);
    expectNoWorldInvariantViolations(state);
  });

  it('after the sale the storage_full block clears, hauling resumes and the ore reaches the warehouse', () => {
    const { run, state, vehicle, count } = fullWarehouseSite();
    addBlastFragments(state.logistics, [rich(9801, 5, 6, MASS)], state.navGrid);
    syncHaulDispatch(state);
    const order = () => state.pendingActions.find(a => a.type === 'haul_debris' && a.payload['fragmentId'] === 9801)!;
    expect(haulBlockedReason(state, order())).toBe('storage_full');

    sellOre(state, count * ORE_PER_FRAGMENT_KG);
    refreshLogisticsCapacity(state);
    expect(haulBlockedReason(state, order())).toBeNull();

    expect(run(`vehicle haul ${vehicle.id} fragment:9801`)).toMatchObject({ success: true });
    tickUntil(run, () => stateOf(state, 9801)?.state === 'stored', 1500);

    expect(stateOf(state, 9801)!.state).toBe('stored');
    expect(state.logistics.storedMassKg).toBeCloseTo(MASS, 3);
  });

  it('the heap keeps growing while the warehouse cycles: barren rock hauled after the sale adds to the released rock', () => {
    const { run, state, vehicle, count } = fullWarehouseSite();
    sellOre(state, count * ORE_PER_FRAGMENT_KG);
    const heapBefore = totalSpoilKg(state.buildings.buildings);
    addBlastFragments(state.logistics, [barren(9901, 5, 6, 700)], state.navGrid);
    syncHaulDispatch(state);

    expect(run(`vehicle haul ${vehicle.id} fragment:9901`)).toMatchObject({ success: true });
    tickUntil(run, () => stateOf(state, 9901) === undefined, 1500);

    expect(totalSpoilKg(state.buildings.buildings)).toBeCloseTo(heapBefore + 700, 3);
    expect(state.logistics.storedMassKg).toBeCloseTo(0, 3);
    expect(state.pendingActions.some(a => a.blockedReason === 'storage_full')).toBe(false);
  });

  it('a rubble_disposal contract delivered after the release draws the released rock from the heap and pays as before', () => {
    const { state, count } = fullWarehouseSite();
    sellOre(state, count * ORE_PER_FRAGMENT_KG);
    const ctx = { state } as unknown as Parameters<typeof contractCommand>[0];
    const pool = state.contracts;
    const offer: Contract = {
      id: pool.nextId++, type: 'rubble_disposal', materialId: '', description: '[fixture] rubble',
      quantityKg: 1000, deliveredKg: 0, pricePerKg: 2, deadlineTicks: 5000, acceptedAtTick: 0,
      penaltyAmount: 100, earlyBonus: 50, completed: false, expired: false,
    };
    pool.available.push(offer);
    expect(contractCommand(ctx, ['accept', String(offer.id)], {}).success).toBe(true);
    const cashBefore = state.cash;
    const heapBefore = totalSpoilKg(state.buildings.buildings);

    const r = contractCommand(ctx, ['deliver', String(offer.id)], { amount: '1000' });

    expect(r.success).toBe(true);
    expect(r.output).toContain('COMPLETED');
    expect(totalSpoilKg(state.buildings.buildings)).toBeCloseTo(heapBefore - 1000, 3);
    expect(state.logistics.storedMassKg).toBeCloseTo(0, 3);
    expect(state.cash - cashBefore).toBeGreaterThanOrEqual(2000);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Barren rock waits while an ore haul can be taken (#1870)
// ═══════════════════════════════════════════════════════════════════════════

describe('barren rock yields to ore hauls (#1870): small site', () => {
  const warehouseOf = (state: GameState) => state.buildings.buildings.find(b => b.type === 'freight_warehouse')!;

  /** Parks a stored filler in the warehouse so only `freeKg` of room is left (what a stocked warehouse is). */
  function leaveRoom(state: GameState, freeKg: number): void {
    refreshLogisticsCapacity(state);
    const filler = rich(7001, 0, 0, state.logistics.storageCapacityKg - freeKg);
    state.logistics.fragments.push({ fragment: filler, state: 'stored', vehicleId: null, warehouseId: warehouseOf(state).id });
    state.logistics.storedMassKg += filler.mass;
  }

  it('barren rock beside far ore: the ore reaches the warehouse before any barren rock reaches the heap', () => {
    const { run, state } = haulSite(true, 64);
    // Barren piles near the hauler and the depot; one ore piece far out, past what the ore bonus can bridge.
    const near = Array.from({ length: 6 }, (_, i) => barren(9801 + i, 6 + i, 6, 400));
    addBlastFragments(state.logistics, [...near, rich(9810, 56, 56, 400)], state.navGrid);
    syncHaulDispatch(state);

    tickUntil(run, () => stateOf(state, 9810)?.state === 'stored', 4000);

    expect(stateOf(state, 9810)?.state).toBe('stored');
    expect(totalSpoilKg(state.buildings.buildings)).toBe(0);
    expect(near.every(f => stateOf(state, f.id)?.state === 'on_ground')).toBe(true);
  });

  it('with the ore delivered the barren rock follows to the heap (no ore left to wait for)', () => {
    const { run, state } = haulSite(true, 64);
    const near = Array.from({ length: 3 }, (_, i) => barren(9821 + i, 6 + i, 6, 400));
    addBlastFragments(state.logistics, [...near, rich(9830, 56, 56, 400)], state.navGrid);
    syncHaulDispatch(state);

    tickUntil(run, () => near.every(f => stateOf(state, f.id) === undefined) && stateOf(state, 9830)?.state === 'stored', 8000);

    expect(stateOf(state, 9830)?.state).toBe('stored');
    expect(totalSpoilKg(state.buildings.buildings)).toBe(1200);
  });

  it('control: barren rock alone is still cleared to the heap by the driver', () => {
    const { run, state } = haulSite();
    const frags = [barren(9841, 5, 6, 500), barren(9842, 6, 6, 500)];
    addBlastFragments(state.logistics, frags, state.navGrid);
    syncHaulDispatch(state);

    tickUntil(run, () => frags.every(f => stateOf(state, f.id) === undefined), 3000);

    expect(totalSpoilKg(state.buildings.buildings)).toBe(1000);
  });

  it('control: with the warehouse full the barren rock still goes to the heap while the ore waits', () => {
    const { run, state } = haulSite(true, 64);
    leaveRoom(state, 100); // fragments weigh 400 kg: no ore fits
    const near = Array.from({ length: 3 }, (_, i) => barren(9851 + i, 6 + i, 6, 400));
    addBlastFragments(state.logistics, [...near, rich(9860, 56, 56, 400)], state.navGrid);
    syncHaulDispatch(state);
    refreshLogisticsCapacity(state);

    tickUntil(run, () => near.every(f => stateOf(state, f.id) === undefined), 6000);

    expect(totalSpoilKg(state.buildings.buildings)).toBe(1200);
    expect(stateOf(state, 9860)?.state).toBe('on_ground');
    expect(state.pendingActions.find(a => a.payload['fragmentId'] === 9860)?.blockedReason).toBe('storage_full');
  });
});

describe('barren rock yields to ore hauls (#1870): second shot beside the first', () => {
  const BUILD = 'living_quarters at:30,48 tier:1';
  const FIRST_SHOT = '36,32';
  const SECOND_SHOT = '48,32';
  /** The repro fires the second shot at t1866 of the standard opening (#1747, easy, desert_badlands seed 42). */
  const SECOND_SHOT_FIRED_AT = 1866;
  /** Drilling and charging it (~500 ticks beside the hauling) is ordered early enough to be ready by then. */
  const SECOND_SHOT_ORDERED_AT = 1100;
  const WINDOW_TICKS = 1000;
  /** The repro's first-shot-only share was 12%; with the second shot it was 36%. */
  const MAX_BARREN_SHARE = 0.15;
  const ORE_PROBES = 8;

  it('no barren trip starts while a reachable ore haul with warehouse room is open, and barren stays a small share of the tonnage', () => {
    const { runner, ctx } = createRunner();
    const run: Run = (c) => runner.run(c);
    expect(run('sandbox start biome:desert_badlands difficulty:easy seed:42')).toMatchObject({ success: true });
    run('time resume');
    const state = ctx.state!;
    const commands: string[] = [];
    const logged: Run = (c) => { commands.push(c); return run(c); };
    const startTick = state.tickCount;
    const elapsed = () => state.tickCount - startTick;

    const tracking = { on: false };
    const claimedSeen = new Set<number>();
    const carried = new Map<number, { kg: number; barren: boolean }>();
    const violations: string[] = [];
    let barrenStarts = 0;
    let oreStored = 0;
    const storedSeen = new Set<number>();

    const openOreHauls = () => {
      const byId = new Map(state.logistics.fragments.map(t => [t.fragment.id, t]));
      return state.pendingActions.filter(a => {
        if (a.type !== 'haul_debris' || a.status !== 'queued' || a.holderId !== null || a.blockedReason != null) return false;
        const t = byId.get(a.payload['fragmentId'] as number);
        return t !== undefined && t.state === 'on_ground' && !isBarrenFragment(t.fragment.oreDensities) && haulBlockedReason(state, a) === null;
      });
    };
    /** Idle debris haulers' reachable open ore hauls as of the last tick's end: what each driver's next choice could have been. */
    const takeableOre = new Map<number, number>();
    const sampleTakeableOre = () => {
      takeableOre.clear();
      if (!tracking.on) return;
      const ore = openOreHauls();
      if (ore.length === 0) return;
      for (const e of state.employees.employees) {
        if (e.activeActionId !== null || !state.vehicles.vehicles.some(v => v.type === 'debris_hauler' && vehicleDriverId(v) === e.id)) continue;
        const probe = [...ore]
          .sort((x, y) => octileHeuristic(e.x, e.z, x.targetX, x.targetZ) - octileHeuristic(e.x, e.z, y.targetX, y.targetZ))
          .slice(0, ORE_PROBES)
          .find(o => resolveActionCost(state, e, o) !== null);
        if (probe !== undefined) takeableOre.set(e.id, probe.id);
      }
    };
    const observe = () => {
      if (!tracking.on) return;
      const byId = new Map(state.logistics.fragments.map(t => [t.fragment.id, t]));
      for (const t of state.logistics.fragments) {
        if (t.state === 'in_transit' && !carried.has(t.fragment.id)) carried.set(t.fragment.id, { kg: t.fragment.mass, barren: isBarrenFragment(t.fragment.oreDensities) });
        if (t.state === 'stored' && !storedSeen.has(t.fragment.id) && !isBarrenFragment(t.fragment.oreDensities)) {
          storedSeen.add(t.fragment.id);
          oreStored += t.fragment.mass;
        }
      }
      for (const a of state.pendingActions) {
        if (a.type !== 'haul_debris' || a.holderId === null || claimedSeen.has(a.id)) continue;
        claimedSeen.add(a.id);
        const t = byId.get(a.payload['fragmentId'] as number);
        if (t === undefined || t.state !== 'on_ground' || !isBarrenFragment(t.fragment.oreDensities)) continue;
        barrenStarts++;
        const ore = takeableOre.get(a.holderId);
        if (ore !== undefined) violations.push(`t+${elapsed()}: barren haul ${a.id} claimed by ${a.holderId} while ore haul ${ore} was open and reachable`);
      }
    };
    const step = () => { playContracts(logged, state); sampleTakeableOre(); playTick(logged, state); observe(); };
    const playUntil = (max: number, done: () => boolean) => { for (let i = 0; i < max && !state.levelEnded && !done(); i++) step(); };

    // The #1747 standard opening: quarters, one 3x3 Krackle 8 kg shot on the deposit.
    expect(logged(`build ${BUILD}`).success).toBe(true);
    expect(logged(`drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:${FIRST_SHOT}`).success).toBe(true);
    playUntil(800, () => state.plannedDrillHoles.length === 0);
    logged('charge hole:* explosive:krackle amount:8 stemming:2');
    playUntil(800, () => Object.keys(state.plannedChargesByHole).length === 0);
    clearBlastZone(logged, state);
    expect(logged('blast').success).toBe(true);

    // The second 3x3 shot beside the first crater, ordered at t1866 of the opening.
    playUntil(SECOND_SHOT_ORDERED_AT, () => elapsed() >= SECOND_SHOT_ORDERED_AT);
    expect(logged(`drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:${SECOND_SHOT}`).success).toBe(true);
    playUntil(1200, () => state.plannedDrillHoles.length === 0);
    logged('charge hole:* explosive:krackle amount:8 stemming:2');
    playUntil(1200, () => Object.keys(state.plannedChargesByHole).length === 0);
    playUntil(SECOND_SHOT_FIRED_AT, () => elapsed() >= SECOND_SHOT_FIRED_AT);
    clearBlastZone(logged, state);
    expect(logged('blast').success).toBe(true);
    expect(state.levelEnded, `ended ${String(state.levelEndReason)}`).toBe(false);

    tracking.on = true;
    const windowStart = elapsed();
    playUntil(WINDOW_TICKS, () => elapsed() - windowStart >= WINDOW_TICKS);

    const kg = (barren: boolean) => [...carried.values()].filter(c => c.barren === barren).reduce((sum, c) => sum + c.kg, 0);
    const total = kg(true) + kg(false);
    expect(violations).toEqual([]);
    expect(oreStored, 'ore keeps arriving at the warehouse in the window').toBeGreaterThan(0);
    expect(kg(false), 'ore tonnage the hauler carried in the window').toBeGreaterThan(0);
    expect(kg(true) / total, `barren ${Math.round(kg(true))} kg of ${Math.round(total)} kg carried (${barrenStarts} barren trips)`).toBeLessThanOrEqual(MAX_BARREN_SHARE);
    expect(commands.filter(c => FORBIDDEN_COMMAND.test(c))).toEqual([]);
    expectNoWorldInvariantViolations(state);
  }, 900_000);
});
