// @vitest-environment jsdom
// Employee inspector content (#1762): full detail sections, links, actions, live refresh.
import { describe, it, expect, vi } from 'vitest';
import { employeeContent } from '../../../../../src/ui/panels/inspector/employeeContent.js';
import type { InspectorLinks } from '../../../../../src/ui/panels/inspector/InspectorContent.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../../src/core/state/GameState.js';
import type { Employee } from '../../../../../src/core/entities/Employee.js';
import type { Building } from '../../../../../src/core/entities/Building.js';
import type { ConfirmModalConfig } from '../../../../../src/ui/panels/ConfirmModal.js';
import { perHour } from '../../../../../src/ui/crewDetailSections.js';
import { t, setLocale } from '../../../../../src/core/i18n/I18n.js';

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
    vehicleWaitingTicks: 0, hiredAtTick: 24,
    ...overrides,
  } as Employee;
}

const living: Building = { id: 4, type: 'living_quarters', tier: 1, x: 8, z: 8, hp: 100, active: true, occupantIds: [] };
const academy: Building = { id: 6, type: 'blasting_academy', tier: 1, x: 12, z: 3, hp: 100, active: true, occupantIds: [] };

function makeState(e: Employee, buildings: Building[] = [living, academy]): GameState {
  setLocale('en');
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.cash = 1_000_000;
  s.employees.employees = [e];
  s.buildings.buildings = buildings.map(b => ({ ...b }));
  return s;
}

function makeLinks() {
  const select = vi.fn();
  const run = vi.fn();
  const confirm = vi.fn<[ConfirmModalConfig], void>();
  const links: InspectorLinks = { select, run, confirm };
  return { links, select, run, confirm };
}

function build(e: Employee, s: GameState = makeState(e), links: InspectorLinks = makeLinks().links) {
  const view = employeeContent.view({ kind: 'employee', id: e.id }, s, links)!;
  const root = document.createElement('div');
  root.className = 'bs-employee-detail';
  root.append(...view.sections);
  document.body.append(root);
  return { view, root, state: s };
}

