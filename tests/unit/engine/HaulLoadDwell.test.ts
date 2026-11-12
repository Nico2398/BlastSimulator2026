// BlastSimulator2026 — Tests for the haul load dwell (#2199)
//
// Loading one fragment onto a debris hauler takes HAUL_LOAD_TICKS ticks, fixed
// whatever the fragment's size. The planner states it on each haul_load leg
// (`dwellTicks`, counted in `estTicks`), and the locomotion tick serves it
// before the load applies: the fragment enters `vehicle.cargo` only after the
// vehicle has stood on the leg destination that long.
//
// The movement-side tests compare a trip against the identical trip with the
// planned dwell cleared, so they measure the dwell itself and never the
// travel time, and never assume a particular HAUL_LOAD_TICKS value.

import { setFreightRoom } from '../../helpers/freightWarehouse.js';
import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { purchaseVehicle, vehicleDriverId, getVehicleDefByTier, type Vehicle } from '../../../src/core/entities/Vehicle.js';
import { hireEmployee, assignSkill, type Employee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { placeBuilding, getStorageCapacity } from '../../../src/core/entities/Building.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { requestHaulFragment } from '../../../src/core/economy/HaulingTask.js';
import { requestBreakBoulder } from '../../../src/core/economy/BoulderBreaking.js';
import { syncHaulDispatch } from '../../../src/core/economy/HaulDispatch.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { octileHeuristic } from '../../../src/core/nav/Pathfinding.js';
import { tickLocomotion } from '../../../src/core/engine/Locomotion.js';
import { interruptActiveAction } from '../../../src/core/engine/TaskDispatch.js';
import { getVehicleReservation } from '../../../src/core/entities/Vehicle.js';
import { vehicleEtaTicks } from '../../../src/core/entities/VehicleStatus.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { OVERSIZED_FRAGMENT_THRESHOLD } from '../../../src/core/mining/BlastCalc.js';
import { HAUL_LOAD_TICKS } from '../../../src/core/config/balance.js';
import type { Itinerary, Leg } from '../../../src/core/engine/Itinerary.js';

const SEED = 42;
const GRID = 64;
const MAX_TICKS = 400;

function makeFragment(id: number, x: number, z: number, mass = 500, volume = 0.3): FragmentData {
  return {
    id,
    position: { x, y: 0, z },
    volume,
    mass,
    rockId: 'cruite',
    oreDensities: { blingite: 0.5 },
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
    origin: { x, y: 0, z },
  };
}

function makeFlatNavGrid(size: number): NavGrid {
  const cells: NavCell[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, (): NavCell => ({ type: 'walkable', moveCost: 1.0, benchLevel: 0, vehicleOccupied: false })));
  return new NavGrid(size, size, cells, 0);
}

function legsWithEffect(itinerary: Itinerary, effectId: string): Leg[] {
  return itinerary.legs.filter(leg => leg.onArrive.kind === 'effect' && leg.onArrive.effectId === effectId);
}

interface Fixture {
  state: GameState;
  vehicle: Vehicle;
  driver: Employee;
  itinerary: Itinerary;
  fragmentIds: number[];
}

/** A driven tier-1 hauler at (0,0), a depot far away, and a haul requested on `fragments[0]`. */
function planHaul(fragments: FragmentData[], opts: { withoutDwell?: boolean } = {}): Fixture {
  const state = createGame({ seed: SEED });
  state.navGrid = makeFlatNavGrid(GRID);
  const depot = placeBuilding(state.buildings, 'freight_warehouse', 40, 40, GRID, GRID);
  if (!depot.success || !depot.building) throw new Error('fixture depot refused');
  depot.building.tier = 3;
  state.logistics.storageCapacityKg = getStorageCapacity(state.buildings);
  const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
  setFreightRoom(state, 15_000);
  const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 0, 0);
  assignSkill(state.employees, employee.id, 'driving.truck', 1);
  vehicle.occupantIds = [employee.id];
  employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
  addBlastFragments(state.logistics, fragments, state.navGrid);
  syncHaulDispatch(state);
  const result = requestHaulFragment(state, vehicle.id, fragments[0]!.id);
  expect(result.success).toBe(true);
  const driver = state.employees.employees.find(e => e.id === vehicleDriverId(vehicle))!;
  const itinerary = driver.itinerary!;
  if (opts.withoutDwell) for (const leg of itinerary.legs) delete leg.dwellTicks;
  return { state, vehicle, driver, itinerary, fragmentIds: fragments.map(f => f.id) };
}

