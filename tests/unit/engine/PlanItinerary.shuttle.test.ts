// BlastSimulator2026 — sharing a shuttle (#2290 C5, C6, C9)
//
// An employee ordered far away who would otherwise ride a free shuttle alone joins the trip of an employee already
// committed to it, as a passenger: the planner returns foot (board as passenger) -> ride -> foot, the driver's
// itinerary holds at the shuttle for a bounded wait, and a trip of three arrives together, sooner than walking.
// Planner tests read the Itinerary; the sim tests drive it with tickLocomotion, the executor the game runs.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, vehicleDriverId, vehiclePassengerIds } from '../../../src/core/entities/Vehicle.js';
import { NavGrid, type NavCell } from '../../../src/core/nav/NavGrid.js';
import { planItinerary } from '../../../src/core/engine/PlanItinerary.js';
import type { Itinerary, Leg } from '../../../src/core/engine/Itinerary.js';
import { moveTo } from '../../../src/core/engine/MoveTo.js';
import { tickLocomotion } from '../../../src/core/engine/Locomotion.js';
import { TRAVEL_VEHICLE_WALK_THRESHOLD_CELLS, TRAVEL_BOARDING_WAIT_TICKS, TRAVEL_SHARE_RADIUS_CELLS } from '../../../src/core/config/balance.js';
import { expectNoWorldInvariantViolations } from '../../helpers/worldInvariants.js';

const SEED = 42;
const FAR = TRAVEL_VEHICLE_WALK_THRESHOLD_CELLS * 3;
const MAX_TICKS = 400;

function makeState(width = 200, height = 20): GameState {
  const state = createGame({ seed: SEED });
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) row.push({ type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false });
    cells.push(row);
  }
  state.navGrid = new NavGrid(width, height, cells);
  return state;
}

/** An employee holding no qualification at all: the travel role needs none. */
function hireUnlicensed(state: GameState, x: number, z: number): Employee {
  const { employee } = hireEmployee(state.employees, 'driller', new Random(SEED), x, z);
  employee.qualifications = [];
  return employee;
}

let nextActionId = 1;
function orderAt(state: GameState, targetX: number, targetZ: number): PendingAction {
  const action: PendingAction = {
    id: nextActionId++, type: 'general_work', requiredSkill: null, requiredVehicleRole: null,
    targetX, targetZ, targetY: 0, payload: {}, targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0,
  };
  state.pendingActions.push(action);
  return action;
}

const plan = (state: GameState, employee: Employee, a: PendingAction): Itinerary | null =>
  planItinerary(state, employee, { kind: 'work', actionId: a.id }, 'exact', { action: a });

/** Claim `action` for `employee` and install its journey, as the dispatcher does. */
function dispatch(state: GameState, employee: Employee, action: PendingAction): void {
  action.status = 'assigned';
  action.holderId = employee.id;
  employee.activeActionId = action.id;
  const result = moveTo(state, employee.id, { actionId: action.id });
  expect(result.success, `moveTo ${employee.id}`).toBe(true);
  expect(employee.itinerary).not.toBeNull();
}

const isPassengerBoard = (l: Leg, vehicleId?: number): boolean =>
  l.onArrive.kind === 'board' && l.onArrive.passenger === true && (vehicleId === undefined || l.onArrive.vehicleId === vehicleId);
const hasPassengerBoard = (it: Itinerary | null): boolean => it !== null && it.legs.some(l => isPassengerBoard(l));
const hasRide = (it: Itinerary | null): boolean => it !== null && it.legs.some(l => l.mode === 'ride');

/** Walking baseline: the same trip, no vehicle anywhere. */
function walkTicks(from: { x: number; z: number }, to: { x: number; z: number }): number {
  const state = makeState();
  const walker = hireUnlicensed(state, from.x, from.z);
  const action = orderAt(state, to.x, to.z);
  action.status = 'assigned';
  action.holderId = walker.id;
  walker.activeActionId = action.id;
  walker.itinerary = plan(state, walker, action);
  expect(walker.itinerary).not.toBeNull();
  let n = 0;
  for (; n < MAX_TICKS && walker.itinerary !== null; n++) tickLocomotion(state);
  expect(walker.itinerary).toBeNull();
  return n;
}