function btnByText(root: HTMLElement, text: string): HTMLButtonElement {
  const b = Array.from(root.querySelectorAll('button')).find(x => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b as HTMLButtonElement;
}

describe('employee inspector — sections', () => {
  it('shows identity, location, now, needs, skills, pay, training and dismiss', () => {
    const { root } = build(makeEmployee());
    const text = root.textContent ?? '';
    for (const key of ['ui.crew.hired', 'ui.crew.location', 'ui.crew.current_task', 'ui.crew.needs', 'ui.crew.skills', 'ui.crew.pay', 'ui.crew.training']) {
      expect(text).toContain(t(key));
    }
    expect(text).toContain('Walt'.slice(0, 1)); // initials rendered by identity
    expect(text).toContain(t('ui.crew.dismiss'));
  });

  it('the view wrapper carries .bs-employee-detail (sections mount inside it)', () => {
    const { view, root } = build(makeEmployee());
    expect(view.sections[0]!.matches('.bs-employee-detail')).toBe(true);
    expect(root.querySelector('.bs-train-btn')).not.toBeNull();
  });

  it('manager effect only for managers', () => {
    const plain = build(makeEmployee()).root;
    expect(plain.querySelector('.bs-crew-manager-effect')).toBeNull();
    const m = makeEmployee({ role: 'manager', qualifications: [{ category: 'management', proficiencyLevel: 3, xp: 0 }] });
    expect(build(m).root.querySelector('.bs-crew-manager-effect')).not.toBeNull();
  });

  it('rest section appears only when resting or walking to rest', () => {
    const idle = build(makeEmployee()).root;
    const resting = build(makeEmployee({ locomotion: { kind: 'inside', buildingId: 4 }, restTicksRemaining: 9 })).root;
    const walking = build(makeEmployee({ destinationX: 8, destinationZ: 8, pendingRestDuration: 30 })).root;
    expect(resting.textContent).not.toBe(idle.textContent);
    expect(resting.textContent).toContain('9');
    expect(walking.textContent).not.toBe(idle.textContent);
  });

  it('view reports no entity for a missing employee', () => {
    const e = makeEmployee();
    const s = makeState(e);
    expect(employeeContent.view({ kind: 'employee', id: 999 }, s, makeLinks().links)).toBeNull();
  });

  it('keeps the detail/dispatch_here/train actions', () => {
    const { view } = build(makeEmployee());
    expect(view.actions.map(a => a.action)).toEqual(['detail', 'dispatch_here', 'train']);
  });
});

describe('employee inspector — links', () => {
  it('inside a building: the location is a building link that selects it', () => {
    const l = makeLinks();
    const { root } = build(makeEmployee({ locomotion: { kind: 'inside', buildingId: 4 } }), undefined, l.links);
    const a = root.querySelector('[data-select-kind="building"][data-select-id="4"]') as HTMLElement;
    expect(a).not.toBeNull();
    a.click();
    expect(l.select).toHaveBeenCalledWith('building', 4);
  });

  it('aboard a vehicle: the location is a vehicle link', () => {
    const l = makeLinks();
    const e = makeEmployee({ locomotion: { kind: 'mounted', vehicleId: 9 } });
    const s = makeState(e);
    s.vehicles.vehicles = [{ id: 9, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100, cargo: [], occupantIds: [1] } as never];
    const { root } = build(e, s, l.links);
    const a = root.querySelector('[data-select-kind="vehicle"][data-select-id="9"]') as HTMLElement;
    expect(a).not.toBeNull();
    a.click();
    expect(l.select).toHaveBeenCalledWith('vehicle', 9);
  });

  it('the task target is a link', () => {
    const l = makeLinks();
    const e = makeEmployee({
      activeActionId: 5, taskTicksRemaining: 10, activeTaskTotalTicks: 20,
      pendingActionType: 'demolish_building' as never, pendingActionPayload: { buildingId: 4 },
    });
    const { root } = build(e, undefined, l.links);
    const a = root.querySelector('[data-select-kind="building"][data-select-id="4"]') as HTMLElement;
    expect(a).not.toBeNull();
    a.click();
    expect(l.select).toHaveBeenCalledWith('building', 4);
  });

  it('training in progress: the school is a link', () => {
    const l = makeLinks();
    const e = makeEmployee({ trainingState: { buildingId: 6, skill: 'blasting', ticksRemaining: 12, fee: 100 } });
    const { root } = build(e, undefined, l.links);
    const a = root.querySelector('[data-select-kind="building"][data-select-id="6"]') as HTMLElement;
    expect(a).not.toBeNull();
    a.click();
    expect(l.select).toHaveBeenCalledWith('building', 6);
  });
});

describe('employee inspector — actions', () => {
  it('a raise preset runs the employee raise command', () => {
    const l = makeLinks();
    const { root } = build(makeEmployee(), undefined, l.links);
    btnByText(root, t('ui.crew.raise_amount', { amount: perHour(100) })).click();
    expect(l.run).toHaveBeenCalledWith('employee raise 1 amount:100');
  });

  it('Train runs the employee train command with skill and school', () => {
    const l = makeLinks();
    const { root } = build(makeEmployee(), undefined, l.links);
    const btn = root.querySelector('.bs-train-btn[data-skill]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    const skill = btn.dataset['skill']!;
    btn.click();
    expect(l.run).toHaveBeenCalledTimes(1);
    expect(l.run.mock.calls[0]![0]).toMatch(new RegExp(`^employee train 1 skill:${skill} building:\\d+$`));
  });

  it('Dismiss asks for confirmation first; only the confirm callback fires the employee', () => {
    const l = makeLinks();
    const { root } = build(makeEmployee(), undefined, l.links);
    btnByText(root, t('ui.crew.dismiss')).click();
    expect(l.confirm).toHaveBeenCalledTimes(1);
    expect(l.run).not.toHaveBeenCalled();
    l.confirm.mock.calls[0]![0].onConfirm();
    expect(l.run).toHaveBeenCalledWith('employee fire 1');
  });

  it('a unionized employee cannot be dismissed and the union reason shows', () => {
    const l = makeLinks();
    const { root } = build(makeEmployee({ unionized: true }), undefined, l.links);
    const btn = btnByText(root, t('ui.crew.dismiss'));
    expect(btn.disabled).toBe(true);
    btn.click();
    expect(l.confirm).not.toHaveBeenCalled();
    expect(root.textContent).toContain(t('ui.crew.dismiss_union_blocked'));
  });
});

describe('employee inspector — live refresh', () => {
  it('needs refresh each frame', () => {
    const e = makeEmployee({ fatigue: 90 });
    const { view, root, state } = build(e);
    const before = root.querySelector('[data-need]')!.textContent;
    state.employees.employees[0]!.fatigue = 12;
    view.sync(root);
    expect(root.querySelector('[data-need]')!.textContent).not.toBe(before);
  });

  it('the task section follows task progress', () => {
    const e = makeEmployee({
      activeActionId: 5, taskTicksRemaining: 10, activeTaskTotalTicks: 20, pendingActionType: 'drill_hole' as never,
    });
    const { view, root, state } = build(e);
    expect(root.textContent).toContain(t('ui.crew.ticks_left', { n: 10 }));
    state.employees.employees[0]!.taskTicksRemaining = 3;
    view.sync(root);
    expect(root.textContent).toContain(t('ui.crew.ticks_left', { n: 3 }));
    expect(root.textContent).not.toContain(t('ui.crew.ticks_left', { n: 10 }));
  });

  it('skills refresh when a qualification is gained', () => {
    const e = makeEmployee();
    const { view, root, state } = build(e);
    expect(root.textContent).toContain(t('ui.crew.no_skills'));
    state.employees.employees[0]!.qualifications = [{ category: 'blasting', proficiencyLevel: 1, xp: 0 }];
    view.sync(root);
    expect(root.textContent).not.toContain(t('ui.crew.no_skills'));
  });

  it('the training countdown follows trainingState.ticksRemaining live', () => {
    const e = makeEmployee({ trainingState: { buildingId: 6, skill: 'blasting', ticksRemaining: 12, fee: 100 } });
    const { view, root, state } = build(e);
    const active = () => root.querySelector('.bs-training-active[data-skill="blasting"]')!.textContent;
    expect(active()).toContain('12');
    state.employees.employees[0]!.trainingState!.ticksRemaining = 5;
    view.sync(root);
    expect(active()).toContain('5');
    expect(active()).not.toContain('12');
  });

  it('starting training swaps the Train buttons for the active marker', () => {
    const e = makeEmployee();
    const { view, root, state } = build(e);
    expect(root.querySelector('.bs-train-btn')).not.toBeNull();
    state.employees.employees[0]!.trainingState = { buildingId: 6, skill: 'blasting', ticksRemaining: 12, fee: 100 };
    view.sync(root);
    expect(root.querySelector('.bs-train-btn')).toBeNull();
    expect(root.querySelector('.bs-training-active[data-skill="blasting"]')).not.toBeNull();
  });

  it('an unchanged frame does not replace the Train button node', () => {
    const { view, root } = build(makeEmployee());
    const before = root.querySelector('.bs-train-btn');
    view.sync(root);
    view.sync(root);
    expect(root.querySelector('.bs-train-btn')).toBe(before);
  });

  it('the location link appears live once the employee enters a building', () => {
    const { view, root, state } = build(makeEmployee());
    expect(root.querySelector('[data-select-kind="building"][data-select-id="4"]')).toBeNull();
    state.employees.employees[0]!.locomotion = { kind: 'inside', buildingId: 4 };
    view.sync(root);
    expect(root.querySelector('[data-select-kind="building"][data-select-id="4"]')).not.toBeNull();
  });
});