interface Trace {
  /** Per tick, after the tick: fragment ids on the vehicle, and its position. */
  cargo: number[][];
  at: { x: number; z: number }[];
  /** Tick index (0-based) on which each fragment's `vehicle:haul_loaded` fired. */
  loadedAt: Map<number, number>;
}

/** Ticks locomotion until the driver has no itinerary left (or MAX_TICKS), tracing the vehicle. */
function runTrip(fx: Fixture, hook?: (tick: number) => void): Trace {
  const emitter = new EventEmitter();
  const trace: Trace = { cargo: [], at: [], loadedAt: new Map() };
  let tick = 0;
  emitter.on('vehicle:haul_loaded', (p: { fragmentId: number }) => trace.loadedAt.set(p.fragmentId, tick));
  for (; tick < MAX_TICKS && fx.driver.itinerary !== null; tick++) {
    tickLocomotion(fx.state, emitter);
    trace.cargo.push(fx.vehicle.cargo.map(c => c.fragmentId));
    trace.at.push({ x: fx.vehicle.x, z: fx.vehicle.z });
    hook?.(tick);
  }
  return trace;
}

const cluster = (n: number, mass = 500, firstId = 1) =>
  Array.from({ length: n }, (_, i) => makeFragment(firstId + i, 5 + (i % 4), 5 + Math.floor(i / 4), mass));

// ── Planner ────────────────────────────────────────────────────────────────

