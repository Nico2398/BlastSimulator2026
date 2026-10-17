import { describe, it, expect, afterEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createMafiaState,
  arrangeAccident,
  startFraming,
  completeFrame,
  setSmugglingVolume,
  smugglingIncomeForTick,
  applyInvestigation,
  FRAME_EVIDENCE_TICKS as FRAME_TICKS,
  decayExposure,
} from '../../../src/core/events/MafiaActions.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { createEmployeeState, type Employee } from '../../../src/core/entities/Employee.js';
import { createCorruptionState } from '../../../src/core/economy/Corruption.js';
import {
  SMUGGLING_VOLUME_LEVELS,
  INVESTIGATION_FOLLOWUP_EVENT_ID,
  EXPOSURE_CLEAN_GRACE_TICKS,
  EXPOSURE_DECAY_PER_TICK,
} from '../../../src/core/config/balance.js';
import { createEventSystemState } from '../../../src/core/events/EventSystem.js';
import { setLocale } from '../../../src/core/i18n/I18n.js';
import { ACCIDENT_EXPOSURE, ACCIDENT_FAILURE_EXPOSURE_EXTRA } from '../../../src/core/config/balance.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { board } from '../../../src/core/engine/Mount.js';
import { DISMISSAL_CREW_MORALE_DENT } from '../../../src/core/config/balance.js';
import { frameRefusal } from '../../../src/core/events/MafiaActions.js';

const EMPLOYEE_DEFAULTS = {
  activeActionId: null, fatigue: 100,
  collapsing: false, interruptedActionPayload: null, ticksWorked: 0,
  restTicksRemaining: null, restNeedKey: null, taskTicksRemaining: null,
  activeTaskSkill: null, destinationX: null, destinationZ: null,
  moveConsecutiveFailures: 0, isMoveStuck: false, pendingRestDuration: null,
  pendingRestNeedKey: null, pendingTaskDuration: null, pendingActionType: null,
  pendingActionPayload: null, pendingDriverVehicleId: null,
  locomotion: { kind: 'on_foot' },
    itinerary: null,
    vehicleWaitingTicks: 0,
} as const;

function addTestEmployee(state: ReturnType<typeof createEmployeeState>, unionized = false): Employee {
  const emp: Employee = {
    id: state.nextId++, name: 'Test Worker', role: 'driller', salary: 500,
    morale: 60, unionized, injured: false, alive: true, x: 0, z: 0,
    qualifications: [], trainingState: null, taskQueue: [],
    ...EMPLOYEE_DEFAULTS,
  };
  state.employees.push(emp);
  return emp;
}

/** Wrap an EmployeeState in a GameState — arrangeAccident/completeFrame take the whole state (#1378). */
function stateOf(employees: ReturnType<typeof createEmployeeState>): GameState {
  const state = createGame({ seed: 42 });
  state.employees = employees;
  return state;
}

afterEach(() => setLocale('en'));

