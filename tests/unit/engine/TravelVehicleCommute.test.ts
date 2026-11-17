// BlastSimulator2026 — the travel vehicle commute (#2285 C9, C10)
//
// A far order for an employee with no vehicle role of its own (survey, general work) boards a free shuttle or race car
// when riding is strictly quicker than walking; a near order walks; the ride stays parked where it was left. Planner
// tests read the Itinerary; the sim tests drive it with tickLocomotion, the executor the game runs.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, getVehicleReservation, getVehicleDefByTier, vehicleDriverId, type Vehicle } from '../../../src/core/entities/Vehicle.js';
import { NavGrid, type NavCell, type NavCellType } from '../../../src/core/nav/NavGrid.js';
import { planItinerary } from '../../../src/core/engine/PlanItinerary.js';
import type { Goal, Itinerary } from '../../../src/core/engine/Itinerary.js';
import { tickLocomotion } from '../../../src/core/engine/Locomotion.js';
import { board } from '../../../src/core/engine/Mount.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { createQuestState, advanceQuests, isQuestCompleted } from '../../../src/core/economy/Quests.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { AGENT_WALK_SPEED, TRAVEL_VEHICLE_WALK_THRESHOLD_CELLS, CELLS_PER_KM, QUEST_RACE_CAR_TRAVEL_KM } from '../../../src/core/config/balance.js';

const SEED = 42;
const FAR = TRAVEL_VEHICLE_WALK_THRESHOLD_CELLS * 3;

function makeCell(type: NavCellType): NavCell {
  return { type, moveCost: type === 'walkable' ? 1.0 : Infinity, benchLevel: 0, vehicleOccupied: false };
}

