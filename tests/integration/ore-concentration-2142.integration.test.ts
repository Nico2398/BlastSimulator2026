// BlastSimulator2026 — Integration: a warehouse keeps ore, not the rock around it (#2142).
//
// A hauler unloads an ore-bearing fragment whole, so a tier-1 freight warehouse filled with 25 t of
// rock holding well under 1 t of ore and every later haul stalled on `storage_full`, while the spoil
// heap (50 t) filled up behind it. Unloading now concentrates the fragment: the warehouse keeps the
// ore's mass and the barren remainder is credited to a spoil heap with room for all of it.
//
//   C1/C2  applyHaulUnload concentrates with a heap that has room, and leaves the fragment whole without one
//   C5     the menu-default sandbox opening (desert_badlands, Digger kit, seed 12345) keeps hauling

import { describe, it, expect, beforeAll } from 'vitest';
import { setFreightRoom } from '../helpers/freightWarehouse.js';
import { createRunner } from '../../src/console/createRunner.js';
import { createGame } from '../../src/core/state/GameState.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { purchaseVehicle, type Vehicle } from '../../src/core/entities/Vehicle.js';
import { hireEmployee, assignSkill } from '../../src/core/entities/Employee.js';
import { placeBuilding, getBuildingDef } from '../../src/core/entities/Building.js';
import { Random } from '../../src/core/math/Random.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { applyHaulUnload } from '../../src/core/engine/ArrivalEffects.js';
import { addBlastFragments, consumeStoredOre } from '../../src/core/economy/Logistics.js';
import { totalSpoilKg } from '../../src/core/economy/SpoilHeaps.js';
import type { FragmentData } from '../../src/core/mining/BlastExecution.js';
import { oreContributionKg } from '../../src/core/mining/BlastOreReport.js';
import { assertWorldInvariants } from '../../src/core/state/WorldInvariants.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import {
  EXPLOSIVE_DELIVERY_TICKS, FREIGHT_WAREHOUSE_CAPACITY_KG, SANDBOX_FLAT_PAD_SIZE, SPOIL_HEAP_CAPACITY_KG,
} from '../../src/core/config/balance.js';
import { fundForDeliveryWait, clearBlastZone, playTick } from '../helpers/playthrough.js';

const SEED = 42;
const ORE_DENSITY_KG_M3 = 2500;

// ── C1 / C2: applyHaulUnload ────────────────────────────────────────────────

function fragmentOf(id: number, mass: number, oreDensities: Record<string, number>): FragmentData {
  return {
    id,
    position: { x: 5 + id, y: 0, z: 5 },
    volume: mass / ORE_DENSITY_KG_M3,
    mass,
    rockId: 'cruite',
    oreDensities,
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: id,
    origin: { x: 5 + id, y: 0, z: 5 },
  };
}

function drivenHauler(state: GameState): Vehicle {
  setFreightRoom(state, 5000);
  const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 10, 10);
  const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 10, 10);
  assignSkill(state.employees, employee.id, 'driving.truck', 1);
  vehicle.occupantIds = [employee.id];
  employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
  return vehicle;
}

interface Trip { state: GameState; vehicle: Vehicle; heapId: number | null }

/** A hauler about to unload `fragments` (each in transit on its cargo); a spoil heap is placed first when `withHeap`. */
function loadedTrip(fragments: FragmentData[], withHeap = true): Trip {
  const state = createGame({ seed: SEED });
  const vehicle = drivenHauler(state);
  let heapId: number | null = null;
  if (withHeap) {
    const placed = placeBuilding(state.buildings, 'spoil_heap', 100, 100, 200, 200);
    if (!placed.success || !placed.building) throw new Error(`heap refused: ${placed.error}`);
    placed.building.active = true;
    heapId = placed.building.id;
  }
  addBlastFragments(state.logistics, fragments);
  for (const tracked of state.logistics.fragments) {
    tracked.state = 'in_transit';
    tracked.vehicleId = String(vehicle.id);
  }
  vehicle.cargo = fragments.map(f => ({ fragmentId: f.id, massKg: f.mass }));
  return { state, vehicle, heapId };
}

