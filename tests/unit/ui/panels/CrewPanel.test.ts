// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { CrewPanel } from '../../../../src/ui/panels/CrewPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { t } from '../../../../src/core/i18n/I18n.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { Employee } from '../../../../src/core/entities/Employee.js';
import type { Vehicle } from '../../../../src/core/entities/Vehicle.js';
import type { Building } from '../../../../src/core/entities/Building.js';
import type { ConfirmModalConfig } from '../../../../src/ui/panels/ConfirmModal.js';

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1, name: 'Walt Diggins', role: 'driller', salary: 1000, morale: 60,
    unionized: false, injured: false, alive: true,
    x: 5, z: 5,
    qualifications: [],
    trainingState: null,
    activeActionId: null,
    fatigue: 100,
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
    taskQueue: [],
    ...overrides,
  };
}

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100, task: 'idle',
    targetX: 0, targetZ: 0, driverId: null, state: 'idle', payloadKg: 0,
    waitingTicks: 0, moveConsecutiveFailures: 0, isMoveStuck: false,
    haulingFragmentId: null, haulingPhase: null, haulingDepotBuildingId: null,
    breakFragmentId: null, breakPhase: null, reservedForActionId: null,
    ...overrides,
  };
}

function makeBuilding(overrides: Partial<Building> = {}): Building {
  return { id: 1, type: 'geology_lab', tier: 1, x: 0, z: 0, hp: 100, active: true, ...overrides };
}

