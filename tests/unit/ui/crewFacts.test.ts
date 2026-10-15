// BlastSimulator2026 — crewFacts (#1762): where an employee is and what their task targets.
import { describe, it, expect } from 'vitest';
import { resolveEmployeeLocation, resolveTaskTarget, trainingSchool } from '../../../src/ui/crewFacts.js';
import { createGame } from '../../../src/core/state/GameState.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import type { Building } from '../../../src/core/entities/Building.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1, name: 'Walt Diggins', role: 'driller', salary: 1000, morale: 60,
    unionized: false, injured: false, alive: true, x: 5, z: 5,
    qualifications: [], trainingState: null, activeActionId: null, fatigue: 100, collapsing: false,
    interruptedActionPayload: null, ticksWorked: 0, restTicksRemaining: null, restNeedKey: null,
    taskTicksRemaining: null, activeTaskSkill: null, destinationX: null, destinationZ: null,
    moveConsecutiveFailures: 0, isMoveStuck: false, pendingRestDuration: null, pendingRestNeedKey: null,
    pendingTaskDuration: null, pendingActionType: null, pendingActionPayload: null,
    pendingDriverVehicleId: null, taskQueue: [], locomotion: { kind: 'on_foot' }, itinerary: null,
    vehicleWaitingTicks: 0,
    ...overrides,
  } as Employee;
}

function world(buildings: Building[] = [], vehicles: Vehicle[] = []): GameState {
  const s = createGame({ seed: 1, mineType: 'desert' });
  s.buildings.buildings = buildings;
  s.vehicles.vehicles = vehicles;
  return s;
}

const living = (id = 4): Building => ({ id, type: 'living_quarters', tier: 1, x: 8, z: 8, hp: 100, active: true, occupantIds: [] });
const school = (id = 6): Building => ({ id, type: 'blasting_academy', tier: 1, x: 12, z: 3, hp: 100, active: true, occupantIds: [] });
const hauler = (id = 9): Vehicle => ({ id, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100, cargo: [], occupantIds: [] } as Vehicle);

describe('resolveEmployeeLocation', () => {
  it('inside a building, not resting: building ref and type', () => {
    const e = makeEmployee({ locomotion: { kind: 'inside', buildingId: 4 } });
    expect(resolveEmployeeLocation(e, world([living()]))).toEqual({
      kind: 'inside', building: { kind: 'building', id: 4 }, buildingType: 'living_quarters', resting: false,
    });
  });

  it('inside a building while rest ticks run: resting true', () => {
    const e = makeEmployee({ locomotion: { kind: 'inside', buildingId: 4 }, restTicksRemaining: 12 });
    const loc = resolveEmployeeLocation(e, world([living()]));
    expect(loc.kind).toBe('inside');
    if (loc.kind === 'inside') expect(loc.resting).toBe(true);
  });

  it('inside a building that no longer exists falls back to coordinates', () => {
    const e = makeEmployee({ locomotion: { kind: 'inside', buildingId: 99 } });
    expect(resolveEmployeeLocation(e, world([])).kind).not.toBe('inside');
  });

  it('mounted: aboard the vehicle', () => {
    const e = makeEmployee({ locomotion: { kind: 'mounted', vehicleId: 9 } });
    expect(resolveEmployeeLocation(e, world([], [hauler()]))).toEqual({ kind: 'aboard', vehicle: { kind: 'vehicle', id: 9 } });
  });

  it('stuck reports the consecutive failure count as ticks', () => {
    const e = makeEmployee({ isMoveStuck: true, moveConsecutiveFailures: 17, destinationX: 20, destinationZ: 20 });
    const loc = resolveEmployeeLocation(e, world());
    expect(loc).toMatchObject({ kind: 'stuck', ticks: 17, x: 5, z: 5 });
  });

  it('walking with a pending rest is a rest walk', () => {
    const e = makeEmployee({ destinationX: 8, destinationZ: 8, pendingRestDuration: 30 });
    expect(resolveEmployeeLocation(e, world())).toEqual({ kind: 'walking', x: 8, z: 8, purpose: 'rest' });
  });

  it('walking with a pending training is a school walk', () => {
    const e = makeEmployee({
      destinationX: 12, destinationZ: 3,
      pendingTrainingState: { buildingId: 6, skill: 'geology', ticksRemaining: 20, fee: 100 },
    });
    expect(resolveEmployeeLocation(e, world([school()]))).toEqual({ kind: 'walking', x: 12, z: 3, purpose: 'school' });
  });

  it('walking with a pending task is a task walk', () => {
    const e = makeEmployee({ destinationX: 2, destinationZ: 3, pendingTaskDuration: 5, pendingActionType: 'drill_hole' as never });
    expect(resolveEmployeeLocation(e, world())).toEqual({ kind: 'walking', x: 2, z: 3, purpose: 'task' });
  });

  it('walking with nothing pending is "other"', () => {
    const e = makeEmployee({ destinationX: 2, destinationZ: 3 });
    expect(resolveEmployeeLocation(e, world())).toEqual({ kind: 'walking', x: 2, z: 3, purpose: 'other' });
  });

  it('standing still on open ground gives coords', () => {
    const e = makeEmployee();
    expect(resolveEmployeeLocation(e, world())).toEqual({ kind: 'coords', x: 5, z: 5 });
  });

  it('standing on a navgrid bench cell gives the bench level', () => {
    const s = world();
    s.navGrid = { cellAt: () => ({ benchLevel: 2 }) } as unknown as GameState['navGrid'];
    expect(resolveEmployeeLocation(makeEmployee(), s)).toEqual({ kind: 'bench', bench: 2, x: 5, z: 5 });
  });
});