/** A shuttle at (2, 0), a driver-to-be at (0, 0) installed on a far order, and everyone else near it. */
function shuttleTrip() {
  const state = makeState();
  const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
  const a = hireUnlicensed(state, 0, 0);
  const actionA = orderAt(state, FAR, 0);
  dispatch(state, a, actionA);
  return { state, vehicle, a, actionA };
}

describe('shuttle sharing: planning a passenger itinerary (#2290 C5)', () => {
  it('a second far employee with a nearby drop point plans foot (board as passenger) -> ride -> foot to the task', () => {
    const { state, vehicle } = shuttleTrip();
    const b = hireUnlicensed(state, 0, 1);
    const actionB = orderAt(state, FAR + 4, 2);

    const it = plan(state, b, actionB);

    expect(it).not.toBeNull();
    const legs = it!.legs;
    expect(legs[0]!.mode).toBe('foot');
    expect(legs[0]!.onArrive).toEqual({ kind: 'board', vehicleId: vehicle.id, passenger: true });
    const rideIndex = legs.findIndex(l => l.mode === 'ride');
    expect(rideIndex).toBeGreaterThan(0);
    expect(legs[rideIndex]!.vehicleId).toBe(vehicle.id);
    expect(legs.some(l => l.mode === 'drive')).toBe(false);
    const last = legs[legs.length - 1]!;
    expect(last.mode).toBe('foot');
    expect(last.destX).toBe(actionB.targetX);
    expect(last.destZ).toBe(actionB.targetZ);
  });

  it('the shared trip is estimated quicker than walking', () => {
    const { state } = shuttleTrip();
    const b = hireUnlicensed(state, 0, 1);
    const it = plan(state, b, orderAt(state, FAR + 4, 2));
    expect(hasPassengerBoard(it)).toBe(true);
    const walk = walkTicks({ x: 0, z: 1 }, { x: FAR + 4, z: 2 });
    expect(it!.estTotalTicks).toBeLessThan(walk);
  });

  it('planning is read-only and B holds no vehicle reservation', () => {
    const { state, vehicle } = shuttleTrip();
    const b = hireUnlicensed(state, 0, 1);
    const actionB = orderAt(state, FAR + 4, 2);
    const reservationsBefore = structuredClone(state.vehicles.reservations);
    const occupantsBefore = [...vehicle.occupantIds];

    const it = plan(state, b, actionB);
    expect(hasPassengerBoard(it)).toBe(true);

    expect(state.vehicles.reservations).toEqual(reservationsBefore);
    expect(vehicle.occupantIds).toEqual(occupantsBefore);
    expect(b.locomotion).toEqual({ kind: 'on_foot' });
  });

  it('installing the passenger itinerary reserves nothing for the passenger\'s own action', () => {
    const { state } = shuttleTrip();
    const b = hireUnlicensed(state, 0, 1);
    const actionB = orderAt(state, FAR + 4, 2);

    dispatch(state, b, actionB);

    expect(hasPassengerBoard(b.itinerary)).toBe(true);
    expect(state.vehicles.reservations.some(r => r.actionId === actionB.id)).toBe(false);
  });

  it('without a committed driver the second employee plans a ride of its own, not a passenger seat', () => {
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    const b = hireUnlicensed(state, 0, 1);

    const it = plan(state, b, orderAt(state, FAR + 4, 2));

    expect(it).not.toBeNull();
    expect(hasPassengerBoard(it)).toBe(false);
    expect(it!.legs.some(l => l.mode === 'drive' && l.vehicleId === vehicle.id)).toBe(true);
  });

  it('a drop point beyond the share radius is not shared', () => {
    const { state } = shuttleTrip();
    const b = hireUnlicensed(state, 0, 1);

    const it = plan(state, b, orderAt(state, FAR + TRAVEL_SHARE_RADIUS_CELLS + 20, 2));

    expect(hasPassengerBoard(it)).toBe(false);
    expect(hasRide(it)).toBe(false);
  });

  it('a drop point just inside the share radius is shared', () => {
    const { state } = shuttleTrip();
    const b = hireUnlicensed(state, 0, 1);

    const it = plan(state, b, orderAt(state, FAR + Math.floor(TRAVEL_SHARE_RADIUS_CELLS / 2), 2));

    expect(hasPassengerBoard(it)).toBe(true);
  });

  it('a near task is walked even when a shuttle is committed to a far drop point', () => {
    const { state } = shuttleTrip();
    const b = hireUnlicensed(state, 0, 1);

    const it = plan(state, b, orderAt(state, TRAVEL_VEHICLE_WALK_THRESHOLD_CELLS - 6, 2));

    expect(it).not.toBeNull();
    expect(hasPassengerBoard(it)).toBe(false);
    expect(it!.legs.every(l => l.mode === 'foot')).toBe(true);
  });

  it('never takes a seat past the shuttle\'s six: a driver and five committed passengers fill it, a sixth passenger walks', () => {
    const { state, vehicle } = shuttleTrip();
    const spots: Array<[number, number]> = [[0, 1], [1, 0], [1, 1], [0, 2], [1, 2], [2, 1]];
    for (let i = 0; i < 5; i++) {
      const p = hireUnlicensed(state, spots[i]![0], spots[i]![1]);
      const action = orderAt(state, FAR + 2, i);
      dispatch(state, p, action);
      expect(p.itinerary!.legs[0]!.onArrive, `passenger ${i}`).toEqual({ kind: 'board', vehicleId: vehicle.id, passenger: true });
    }
    const sixth = hireUnlicensed(state, spots[5]![0], spots[5]![1]);

    const it = plan(state, sixth, orderAt(state, FAR + 2, 6));

    expect(it).not.toBeNull();
    expect(hasPassengerBoard(it)).toBe(false);
    expect(hasRide(it)).toBe(false);
  });

  it('never joins a race car, which carries only its driver', () => {
    const state = makeState();
    purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0, 2);
    const a = hireUnlicensed(state, 0, 0);
    dispatch(state, a, orderAt(state, FAR, 0));
    const b = hireUnlicensed(state, 0, 1);

    const it = plan(state, b, orderAt(state, FAR + 4, 2));

    expect(hasPassengerBoard(it)).toBe(false);
    expect(hasRide(it)).toBe(false);
  });

  it('never joins a shuttle already driving away', () => {
    const { state, vehicle, a } = shuttleTrip();
    for (let n = 0; n < MAX_TICKS && vehicle.x < 14; n++) tickLocomotion(state);
    expect(vehicle.x, 'the shuttle left').toBeGreaterThanOrEqual(14);
    expect(vehicleDriverId(vehicle)).toBe(a.id);
    const b = hireUnlicensed(state, 0, 1);

    const it = plan(state, b, orderAt(state, FAR + 4, 2));

    expect(hasPassengerBoard(it)).toBe(false);
    expect(hasRide(it)).toBe(false);
  });

  it('never joins a shuttle whose boarding wait it cannot meet', () => {
    const state = makeState();
    purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    const a = hireUnlicensed(state, 0, 0);
    dispatch(state, a, orderAt(state, 100, 0));
    // 48 cells from the shuttle: a walk of 24 ticks, three times the boarding wait.
    const b = hireUnlicensed(state, 50, 1);

    const it = plan(state, b, orderAt(state, 104, 2));

    expect(hasPassengerBoard(it)).toBe(false);
    expect(hasRide(it)).toBe(false);
  });
});