const heapOf = (t: Trip) => t.state.buildings.buildings.find(b => b.id === t.heapId)!;
const storedFragment = (state: GameState, id: number) => state.logistics.fragments.find(f => f.fragment.id === id)!;
const oreKgOf = (f: FragmentData, ore: string): number => oreContributionKg(f.volume, f.oreDensities[ore] ?? 0);

describe('applyHaulUnload concentrates ore-bearing cargo when a heap has room (#2142)', () => {
  it('the warehouse stores only the ore mass and the heap receives the barren remainder', () => {
    const t = loadedTrip([fragmentOf(1, 1200, { blingite: 0.5 })]);

    expect(applyHaulUnload(t.state, t.vehicle)).toBe(true);

    expect(t.state.logistics.storedMassKg).toBeCloseTo(600, 6);
    expect(storedFragment(t.state, 1).state).toBe('stored');
    expect(storedFragment(t.state, 1).fragment.mass).toBeCloseTo(600, 6);
    expect(heapOf(t).storedSpoilKg).toBeCloseTo(600, 6);
    expect(totalSpoilKg(t.state.buildings.buildings)).toBeCloseTo(600, 6);
    expect(t.vehicle.cargo).toEqual([]);
  });

  it('collectedOre is credited exactly the ore kg, and the fragment still holds exactly that ore', () => {
    const t = loadedTrip([fragmentOf(1, 1200, { blingite: 0.5 })]);

    applyHaulUnload(t.state, t.vehicle);

    expect(t.state.collectedOre['blingite']).toBeCloseTo(600, 6);
    expect(oreKgOf(storedFragment(t.state, 1).fragment, 'blingite')).toBeCloseTo(600, 6);
  });

  it('a mixed fragment keeps each ore at its exact kg', () => {
    const t = loadedTrip([fragmentOf(1, 2000, { blingite: 0.1, dirtite: 0.15 })]);

    applyHaulUnload(t.state, t.vehicle);

    expect(t.state.logistics.storedMassKg).toBeCloseTo(500, 6);
    expect(oreKgOf(storedFragment(t.state, 1).fragment, 'blingite')).toBeCloseTo(200, 6);
    expect(oreKgOf(storedFragment(t.state, 1).fragment, 'dirtite')).toBeCloseTo(300, 6);
    expect(t.state.collectedOre['blingite']).toBeCloseTo(200, 6);
    expect(t.state.collectedOre['dirtite']).toBeCloseTo(300, 6);
    expect(heapOf(t).storedSpoilKg).toBeCloseTo(1500, 6);
  });

  it('every item of a multi-fragment cargo is concentrated and the heap holds all the remainders', () => {
    const t = loadedTrip([
      fragmentOf(1, 1200, { blingite: 0.5 }),
      fragmentOf(2, 800, { blingite: 0.25 }),
      fragmentOf(3, 500, { blingite: 0.2 }),
    ]);

    expect(applyHaulUnload(t.state, t.vehicle)).toBe(true);

    expect(t.state.logistics.storedMassKg).toBeCloseTo(600 + 200 + 100, 6);
    expect(heapOf(t).storedSpoilKg).toBeCloseTo(600 + 600 + 400, 6);
    expect(t.state.collectedOre['blingite']).toBeCloseTo(900, 6);
    expect(t.state.logistics.fragments.map(f => f.state)).toEqual(['stored', 'stored', 'stored']);
  });

  it('still emits one vehicle:haul_delivered per fragment', () => {
    const t = loadedTrip([fragmentOf(1, 1200, { blingite: 0.5 }), fragmentOf(2, 800, { blingite: 0.25 })]);
    const emitter = new EventEmitter();
    const delivered: number[] = [];
    emitter.on('vehicle:haul_delivered', (e: { fragmentId: number }) => delivered.push(e.fragmentId));

    applyHaulUnload(t.state, t.vehicle, emitter);

    expect(delivered).toEqual([1, 2]);
  });

  it('selling the concentrated ore delivers exactly the kg asked and empties the warehouse at the end', () => {
    const t = loadedTrip([fragmentOf(1, 1200, { blingite: 0.5 })]);
    applyHaulUnload(t.state, t.vehicle);
    const { logistics, collectedOre, buildings } = t.state;

    const first = consumeStoredOre(logistics, collectedOre, 'blingite', 250, buildings.buildings);
    expect(first.success).toBe(true);
    expect(first.consumedKg).toBeCloseTo(250, 6);
    expect(collectedOre['blingite']).toBeCloseTo(350, 6);
    expect(logistics.storedMassKg).toBeCloseTo(350, 6);

    const rest = consumeStoredOre(logistics, collectedOre, 'blingite', 350, buildings.buildings);
    expect(rest.consumedKg).toBeCloseTo(350, 6);
    expect(logistics.fragments).toHaveLength(0);
    expect(logistics.storedMassKg).toBeCloseTo(0, 6);
    expect(heapOf(t).storedSpoilKg).toBeCloseTo(600, 6);
  });

  it('world invariants hold after a concentrating unload', () => {
    const t = loadedTrip([fragmentOf(1, 1200, { blingite: 0.5 })]);
    applyHaulUnload(t.state, t.vehicle);
    expect(assertWorldInvariants(t.state)).toEqual([]);
  });
});

