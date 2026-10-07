import { describe, it, expect, afterEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createMafiaState,
  arrangeAccident,
  startFraming,
  completeFrame,
  toggleSmuggling,
  processSmuggling,
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

  it('smuggling generates income but increases exposure risk', () => {
    const mafia = createMafiaState();
    const { active, incomePerTick } = toggleSmuggling(mafia);
    expect(active).toBe(true);
    expect(incomePerTick).toBeGreaterThan(0);

    const initialExposure = mafia.exposureRisk;
    const result = processSmuggling(mafia, new Random(42), 5);
    expect(result.income).toBeGreaterThan(0);
    expect(mafia.exposureRisk).toBeGreaterThan(initialExposure);
  });

  it('exposure leads to criminal charges (potential game over)', () => {
    const mafia = createMafiaState();
    mafia.exposureRisk = 0.95; // Very high exposure
    mafia.smugglingActive = true;
    mafia.smugglingIncome = 8000;

    // With high exposure, should eventually trigger
    let triggered = false;
    for (let seed = 0; seed < 200; seed++) {
      const result = processSmuggling(mafia, new Random(seed), 5);
      // isExposed just checks if risk * 0.05 triggers, but processSmuggling checks exposure too
      if (result.exposed) {
        triggered = true;
        break;
      }
    }
    // With 0.95 exposure and 0.15 base risk, should trigger often
    expect(triggered).toBe(true);
  });

  // ── completeFrame with no pending frame — issue #862 ────────────────────
  //
  // Not reachable through mafia.ts's console command (its 'frame' case only
  // calls completeFrame after confirming a ready pending frame exists), so
  // this outcome is covered directly against the core function instead.
  it('completeFrame with no pending frame for the target returns outcomeKey mafia.frame_no_ready', () => {
    const mafia = createMafiaState();
    const employees = createEmployeeState();
    const emp = addTestEmployee(employees);

    const result = completeFrame(mafia, stateOf(employees), emp.id, 100, new Random(42));

    expect(result.success).toBe(false);
    expect(result.outcomeKey).toBe('mafia.frame_no_ready');
    expect(result.outcomeParams).toBeUndefined();

    const NO_READY_FRAME_EN = 'No ready frame for this employee';
    expect(t(result.outcomeKey, result.outcomeParams)).toBe(NO_READY_FRAME_EN);

    setLocale('fr');
    expect(t(result.outcomeKey, result.outcomeParams)).not.toBe(NO_READY_FRAME_EN);
  });

  // ── exposureIncrease equals the applied delta — issue #1410 ─────────────
  function accidentRun(wantSuccess: boolean, startExposure: number) {
    for (let seed = 0; seed < 50; seed++) {
      const mafia = createMafiaState();
      mafia.exposureRisk = startExposure;
      const employees = createEmployeeState();
      const emp = addTestEmployee(employees);
      const result = arrangeAccident(mafia, stateOf(employees), createCorruptionState(), emp.id, new Random(seed));
      if (result.success === wantSuccess) return { mafia, result };
    }
    return expect.unreachable(`No ${wantSuccess ? 'successful' : 'failed'} accident in 50 seeds`);
  }

  it('failed accident raises exposureRisk by exactly result.exposureIncrease', () => {
    const { mafia, result } = accidentRun(false, 0);
    expect(result.exposureIncrease).toBeCloseTo(ACCIDENT_EXPOSURE + ACCIDENT_FAILURE_EXPOSURE_EXTRA, 10);
    expect(mafia.exposureRisk).toBeCloseTo(result.exposureIncrease, 10);
    expect(mafia.exposureRisk).toBeCloseTo(0.2, 10);
  });

  it('successful accident raises exposureRisk by exactly result.exposureIncrease', () => {
    const { mafia, result } = accidentRun(true, 0);
    expect(result.exposureIncrease).toBeCloseTo(ACCIDENT_EXPOSURE, 10);
    expect(mafia.exposureRisk).toBeCloseTo(result.exposureIncrease, 10);
    expect(mafia.exposureRisk).toBeCloseTo(0.1, 10);
  });

  it('failed accident near the cap clamps to 1 and reports the applied delta', () => {
    const { mafia, result } = accidentRun(false, 0.95);
    expect(mafia.exposureRisk).toBe(1);
    expect(result.exposureIncrease).toBeCloseTo(1 - 0.95, 10);
  });

  it('accident on an unknown target changes no exposure', () => {
    const mafia = createMafiaState();
    mafia.exposureRisk = 0.3;
    const result = arrangeAccident(mafia, stateOf(createEmployeeState()), createCorruptionState(), 999, new Random(1));
    expect(result.exposureIncrease).toBe(0);
    expect(mafia.exposureRisk).toBe(0.3);
  });

  it('accident on a dead target changes no exposure', () => {
    const mafia = createMafiaState();
    mafia.exposureRisk = 0.3;
    const employees = createEmployeeState();
    const emp = addTestEmployee(employees);
    emp.alive = false;
    const result = arrangeAccident(mafia, stateOf(employees), createCorruptionState(), emp.id, new Random(1));
    expect(result.exposureIncrease).toBe(0);
    expect(mafia.exposureRisk).toBe(0.3);
  });

  it('startFraming exposureIncrease equals the applied delta, also near the cap', () => {
    for (const start of [0, 0.98]) {
      const mafia = createMafiaState();
      mafia.exposureRisk = start;
      const employees = createEmployeeState();
      const emp = addTestEmployee(employees);
      const before = mafia.exposureRisk;
      const result = startFraming(mafia, employees, emp.id, 100);
      expect(mafia.exposureRisk - before).toBeCloseTo(result.exposureIncrease, 10);
    }
  });

  it('detected completeFrame exposureIncrease equals the applied delta, also near the cap', () => {
    for (const start of [0, 0.95]) {
      let found = false;
      for (let seed = 0; seed < 50 && !found; seed++) {
        const mafia = createMafiaState();
        const employees = createEmployeeState();
        const emp = addTestEmployee(employees);
        startFraming(mafia, employees, emp.id, 0);
        mafia.exposureRisk = start;
        const result = completeFrame(mafia, stateOf(employees), emp.id, 1_000_000, new Random(seed));
        if (result.outcomeKey === 'mafia.frame_detected') {
          found = true;
          expect(mafia.exposureRisk - start).toBeCloseTo(result.exposureIncrease, 10);
        }
      }
      expect(found, `no detected frame in 50 seeds at start ${start}`).toBe(true);
    }
  });
});