describe('shuttle sharing: the driver holds for a bounded wait (#2290 C6)', () => {
  it('installing a passenger itinerary adds a zero-length boarding hold right after the driver\'s board leg', () => {
    const { state, vehicle, a } = shuttleTrip();
    const b = hireUnlicensed(state, 0, 1);

    dispatch(state, b, orderAt(state, FAR + 4, 2));

    const legs = a.itinerary!.legs;
    expect(legs[0]!.onArrive).toEqual({ kind: 'board', vehicleId: vehicle.id });
    const hold = legs[1]!;
    expect(hold.boardingHold).toBe(true);
    expect(hold.mode).toBe('foot');
    expect(hold.dwellTicks).toBeGreaterThan(0);
    expect(hold.dwellTicks).toBeLessThanOrEqual(TRAVEL_BOARDING_WAIT_TICKS);
    expect(hold.destX).toBe(vehicle.x);
    expect(hold.destZ).toBe(vehicle.z);
    expect(legs.slice(2).some(l => l.mode === 'drive' && l.vehicleId === vehicle.id)).toBe(true);
  });

  it('with no passenger the driver\'s itinerary has no hold', () => {
    const { a } = shuttleTrip();
    expect(a.itinerary!.legs.some(l => l.boardingHold === true)).toBe(false);
  });

  it('a passenger whose driver is not aboard waits at most the boarding wait, then its itinerary clears', () => {
    const { state, vehicle, a } = shuttleTrip();
    const b = hireUnlicensed(state, 0, 1);
    dispatch(state, b, orderAt(state, FAR + 4, 2));
    // The driver never comes: its journey is cancelled before it boards.
    a.itinerary = null;
    a.activeActionId = null;

    let ticks = 0;
    for (; ticks < MAX_TICKS && b.itinerary !== null; ticks++) tickLocomotion(state);

    expect(b.itinerary, 'still waiting').toBeNull();
    expect(ticks).toBeLessThanOrEqual(TRAVEL_BOARDING_WAIT_TICKS + 3);
    expect(b.locomotion).toEqual({ kind: 'on_foot' });
    expect(vehicle.occupantIds).toEqual([]);
  });

  it('the shuttle leaves with whoever boarded: a passenger who never shows costs the driver at most the boarding wait', () => {
    const { state, vehicle, a, actionA } = shuttleTrip();
    const b = hireUnlicensed(state, 0, 1);
    dispatch(state, b, orderAt(state, FAR + 4, 2));
    b.itinerary = null; // B changes its mind and stays on foot.
    b.activeActionId = null;

    let ticks = 0;
    for (; ticks < MAX_TICKS && a.itinerary !== null; ticks++) tickLocomotion(state);

    expect(a.itinerary, 'the driver never left').toBeNull();
    expect(Math.hypot(a.x - actionA.targetX, a.z - actionA.targetZ)).toBeLessThan(2);
    expect(vehicle.occupantIds).toEqual([]);

    const alone = shuttleTrip();
    let aloneTicks = 0;
    for (; aloneTicks < MAX_TICKS && alone.a.itinerary !== null; aloneTicks++) tickLocomotion(alone.state);
    expect(ticks).toBeLessThanOrEqual(aloneTicks + TRAVEL_BOARDING_WAIT_TICKS + 2);
  });
});