function makeState(employees: Employee[] = [], vehicles: Vehicle[] = [], buildings: Building[] = []): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.employees.employees = employees;
  state.employees.nextId = employees.length + 1;
  state.vehicles.vehicles = vehicles;
  state.buildings.buildings = buildings;
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
    panel.update(makeState([makeEmployee({ id: 1, fatigue: 80 })]));
    toggle(panel, 1);
    const detail = panel.root.querySelector('.bs-crew-needs')!;
    expect(detail.textContent).toContain('80');
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

  // ── PAY ──

  it('pay section shows a real base/bonus/total breakdown', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({
      id: 1, role: 'driller', salary: 570,
      qualifications: [{ category: 'blasting', proficiencyLevel: 1, xp: 0 }],
    })]));
    toggle(panel, 1);
    const text = panel.root.textContent!;
    expect(text).toContain('Base $500');
    expect(text).toContain('+ skills $50');
    expect(text).toContain('$570/h');
  });

  it('a raise preset button dispatches employee raise with the real id and amount', () => {
    const { panel } = makePanel();
    const calls: string[] = [];
    panel.setGameConsole(cmd => { calls.push(cmd); return { success: true, output: '' }; });
    panel.update(makeState([makeEmployee({ id: 3 })]));
    toggle(panel, 3);

    const raiseBtn = [...panel.root.querySelectorAll('button')].find(b => b.textContent === '+$100')!;
    raiseBtn.click();

    expect(calls).toContain('employee raise 3 amount:100');
  });

  // ── TRAINING ──

  it('training section reports no school when none is built', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 1 })], [], []));
    toggle(panel, 1);
    expect(panel.root.querySelector('.bs-crew-training')?.textContent ?? panel.root.textContent).toContain('No school built yet.');
  });

  it('training section offers a real course from a built school and dispatches employee train on click', () => {
    const { panel } = makePanel();
    const calls: string[] = [];
    panel.setGameConsole(cmd => { calls.push(cmd); return { success: true, output: '' }; });
    const state = makeState([makeEmployee({ id: 5 })], [], [makeBuilding({ id: 9, type: 'geology_lab', tier: 1 })]);
    state.cash = 50000;
    panel.update(state);
    toggle(panel, 5);

    expect(panel.root.textContent).toContain('Geology Diploma');
    const trainBtn = [...panel.root.querySelectorAll('button')].find(b => b.textContent === 'Train')!;
    expect(trainBtn.disabled).toBe(false);
    trainBtn.click();
    expect(calls).toContain('employee train 5 skill:geology building:9');
  });

  it('training button is disabled when the fee is unaffordable', () => {
    const { panel } = makePanel();
    const state = makeState([makeEmployee({ id: 5 })], [], [makeBuilding({ id: 9, type: 'geology_lab', tier: 1 })]);
    state.cash = 0;
    panel.update(state);
    toggle(panel, 5);
    const trainBtn = [...panel.root.querySelectorAll('button')].find(b => b.textContent === 'Train')!;
    expect(trainBtn.disabled).toBe(true);
  });

  it('training section shows in-progress status instead of course offers while training', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({
      id: 1, trainingState: { buildingId: 9, skill: 'geology', ticksRemaining: 12, fee: 1000 },
    })], [], [makeBuilding({ id: 9, type: 'geology_lab' })]));
    toggle(panel, 1);
    expect(panel.root.querySelector('.bs-crew-training')!.textContent).toContain('12h left');
  });

  it('training section is reason-blocked for an injured employee', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 1, injured: true })], [], [makeBuilding({ id: 9, type: 'geology_lab' })]));
    toggle(panel, 1);
    expect(panel.root.querySelector('.bs-crew-training')!.textContent).toContain('Injured');
  });

  // ── DISMISS ──

  it('dismiss requests confirmation instead of firing immediately', () => {
    const { panel } = makePanel();
    const calls: string[] = [];
    panel.setGameConsole(cmd => { calls.push(cmd); return { success: true, output: '' }; });
    let requested: ConfirmModalConfig | null = null;
    panel.setConfirmHandler(config => { requested = config; });
    panel.update(makeState([makeEmployee({ id: 4, name: 'Oz Trill' })]));
    toggle(panel, 4);

    const dismissBtn = [...panel.root.querySelectorAll('button')].find(b => b.textContent === 'Dismiss')!;
    dismissBtn.click();

    expect(calls).toEqual([]); // not fired yet — only the confirm was requested
    expect(requested).not.toBeNull();
    expect(requested!.body).toContain('Oz Trill');

    requested!.onConfirm();
    expect(calls).toContain('employee fire 4');
  });

  it('dismiss is disabled with a reason for a unionised employee', () => {
    const { panel } = makePanel();
    panel.setConfirmHandler(() => { throw new Error('should not be called'); });
    panel.update(makeState([makeEmployee({ id: 1, unionized: true })]));
    toggle(panel, 1);
    const dismissBtn = [...panel.root.querySelectorAll('button')].find(b => b.textContent === 'Dismiss')!;
    expect(dismissBtn.disabled).toBe(true);
    expect(panel.root.textContent).toContain("Unionised");
  });

  // ── HIRING ──

  it('hiring rows list every role with real cost, starting qualification, and headcount', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 1, role: 'driller' })]));
    const text = panel.root.textContent!;
    expect(text).toContain('HIRING');
    expect(text).toContain('$1000');
    expect(text).toContain('Starts with Blasting ★1 · 1 on roster');
  });

  it('hire button dispatches employee hire with the real role', () => {
    const { panel } = makePanel();
    const calls: string[] = [];
    panel.setGameConsole(cmd => { calls.push(cmd); return { success: true, output: '' }; });
    panel.update(makeState([]));
    const hireBtns = [...panel.root.querySelectorAll('button')].filter(b => b.textContent === 'Hire');
    hireBtns[0]!.click();
    expect(calls).toContain('employee hire role:driller');
  });

  it('hire button is disabled when the role is unaffordable', () => {
    const { panel } = makePanel();
    const state = makeState([]);
    state.cash = 0;
    panel.update(state);
    const hireBtns = [...panel.root.querySelectorAll('button')].filter(b => b.textContent === 'Hire');
    expect(hireBtns.every(b => b.disabled)).toBe(true);
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

// ── Scroll-bounded roster section (#958) ────────────────────────────────────
//
// bodyEl (this.el.append(header, this.bodyEl) in the constructor) is always
// the panel root's second child. Roster cards (one per living employee,
// unbounded) are rendered directly into bodyEl today, followed by the HIRING
// sectionHeader and its 5 fixed role rows — a long roster buries HIRING far
// below the panel's fold. The fix nests every roster card inside one
// scrollBoundedSection wrapper standing before the HIRING section header,
// leaving HIRING and its rows unwrapped, reachable bodyEl-level siblings.

function getBodyEl(panel: CrewPanel): HTMLElement {
  return panel.root.children[1] as HTMLElement;
}

/** Every direct child of `bodyEl` before the section header whose text contains `label`. */
function childrenBeforeSection(bodyEl: HTMLElement, label: string): HTMLElement[] {
  const children = Array.from(bodyEl.children) as HTMLElement[];
  const idx = children.findIndex(c => c.classList.contains('bsx-section') && (c.textContent ?? '').includes(label));
  if (idx === -1) throw new Error(`section header not found for label: ${label}`);
  return children.slice(0, idx);
}

function makeManyEmployees(count: number): Employee[] {
  return Array.from({ length: count }, (_, i) => makeEmployee({ id: i + 1, name: `Crew ${i + 1}` }));
}

describe('CrewPanel — scroll-bounded roster section (#958)', () => {
  it('nests all 55 roster cards inside a single bounded wrapper, not flattened directly into bodyEl', () => {
    const { panel } = makePanel();
    panel.update(makeState(makeManyEmployees(55)));

    const bodyEl = getBodyEl(panel);
    const rosterChildren = childrenBeforeSection(bodyEl, t('ui.crew.hiring'));

    // The 55 cards must be nested inside exactly one wrapper element that is
    // itself the only bodyEl child before HIRING — proving the cards didn't
    // flatten directly into bodyEl (today's behavior).
    expect(rosterChildren.length).toBe(1);
    const wrapper = rosterChildren[0]!;
    expect(wrapper.querySelectorAll('[data-employee-id]').length).toBe(55);
  });

  it('gives the roster wrapper inline overflow-y:auto and a numeric max-height (not vh/%)', () => {
    const { panel } = makePanel();
    panel.update(makeState(makeManyEmployees(55)));

    const bodyEl = getBodyEl(panel);
    const wrapper = childrenBeforeSection(bodyEl, t('ui.crew.hiring'))[0]!;

    expect(wrapper.style.overflowY).toBe('auto');
    expect(wrapper.style.maxHeight).toMatch(/^\d+px$/);
  });

  it('keeps the HIRING section header and all 5 role rows reachable as bodyEl children, outside the roster wrapper', () => {
    const { panel } = makePanel();
    panel.update(makeState(makeManyEmployees(55)));

    const bodyEl = getBodyEl(panel);
    const children = Array.from(bodyEl.children) as HTMLElement[];
    const hiringIdx = children.findIndex(c => c.classList.contains('bsx-section') && (c.textContent ?? '').includes(t('ui.crew.hiring')));
    expect(hiringIdx).toBeGreaterThan(-1);

    const rosterWrapper = children[0]!;
    const hiringHeader = children[hiringIdx]!;
    const hiringRows = children.slice(hiringIdx + 1);

    expect(rosterWrapper.contains(hiringHeader)).toBe(false);
    expect(hiringRows.length).toBe(5); // ROLES: driller, blaster, driver, surveyor, manager
    for (const row of hiringRows) expect(rosterWrapper.contains(row)).toBe(false);
  });

  it('keeps bodyEl itself scrollable (overflow-y:auto unchanged) regardless of roster size', () => {
    const { panel: emptyPanel } = makePanel();
    emptyPanel.update(makeState([]));
    const emptyBodyEl = getBodyEl(emptyPanel);

    const { panel: fullPanel } = makePanel();
    fullPanel.update(makeState(makeManyEmployees(55)));
    const fullBodyEl = getBodyEl(fullPanel);

    for (const bodyEl of [emptyBodyEl, fullBodyEl]) {
      expect(bodyEl.style.overflowY).toBe('auto');
    }
  });

  it('with zero employees, the roster bounded wrapper is still present and contains the empty state', () => {
    const { panel } = makePanel();
    panel.update(makeState([]));

    const bodyEl = getBodyEl(panel);
    const rosterChildren = childrenBeforeSection(bodyEl, t('ui.crew.hiring'));

    expect(rosterChildren.length).toBe(1);
    const wrapper = rosterChildren[0]!;
    expect(wrapper.style.overflowY).toBe('auto');
    expect(wrapper.style.maxHeight).toMatch(/^\d+px$/);
    expect(wrapper.textContent).toContain(t('ui.crew.none'));
  });
});