describe('Mafia gameplay mechanics', () => {
  it('accident arrangement removes targeted employee if successful', () => {
    for (let seed = 0; seed < 50; seed++) {
      const mafia = createMafiaState();
      const employees = createEmployeeState();
      const emp = addTestEmployee(employees);
      const corruption = createCorruptionState();

      const result = arrangeAccident(mafia, stateOf(employees), corruption, emp.id, new Random(seed));
      if (result.success) {
        expect(emp.alive).toBe(false);
        expect(result.cost).toBeGreaterThan(0);
        return;
      }
    }
    expect.unreachable('No successful accident in 50 seeds');
  });

  it('failed accident triggers investigation event', () => {
    for (let seed = 0; seed < 50; seed++) {
      const mafia = createMafiaState();
      const employees = createEmployeeState();
      const emp = addTestEmployee(employees);
      const corruption = createCorruptionState();

      const result = arrangeAccident(mafia, stateOf(employees), corruption, emp.id, new Random(seed));
      if (!result.success) {
        expect(result.investigationTriggered).toBe(true);
        expect(emp.alive).toBe(true);
        return;
      }
    }
    expect.unreachable('No failed accident in 50 seeds');
  });

  it('framing an employee requires planting evidence (cost + time)', () => {
    const mafia = createMafiaState();
    const employees = createEmployeeState();
    const emp = addTestEmployee(employees);

    const result = startFraming(mafia, employees, emp.id, 100);
    expect(result.success).toBe(true);
    expect(result.cost).toBeGreaterThan(0);
    expect(mafia.pendingFrames.length).toBe(1);
    expect(mafia.pendingFrames[0]!.readyTick).toBeGreaterThan(100);

    // Can't complete yet
    const early = completeFrame(mafia, stateOf(employees), emp.id, 100, new Random(42));
    expect(early.success).toBe(false);
  });

  it('a new mafia state smuggles nothing', () => {
    const mafia = createMafiaState();
    expect(mafia.smugglingVolume).toBe(0);
  });

  it('setSmugglingVolume accepts every configured volume level', () => {
    for (const level of SMUGGLING_VOLUME_LEVELS) {
      const mafia = createMafiaState();
      const result = setSmugglingVolume(mafia, level);
      expect(result).toEqual({ success: true, data: { volume: level } });
      expect(mafia.smugglingVolume).toBe(level);
    }
  });

  it('setSmugglingVolume accepts 0 to switch smuggling off', () => {
    const mafia = createMafiaState();
    setSmugglingVolume(mafia, SMUGGLING_VOLUME_LEVELS[1]);
    const result = setSmugglingVolume(mafia, 0);
    expect(result.success).toBe(true);
    expect(mafia.smugglingVolume).toBe(0);
  });

  it('setSmugglingVolume rejects values outside the configured levels and leaves the volume alone', () => {
    const mafia = createMafiaState();
    setSmugglingVolume(mafia, 0.25);
    for (const bad of [0.3, -0.25, 2, 0.01, NaN, Infinity]) {
      const result = setSmugglingVolume(mafia, bad);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.length).toBeGreaterThan(0);
      expect(mafia.smugglingVolume).toBe(0.25);
    }
  });

  it('smugglingIncomeForTick is the volume times the operating income per hour', () => {
    expect(smugglingIncomeForTick(0.25, 1_000)).toBeCloseTo(250, 9);
    expect(smugglingIncomeForTick(1, 1_234.5)).toBeCloseTo(1_234.5, 9);
    expect(smugglingIncomeForTick(0.1, 300)).toBeCloseTo(30, 9);
  });

  it('smugglingIncomeForTick is 0 without operating income or without volume', () => {
    expect(smugglingIncomeForTick(1, 0)).toBe(0);
    expect(smugglingIncomeForTick(0.5, 0)).toBe(0);
    expect(smugglingIncomeForTick(0, 5_000)).toBe(0);
  });

  it('choosing a volume adds no exposure', () => {
    const mafia = createMafiaState();
    setSmugglingVolume(mafia, 1);
    expect(mafia.exposureRisk).toBe(0);
  });

  it('applyInvestigation stamps lastActivityTick when a tick is given', () => {
    const mafia = createMafiaState();
    applyInvestigation(mafia, createEventSystemState(), 77);
    expect(mafia.lastActivityTick).toBe(77);
  });

  it('applyInvestigation caps exposure at 1 and returns the applied delta', () => {
    const mafia = createMafiaState();
    mafia.exposureRisk = 0.95;
    const applied = applyInvestigation(mafia, createEventSystemState());
    expect(mafia.exposureRisk).toBe(1);
    expect(applied).toBeCloseTo(0.05, 10);
  });

  it('applyInvestigation at the cap applies 0 but still queues the follow-up', () => {
    const mafia = createMafiaState();
    mafia.exposureRisk = 1;
    const events = createEventSystemState();
    expect(applyInvestigation(mafia, events)).toBe(0);
    expect(events.followUpQueue).toContain(INVESTIGATION_FOLLOWUP_EVENT_ID);
  });
});

describe('Mafia exposure decay (#1411)', () => {
  it('createMafiaState starts with lastActivityTick 0', () => {
    expect(createMafiaState().lastActivityTick).toBe(0);
  });

  it('does not decay inside the clean grace period', () => {
    const mafia = createMafiaState();
    mafia.exposureRisk = 0.5;
    mafia.lastActivityTick = 100;
    decayExposure(mafia, 100 + EXPOSURE_CLEAN_GRACE_TICKS - 1);
    expect(mafia.exposureRisk).toBe(0.5);
  });

  it('decays by the configured step once the grace period has elapsed', () => {
    const mafia = createMafiaState();
    mafia.exposureRisk = 0.5;
    mafia.lastActivityTick = 100;
    decayExposure(mafia, 100 + EXPOSURE_CLEAN_GRACE_TICKS);
    expect(mafia.exposureRisk).toBeCloseTo(0.5 - EXPOSURE_DECAY_PER_TICK, 10);
  });

  it('floors exposure at 0', () => {
    const mafia = createMafiaState();
    mafia.exposureRisk = EXPOSURE_DECAY_PER_TICK / 2;
    decayExposure(mafia, 10_000);
    expect(mafia.exposureRisk).toBe(0);
  });

  it('startFraming stamps lastActivityTick with the current tick', () => {
    const mafia = createMafiaState();
    const employees = createEmployeeState();
    const emp = addTestEmployee(employees);
    startFraming(mafia, employees, emp.id, 77);
    expect(mafia.lastActivityTick).toBe(77);
  });

  it('completeFrame stamps lastActivityTick with the current tick', () => {
    const mafia = createMafiaState();
    const employees = createEmployeeState();
    const emp = addTestEmployee(employees);
    startFraming(mafia, employees, emp.id, 10);
    completeFrame(mafia, stateOf(employees), emp.id, 10 + FRAME_TICKS, new Random(1));
    expect(mafia.lastActivityTick).toBe(10 + FRAME_TICKS);
  });
});