describe('applyHaulUnload leaves the fragment whole when it cannot concentrate (#2142)', () => {
  it('with no spoil heap nothing is shrunk or credited', () => {
    const t = loadedTrip([fragmentOf(1, 1200, { blingite: 0.5 })], false);

    expect(applyHaulUnload(t.state, t.vehicle)).toBe(true);

    expect(t.state.logistics.storedMassKg).toBe(1200);
    expect(storedFragment(t.state, 1).fragment.mass).toBe(1200);
    expect(t.state.collectedOre['blingite']).toBeCloseTo(600, 6);
  });

  it('with a heap whose room is one kg short of the remainder, the fragment stays whole', () => {
    const t = loadedTrip([fragmentOf(1, 1200, { blingite: 0.5 })]);
    heapOf(t).storedSpoilKg = getBuildingDef('spoil_heap', 1).capacity - 599;

    applyHaulUnload(t.state, t.vehicle);

    expect(t.state.logistics.storedMassKg).toBe(1200);
    expect(storedFragment(t.state, 1).fragment.mass).toBe(1200);
    expect(heapOf(t).storedSpoilKg).toBe(getBuildingDef('spoil_heap', 1).capacity - 599);
  });

  it('with a heap whose room is exactly the remainder, the fragment is concentrated', () => {
    const t = loadedTrip([fragmentOf(1, 1200, { blingite: 0.5 })]);
    heapOf(t).storedSpoilKg = getBuildingDef('spoil_heap', 1).capacity - 600;

    applyHaulUnload(t.state, t.vehicle);

    expect(t.state.logistics.storedMassKg).toBeCloseTo(600, 6);
    expect(heapOf(t).storedSpoilKg).toBeCloseTo(getBuildingDef('spoil_heap', 1).capacity, 6);
  });

  it('a heap with room for one remainder only: each fragment is either whole or fully concentrated, never split across heaps', () => {
    const t = loadedTrip([fragmentOf(1, 1200, { blingite: 0.5 }), fragmentOf(2, 1200, { blingite: 0.5 })]);
    heapOf(t).storedSpoilKg = getBuildingDef('spoil_heap', 1).capacity - 700;

    applyHaulUnload(t.state, t.vehicle);

    const masses = [1, 2].map(id => storedFragment(t.state, id).fragment.mass).sort((a, b) => a - b);
    expect(masses[0]).toBeCloseTo(600, 6);
    expect(masses[1]).toBe(1200);
    expect(heapOf(t).storedSpoilKg).toBeCloseTo(getBuildingDef('spoil_heap', 1).capacity - 100, 6);
    expect(t.state.logistics.storedMassKg).toBeCloseTo(1800, 6);
  });

  it('a pure-ore fragment (no barren remainder) is untouched and the heap gains nothing', () => {
    const t = loadedTrip([fragmentOf(1, 1200, { blingite: 1 })]);

    applyHaulUnload(t.state, t.vehicle);

    expect(t.state.logistics.storedMassKg).toBe(1200);
    expect(storedFragment(t.state, 1).fragment.mass).toBe(1200);
    expect(heapOf(t).storedSpoilKg ?? 0).toBe(0);
  });

  it('a fragment whose densities sum past 1 is untouched', () => {
    const t = loadedTrip([fragmentOf(1, 1200, { blingite: 0.7, dirtite: 0.6 })]);

    applyHaulUnload(t.state, t.vehicle);

    expect(t.state.logistics.storedMassKg).toBe(1200);
    expect(heapOf(t).storedSpoilKg ?? 0).toBe(0);
  });
});

