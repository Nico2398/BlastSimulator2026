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
  applySmugglingExposure,
  FRAME_EVIDENCE_TICKS as FRAME_TICKS,
  decayExposure,
} from '../../../src/core/events/MafiaActions.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { createEmployeeState, type Employee } from '../../../src/core/entities/Employee.js';
import { createCorruptionState } from '../../../src/core/economy/Corruption.js';
import {
  ACCIDENT_EXPOSURE,
  ACCIDENT_FAILURE_EXPOSURE_EXTRA,
  INVESTIGATION_EXPOSURE_JUMP,
  SMUGGLING_EXPOSED_FINE,
  SMUGGLING_EXPOSED_EXPOSURE_JUMP,
  SMUGGLING_VOLUME_LEVELS,
  INVESTIGATION_FOLLOWUP_EVENT_ID,
  EXPOSURE_CLEAN_GRACE_TICKS,
  EXPOSURE_DECAY_PER_TICK,
} from '../../../src/core/config/balance.js';
import { createEventSystemState } from '../../../src/core/events/EventSystem.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';

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
    const emp = addTestEmployee(employees, true); // unionized

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

  it('applySmugglingExposure jumps exposure, stops smuggling and returns the fine', () => {
    const mafia = createMafiaState();
    setSmugglingVolume(mafia, 0.25);
    const { fine } = applySmugglingExposure(mafia, 9);
    expect(fine).toBe(SMUGGLING_EXPOSED_FINE);
    expect(mafia.exposureRisk).toBeCloseTo(SMUGGLING_EXPOSED_EXPOSURE_JUMP, 10);
    expect(mafia.smugglingActive).toBe(false);
    expect(mafia.smugglingIncome).toBe(0);
    expect(mafia.lastActivityTick).toBe(9);
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

  it('never decays while smuggling is active', () => {
    const mafia = createMafiaState();
    mafia.exposureRisk = 0.5;
    mafia.smugglingActive = true;
    decayExposure(mafia, 10_000);
    expect(mafia.exposureRisk).toBe(0.5);
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