describe('Arranged accident is booked as a workplace death (#1700)', () => {
  function attempt(wantSuccess: boolean) {
    for (let seed = 0; seed < 200; seed++) {
      const mafia = createMafiaState();
      const employees = createEmployeeState();
      const emp = addTestEmployee(employees);
      const state = stateOf(employees);
      state.tickCount = 37;
      const result = arrangeAccident(mafia, state, createCorruptionState(), emp.id, new Random(seed));
      if (result.success === wantSuccess) return { mafia, state, emp, result };
    }
    throw new Error('no seed produced the wanted outcome');
  }

  it('a successful accident counts in damage.deathCount and sets lawsuitPending', () => {
    const { state } = attempt(true);
    expect(state.damage.deathCount).toBe(1);
    expect(state.damage.lawsuitPending).toBe(true);
  });

  it('a successful accident logs exactly one death record for the target at the current tick', () => {
    const { state, emp } = attempt(true);
    const deaths = state.damage.accidents.filter(a => a.type === 'death');
    expect(deaths).toHaveLength(1);
    expect(deaths[0]!.entityId).toBe(emp.id);
    expect(deaths[0]!.tick).toBe(37);
    expect(state.damage.accidents).toHaveLength(1);
  });

  it('a failed accident kills nobody and books nothing', () => {
    const { state, emp } = attempt(false);
    expect(emp.alive).toBe(true);
    expect(state.damage.deathCount).toBe(0);
    expect(state.damage.lawsuitPending).toBe(false);
    expect(state.damage.accidents).toEqual([]);
  });

  it('an unknown target books nothing', () => {
    const state = stateOf(createEmployeeState());
    arrangeAccident(createMafiaState(), state, createCorruptionState(), 999, new Random(1));
    expect(state.damage.deathCount).toBe(0);
    expect(state.damage.lawsuitPending).toBe(false);
    expect(state.damage.accidents).toEqual([]);
  });

  it('an already-dead target is not counted twice', () => {
    const employees = createEmployeeState();
    const emp = addTestEmployee(employees);
    emp.alive = false;
    const state = stateOf(employees);
    for (let seed = 0; seed < 20; seed++) {
      arrangeAccident(createMafiaState(), state, createCorruptionState(), emp.id, new Random(seed));
    }
    expect(state.damage.deathCount).toBe(0);
    expect(state.damage.accidents).toEqual([]);
  });

  it('exposure amounts are unchanged by booking the death', () => {
    const ok = attempt(true);
    expect(ok.mafia.exposureRisk).toBeCloseTo(ACCIDENT_EXPOSURE, 10);
    const bad = attempt(false);
    expect(bad.mafia.exposureRisk).toBeCloseTo(ACCIDENT_EXPOSURE + ACCIDENT_FAILURE_EXPOSURE_EXTRA, 10);
  });

  it('the dead employee still leaves the vehicle they were driving', () => {
    for (let seed = 0; seed < 200; seed++) {
      const state = createGame({ seed: 42 });
      state.employees = createEmployeeState();
      const driver = hireEmployee(state.employees, 'driver', new Random(42), 5, 5).employee;
      assignSkill(state.employees, driver.id, 'driving.truck', 1);
      const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 5, 5);
      expect(board(state, vehicle.id, driver.id).success).toBe(true);
      const result = arrangeAccident(createMafiaState(), state, createCorruptionState(), driver.id, new Random(seed));
      if (!result.success) continue;
      expect(driver.alive).toBe(false);
      expect(vehicle.occupantIds).toEqual([]);
      expect(driver.locomotion).toEqual({ kind: 'on_foot' });
      expect(state.damage.deathCount).toBe(1);
      return;
    }
    expect.unreachable('No successful accident in 200 seeds');
  });
});