// ── C5: the menu-default sandbox opening keeps hauling ──────────────────────

const BIOME = 'desert_badlands';
const OPENING_SEED = 12345;
const PLAY_TICKS = 3000;
const SAMPLE_EVERY = 50;
/** The ramp's top, past the crater's east rim, and its crater-floor end tile (the crater is 9 m wide on the 3x3 shot). */
const RAMP_REACH_M = 21;
const RAMP_DEPTH_M = 5;
/** A warehouse counts as full of ore from this share of its capacity and of its stored mass being ore. */
const FULL_SHARE = 0.9;
/** Ore the kit's tier-1 warehouse must hold by the end: the old behaviour stopped at ~0.7 t. */
const MIN_ORE_KG = 10_000;

function refresh(state: GameState): void {
  fundForDeliveryWait(state);
  for (const e of state.employees.employees) e.fatigue = 100;
}

function tickWhile(run: (c: string) => unknown, state: GameState, until: () => boolean, max: number): void {
  for (let n = 0; n < max && !until(); n++) { refresh(state); run('tick 1'); }
}

/** Flattest ore-bearing pad of the grid, where the sandbox guarantees a flat drill site. */
function flattestPad(grid: VoxelGrid, depthM: number): { x0: number; z0: number } {
  const size = SANDBOX_FLAT_PAD_SIZE;
  let best = { x0: 0, z0: 0, spread: Infinity };
  for (let x0 = 0; x0 + size <= grid.sizeX; x0 += 3) {
    for (let z0 = 0; z0 + size <= grid.sizeZ; z0 += 3) {
      let lo = Infinity, hi = -Infinity, oreCells = 0;
      for (let x = x0; x < x0 + size; x++) for (let z = z0; z < z0 + size; z++) {
        const y = computeVoxelColumnSurfaceY(grid, x, z)!;
        lo = Math.min(lo, y); hi = Math.max(hi, y);
        for (let d = 0; d < depthM; d++) if (grid.oresAt(x, y - d, z)) oreCells++;
      }
      if (oreCells > 0 && hi - lo < best.spread) best = { x0, z0, spread: hi - lo };
    }
  }
  return best;
}

const oreKg = (state: GameState): number => Object.values(state.collectedOre).reduce((a, b) => a + b, 0);

interface Played {
  state: GameState;
  rampOrdered: boolean;
  oreSamples: number[];
  /** Ticks at which a haul order was blocked on a full warehouse although it was not full of ore. */
  storageFullWithRockInside: number;
  spoilHeapFullTicks: number;
  storageFullTicks: number;
}