describe('Mafia investigation (#1411)', () => {
  it('applyInvestigation adds the configured exposure jump', () => {
    const mafia = createMafiaState();
    mafia.exposureRisk = 0.3;
    const applied = applyInvestigation(mafia, createEventSystemState());
    expect(applied).toBeCloseTo(INVESTIGATION_EXPOSURE_JUMP, 10);
    expect(mafia.exposureRisk).toBeCloseTo(0.3 + INVESTIGATION_EXPOSURE_JUMP, 10);
  });

  it('applyInvestigation queues the follow-up event', () => {
    const events = createEventSystemState();
    applyInvestigation(createMafiaState(), events);
    expect(events.followUpQueue).toContain(INVESTIGATION_FOLLOWUP_EVENT_ID);
  });

  it('applyInvestigation does not queue the follow-up twice but still raises exposure', () => {
    const mafia = createMafiaState();
    const events = createEventSystemState();
    applyInvestigation(mafia, events);
    const after1 = mafia.exposureRisk;
    applyInvestigation(mafia, events);
    expect(events.followUpQueue.filter(id => id === INVESTIGATION_FOLLOWUP_EVENT_ID)).toHaveLength(1);
    expect(mafia.exposureRisk).toBeGreaterThan(after1);
  });

  it('applyInvestigation stamps lastActivityTick when a tick is given', () => {
    const mafia = createMafiaState();
    applyInvestigation(mafia, createEventSystemState(), 77);
    expect(mafia.lastActivityTick).toBe(77);
  });

  it('applySmugglingExposure jumps exposure, stops smuggling and returns the fine', () => {
    const mafia = createMafiaState();
    toggleSmuggling(mafia);
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
