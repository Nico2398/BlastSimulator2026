import { describe, it, expect, afterEach } from 'vitest';
import { Random } from '../../../src/core/math/Random.js';
import {
  createMafiaState,
  arrangeAccident,
  startFraming,
  completeFrame,
  toggleSmuggling,
  processSmuggling,
} from '../../../src/core/events/MafiaActions.js';
import { createEmployeeState, type Employee } from '../../../src/core/entities/Employee.js';
import { createCorruptionState } from '../../../src/core/economy/Corruption.js';
import { t, setLocale } from '../../../src/core/i18n/I18n.js';

const EMPLOYEE_DEFAULTS = {
  activeActionId: null, fatigue: 100,
  collapsing: false, interruptedActionPayload: null, ticksWorked: 0,
  restTicksRemaining: null, restNeedKey: null, taskTicksRemaining: null,
  activeTaskSkill: null, destinationX: null, destinationZ: null,
  moveConsecutiveFailures: 0, isMoveStuck: false, pendingRestDuration: null,
  pendingRestNeedKey: null, pendingTaskDuration: null, pendingActionType: null,
  pendingActionPayload: null, pendingDriverVehicleId: null,
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

afterEach(() => setLocale('en'));

describe('Mafia gameplay mechanics', () => {
  it('accident arrangement removes targeted employee if successful', () => {
    for (let seed = 0; seed < 50; seed++) {
      const mafia = createMafiaState();
      const employees = createEmployeeState();
      const emp = addTestEmployee(employees);
      const corruption = createCorruptionState();

      const result = arrangeAccident(mafia, employees, corruption, emp.id, new Random(seed));
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

      const result = arrangeAccident(mafia, employees, corruption, emp.id, new Random(seed));
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
    const early = completeFrame(mafia, employees, emp.id, 100, new Random(42));
    expect(early.success).toBe(false);
  });

  it('smuggling generates income but increases exposure risk', () => {
    const mafia = createMafiaState();
    const { active, incomePerTick } = toggleSmuggling(mafia);
    expect(active).toBe(true);
    expect(incomePerTick).toBeGreaterThan(0);

    const initialExposure = mafia.exposureRisk;
    const result = processSmuggling(mafia, new Random(42));
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
      const result = processSmuggling(mafia, new Random(seed));
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

    const result = completeFrame(mafia, employees, emp.id, 100, new Random(42));

    expect(result.success).toBe(false);
    expect(result.outcomeKey).toBe('mafia.frame_no_ready');
    expect(result.outcomeParams).toBeUndefined();

    const NO_READY_FRAME_EN = 'No ready frame for this employee';
    expect(t(result.outcomeKey, result.outcomeParams)).toBe(NO_READY_FRAME_EN);

    setLocale('fr');
    expect(t(result.outcomeKey, result.outcomeParams)).not.toBe(NO_READY_FRAME_EN);
  });
});
