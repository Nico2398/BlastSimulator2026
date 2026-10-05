// @vitest-environment jsdom
// Crew card Locate button (#1422)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CrewPanel } from '../../../../src/ui/panels/CrewPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { Employee } from '../../../../src/core/entities/Employee.js';

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1, name: 'Walt Diggins', role: 'driller', salary: 1000, morale: 60,
    unionized: false, injured: false, alive: true, x: 5, z: 5,
    qualifications: [], trainingState: null, activeActionId: null, fatigue: 100,
    collapsing: false, interruptedActionPayload: null, ticksWorked: 0,
    restTicksRemaining: null, restNeedKey: null, taskTicksRemaining: null,
    activeTaskSkill: null, destinationX: null, destinationZ: null,
    moveConsecutiveFailures: 0, isMoveStuck: false, pendingRestDuration: null,
    pendingRestNeedKey: null, pendingTaskDuration: null, pendingActionType: null,
    pendingActionPayload: null, pendingDriverVehicleId: null, taskQueue: [],
    locomotion: { kind: 'on_foot' }, itinerary: null, vehicleWaitingTicks: 0,
    ...overrides,
  };
}

function makeState(employees: Employee[]): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.employees.employees = employees;
  state.employees.nextId = employees.length + 1;
  return state;
}

function makePanel(): CrewPanel {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new CrewPanel(container);
}

const LOCATE = '[data-action="locate"]';

afterEach(() => {
  delete (window as unknown as { __cameraFocus?: unknown }).__cameraFocus;
});

describe('CrewPanel — Locate button (#1422)', () => {
  it('renders exactly one locate button per alive card', () => {
    const panel = makePanel();
    panel.update(makeState([
      makeEmployee({ id: 1 }), makeEmployee({ id: 2, name: 'B' }), makeEmployee({ id: 3, name: 'C', alive: false }),
    ]));
    expect(panel.root.querySelectorAll(`[data-employee-id="1"] ${LOCATE}`).length).toBe(1);
    expect(panel.root.querySelectorAll(`[data-employee-id="2"] ${LOCATE}`).length).toBe(1);
    expect(panel.root.querySelectorAll(`[data-employee-id="3"] ${LOCATE}`).length).toBe(0);
  });

  it('keeps the locate button outside the .bs-detail-toggle', () => {
    const panel = makePanel();
    panel.update(makeState([makeEmployee()]));
    const btn = panel.root.querySelector(`[data-employee-id="1"] ${LOCATE}`)!;
    expect(btn).not.toBeNull();
    expect(btn.closest('.bs-detail-toggle')).toBeNull();
  });

  it('focuses the camera on the live position read at click time', () => {
    const focus = vi.fn();
    window.__cameraFocus = focus;
    const panel = makePanel();
    const emp = makeEmployee({ x: 5, z: 5 });
    const state = makeState([emp]);
    panel.update(state);
    emp.x = 20; emp.z = 31;
    panel.update(state);
    (panel.root.querySelector(`[data-employee-id="1"] ${LOCATE}`) as HTMLButtonElement).click();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith(20, 31, 15);
  });

  it('calls the select handler once with the employee id', () => {
    window.__cameraFocus = vi.fn();
    const panel = makePanel();
    const cb = vi.fn();
    panel.setSelectEmployeeHandler(cb);
    panel.update(makeState([makeEmployee({ id: 4 })]));
    (panel.root.querySelector(`[data-employee-id="4"] ${LOCATE}`) as HTMLButtonElement).click();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(4);
  });

  it('does not expand the card or rebuild the roster', () => {
    window.__cameraFocus = vi.fn();
    const panel = makePanel();
    panel.setSelectEmployeeHandler(() => {});
    panel.update(makeState([makeEmployee()]));
    const card = panel.root.querySelector('[data-employee-id="1"]');
    (panel.root.querySelector(`[data-employee-id="1"] ${LOCATE}`) as HTMLButtonElement).click();
    expect(panel.root.querySelector('.bs-employee-detail')).toBeNull();
    expect(panel.root.querySelector('[data-employee-id="1"]')).toBe(card);
  });

  it('does not throw without a handler or __cameraFocus', () => {
    const panel = makePanel();
    panel.update(makeState([makeEmployee()]));
    const btn = panel.root.querySelector(`[data-employee-id="1"] ${LOCATE}`) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(() => btn.click()).not.toThrow();
  });

  it('the roster toggle still expands the card', () => {
    const panel = makePanel();
    panel.update(makeState([makeEmployee()]));
    (panel.root.querySelector('[data-employee-id="1"] .bs-detail-toggle') as HTMLElement).click();
    expect(panel.root.querySelector('.bs-employee-detail')).not.toBeNull();
  });
});