describe('resolveTaskTarget', () => {
  it('null when there is no pending payload', () => {
    expect(resolveTaskTarget(makeEmployee(), world())).toBeNull();
  });

  it('buildingId payload resolves to a building ref', () => {
    const e = makeEmployee({ pendingActionPayload: { buildingId: 4 } });
    expect(resolveTaskTarget(e, world([living()]))).toEqual({ kind: 'building', id: 4 });
  });

  it('vehicleId payload resolves to a vehicle ref', () => {
    const e = makeEmployee({ pendingActionPayload: { vehicleId: 9 } });
    expect(resolveTaskTarget(e, world([], [hauler()]))).toEqual({ kind: 'vehicle', id: 9 });
  });

  it('rampId payload resolves to a ramp ref when the ramp is built', () => {
    const s = world();
    s.builtRamps = [{ id: 3 } as never];
    const e = makeEmployee({ pendingActionPayload: { rampId: 3 } });
    expect(resolveTaskTarget(e, s)).toEqual({ kind: 'ramp', id: 3 });
  });

  it('null when the targeted entity is gone', () => {
    expect(resolveTaskTarget(makeEmployee({ pendingActionPayload: { buildingId: 77 } }), world())).toBeNull();
    expect(resolveTaskTarget(makeEmployee({ pendingActionPayload: { vehicleId: 77 } }), world())).toBeNull();
  });

  it('null for a payload with no entity keys', () => {
    expect(resolveTaskTarget(makeEmployee({ pendingActionPayload: { depth: 4 } }), world([living()]))).toBeNull();
  });
});

describe('trainingSchool', () => {
  it('null when not training', () => {
    expect(trainingSchool(makeEmployee())).toBeNull();
  });

  it('current training names its building', () => {
    const e = makeEmployee({ trainingState: { buildingId: 6, skill: 'geology', ticksRemaining: 9, fee: 1 } });
    expect(trainingSchool(e)).toEqual({ kind: 'building', id: 6 });
  });

  it('pending enrolment names its building', () => {
    const e = makeEmployee({ pendingTrainingState: { buildingId: 7, skill: 'geology', ticksRemaining: 9, fee: 1 } });
    expect(trainingSchool(e)).toEqual({ kind: 'building', id: 7 });
  });

  it('current training wins over a pending one', () => {
    const e = makeEmployee({
      trainingState: { buildingId: 6, skill: 'geology', ticksRemaining: 9, fee: 1 },
      pendingTrainingState: { buildingId: 7, skill: 'geology', ticksRemaining: 9, fee: 1 },
    });
    expect(trainingSchool(e)).toEqual({ kind: 'building', id: 6 });
  });
});