describe('planned haul itinerary counts the load dwell (#2199)', () => {
  it('the primary haul_load leg dwells HAUL_LOAD_TICKS', () => {
    const { itinerary } = planHaul(cluster(1));
    const loads = legsWithEffect(itinerary, 'haul_load');
    expect(loads).toHaveLength(1);
    expect(loads[0]!.dwellTicks).toBe(HAUL_LOAD_TICKS);
  });

  it('every extra batch pickup dwells HAUL_LOAD_TICKS too', () => {
    const { itinerary } = planHaul(cluster(4));
    const loads = legsWithEffect(itinerary, 'haul_load');
    expect(loads).toHaveLength(4);
    for (const leg of loads) expect(leg.dwellTicks).toBe(HAUL_LOAD_TICKS);
  });

  it('the dwell does not depend on the fragment mass or volume', () => {
    const light = planHaul([makeFragment(1, 5, 5, 20, 0.01)]).itinerary;
    const heavy = planHaul([makeFragment(1, 5, 5, 3900, OVERSIZED_FRAGMENT_THRESHOLD)]).itinerary;
    expect(legsWithEffect(light, 'haul_load')[0]!.dwellTicks).toBe(HAUL_LOAD_TICKS);
    expect(legsWithEffect(heavy, 'haul_load')[0]!.dwellTicks).toBe(HAUL_LOAD_TICKS);
  });

  it('the haul_unload leg has no dwell', () => {
    const { itinerary } = planHaul(cluster(3));
    for (const leg of legsWithEffect(itinerary, 'haul_unload')) expect(leg.dwellTicks ?? 0).toBe(0);
  });

  it('a load leg estTicks is its drive time plus the dwell', () => {
    const { itinerary, vehicle } = planHaul(cluster(1));
    const leg = legsWithEffect(itinerary, 'haul_load')[0]!;
    const driveTicks = octileHeuristic(vehicle.x, vehicle.z, leg.destX, leg.destZ) / getVehicleDefByTier('debris_hauler', 1).speed;
    expect(leg.estTicks).toBeCloseTo(driveTicks + HAUL_LOAD_TICKS, 6);
  });

  it('estTotalTicks is the sum of every leg estimate, dwell included', () => {
    const { itinerary } = planHaul(cluster(3));
    const sum = itinerary.legs.reduce((s, leg) => s + leg.estTicks, 0);
    expect(itinerary.estTotalTicks).toBeCloseTo(sum + itinerary.workTicks, 6);
    for (const leg of itinerary.legs) expect(leg.estTicks).toBeGreaterThanOrEqual(leg.dwellTicks ?? 0);
  });

  it('each extra fragment adds HAUL_LOAD_TICKS to the planned total beyond its drive time', () => {
    // Same positions, different pickups: the whole-trip estimate minus every leg's drive time
    // is exactly one dwell per load leg.
    for (const count of [1, 2, 4]) {
      const { itinerary } = planHaul(cluster(count));
      const dwellTotal = itinerary.legs.reduce((s, leg) => s + (leg.dwellTicks ?? 0), 0);
      expect(dwellTotal).toBe(count * HAUL_LOAD_TICKS);
    }
  });

  it('a boulder_split leg has no dwell', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(GRID);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_fragmenter', 0, 0);
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 0, 0);
    assignSkill(state.employees, employee.id, 'driving.excavator', 1);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    addBlastFragments(state.logistics, [makeFragment(1, 6, 9, 4000, OVERSIZED_FRAGMENT_THRESHOLD + 0.5)], state.navGrid);
    syncHaulDispatch(state);
    expect(requestBreakBoulder(state, vehicle.id, 1).success).toBe(true);
    const splits = legsWithEffect(employee.itinerary!, 'boulder_split');
    expect(splits).toHaveLength(1);
    expect(splits[0]!.dwellTicks ?? 0).toBe(0);
  });

  it('an oversized fragment still cannot be hauled', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(GRID);
    placeBuilding(state.buildings, 'freight_warehouse', 40, 40, GRID, GRID);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 0, 0);
    setFreightRoom(state, 15_000);
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), 0, 0);
    assignSkill(state.employees, employee.id, 'driving.truck', 1);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 4000, OVERSIZED_FRAGMENT_THRESHOLD + 0.5)], state.navGrid);
    syncHaulDispatch(state);

    expect(requestHaulFragment(state, vehicle.id, 1).success).toBe(false);
    expect(employee.itinerary).toBeNull();
  });
});

// ── Locomotion ─────────────────────────────────────────────────────────────