/** A flat, fully walkable grid wide enough for the far orders below. */
function makeState(width = 120, height = 20): GameState {
  const state = createGame({ seed: SEED });
  const cells: NavCell[][] = [];
  for (let z = 0; z < height; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < width; x++) row.push(makeCell('walkable'));
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
/** A plain on-foot 'work' order (no vehicle role) pushed on the pool. */
function orderAt(state: GameState, targetX: number, targetZ: number): PendingAction {
  const action: PendingAction = {
    id: nextActionId++, type: 'general_work', requiredSkill: null, requiredVehicleRole: null,
    targetX, targetZ, targetY: 0, payload: {}, targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0,
  };
  state.pendingActions.push(action);
  return action;
}

const goalOf = (a: PendingAction): Goal => ({ kind: 'work', actionId: a.id });
const plan = (state: GameState, employee: Employee, a: PendingAction): Itinerary | null =>
  planItinerary(state, employee, goalOf(a), 'exact', { action: a });
const ridesVehicle = (it: Itinerary, v: Vehicle): boolean => it.legs.some(l => l.mode === 'drive' && l.vehicleId === v.id);

/** The same trip with no vehicle in the fleet: the walking baseline. */
function walkingBaseline(from: { x: number; z: number }, to: { x: number; z: number }): Itinerary {
  const state = makeState();
  const e = hireUnlicensed(state, from.x, from.z);
  const it = plan(state, e, orderAt(state, to.x, to.z));
  expect(it).not.toBeNull();
  return it!;
}

describe('travel vehicle commute: planning (#2285 C9)', () => {
  it('a far order with a free shuttle beside the employee: board, drive, alight, then foot to the target — strictly quicker than walking', () => {
    const state = makeState();
    const employee = hireUnlicensed(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    const action = orderAt(state, FAR, 0);

    const it = plan(state, employee, action);
    expect(it).not.toBeNull();
    const legs = it!.legs;
    expect(legs[0]!.mode).toBe('foot');
    expect(legs[0]!.onArrive).toEqual({ kind: 'board', vehicleId: vehicle.id });
    const drive = legs.find(l => l.mode === 'drive');
    expect(drive, `legs: ${JSON.stringify(legs)}`).toBeDefined();
    expect(drive!.vehicleId).toBe(vehicle.id);
    expect(drive!.onArrive.kind).toBe('alight');
    expect(legs[legs.length - 1]!.mode).toBe('foot');
    expect(legs[legs.length - 1]!.destX).toBe(action.targetX);
    expect(legs[legs.length - 1]!.destZ).toBe(action.targetZ);
    expect(legs.indexOf(drive!)).toBeGreaterThan(0);

    const walk = walkingBaseline({ x: 0, z: 0 }, { x: FAR, z: 0 });
    expect(walk.legs.every(l => l.mode === 'foot')).toBe(true);
    expect(it!.estTotalTicks).toBeLessThan(walk.estTotalTicks);
  });

  it('planning is read-only: nothing is reserved or boarded', () => {
    const state = makeState();
    const employee = hireUnlicensed(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    const action = orderAt(state, FAR, 0);
    const before = structuredClone(state);
    plan(state, employee, action);
    expect(state).toEqual(before);
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
  });

  it('a target nearer than the threshold walks even with a free shuttle beside the employee', () => {
    const state = makeState();
    const employee = hireUnlicensed(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    const near = orderAt(state, TRAVEL_VEHICLE_WALK_THRESHOLD_CELLS - 4, 0);
    const it = plan(state, employee, near);
    expect(it).not.toBeNull();
    expect(ridesVehicle(it!, vehicle)).toBe(false);
    expect(it!.legs.every(l => l.mode === 'foot')).toBe(true);
  });

  it('a target exactly at the threshold walks; just beyond it rides', () => {
    const state = makeState();
    const employee = hireUnlicensed(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 1, 0);
    const at = orderAt(state, TRAVEL_VEHICLE_WALK_THRESHOLD_CELLS, 0);
    expect(ridesVehicle(plan(state, employee, at)!, vehicle)).toBe(false);
    const beyond = orderAt(state, TRAVEL_VEHICLE_WALK_THRESHOLD_CELLS + 6, 0);
    expect(ridesVehicle(plan(state, employee, beyond)!, vehicle)).toBe(true);
  });

  it('the distance that counts is the straight line from the employee, not from the vehicle', () => {
    const state = makeState();
    const employee = hireUnlicensed(state, 60, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 61, 0);
    // The shuttle stands 40 cells from this target, the employee only 10: a near order, so it walks.
    const near = orderAt(state, 70, 0);
    expect(ridesVehicle(plan(state, employee, near)!, vehicle)).toBe(false);
  });

  it('a far shuttle is not fetched when walking is quicker: shuttle farther from the employee than the target', () => {
    const state = makeState();
    const employee = hireUnlicensed(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', FAR + 20, 0);
    const it = plan(state, employee, orderAt(state, FAR, 0));
    expect(it).not.toBeNull();
    expect(ridesVehicle(it!, vehicle)).toBe(false);
    expect(it!.legs.every(l => l.mode === 'foot')).toBe(true);
  });

  it('an occupied shuttle is not taken', () => {
    const state = makeState();
    const employee = hireUnlicensed(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    const other = hireUnlicensed(state, 2, 0);
    expect(board(state, vehicle.id, other.id).success).toBe(true);
    const it = plan(state, employee, orderAt(state, FAR, 0));
    expect(it).not.toBeNull();
    expect(ridesVehicle(it!, vehicle)).toBe(false);
  });

  it('a reserved shuttle is not taken', () => {
    const state = makeState();
    const employee = hireUnlicensed(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    reserveVehicle(state.vehicles, vehicle.id, 9999);
    const it = plan(state, employee, orderAt(state, FAR, 0));
    expect(it).not.toBeNull();
    expect(ridesVehicle(it!, vehicle)).toBe(false);
  });

  it('a shuttle out of service is not taken', () => {
    const state = makeState();
    const employee = hireUnlicensed(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    state.events.activeModifiers.push({
      id: 1, kind: 'out_of_service', sourceEventId: 'test', role: null, targetId: vehicle.id, targetKind: 'vehicle',
      category: null, magnitude: 1, startTick: 0, endTick: null,
    });
    const it = plan(state, employee, orderAt(state, FAR, 0));
    expect(it).not.toBeNull();
    expect(ridesVehicle(it!, vehicle)).toBe(false);
  });

  it('a shuttle under repair is not taken', () => {
    const state = makeState();
    const employee = hireUnlicensed(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    const repair = orderAt(state, vehicle.x, vehicle.z);
    repair.type = 'repair_vehicle';
    repair.status = 'in_progress';
    repair.payload = { vehicleId: vehicle.id };
    const it = plan(state, employee, orderAt(state, FAR, 0));
    expect(it).not.toBeNull();
    expect(ridesVehicle(it!, vehicle)).toBe(false);
  });

  it('with two free shuttles the nearer to the employee is the one boarded', () => {
    const state = makeState();
    const employee = hireUnlicensed(state, 0, 0);
    const far = purchaseVehicle(state.vehicles, 'travel_vehicle', 8, 0).vehicle;
    const near = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0).vehicle;
    const it = plan(state, employee, orderAt(state, FAR, 0))!;
    expect(ridesVehicle(it, near)).toBe(true);
    expect(ridesVehicle(it, far)).toBe(false);
  });

  it('the race car trip is no slower than the shuttle trip for the same order', () => {
    const totalWith = (tier: 1 | 2): number => {
      const state = makeState();
      const employee = hireUnlicensed(state, 0, 0);
      const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0, tier);
      const it = plan(state, employee, orderAt(state, FAR, 0))!;
      expect(ridesVehicle(it, vehicle)).toBe(true);
      return it.estTotalTicks;
    };
    expect(totalWith(2)).toBeLessThanOrEqual(totalWith(1));
  });

  it('the shuttle really is faster than a walker (so the ride can win)', () => {
    expect(getVehicleDefByTier('travel_vehicle', 1).speed).toBeGreaterThan(AGENT_WALK_SPEED);
  });

  it('an employee already mounted in the shuttle keeps driving it to a far target (single drive leg, no boarding)', () => {
    const state = makeState();
    const employee = hireUnlicensed(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 0, 0);
    expect(board(state, vehicle.id, employee.id).success).toBe(true);
    const it = plan(state, employee, orderAt(state, FAR, 0));
    expect(it).not.toBeNull();
    expect(it!.legs.some(l => l.mode === 'drive' && l.vehicleId === vehicle.id)).toBe(true);
    expect(it!.legs.some(l => l.onArrive.kind === 'board')).toBe(false);
  });
});

// ── In the sim ───────────────────────────────────────────────────────────────

const MAX_TICKS = 400;

/** Hand the order to `employee` and run the executor until its itinerary empties. Returns the ticks it took. */
function commute(state: GameState, employee: Employee, action: PendingAction): number {
  action.status = 'assigned';
  action.holderId = employee.id;
  employee.activeActionId = action.id;
  employee.itinerary = plan(state, employee, action);
  expect(employee.itinerary).not.toBeNull();
  let ticks = 0;
  for (; ticks < MAX_TICKS && employee.itinerary !== null; ticks++) tickLocomotion(state);
  expect(employee.itinerary, `still travelling after ${MAX_TICKS} ticks`).toBeNull();
  return ticks;
}

describe('travel vehicle commute: in the sim (#2285 C10)', () => {
  it('an employee ordered far away rides the shuttle, arrives markedly sooner than a walking control, and stands at the target', () => {
    const state = makeState();
    const rider = hireUnlicensed(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    let boarded = false;
    const rideTicks = (() => {
      const action = orderAt(state, FAR, 0);
      action.status = 'assigned';
      action.holderId = rider.id;
      rider.activeActionId = action.id;
      rider.itinerary = plan(state, rider, action);
      let n = 0;
      for (; n < MAX_TICKS && rider.itinerary !== null; n++) {
        tickLocomotion(state);
        if (vehicle.occupantIds.includes(rider.id)) boarded = true;
      }
      return n;
    })();
    expect(boarded).toBe(true);
    expect(rider.itinerary).toBeNull();
    expect(Math.hypot(rider.x - FAR, rider.z - 0)).toBeLessThan(2);

    const control = makeState();
    const walker = hireUnlicensed(control, 0, 0);
    const walkTicks = commute(control, walker, orderAt(control, FAR, 0));
    expect(rideTicks).toBeLessThan(walkTicks * 0.7);
  });

  it('afterwards the rider is on foot, the shuttle is parked off the origin, free: no occupant, no reservation, no driver', () => {
    const state = makeState();
    const rider = hireUnlicensed(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    commute(state, rider, orderAt(state, FAR, 0));
    expect(rider.locomotion).toEqual({ kind: 'on_foot' });
    expect(vehicle.occupantIds).toEqual([]);
    expect(vehicleDriverId(vehicle)).toBeNull();
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
    expect(vehicle.x).toBeGreaterThan(FAR / 2);
    expect(Math.hypot(vehicle.x - FAR, vehicle.z)).toBeLessThan(6);
  });

  it('the shuttle left at the far end is taken by the next employee there, for the trip back', () => {
    const state = makeState();
    const first = hireUnlicensed(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    commute(state, first, orderAt(state, FAR, 0));

    const second = hireUnlicensed(state, Math.round(vehicle.x) - 2, 0);
    const back = orderAt(state, 0, 0);
    const it = plan(state, second, back);
    expect(it).not.toBeNull();
    expect(ridesVehicle(it!, vehicle)).toBe(true);
    const ticks = commute(state, second, back);
    expect(Math.hypot(second.x, second.z)).toBeLessThan(2);
    expect(vehicle.occupantIds).toEqual([]);
    expect(ticks).toBeLessThan(FAR / AGENT_WALK_SPEED);
  });

  it('a far order with no shuttle is walked in about distance / walking speed (control)', () => {
    const state = makeState();
    const walker = hireUnlicensed(state, 0, 0);
    const ticks = commute(state, walker, orderAt(state, FAR, 0));
    expect(ticks).toBeGreaterThan(FAR / AGENT_WALK_SPEED * 0.8);
  });

  it('a near order is walked and leaves the shuttle untouched where it stood', () => {
    const state = makeState();
    const walker = hireUnlicensed(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    commute(state, walker, orderAt(state, TRAVEL_VEHICLE_WALK_THRESHOLD_CELLS - 6, 0));
    expect(vehicle.x).toBe(2);
    expect(vehicle.z).toBe(0);
    expect(vehicle.occupantIds).toEqual([]);
  });

  it('the race car gets there no later than the shuttle', () => {
    const run = (tier: 1 | 2): number => {
      const state = makeState();
      const rider = hireUnlicensed(state, 0, 0);
      purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0, tier);
      return commute(state, rider, orderAt(state, FAR, 0));
    };
    expect(run(2)).toBeLessThanOrEqual(run(1));
  });
});

describe('travel vehicle commute: kilometres driven feed the race-car quest (#2285 C6)', () => {
  function questState(): GameState {
    const state = makeState();
    state.grade = createGradeState();
    state.quests = createQuestState();
    return state;
  }

  it('driving a travel vehicle adds the cells driven to quests.travelCells', () => {
    const state = questState();
    const rider = hireUnlicensed(state, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    const startX = vehicle.x;
    const startZ = vehicle.z;
    commute(state, rider, orderAt(state, FAR, 0));
    const driven = Math.hypot(vehicle.x - startX, vehicle.z - startZ);
    expect(driven).toBeGreaterThan(FAR / 2);
    expect(state.quests!.travelCells).toBeGreaterThan(driven * 0.9);
    expect(state.quests!.travelCells).toBeLessThan(driven * 1.15);
  });

  it('walking adds nothing', () => {
    const state = questState();
    const walker = hireUnlicensed(state, 0, 0);
    commute(state, walker, orderAt(state, FAR, 0));
    expect(state.quests!.travelCells).toBe(0);
  });

  it('a work vehicle ridden as transport adds nothing (only travel vehicles count)', () => {
    const state = questState();
    const rider = hireUnlicensed(state, 0, 0);
    assignSkill(state.employees, rider.id, 'driving.truck', 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 0);
    const action = orderAt(state, FAR, 0);
    const it = plan(state, rider, action);
    expect(it).not.toBeNull();
    expect(ridesVehicle(it!, vehicle)).toBe(true);
    commute(state, rider, action);
    expect(state.quests!.travelCells).toBe(0);
  });

  it('the cells accumulate over several rides', () => {
    const state = questState();
    const rider = hireUnlicensed(state, 0, 0);
    purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    commute(state, rider, orderAt(state, FAR, 0));
    const afterOne = state.quests!.travelCells;
    expect(afterOne).toBeGreaterThan(0);
    commute(state, rider, orderAt(state, 0, 0));
    expect(state.quests!.travelCells).toBeGreaterThan(afterOne * 1.5);
  });

  it('a site without quest state rides without error and books nothing', () => {
    const state = makeState();
    expect(state.quests).toBeUndefined();
    const rider = hireUnlicensed(state, 0, 0);
    purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    expect(() => commute(state, rider, orderAt(state, FAR, 0))).not.toThrow();
  });

  it('enough driving completes the race-car quest', () => {
    const state = questState();
    state.quests!.travelCells = QUEST_RACE_CAR_TRAVEL_KM * CELLS_PER_KM - FAR / 2;
    const rider = hireUnlicensed(state, 0, 0);
    purchaseVehicle(state.vehicles, 'travel_vehicle', 2, 0);
    expect(advanceQuests(state)).not.toContain('quest_race_car');
    commute(state, rider, orderAt(state, FAR, 0));
    expect(advanceQuests(state)).toContain('quest_race_car');
    expect(isQuestCompleted(state, 'quest_race_car')).toBe(true);
  });
});
