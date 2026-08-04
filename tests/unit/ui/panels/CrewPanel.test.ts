// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { CrewPanel } from '../../../../src/ui/panels/CrewPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { Employee } from '../../../../src/core/entities/Employee.js';
import type { Vehicle } from '../../../../src/core/entities/Vehicle.js';

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1, name: 'Walt Diggins', role: 'driller', salary: 1000, morale: 60,
    unionized: false, injured: false, alive: true,
    x: 5, z: 5,
    qualifications: [],
    trainingState: null,
    activeActionId: null,
    hunger: 100, fatigue: 100, breakNeed: 100,
    collapsing: false,
    interruptedActionPayload: null,
    ticksWorked: 0,
    restTicksRemaining: null,
    restNeedKey: null,
    taskTicksRemaining: null,
    activeTaskSkill: null,
    destinationX: null,
    destinationZ: null,
    moveConsecutiveFailures: 0,
    isMoveStuck: false,
    pendingRestDuration: null,
    pendingRestNeedKey: null,
    pendingTaskDuration: null,
    pendingActionType: null,
    pendingActionPayload: null,
    pendingDriverVehicleId: null,
    ...overrides,
  };
}

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100, task: 'idle',
    targetX: 0, targetZ: 0, driverId: null, state: 'idle', payloadKg: 0,
    waitingTicks: 0, moveConsecutiveFailures: 0, isMoveStuck: false,
    haulingFragmentId: null, haulingPhase: null, haulingDepotBuildingId: null,
    ...overrides,
  };
}

function makeState(employees: Employee[] = [], vehicles: Vehicle[] = []): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.employees.employees = employees;
  state.employees.nextId = employees.length + 1;
  state.vehicles.vehicles = vehicles;
  return state;
}

function makePanel(): { panel: CrewPanel; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const panel = new CrewPanel(container);
  return { panel, container };
}

function toggle(panel: CrewPanel, id: number): void {
  (panel.root.querySelector(`[data-employee-id="${id}"] button`) as HTMLButtonElement).click();
}