function playOpening(): Played {
  const { runner, ctx } = createRunner();
  const run = (c: string) => runner.run(c);
  expect(run(`sandbox start biome:${BIOME} kit:digger seed:${OPENING_SEED}`)).toMatchObject({ success: true });
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0; // a pending event halts `tick`
  refresh(state);

  const pad = flattestPad(ctx.grid!, 6);
  const shotX = pad.x0 + 1;
  const shotZ = pad.z0 + 1;
  expect(run(`drill_plan grid rows:3 cols:3 spacing:4 depth:6 start:${shotX},${shotZ}`)).toMatchObject({ success: true });
  tickWhile(run, state, () => state.plannedDrillHoles.length === 0, 1500);
  expect(run('charge hole:* explosive:krackle amount:6 stemming:2')).toMatchObject({ success: true });
  tickWhile(run, state, () => Object.keys(state.plannedChargesByHole).length === 0, EXPLOSIVE_DELIVERY_TICKS + 1500);
  clearBlastZone(run, state);
  expect(run('blast detonate')).toMatchObject({ success: true });
  tickWhile(run, state, () => state.lastBlastReport !== null, 600);
  expect(state.lastBlastReport).not.toBeNull();

  // Access ramp from the east rim down to the crater floor, along the shot's middle row.
  const rowZ = shotZ + 4;
  const endX = shotX + 8 + 2;
  const ramp = run(`build_ramp start:${endX + RAMP_REACH_M},${rowZ} end:${endX},${rowZ} depth:${RAMP_DEPTH_M}`);

  const oreSamples: number[] = [];
  let storageFullWithRockInside = 0, spoilHeapFullTicks = 0, storageFullTicks = 0;
  const capacity = FREIGHT_WAREHOUSE_CAPACITY_KG[1];
  for (let i = 0; i < PLAY_TICKS; i++) {
    refresh(state);
    playTick(run, state);
    if (i % SAMPLE_EVERY === 0) oreSamples.push(oreKg(state));
    let storageFull = false, heapFull = false;
    for (const a of state.pendingActions) {
      if (a.blockedReason === 'storage_full') storageFull = true;
      else if (a.blockedReason === 'spoil_heap_full') heapFull = true;
    }
    if (heapFull) spoilHeapFullTicks++;
    if (storageFull) {
      storageFullTicks++;
      const stored = state.logistics.storedMassKg;
      const fullOfOre = stored >= FULL_SHARE * capacity && oreKg(state) >= FULL_SHARE * stored;
      if (!fullOfOre) storageFullWithRockInside++;
    }
  }
  oreSamples.push(oreKg(state));
  return { state, rampOrdered: ramp.success, oreSamples, storageFullWithRockInside, spoilHeapFullTicks, storageFullTicks };
}

describe(`menu-default sandbox opening keeps hauling ore (${BIOME}, Digger kit, seed ${OPENING_SEED}, #2142)`, () => {
  let played: Played;
  beforeAll(() => { played = playOpening(); }, 600_000);

  it('the access ramp was accepted and dug', () => {
    expect(played.rampOrdered).toBe(true);
    expect(played.state.builtRamps.length).toBeGreaterThanOrEqual(1);
  });

  it('no haul order is blocked on storage_full while the warehouse still holds rock instead of ore', () => {
    expect(played.storageFullWithRockInside).toBe(0);
  });

  it('no haul order is ever blocked on spoil_heap_full', () => {
    expect(played.spoilHeapFullTicks).toBe(0);
  });

  it('delivered ore never falls over the ticks (no sale or contract is made)', () => {
    const { oreSamples } = played;
    for (let i = 1; i < oreSamples.length; i++) {
      expect(oreSamples[i]!, `sample ${i}`).toBeGreaterThanOrEqual(oreSamples[i - 1]! - 1);
    }
  });

  it('delivered ore ends far above the old ~0.7 t and the tier-1 warehouse holds ore, not rock', () => {
    const { state } = played;
    expect(oreKg(state)).toBeGreaterThan(MIN_ORE_KG);
    expect(oreKg(state)).toBeGreaterThanOrEqual(FULL_SHARE * state.logistics.storedMassKg);
    expect(state.logistics.storedMassKg).toBeLessThanOrEqual(FREIGHT_WAREHOUSE_CAPACITY_KG[1] + 1e-6);
  });

  it('the barren remainder went to the spoil heap, past what the old 50 t heap could ever hold', () => {
    const { state } = played;
    expect(totalSpoilKg(state.buildings.buildings)).toBeGreaterThan(50_000);
    expect(totalSpoilKg(state.buildings.buildings)).toBeLessThanOrEqual(SPOIL_HEAP_CAPACITY_KG);
  });

  it('storedMassKg is the mass of the stored fragments, and collectedOre is the ore kg inside them', () => {
    const { state } = played;
    const stored = state.logistics.fragments.filter(f => f.state === 'stored');
    expect(state.logistics.storedMassKg).toBeCloseTo(stored.reduce((s, f) => s + f.fragment.mass, 0), 3);
    const inside: Record<string, number> = {};
    for (const f of stored) {
      for (const id of Object.keys(f.fragment.oreDensities)) inside[id] = (inside[id] ?? 0) + oreKgOf(f.fragment, id);
    }
    for (const [id, kg] of Object.entries(state.collectedOre)) expect(inside[id] ?? 0, id).toBeCloseTo(kg, 0);
  });

  it('world invariants hold', () => {
    expect(assertWorldInvariants(played.state)).toEqual([]);
  });
});
