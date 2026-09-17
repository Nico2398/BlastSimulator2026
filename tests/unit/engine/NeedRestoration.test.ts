// BlastSimulator2026 — Tests for tickNeedRestoration (auto-routing employees
// whose fatigue gauge drops below the warning threshold to a living_quarters
// building) and tickCollapse (relocated from GameLoop.test.ts, #759).
//
// #928: hunger and breakNeed removed — fatigue is the sole gauge every
// routing/collapse decision reads.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { tickNeedRestoration, tickCollapse } from '../../../src/core/engine/NeedRestoration.js';
import { tickEmployees } from '../../../src/core/engine/EmployeeDispatch.js';
import { autoInsertNeedTasks } from '../../../src/core/engine/NeedTaskInsertion.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, vehicleDriverId, getVehicleReservation } from '../../../src/core/entities/Vehicle.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { computeEmployeeActivity } from '../../../src/core/entities/EmployeeActivity.js';
import type { PendingAction } from '../../../src/core/state/GameState.js';
import type { FiredEvent } from '../../../src/core/events/EventSystem.js';
import type { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { assertWorldInvariants } from '../../../src/core/state/WorldInvariants.js';
import {
  NEED_REST_DURATIONS,
} from '../../../src/core/config/balance.js';


describe('tickNeedRestoration (Task 3.11)', () => {
  const SEED = 42;

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('routes a fatigued employee (fatigue < 25) to rest when a living_quarters is active', () => {
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    // Fatigue 20 is below the NEED_SOFT_THRESHOLDS.fatigue = 25 threshold.
    employee.fatigue = 20;

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100);

    const result = tickNeedRestoration(state);

    expect(result.routed).toContain(employee.id);
    expect(employee.activeActionId).not.toBeNull();

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('does NOT route an employee whose fatigue is comfortably above threshold', () => {
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    // Well above the threshold (25).
    employee.fatigue = 80;

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100);

    const result = tickNeedRestoration(state);
    expect(result.routed).toHaveLength(0);
    expect(employee.activeActionId).toBeNull();
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('does NOT route an already-busy employee even when they are exhausted', () => {
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    // Employee is critically exhausted but already claimed a different action.
    employee.fatigue        = 5; // far below the threshold of 25
    employee.activeActionId = 99; // already busy

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100);

    const result = tickNeedRestoration(state);

    // Busy employees must be skipped entirely.
    expect(result.routed).toHaveLength(0);
    // The pre-existing activeActionId must remain untouched.
    expect(employee.activeActionId).toBe(99);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('adds employee to noBuilding when fatigue is below threshold but no living_quarters exists', () => {
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 20; // below the threshold of 25
    // No buildings placed — living_quarters is absent.

    const result = tickNeedRestoration(state);

    // With no available building, the employee cannot be routed.
    expect(result.noBuilding).toContain(employee.id);
    // Employee must NOT be assigned any action.
    expect(employee.activeActionId).toBeNull();
    // Result routed list must be empty.
    expect(result.routed).toHaveLength(0);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('tickEmployees does not reassign an employee who is currently resting', () => {
    // An employee already holding a rest action (activeActionId != null) must be
    // treated as "busy" by tickEmployees — work actions must stay in pendingActions.
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    assignSkill(state.employees, employee.id, 'blasting', 1);

    // Simulate the employee being mid-rest: their activeActionId is set.
    const REST_ACTION_ID = 500;
    employee.activeActionId = REST_ACTION_ID;

    // A new blast work action is now pending.
    const workAction: PendingAction = {
      id: 600,
      type: 'drill_hole',
      requiredSkill: 'blasting',
      requiredVehicleRole: null,
      targetX: 5,
      targetZ: 5,
      targetY: 0,
      payload: {},
      targetEmployeeId: null,
      status: 'queued',
      holderId: null,
      queuedAtTick: 0,
    };
    state.pendingActions.push(workAction);

    tickEmployees(state);

    // The work action must remain in pendingActions — the resting employee cannot
    // claim it while their activeActionId is non-null.
    expect(state.pendingActions).toHaveLength(1);
    expect(state.pendingActions[0]!.id).toBe(600);

    // The employee's rest assignment must be undisturbed.
    expect(employee.activeActionId).toBe(REST_ACTION_ID);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('selects the nearest active living_quarters by Euclidean distance', () => {
    // Employee is at (0, 0).
    // Two living_quarters buildings are placed:
    //   • near:  origin (5, 0)  — Euclidean distance from employee ≈ 5
    //   • far:   origin (50, 50) — Euclidean distance from employee ≈ 70.7
    // The routing logic must pick the nearer building.
    //
    // Note: living_quarters tier 1 has a 3×3 footprint, so both buildings
    // fit comfortably within the 100×100 grid without overlapping.
    const state = createGame({ seed: SEED });
    const rng   = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x       = 0;
    employee.z       = 0;
    employee.fatigue  = 20; // below the threshold of 25

    // Near building: origin (5, 0)
    const nearResult = placeBuilding(state.buildings, 'living_quarters', 5, 0, 100, 100);
    expect(nearResult.success).toBe(true); // guard: placement must succeed

    // Far building: origin (50, 50)  — 3×3 footprint keeps it within grid
    const farResult = placeBuilding(state.buildings, 'living_quarters', 50, 50, 100, 100);
    expect(farResult.success).toBe(true); // guard: placement must succeed

    tickNeedRestoration(state);

    // The created rest action must target the nearer building, not the far one.
    const restAction = state.pendingActions.find((a: PendingAction) => a.type === 'rest');
    expect(restAction).toBeDefined();

    // targetX and targetZ must correspond to the near building's location (x=5, z=0),
    // not the far building's location (x=50, z=50).
    expect(restAction!.targetX).toBe(nearResult.building!.x);
    expect(restAction!.targetZ).toBe(nearResult.building!.z);
    expect(restAction!.targetX).not.toBe(farResult.building!.x);
  });

  // #1013: computeEmployeeActivity must report actionType: 'rest' the
  // instant a warning-threshold employee starts walking to a living_quarters
  // — this is what lets EmployeePictograms.ts's pictogramKindFor distinguish
  // a walk-to-rest from an ordinary task walk. Before beginRestWalk is wired
  // in here, tickNeedRestoration sets destinationX/destinationZ directly
  // without touching pendingActionType, so this reads null instead — the bug
  // this test pins the fix for.
  it('#1013: a routed employee reports actionType "rest" via computeEmployeeActivity while walking to the living_quarters', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'blaster', rng);
    employee.fatigue = 20; // below the NEED_SOFT_THRESHOLDS.fatigue = 25 threshold

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100);

    tickNeedRestoration(state);

    const activity = computeEmployeeActivity(employee, state.vehicles);
    expect(activity.kind).toBe('walking');
    expect(activity.actionType).toBe('rest');
  });

  // #1042: an employee mid-evacuation-drive (boarded a driverless vehicle and
  // is driving it clear of a danger zone) has no activeActionId of their own
  // — mirrors the isMidEvacuationWalk skip this file already relies on for a
  // walking evacuee, but for one driving instead. Without the analogous
  // isMidEvacuationDrive guard, this routine would self-claim a fresh rest
  // action over the drive, overwriting nothing on the employee (they have no
  // destinationX of their own while driving) but abandoning the vehicle
  // mid-evacuation with no driver actively finishing the drive.
  it('does NOT route an employee mid-evacuation-drive even when fatigue is below threshold (#1042)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    employee.fatigue = 10; // below the threshold of 25
    employee.activeActionId = null;
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    vehicle.occupantIds = [employee.id];
    // Mid-evacuation-drive is read off the driver's own itinerary since
    // #1092: a `reposition` goal whose last leg puts them back on foot, the
    // shape only clearZone (Zone.ts) ever plans.
    employee.itinerary = {
      goal: { kind: 'reposition', x: 40, z: 40 },
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 40, destZ: 40,
        arrival: 'exact', onArrive: { kind: 'alight' }, estTicks: 9,
      }],
      workTicks: 0,
      estTotalTicks: 9,
    };

    placeBuilding(state.buildings, 'living_quarters', 0, 0, 100, 100);

    const result = tickNeedRestoration(state);

    expect(result.routed).toHaveLength(0);
    expect(employee.activeActionId).toBeNull();
  });

  // #1118: tickNeedRestoration routes a mounted employee's soft-threshold
  // rest through beginRestTravel (RestActionHelpers.ts) instead of
  // beginRestWalk — a mounted employee keeps the vehicle and drives to rest,
  // rather than desyncing their position from it (I2_mounted_position_mismatch)
  // the way a plain destinationX/Z field-write would.
  it('#1118: an idle mounted employee crossing the soft fatigue threshold stays mounted, with a drive-leg itinerary installed toward the rest building', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    employee.fatigue = 20; // below NEED_SOFT_THRESHOLDS.fatigue (25)

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickNeedRestoration(state);

    expect(result.routed).toContain(employee.id);
    expect(employee.locomotion).toEqual({ kind: 'mounted', vehicleId: vehicle.id });
    expect(employee.itinerary).not.toBeNull();
    const driveLeg = employee.itinerary!.legs.find(l => l.mode === 'drive');
    expect(driveLeg).toBeDefined();
    expect(driveLeg!.vehicleId).toBe(vehicle.id);
  });
});

describe('tickCollapse (7.6)', () => {
  const SEED = 42;

  // ── Test 1 ──────────────────────────────────────────────────────────────────
  it('collapsed employee gets rest PendingAction created', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 0;
    employee.x = 0;
    employee.z = 0;

    // Place a living_quarters within search radius
    const buildResult = placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);
    expect(buildResult.success).toBe(true);

    const result = tickCollapse(state);

    // Result must report this employee as collapsed
    expect(result.collapsed).toHaveLength(1);
    expect(result.collapsed[0]).toBe(employee.id);

    // A rest PendingAction must have been created for this employee
    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
    // The collapsed need must be 'fatigue' — the sole gauge (#928)
    expect(restAction!.payload.collapsedNeed).toBe('fatigue');
  });

  // ── Test 2 ──────────────────────────────────────────────────────────────────
  it('rest action targets the nearest living_quarters building', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 0;
    employee.x = 0;
    employee.z = 0;

    // Two living_quarters: one near (5,5), one far (20,20)
    const nearResult = placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);
    expect(nearResult.success).toBe(true);
    const farResult = placeBuilding(state.buildings, 'living_quarters', 20, 20, 100, 100);
    expect(farResult.success).toBe(true);

    tickCollapse(state);

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest',
    );
    expect(restAction).toBeDefined();
    // Must target the nearer building
    expect(restAction!.targetX).toBe(nearResult.building!.x);
    expect(restAction!.targetZ).toBe(nearResult.building!.z);
    expect(restAction!.targetX).not.toBe(farResult.building!.x);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────────
  it('no building within 20 cells → restDuration doubled in payload', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 0;
    employee.x = 0;
    employee.z = 0;

    // Building at (50,50) is > 20 cells from (0,0)
    placeBuilding(state.buildings, 'living_quarters', 50, 50, 100, 100);

    tickCollapse(state);

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest',
    );
    expect(restAction).toBeDefined();
    // restDuration must be doubled (base 8 × 2 = 16 for fatigue)
    expect(restAction!.payload.restDuration).toBe(NEED_REST_DURATIONS.fatigue * 2);
  });

  // ── Test 4 ──────────────────────────────────────────────────────────────────
  it('no building at all → rest duration doubled, target is employee position', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 0;
    employee.x = 7;
    employee.z = 13;

    // No living_quarters placed anywhere

    tickCollapse(state);

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest',
    );
    expect(restAction).toBeDefined();
    // Target must be the employee's current position
    expect(restAction!.targetX).toBe(7);
    expect(restAction!.targetZ).toBe(13);
    // restDuration must be doubled
    expect(restAction!.payload.restDuration).toBe(NEED_REST_DURATIONS.fatigue * 2);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────────
  it('fatigue above threshold → no action created', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 50;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────────
  it('already collapsing → not re-processed', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.collapsing = true;
    employee.fatigue = 0;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(0);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────────
  it('dead employee → skipped', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.alive = false;
    employee.fatigue = 0;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toHaveLength(0);
  });

  // ── Test 8 ──────────────────────────────────────────────────────────────────
  it('injured employee → skipped', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.injured = true;
    employee.fatigue = 0;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toHaveLength(0);
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────────
  it('collapsed result contains employee IDs', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 0;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toEqual([employee.id]);
  });

  // ── Test 10 ─────────────────────────────────────────────────────────────────
  it('fatigue-triggered collapse produces correct collapsedNeed and restDuration', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 0;     // Below (== 0, the hard threshold — NEED_HARD_THRESHOLDS.fatigue)
    employee.x = 0;
    employee.z = 0;

    // Place a living_quarters within search radius
    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    // Result must report this employee as collapsed
    expect(result.collapsed).toHaveLength(1);
    expect(result.collapsed[0]).toBe(employee.id);

    // The rest action must have collapsedNeed: 'fatigue'
    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
    expect(restAction!.payload.collapsedNeed).toBe('fatigue');
    expect(restAction!.payload.restDuration).toBe(NEED_REST_DURATIONS.fatigue);
  });

  // ── Test 11 ─────────────────────────────────────────────────────────────────
  it('adds employee_collapsed to firedEvents when employee collapses', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 0;
    employee.x = 0;
    employee.z = 0;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const firedEvents: FiredEvent[] = [];
    tickCollapse(state, firedEvents);

    expect(firedEvents).toHaveLength(1);
    expect(firedEvents[0]!.eventId).toBe('employee_collapsed');
    expect(firedEvents[0]!.firedAtTick).toBe(state.tickCount);
  });

  // ── Test 12 ─────────────────────────────────────────────────────────────────
  it('emits employee:collapsed via emitter when employee collapses', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 0;
    employee.x = 0;
    employee.z = 0;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const events: string[] = [];
    const mockEmitter = { emit: (event: string) => { events.push(event); } } as unknown as EventEmitter;
    const firedEvents: FiredEvent[] = [];

    tickCollapse(state, firedEvents, mockEmitter);

    expect(events).toContain('employee:collapsed');
  });

  // ── Test 13 ─────────────────────────────────────────────────────────────────
  it('does not emit employee_collapsed when employee is not collapsing', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 50;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const firedEvents: FiredEvent[] = [];
    tickCollapse(state, firedEvents);

    expect(firedEvents).toHaveLength(0);
  });

  // ── Test 14 ─────────────────────────────────────────────────────────────────
  it('emits one employee_collapsed per collapsed employee', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee: emp1 } = hireEmployee(state.employees, 'driller', rng);
    emp1.fatigue = 0;
    emp1.x = 0;
    emp1.z = 0;

    const { employee: emp2 } = hireEmployee(state.employees, 'blaster', rng);
    emp2.fatigue = 0;
    emp2.x = 0;
    emp2.z = 0;

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const firedEvents: FiredEvent[] = [];
    tickCollapse(state, firedEvents);

    expect(firedEvents).toHaveLength(2);
    expect(firedEvents[0]!.eventId).toBe('employee_collapsed');
    expect(firedEvents[1]!.eventId).toBe('employee_collapsed');
  });

  // ── Collapse supersedes a warning-threshold rest queued while the employee was busy ──
  // autoInsertNeedTasks queues a rest for a busy employee without claiming it.
  // If that action survives the collapse, it is claimed the instant the collapse
  // rest ends: a second rest cycle and a second NEED_REST_COSTS charge for one
  // collapse, and two rest entries in the roster panel's task queue.
  it('drops a rest action already queued for the employee it collapses', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 0; // at the collapse threshold (0)

    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    // The warning-threshold rest queued earlier, still unclaimed.
    autoInsertNeedTasks(state);
    const queuedBefore = state.pendingActions.filter(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(queuedBefore).toHaveLength(1);

    tickCollapse(state);

    const restActions = state.pendingActions.filter(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restActions).toHaveLength(1);
    expect(restActions[0]!.id).toBe(employee.activeActionId);
    // The rest timer itself does not start until ArrivalGate confirms the
    // employee has walked to the building — restNeedKey stays queued as
    // pendingRestNeedKey until then (#437).
    expect(employee.pendingRestNeedKey).toBe('fatigue');
  });

  // ── NEW (#928) ──────────────────────────────────────────────────────────────
  // The walk-to-claimed-job survival guard added to ForceShiftRest.ts's two
  // proactive functions does NOT apply here: tickCollapse/checkCollapse is a
  // genuinely different code path (a real collapse, not a proactive nudge)
  // and must keep interrupting an employee in ANY state — including
  // mid-walk to an already-claimed job (pendingTaskDuration !== null) — the
  // instant fatigue crosses the collapse threshold. This path is untouched
  // by #928 and must not regress.
  it('interrupts an employee mid-walk to a claimed job (pendingTaskDuration !== null) when fatigue collapses', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 0; // at the collapse threshold (0)
    employee.activeActionId = 42; // claimed a job
    employee.pendingTaskDuration = 20; // walking to it, not yet arrived — 'traveling' state

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toEqual([employee.id]);
    expect(employee.collapsing).toBe(true);
    // The prior claim is released — collapse interrupts unconditionally,
    // regardless of the employee's travel state.
    expect(employee.activeActionId).not.toBe(42);
    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
  });

  // ── NEW (#945) ──────────────────────────────────────────────────────────────
  // #945 adds a taskTicksRemaining !== null guard to forceShiftRestIfNeeded,
  // forceShiftRestIfNeededByPolicy, and autoInsertNeedTasks — but explicitly
  // does NOT touch tickCollapse/checkCollapse. This is the hard floor
  // (NEED_HARD_THRESHOLDS.fatigue = 0, #1062) that keeps the fix from making a
  // worker immortal: a genuinely collapsing employee must still be
  // interrupted unconditionally, even mid-execution of a claimed, already-
  // arrived task (e.g. mid dig_ramp_segment) — not just mid-walk to one
  // (already covered by the #928 pendingTaskDuration regression test above).
  it('#945: interrupts an employee mid-execution of a claimed task (taskTicksRemaining !== null) when fatigue collapses — tickCollapse is deliberately unguarded', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 0; // at the collapse threshold (0)
    employee.activeActionId = 42; // claimed a job
    employee.taskTicksRemaining = 4; // arrived, mid-execution of it — not just walking

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toEqual([employee.id]);
    expect(employee.collapsing).toBe(true);
    // The prior claim is released — collapse interrupts unconditionally,
    // regardless of the employee's task-execution state.
    expect(employee.activeActionId).not.toBe(42);
    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
  });

  // ── NEW (#1039, widened by #1049) ───────────────────────────────────────────
  // ForceShiftRest.ts's forceShiftRestIfNeededByPolicy gains a
  // PROTECTED_MID_EXECUTION_ACTION_TYPES guard (isMidConstructionWork) —
  // place_building, charge_hole and survey — so a proactive shift-cycle/
  // fatigue-threshold rest no longer fragments a single one of these tasks
  // into many interrupted, restarted attempts. tickCollapse is a genuinely
  // different code path (a real collapse, not a proactive nudge) and is
  // deliberately left unguarded — mirrors the #945 test above (a
  // non-construction claimed task), for each protected action type in turn,
  // to pin that this guard does not accidentally leak protection into the
  // collapse path too.
  it.each<[PendingAction['type'], number, PendingAction['payload']]>([
    ['place_building', 1039, { buildingType: 'driving_center' }],
    ['charge_hole', 1049, { holeId: 1 }],
    ['survey', 1050, { method: 'core_sample' }],
  ])('#1039/#1049: interrupts an employee mid-execution of a %s action when fatigue collapses — tickCollapse is deliberately unguarded', (actionType, id, payload) => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 0; // at the collapse threshold (0)

    const action: PendingAction = {
      id, type: actionType, requiredSkill: null, requiredVehicleRole: null,
      targetX: 6, targetZ: 7, targetY: 0, payload,
      targetEmployeeId: null, status: 'in_progress', holderId: employee.id,
      queuedAtTick: 0,
    };
    state.pendingActions.push(action);
    employee.activeActionId = action.id;
    employee.taskTicksRemaining = 4; // arrived, mid-execution of the task

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toEqual([employee.id]);
    // The claim is released back to the pool, not orphaned — collapse
    // interrupts unconditionally, regardless of action type.
    const released = state.pendingActions.find(a => a.id === id)!;
    expect(released.status).toBe('queued');
    expect(released.holderId).toBeNull();
    expect(employee.activeActionId).not.toBe(id);

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
  });

  // #1013: unlike tickNeedRestoration's proactive routing (mirrored test
  // above), checkCollapse sets employee.collapsing = true for the whole walk
  // AND rest — computeEmployeeActivity checks that flag first (it takes
  // priority over every other state, EmployeeActivity.ts's own doc comment),
  // so a collapse-triggered rest walk reports kind 'collapsed', never
  // 'walking', and the 'collapsed' branch never surfaces actionType (it
  // spreads IDLE, whose actionType is always null). The pictogram this drives
  // (EmployeePictograms.ts's pictogramKindFor) is unambiguous either way — it
  // maps 'collapsed' straight to the 'collapsed' pictogram regardless of
  // actionType — so what this test pins is the underlying field directly:
  // pendingActionType must still read 'rest' once tickCollapse wires
  // beginRestWalk in, for every OTHER consumer of that field (e.g. the Crew
  // panel's "current task" line) even though the pictogram layer itself
  // never needs to read it for this particular kind.
  it('#1013: a collapsed employee routed to a distant living_quarters gets pendingActionType "rest" while walking there (kind stays "collapsed", not "walking" — collapsing takes priority)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    employee.fatigue = 0;
    employee.x = 0;
    employee.z = 0;

    // Within NEED_REST_SEARCH_RADIUS but not at the employee's own position —
    // a genuine walk, not an instant rest-in-place.
    placeBuilding(state.buildings, 'living_quarters', 5, 5, 100, 100);

    tickCollapse(state);

    expect(employee.pendingActionType).toBe('rest');
    const activity = computeEmployeeActivity(employee, state.vehicles);
    expect(activity.kind).toBe('collapsed');
  });

  // #1042 — mirrors tickNeedRestoration's own isMidEvacuationWalk-analogue
  // guard above: an employee mid-evacuation-drive must not be
  // collapse-interrupted out from under the vehicle they are still driving
  // clear of the danger zone.
  it('does NOT collapse an employee mid-evacuation-drive even below the collapse threshold (#1042)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    employee.fatigue = 0; // at NEED_HARD_THRESHOLDS.fatigue (0)
    employee.activeActionId = null;
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    vehicle.occupantIds = [employee.id];
    // Mid-evacuation-drive is read off the driver's own itinerary since
    // #1092: a `reposition` goal whose last leg puts them back on foot, the
    // shape only clearZone (Zone.ts) ever plans.
    employee.itinerary = {
      goal: { kind: 'reposition', x: 40, z: 40 },
      legs: [{
        mode: 'drive', vehicleId: vehicle.id, destX: 40, destZ: 40,
        arrival: 'exact', onArrive: { kind: 'alight' }, estTicks: 9,
      }],
      workTicks: 0,
      estTotalTicks: 9,
    };

    const result = tickCollapse(state);

    expect(result.collapsed).toHaveLength(0);
    expect(employee.collapsing).toBe(false);
  });

  // ── NEW (#1062) ─────────────────────────────────────────────────────────────
  // Hard threshold is always the gauge's own zero (NEED_HARD_THRESHOLDS.fatigue
  // = 0): fatigue reaching exactly 0 the same tick interrupts whatever active
  // action the employee holds, releases it back to the pool, and — for a
  // vehicle-gated action the employee is boarded and mid-execution on — also
  // releases the vehicle reservation and dismounts the driver, rather than
  // leaving a vehicle idling with a driverId that no longer intends to work it.
  it('#1062: fatigue reaching exactly 0 interrupts a boarded vehicle-gated action, releases it to the pool, and releases the vehicle reservation/driver', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng);
    assignSkill(state.employees, employee.id, 'driving.drill_rig', 1);
    employee.x = 0;
    employee.z = 0;
    employee.fatigue = 0; // exactly NEED_HARD_THRESHOLDS.fatigue

    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    const gatedAction: PendingAction = {
      id: 900, type: 'drill_hole', requiredSkill: 'blasting', requiredVehicleRole: 'drill_rig',
      targetX: 3, targetZ: 3, targetY: 0, payload: {},
      targetEmployeeId: null, status: 'in_progress', holderId: employee.id,
      queuedAtTick: 0,
    };
    state.pendingActions.push(gatedAction);
    employee.activeActionId = gatedAction.id;
    employee.taskTicksRemaining = 3; // boarded, mid-execution
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    reserveVehicle(state.vehicles, vehicle.id, gatedAction.id);

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toEqual([employee.id]);
    expect(employee.collapsing).toBe(true);

    // The active action is released back to the open pool, not orphaned.
    const released = state.pendingActions.find(a => a.id === gatedAction.id)!;
    expect(released.status).toBe('queued');
    expect(released.holderId).toBeNull();
    expect(employee.activeActionId).not.toBe(gatedAction.id);

    // The vehicle reservation and its driver are released too.
    expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
    expect(vehicleDriverId(vehicle)).toBeNull();

    const restAction = state.pendingActions.find(
      (a: PendingAction) => a.type === 'rest' && a.targetEmployeeId === employee.id,
    );
    expect(restAction).toBeDefined();
    expect(restAction!.payload.collapsedNeed).toBe('fatigue');
    expect(restAction!.payload.restDuration).toBe(NEED_REST_DURATIONS.fatigue);
  });

  // ── NEW (#1096) ─────────────────────────────────────────────────────────────
  // interruptActiveAction only ever touches emp.activeActionId — a vehicle-gated
  // action sitting unboarded in emp.taskQueue (e.g. re-pinned via
  // walkOnlyPinnedBy after its original vehicle was destroyed mid-drive, #1085)
  // is left completely untouched by it, so its vehicle reservation survives the
  // whole rest unless tickCollapse also calls
  // releaseUnboardedTaskQueueVehicleReservations. See EmployeeDispatchSteps.ts's
  // own doc comment on that function and TickPipeline.ts's tickCollapse ordering
  // for why the steady-state (already-collapsing) branch below is the one that
  // actually closes the race: a same-tick reclaim onto a freshly-collapsed
  // employee cannot exist yet at the exact instant of the FIRST tickCollapse call
  // that interrupts them — only the NEXT tick's pass, while still collapsing,
  // can observe and release it.
  describe('#1096: releases a taskQueue-held vehicle reservation on collapse', () => {
    it('steady-state (already-collapsing) branch releases an unboarded, vehicle-gated taskQueue reservation', () => {
      const state = createGame({ seed: SEED });
      const rng = new Random(SEED);

      const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
      employee.collapsing = true; // already resting from an earlier collapse
      employee.fatigue = 0;

      const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
      const gatedAction: PendingAction = {
        id: 1096, type: 'drill_hole', requiredSkill: null, requiredVehicleRole: 'drill_rig',
        targetX: 5, targetZ: 5, targetY: 0, payload: {},
        targetEmployeeId: null, status: 'assigned', holderId: employee.id,
        queuedAtTick: 0,
      };
      state.pendingActions.push(gatedAction);
      employee.taskQueue = [gatedAction.id];
      reserveVehicle(state.vehicles, vehicle.id, gatedAction.id);
      // vehicle.driverId stays null — reserved but never boarded, exactly the
      // reclaim-while-resting shape claimActionsTargetedAtEmployee produces.

      const result = tickCollapse(state);

      // The already-collapsing employee is not reported as newly collapsed.
      expect(result.collapsed).toHaveLength(0);

      expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
      expect(gatedAction.status).toBe('queued');
      expect(gatedAction.holderId).toBeNull();
      expect(employee.taskQueue).not.toContain(gatedAction.id);
    });

    it('fresh-collapse branch also releases a pre-existing unboarded, vehicle-gated taskQueue reservation', () => {
      const state = createGame({ seed: SEED });
      const rng = new Random(SEED);

      const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
      employee.fatigue = 0; // crosses the collapse threshold THIS tick
      employee.collapsing = false;

      const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 5, 5);
      const gatedAction: PendingAction = {
        id: 1097, type: 'drill_hole', requiredSkill: null, requiredVehicleRole: 'drill_rig',
        targetX: 5, targetZ: 5, targetY: 0, payload: {},
        targetEmployeeId: null, status: 'assigned', holderId: employee.id,
        queuedAtTick: 0,
      };
      state.pendingActions.push(gatedAction);
      // Predates the collapse trigger — already sitting in taskQueue before
      // fatigue crossed the threshold this same tick.
      employee.taskQueue = [gatedAction.id];
      reserveVehicle(state.vehicles, vehicle.id, gatedAction.id);

      placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

      const result = tickCollapse(state);

      expect(result.collapsed).toEqual([employee.id]);
      expect(employee.collapsing).toBe(true);

      expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
      expect(gatedAction.status).toBe('queued');
      expect(gatedAction.holderId).toBeNull();
      expect(employee.taskQueue).not.toContain(gatedAction.id);
    });

    it('does not touch an active (not taskQueue) vehicle-gated action — interruptActiveAction still owns it', () => {
      const state = createGame({ seed: SEED });
      const rng = new Random(SEED);

      const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
      assignSkill(state.employees, employee.id, 'driving.drill_rig', 1);
      employee.fatigue = 0;
      employee.collapsing = false;
      employee.taskQueue = []; // nothing queued — only the active action exists

      const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
      const activeAction: PendingAction = {
        id: 1098, type: 'drill_hole', requiredSkill: 'blasting', requiredVehicleRole: 'drill_rig',
        targetX: 3, targetZ: 3, targetY: 0, payload: {},
        targetEmployeeId: null, status: 'in_progress', holderId: employee.id,
        queuedAtTick: 0,
      };
      state.pendingActions.push(activeAction);
      employee.activeActionId = activeAction.id;
      employee.taskTicksRemaining = 3; // boarded, mid-execution
      vehicle.occupantIds = [employee.id];
      employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
      reserveVehicle(state.vehicles, vehicle.id, activeAction.id);

      placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

      const result = tickCollapse(state);

      expect(result.collapsed).toEqual([employee.id]);
      // interruptActiveAction (existing, pre-#1096 behavior) still releases
      // the active action and its vehicle reservation on its own — the new
      // taskQueue-release logic must not interfere with or duplicate that.
      const released = state.pendingActions.find(a => a.id === activeAction.id)!;
      expect(released.status).toBe('queued');
      expect(released.holderId).toBeNull();
      expect(employee.activeActionId).not.toBe(activeAction.id);
      expect(getVehicleReservation(state.vehicles, vehicle.id)).toBeNull();
      expect(vehicleDriverId(vehicle)).toBeNull();
    });

    it('empty taskQueue on an already-collapsing employee: no crash, no unintended release', () => {
      const state = createGame({ seed: SEED });
      const rng = new Random(SEED);

      const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
      employee.collapsing = true;
      employee.fatigue = 0;
      employee.taskQueue = [];

      expect(() => tickCollapse(state)).not.toThrow();

      const result = tickCollapse(state);
      expect(result.collapsed).toHaveLength(0);
      expect(employee.taskQueue).toEqual([]);
    });
  });

  // #1118: collapse policy is release-the-vehicle, distinct from the
  // proactive/soft-threshold path (which keeps the driver mounted, see
  // tickNeedRestoration's own #1118 test above). An idle mounted employee
  // crossing the hard fatigue threshold gets explicitly dismounted before
  // beginRestTravel is called, so the vehicle is freed for another driver
  // rather than idling with a collapsed occupant who never intends to work
  // it — mirrors the release attempted for a boarded, actively-working
  // vehicle-gated action (#1062's own test above), but for an idle mount.
  it('#1118: an idle mounted employee crossing the hard fatigue threshold has their vehicle released (occupantIds cleared, driver dismounted to on_foot)', () => {
    const state = createGame({ seed: SEED });
    const rng = new Random(SEED);

    const { employee } = hireEmployee(state.employees, 'driller', rng, 0, 0);
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig', 0, 0);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    employee.activeActionId = null; // idle — nothing being actively worked
    employee.fatigue = 0; // at NEED_HARD_THRESHOLDS.fatigue

    placeBuilding(state.buildings, 'living_quarters', 10, 10, 100, 100);

    const result = tickCollapse(state);

    expect(result.collapsed).toEqual([employee.id]);
    expect(vehicle.occupantIds).not.toContain(employee.id);
    expect(vehicleDriverId(vehicle)).not.toBe(employee.id);
    expect(employee.locomotion).toEqual({ kind: 'on_foot' });

    const violations = assertWorldInvariants(state);
    expect(violations.filter(v => v.kind === 'I2_mounted_position_mismatch')).toHaveLength(0);
  });
});