describe('locomotion serves the load dwell before the load applies (#2199)', () => {
  it('HAUL_LOAD_TICKS is a positive whole number of ticks', () => {
    expect(Number.isInteger(HAUL_LOAD_TICKS)).toBe(true);
    expect(HAUL_LOAD_TICKS).toBeGreaterThan(0);
  });

  it('the fragment is loaded HAUL_LOAD_TICKS ticks later than a leg with no dwell', () => {
    const free = runTrip(planHaul(cluster(1), { withoutDwell: true }));
    const paid = runTrip(planHaul(cluster(1)));
    expect(free.loadedAt.get(1)).toBeDefined();
    expect(paid.loadedAt.get(1)).toBe(free.loadedAt.get(1)! + HAUL_LOAD_TICKS);
  });

  /** Where the trip's first load leg stands: beside the rock, since rubble blocks the rock's own cells. */
  const loadStand = (trip: ReturnType<typeof planHaul>) => {
    const leg = trip.itinerary.legs.find(l => l.onArrive.kind === 'effect' && l.onArrive.effectId === 'haul_load')!;
    return { x: leg.destX, z: leg.destZ };
  };

  it('cargo stays empty and the vehicle stays put through the dwell', () => {
    const free = runTrip(planHaul(cluster(1), { withoutDwell: true }));
    const plan = planHaul(cluster(1));
    const stand = loadStand(plan);
    const paid = runTrip(plan);
    const arrivedAt = free.loadedAt.get(1)!;
    for (let t = arrivedAt; t < arrivedAt + HAUL_LOAD_TICKS; t++) {
      expect(paid.cargo[t]).toEqual([]);
      // The free run drives on the tick it loads, so only the cell beside the rock is a fixed point.
      expect(paid.at[t]).toEqual(stand);
    }
    expect(paid.cargo[arrivedAt + HAUL_LOAD_TICKS]).toEqual([1]);
  });

  it('the vehicle does not move on, and does not unload, until the load has landed', () => {
    const plan = planHaul(cluster(1));
    const stand = loadStand(plan);
    const paid = runTrip(plan);
    const loadedTick = paid.loadedAt.get(1)!;
    // It waited beside the rock until the tick the load landed (the landing tick drives on).
    expect(paid.at[loadedTick - 1]).toEqual(stand);
    for (let t = 0; t < loadedTick; t++) expect(paid.cargo[t]).toEqual([]);
  });

  it('every extra pickup in a batch pays its own dwell', () => {
    const free = runTrip(planHaul(cluster(3), { withoutDwell: true }));
    const paid = runTrip(planHaul(cluster(3)));
    const order = [...free.loadedAt.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    expect(order).toHaveLength(3);
    order.forEach((id, i) => {
      expect(paid.loadedAt.get(id)).toBe(free.loadedAt.get(id)! + (i + 1) * HAUL_LOAD_TICKS);
    });
  });

  it('a whole batched trip lasts one dwell per fragment longer', () => {
    for (const count of [1, 3, 4]) {
      const free = runTrip(planHaul(cluster(count), { withoutDwell: true }));
      const paid = runTrip(planHaul(cluster(count)));
      expect(paid.cargo.length - free.cargo.length).toBe(count * HAUL_LOAD_TICKS);
    }
  });

  it('the dwell is the same for a light fragment and a heavy one', () => {
    const lightFree = runTrip(planHaul([makeFragment(1, 5, 5, 20, 0.01)], { withoutDwell: true }));
    const lightPaid = runTrip(planHaul([makeFragment(1, 5, 5, 20, 0.01)]));
    const heavyFree = runTrip(planHaul([makeFragment(1, 5, 5, 3900, OVERSIZED_FRAGMENT_THRESHOLD)], { withoutDwell: true }));
    const heavyPaid = runTrip(planHaul([makeFragment(1, 5, 5, 3900, OVERSIZED_FRAGMENT_THRESHOLD)]));
    expect(lightPaid.loadedAt.get(1)! - lightFree.loadedAt.get(1)!).toBe(HAUL_LOAD_TICKS);
    expect(heavyPaid.loadedAt.get(1)! - heavyFree.loadedAt.get(1)!).toBe(HAUL_LOAD_TICKS);
  });

  it('the fragment is still on the ground while the dwell runs', () => {
    const fx = planHaul(cluster(1));
    const free = runTrip(planHaul(cluster(1), { withoutDwell: true }));
    const arrivedAt = free.loadedAt.get(1)!;
    const states: string[] = [];
    runTrip(fx, tick => {
      if (tick >= arrivedAt && tick < arrivedAt + HAUL_LOAD_TICKS) {
        states.push(fx.state.logistics.fragments.find(f => f.fragment.id === 1)!.state);
      }
    });
    expect(states).toHaveLength(HAUL_LOAD_TICKS);
    for (const s of states) expect(s).toBe('on_ground');
  });

  it('an interruption during the dwell leaves the fragment on the ground, never loaded', () => {
    const free = runTrip(planHaul(cluster(1), { withoutDwell: true }));
    const arrivedAt = free.loadedAt.get(1)!;
    const fx = planHaul(cluster(1));
    const emitter = new EventEmitter();
    let loaded = false;
    emitter.on('vehicle:haul_loaded', () => { loaded = true; });
    for (let t = 0; t <= arrivedAt; t++) tickLocomotion(fx.state, emitter); // through the arrival tick
    expect(loaded).toBe(false);
    // Standing in the dwell now: the load has not landed.
    expect(fx.vehicle.cargo).toEqual([]);

    interruptActiveAction(fx.state, fx.driver, getVehicleReservation(fx.state.vehicles, fx.vehicle.id), { forceOpenPool: true });
    for (let t = 0; t < 20; t++) tickLocomotion(fx.state, emitter);

    expect(loaded).toBe(false);
    expect(fx.vehicle.cargo).toEqual([]);
    expect(fx.state.logistics.fragments.find(f => f.fragment.id === 1)!.state).toBe('on_ground');
  });

  it('a load that fails once the dwell is served still interrupts the action', () => {
    const free = runTrip(planHaul(cluster(1), { withoutDwell: true }));
    const arrivedAt = free.loadedAt.get(1)!;
    const fx = planHaul(cluster(1));
    for (let t = 0; t <= arrivedAt; t++) tickLocomotion(fx.state); // through the arrival tick
    expect(fx.driver.activeActionId).not.toBeNull();
    // The fragment vanishes while the hauler stands loading it.
    fx.state.logistics.fragments = fx.state.logistics.fragments.filter(f => f.fragment.id !== 1);

    for (let t = 0; t < 20; t++) tickLocomotion(fx.state);

    expect(fx.vehicle.cargo).toEqual([]);
    expect(fx.driver.activeActionId).toBeNull();
    expect(fx.driver.itinerary).toBeNull();
  });
});

// ── ETA ────────────────────────────────────────────────────────────────────

describe('vehicleEtaTicks on a planned haul counts the dwell once (#2199)', () => {
  it('at the start of a batched trip the ETA matches the planned total, not more', () => {
    const fx = planHaul(cluster(4));
    const eta = vehicleEtaTicks(fx.vehicle, fx.itinerary);
    // The first leg's drive is rounded up to a whole tick; any dwell counted twice would add at least a tick more.
    expect(eta).toBeGreaterThanOrEqual(fx.itinerary.estTotalTicks - 1e-6);
    expect(eta).toBeLessThan(fx.itinerary.estTotalTicks + 1);
  });

  it('while the dwell runs, the ETA still includes the dwell left', () => {
    const free = runTrip(planHaul(cluster(1), { withoutDwell: true }));
    const arrivedAt = free.loadedAt.get(1)!;
    const fx = planHaul(cluster(1));
    for (let t = 0; t <= arrivedAt; t++) tickLocomotion(fx.state); // through the arrival tick

    const live = fx.driver.itinerary!;
    const leg = live.legs[0]!;
    expect(leg.dwellLeft).toBeDefined();
    const rest = live.legs.slice(1).reduce((s, l) => s + l.estTicks, 0);
    expect(vehicleEtaTicks(fx.vehicle, live)).toBe(leg.dwellLeft! + rest);
  });
});

// ── Pass-through guard: legs without a dwell keep firing on arrival ────────

describe('a leg without dwellTicks still fires its arrival step on arrival (#2199)', () => {
  it('the unload step is not delayed', () => {
    const planned = planHaul(cluster(1));
    const stripped = planHaul(cluster(1), { withoutDwell: true });
    const a = runTrip(planned);
    const b = runTrip(stripped);
    // Only the load dwell separates the two trips.
    expect(a.cargo.length - b.cargo.length).toBe(HAUL_LOAD_TICKS);
    expect(planned.vehicle.cargo).toEqual([]);
    expect(stripped.vehicle.cargo).toEqual([]);
  });
});