describe('CrewPanel', () => {
  it('shows an empty state with no crew', () => {
    const { panel } = makePanel();
    panel.update(makeState([]));
    expect(panel.root.textContent).toContain('No crew');
  });

  it('renders a roster card with name, id, role, and morale', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 3, name: 'Walt Diggins', role: 'blaster', morale: 62 })]));

    expect(panel.root.textContent).toContain('Walt Diggins');
    expect(panel.root.textContent).toContain('#3');
    expect(panel.root.textContent).toContain('Blaster');
    expect(panel.root.textContent).toContain('62%');
  });

  it('skips dead employees', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 1, alive: false })]));
    expect(panel.root.querySelector('[data-employee-id="1"]')).toBeNull();
  });

  it('shows status tags only for states that apply', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 1, unionized: true, injured: true })]));
    const row = panel.root.querySelector('[data-employee-id="1"]')!;
    expect(row.querySelectorAll('[title]').length).toBe(2);
  });

  it('shows a driving tag when a vehicle lists the employee as its driver', () => {
    const { panel } = makePanel();
    const state = makeState(
      [makeEmployee({ id: 6 })],
      [makeVehicle({ id: 1, driverId: 6 })],
    );
    panel.update(state);
    const row = panel.root.querySelector('[data-employee-id="6"]')!;
    expect(row.querySelector('[title="Driving a vehicle"]')).not.toBeNull();
  });

  it('is collapsed by default and expands on click', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 1 })]));
    expect(panel.root.querySelector('.bs-crew-detail')).toBeNull();

    toggle(panel, 1);
    expect(panel.root.querySelector('.bs-crew-detail')).not.toBeNull();
  });

  it('allows only one card expanded at a time', () => {
    const { panel } = makePanel();
    const state = makeState([makeEmployee({ id: 1 }), makeEmployee({ id: 2 })]);
    panel.update(state);

    toggle(panel, 1);
    expect(panel.root.querySelector('[data-employee-id="1"] .bs-crew-detail')).not.toBeNull();

    toggle(panel, 2);
    expect(panel.root.querySelector('[data-employee-id="1"] .bs-crew-detail')).toBeNull();
    expect(panel.root.querySelector('[data-employee-id="2"] .bs-crew-detail')).not.toBeNull();
  });

  it('collapses again on a second click of the same card', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 1 })]));
    toggle(panel, 1);
    toggle(panel, 1);
    expect(panel.root.querySelector('.bs-crew-detail')).toBeNull();
  });

  it('detail shows HIRED as a real day number and falls back to unknown without hiredAtTick', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 1, hiredAtTick: 48 })]));
    toggle(panel, 1);
    expect(panel.root.textContent).toContain('Day 3');

    const { panel: panel2 } = makePanel();
    panel2.update(makeState([makeEmployee({ id: 1 })]));
    toggle(panel2, 1);
    expect(panel2.root.textContent).toContain('Unknown');
  });

  it('detail shows real needs gauges', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 1, hunger: 22, fatigue: 80, breakNeed: 50 })]));
    toggle(panel, 1);
    const detail = panel.root.querySelector('.bs-crew-needs')!;
    expect(detail.textContent).toContain('22');
    expect(detail.textContent).toContain('80');
    expect(detail.textContent).toContain('50');
  });

  it('current task shows Idle for an employee with nothing assigned', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 1 })]));
    toggle(panel, 1);
    expect(panel.root.querySelector('.bs-crew-task')!.textContent).toContain('Idle');
  });

  it('current task shows a real percentage bar for a dispatched task', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({
      id: 1, taskTicksRemaining: 5, activeTaskTotalTicks: 20, pendingActionType: 'survey',
    })]));
    toggle(panel, 1);
    const task = panel.root.querySelector('.bs-crew-task')!;
    expect(task.textContent).toContain('Surveying');
    expect(task.textContent).toContain('5h left');
    const fill = task.querySelector('div[style*="background:var(--bsx-amber)"]') as HTMLElement;
    expect(fill.style.width).toBe('75%');
  });

  it('current task shows Collapsed, taking priority over an in-progress task', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 1, collapsing: true, taskTicksRemaining: 5 })]));
    toggle(panel, 1);
    expect(panel.root.querySelector('.bs-crew-task')!.textContent).toContain('Collapsed');
  });

  it('skills section lists real qualifications with stars and effect multiplier', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({
      id: 1, qualifications: [{ category: 'blasting', proficiencyLevel: 3, xp: 320 }],
    })]));
    toggle(panel, 1);
    const skills = panel.root.querySelector('.bs-crew-skills')!;
    expect(skills.textContent).toContain('★★★☆☆');
    expect(skills.textContent).toContain('320 / 600 XP');
    expect(skills.textContent).toContain('×0.70 task duration');
  });

  it('skills section shows MAX with no fraction at proficiency level 5', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({
      id: 1, qualifications: [{ category: 'geology', proficiencyLevel: 5, xp: 1200 }],
    })]));
    toggle(panel, 1);
    expect(panel.root.querySelector('.bs-crew-skills')!.textContent).toContain('MAX');
  });

  it('skills section shows an empty state with no qualifications', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 1, qualifications: [] })]));
    toggle(panel, 1);
    expect(panel.root.querySelector('.bs-crew-skills')!.textContent).toContain('No qualifications yet.');
  });

  it('refreshLocale() re-renders the title and does not throw', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 1 })]));
    expect(() => panel.refreshLocale()).not.toThrow();
    expect(panel.root.textContent).toContain('Crew');
  });

  it('close button dispatches the close handler', () => {
    const { panel } = makePanel();
    let closed = false;
    panel.setCloseHandler(() => { closed = true; });
    // Empty roster: the header close button is the panel's only <button>.
    panel.update(makeState([]));
    (panel.root.querySelector('button') as HTMLButtonElement).click();
    expect(closed).toBe(true);
  });

  it('show/hide toggle visibility', () => {
    const { panel } = makePanel();
    expect(panel.visible).toBe(false);
    panel.show();
    expect(panel.visible).toBe(true);
    panel.hide();
    expect(panel.visible).toBe(false);
  });

  it('dispose() removes the panel from the DOM', () => {
    const { panel, container } = makePanel();
    panel.dispose();
    expect(container.contains(panel.root)).toBe(false);
  });
});