describe('shuttle sharing: the ride in the sim (#2290 C4, C6, C9)', () => {
  it('a passenger boards behind the driver, rides on the vehicle\'s cell, and walks on from the drop point', () => {
    const { state, vehicle, a, actionA } = shuttleTrip();
    const b = hireUnlicensed(state, 0, 1);
    const actionB = orderAt(state, FAR + 4, 2);
    dispatch(state, b, actionB);
    const boardingsBefore = state.vehicles.driverBoardingCount;

    let sawBoth = false;
    for (let n = 0; n < MAX_TICKS && (a.itinerary !== null || b.itinerary !== null); n++) {
      tickLocomotion(state);
      expectNoWorldInvariantViolations(state);
      if (vehicle.occupantIds.includes(b.id)) {
        expect(vehicleDriverId(vehicle)).toBe(a.id);
        expect(b.x).toBe(vehicle.x);
        expect(b.z).toBe(vehicle.z);
        expect(vehicle.occupantIds.length).toBeLessThanOrEqual(6);
        if (vehicle.occupantIds.includes(a.id)) sawBoth = true;
      }
    }

    expect(sawBoth, 'passenger never rode with the driver').toBe(true);
    expect(a.itinerary).toBeNull();
    expect(b.itinerary).toBeNull();
    expect(Math.hypot(a.x - actionA.targetX, a.z - actionA.targetZ)).toBeLessThan(2);
    expect(Math.hypot(b.x - actionB.targetX, b.z - actionB.targetZ)).toBeLessThan(2);
    expect(b.locomotion).toEqual({ kind: 'on_foot' });
    expect(vehicle.occupantIds).toEqual([]);
    // Only the driver counted as a driver boarding, and the passenger earned no driving skill.
    expect(state.vehicles.driverBoardingCount).toBe(boardingsBefore + 1);
    expect(b.qualifications).toEqual([]);
  });

  it('three employees with far tasks at the same island board one shuttle and arrive together, sooner than a walking control', () => {
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    const crew = [hireUnlicensed(state, 0, 0), hireUnlicensed(state, 0, 1), hireUnlicensed(state, 1, 1)];
    const targets: Array<[number, number]> = [[FAR, 0], [FAR + 3, 1], [FAR - 3, 1]];
    crew.forEach((e, i) => dispatch(state, e, orderAt(state, targets[i]![0], targets[i]![1])));
    expect(crew.filter(e => hasPassengerBoard(e.itinerary))).toHaveLength(2);

    const arrivedAt: Array<number | null> = crew.map(() => null);
    let maxAboard = 0;
    for (let n = 1; n <= MAX_TICKS && arrivedAt.some(t => t === null); n++) {
      tickLocomotion(state);
      maxAboard = Math.max(maxAboard, vehicle.occupantIds.length);
      crew.forEach((e, i) => { if (arrivedAt[i] === null && e.itinerary === null) arrivedAt[i] = n; });
    }

    expect(maxAboard).toBe(3);
    expect(arrivedAt.every(t => t !== null)).toBe(true);
    const ticks = arrivedAt as number[];
    crew.forEach((e, i) => expect(Math.hypot(e.x - targets[i]![0], e.z - targets[i]![1]), `employee ${i}`).toBeLessThan(2));
    expect(Math.max(...ticks) - Math.min(...ticks)).toBeLessThanOrEqual(TRAVEL_BOARDING_WAIT_TICKS + 4);
    const control = walkTicks({ x: 0, z: 0 }, { x: FAR, z: 0 });
    expect(Math.max(...ticks)).toBeLessThan(control);
    expect(vehiclePassengerIds(vehicle)).toEqual([]);
  });

  it('the race car carries its driver alone: the others never board it', () => {
    const state = makeState();
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0, 2);
    const crew = [hireUnlicensed(state, 0, 0), hireUnlicensed(state, 0, 1), hireUnlicensed(state, 1, 1)];
    const targets: Array<[number, number]> = [[FAR, 0], [FAR + 3, 1], [FAR - 3, 1]];
    crew.forEach((e, i) => dispatch(state, e, orderAt(state, targets[i]![0], targets[i]![1])));
    expect(crew.some(e => hasPassengerBoard(e.itinerary))).toBe(false);

    let maxAboard = 0;
    for (let n = 0; n < MAX_TICKS && crew.some(e => e.itinerary !== null); n++) {
      tickLocomotion(state);
      maxAboard = Math.max(maxAboard, vehicle.occupantIds.length);
    }

    expect(maxAboard).toBeLessThanOrEqual(1);
  });
});