describe('Framing refuses union members; accident is the only shady way out (#1872)', () => {
  const REFUSED = 'mafia.frame_union_refused';

  it('frameRefusal names the refusal for a union member and is null otherwise', () => {
    expect(frameRefusal({ unionized: true })).toBe(REFUSED);
    expect(frameRefusal({ unionized: false })).toBeNull();
  });

  it('startFraming on a union target fails, costs nothing, adds no exposure and queues nothing', () => {
    const mafia = createMafiaState();
    const employees = createEmployeeState();
    const emp = addTestEmployee(employees, true);
    const result = startFraming(mafia, employees, emp.id, 100);
    expect(result.success).toBe(false);
    expect(result.cost).toBe(0);
    expect(result.exposureIncrease).toBe(0);
    expect(result.outcomeKey).toBe(REFUSED);
    expect(result.investigationTriggered).toBe(false);
    expect(mafia.pendingFrames).toEqual([]);
    expect(mafia.exposureRisk).toBe(0);
  });

  it('startFraming on a non-union target still works', () => {
    const mafia = createMafiaState();
    const employees = createEmployeeState();
    const emp = addTestEmployee(employees, false);
    const result = startFraming(mafia, employees, emp.id, 100);
    expect(result.success).toBe(true);
    expect(result.cost).toBeGreaterThan(0);
    expect(mafia.pendingFrames).toHaveLength(1);
  });

  it('completeFrame on a target that joined the union meanwhile never dismisses, rolls nothing, adds no exposure, drops the frame', () => {
    for (let seed = 0; seed < 30; seed++) {
      const mafia = createMafiaState();
      const employees = createEmployeeState();
      const emp = addTestEmployee(employees, false);
      startFraming(mafia, employees, emp.id, 0);
      const exposureAfterStart = mafia.exposureRisk;
      emp.unionized = true;
      const state = stateOf(employees);
      const result = completeFrame(mafia, state, emp.id, 1_000_000, new Random(seed));
      expect(result.success).toBe(false);
      expect(result.exposureIncrease).toBe(0);
      expect(result.investigationTriggered).toBe(false);
      expect(mafia.exposureRisk).toBe(exposureAfterStart);
      expect(mafia.pendingFrames).toEqual([]);
      expect(state.employees.employees).toContain(emp);
      expect(emp.alive).toBe(true);
    }
  });

  it('completeFrame on a vanished target drops the frame and dismisses nobody', () => {
    const mafia = createMafiaState();
    const employees = createEmployeeState();
    const emp = addTestEmployee(employees, false);
    const bystander = addTestEmployee(employees, false);
    startFraming(mafia, employees, emp.id, 0);
    employees.employees = employees.employees.filter(e => e.id !== emp.id);
    const result = completeFrame(mafia, stateOf(employees), emp.id, 1_000_000, new Random(1));
    expect(result.success).toBe(false);
    expect(result.outcomeKey).toMatch(/target_not_found/);
    expect(mafia.pendingFrames).toEqual([]);
    expect(employees.employees).toEqual([bystander]);
  });

  it('arrangeAccident still removes a union member and books the death', () => {
    for (let seed = 0; seed < 200; seed++) {
      const mafia = createMafiaState();
      const employees = createEmployeeState();
      const emp = addTestEmployee(employees, true);
      const state = stateOf(employees);
      const result = arrangeAccident(mafia, state, createCorruptionState(), emp.id, new Random(seed));
      if (!result.success) continue;
      expect(emp.alive).toBe(false);
      expect(state.damage.deathCount).toBe(1);
      expect(state.employees.employees.find(e => e.id === emp.id && e.alive)).toBeUndefined();
      return;
    }
    expect.unreachable('no successful accident in 200 seeds');
  });
});

describe('A successful frame is dismissal for cause: no crew morale dent (#1872)', () => {
  function frameSucceeds(): { employees: ReturnType<typeof createEmployeeState>; victimId: number; others: Employee[] } {
    for (let seed = 0; seed < 200; seed++) {
      const mafia = createMafiaState();
      const employees = createEmployeeState();
      const victim = addTestEmployee(employees, false);
      const others = [addTestEmployee(employees), addTestEmployee(employees)];
      startFraming(mafia, employees, victim.id, 0);
      const result = completeFrame(mafia, stateOf(employees), victim.id, 1_000_000, new Random(seed));
      if (result.success) return { employees, victimId: victim.id, others };
    }
    throw new Error('no seed produced a successful frame');
  }

  it('removes the target and leaves every other employee morale unchanged', () => {
    const { employees, victimId, others } = frameSucceeds();
    expect(employees.employees.find(e => e.id === victimId)).toBeUndefined();
    for (const o of others) expect(o.morale).toBe(60);
  });

  it('the dent an ordinary dismissal would cost is real (so the frame benefit is non-zero)', () => {
    expect(DISMISSAL_CREW_MORALE_DENT).toBeGreaterThan(0);
  });
});
