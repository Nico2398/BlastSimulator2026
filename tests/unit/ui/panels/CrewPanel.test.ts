// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { CrewPanel } from '../../../../src/ui/panels/CrewPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { t } from '../../../../src/core/i18n/I18n.js';
import { managerNegotiationBonusPct } from '../../../../src/core/economy/Negotiation.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { Employee, SkillCategory } from '../../../../src/core/entities/Employee.js';
import type { Vehicle } from '../../../../src/core/entities/Vehicle.js';
import type { Building } from '../../../../src/core/entities/Building.js';
import frLocaleJson from '../../../../src/core/i18n/locales/fr.json' assert { type: 'json' };
import enLocaleJson from '../../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import { perHour } from '../../../../src/ui/crewDetailSections.js';
import { hiringSignature, makeHiringSection } from '../../../../src/ui/panels/CrewHiring.js';
import { FilterBarSelection } from '../../../../src/ui/filterBar.js';
import { candidatesForRole, takeCandidate, type HireCandidate } from '../../../../src/core/entities/HiringPool.js';
import { HIRING_COSTS } from '../../../../src/core/entities/Employee.js';
import { skillLevelExplain, salaryExplain, unionExplain } from '../../../../src/ui/statExplain.js';

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
    locomotion: { kind: 'on_foot' },
    itinerary: null,
    vehicleWaitingTicks: 0,
    ...overrides,
  };
}

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1, type: 'debris_hauler', tier: 1, x: 0, z: 0, hp: 100,
    cargo: [],
    occupantIds: [],
    ...overrides,
  };
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
    expect(row.querySelectorAll('[title]:not([data-action="locate"]), .bs-crew-status [data-explain]').length).toBe(2);
  });

  it('shows a driving tag when a vehicle lists the employee as its driver', () => {
    const { panel } = makePanel();
    const state = makeState(
      [makeEmployee({ id: 6 })],
      [makeVehicle({ id: 1, occupantIds: [6] })],
    );
    panel.update(state);
    const row = panel.root.querySelector('[data-employee-id="6"]')!;
    expect(row.querySelector('[title="Driving a vehicle"]')).not.toBeNull();
  });

  // ── HIRING ──

  it('hiring rows list every role with real cost, starting qualification, and headcount', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 1, role: 'driller' })]));
    const text = panel.root.textContent!;
    expect(text).toContain('HIRING');
    expect(text).toContain('$1000');
    expect(text).toContain('Starts with Blasting ★1, Drill Rig Operation ★1 · 1 on roster');
  });

  it('hire button dispatches employee hire with the real role', () => {
    const { panel } = makePanel();
    const calls: string[] = [];
    panel.setGameConsole(cmd => { calls.push(cmd); return { success: true, output: '' }; });
    panel.update(makeState([]));
    const hireBtns = [...panel.root.querySelectorAll('button')].filter(b => b.textContent === 'Hire');
    hireBtns[0]!.click();
    const state = panel.root.querySelector('button[data-role="driller"][data-candidate-id]') as HTMLButtonElement;
    expect(state).not.toBeNull();
    expect(calls).toEqual([`employee hire role:driller candidate:${state.dataset['candidateId']}`]);
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
    const hiringRows = children.slice(hiringIdx + 1).filter(c => c.dataset['hiringRole'] !== undefined); // the filter bar (#2160) sits between header and rows

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

describe('CrewPanel manager effect (#1340)', () => {
  const mgr = (level: 1 | 2 | 3 | 4 | 5, overrides: Partial<Employee> = {}) => makeEmployee({
    id: 7, name: 'Pat Boss', role: 'manager',
    qualifications: [{ category: 'management', proficiencyLevel: level, xp: 0 }],
    ...overrides,
  });

  it('a hired manager card shows the negotiation bonus for its level', () => {
    const { panel } = makePanel();
    panel.update(makeState([mgr(3)]));
    const eff = panel.root.querySelector('[data-employee-id="7"] .bs-crew-manager-effect');
    expect(eff).not.toBeNull();
    expect(eff!.textContent).toBe(t('ui.crew.manager_effect', { pct: managerNegotiationBonusPct(3) }));
    expect(eff!.textContent).toContain('16');
  });

  it('non-manager cards carry no manager effect', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 2 })]));
    expect(panel.root.querySelector('[data-employee-id="2"] .bs-crew-manager-effect')).toBeNull();
  });

  it('the effect refreshes when the manager level changes', () => {
    const { panel } = makePanel();
    const state = makeState([mgr(1)]);
    panel.update(state);
    expect(panel.root.querySelector('.bs-crew-manager-effect')!.textContent).toBe(t('ui.crew.manager_effect', { pct: 0 }));
    state.employees.employees[0]!.qualifications = [{ category: 'management', proficiencyLevel: 5, xp: 0 }];
    panel.update(state);
    expect(panel.root.querySelector('.bs-crew-manager-effect')!.textContent).toBe(t('ui.crew.manager_effect', { pct: 32 }));
  });

  it('the manager hiring row explains what a manager does', () => {
    const { panel } = makePanel();
    panel.update(makeState([]));
    const row = panel.root.querySelector('[data-hiring-role="manager"]')!;
    expect(row.textContent).toContain(t('ui.crew.manager_effect_hint'));
    const other = panel.root.querySelector('[data-hiring-role="driller"]')!;
    expect(other.textContent).not.toContain(t('ui.crew.manager_effect_hint'));
  });
});


describe('CrewPanel — hiring candidates (#1385)', () => {
  const ROLES = ['driller', 'blaster', 'driver', 'surveyor', 'manager'] as const;

  function hireBtnsFor(panel: CrewPanel, role: string): HTMLButtonElement[] {
    return [...panel.root.querySelectorAll<HTMLButtonElement>(`button[data-role="${role}"][data-candidate-id]`)];
  }

  /** Smallest ancestor of the button that also contains the candidate's name: the candidate card. */
  function cardOf(btn: HTMLElement, c: HireCandidate): HTMLElement {
    let node: HTMLElement | null = btn;
    while (node && !(node.textContent ?? '').includes(c.name)) node = node.parentElement;
    if (!node) throw new Error(`no card containing ${c.name}`);
    return node;
  }

  it('renders 3 Hire buttons per role, each carrying data-role and data-candidate-id', () => {
    const { panel } = makePanel();
    const state = makeState([]);
    panel.update(state);
    for (const role of ROLES) {
      const btns = hireBtnsFor(panel, role);
      expect(btns.map(b => b.dataset['candidateId'])).toEqual(
        candidatesForRole(state.hiringPool, role).map(c => String(c.id)),
      );
      expect(btns).toHaveLength(3);
    }
  });

  it('each candidate card shows name, $X/h salary, skill, union status and the hire fee', () => {
    const { panel } = makePanel();
    const state = makeState([]);
    panel.update(state);
    for (const role of ROLES) {
      for (const c of candidatesForRole(state.hiringPool, role)) {
        const btn = panel.root.querySelector(`button[data-candidate-id="${c.id}"]`) as HTMLButtonElement;
        const text = cardOf(btn, c).textContent!;
        expect(text).toContain(c.name);
        expect(text).toContain(`$${perHour(c.salary)}/h`);
        expect(text).toContain(t(c.unionized ? 'ui.crew.candidate_union' : 'ui.crew.candidate_non_union'));
        expect(text).toContain(`$${HIRING_COSTS[role]}`);
        const catLabelHint = t(`skill.${c.qualifications[0]!.category}`);
        if (catLabelHint !== `skill.${c.qualifications[0]!.category}`) expect(text).toContain(catLabelHint);
      }
    }
  });

  it('clicking a candidate Hire sends employee hire role:R candidate:ID', () => {
    const { panel } = makePanel();
    const calls: string[] = [];
    panel.setGameConsole(cmd => { calls.push(cmd); return { success: true, output: '' }; });
    const state = makeState([]);
    panel.update(state);
    const second = candidatesForRole(state.hiringPool, 'blaster')[1]!;
    (panel.root.querySelector(`button[data-candidate-id="${second.id}"]`) as HTMLButtonElement).click();
    expect(calls).toEqual([`employee hire role:blaster candidate:${second.id}`]);
  });

  it('Hire buttons are disabled when the role fee is unaffordable, enabled otherwise', () => {
    const { panel } = makePanel();
    const state = makeState([]);
    state.cash = HIRING_COSTS.manager - 1;
    panel.update(state);
    expect(hireBtnsFor(panel, 'manager').every(b => b.disabled)).toBe(true);
    state.cash = HIRING_COSTS.manager;
    panel.update(state);
    expect(hireBtnsFor(panel, 'manager').every(b => !b.disabled)).toBe(true);
  });

  it('an empty role shows the no_candidates text and no Hire button', () => {
    const { panel } = makePanel();
    const state = makeState([]);
    for (let i = 0; i < 3; i++) takeCandidate(state.hiringPool, 'surveyor');
    panel.update(state);
    expect(hireBtnsFor(panel, 'surveyor')).toHaveLength(0);
    expect(hireBtnsFor(panel, 'driller')).toHaveLength(3);
    expect(panel.root.textContent).toContain(t('ui.crew.no_candidates'));
  });

  it('re-renders when a candidate is removed from the pool', () => {
    const { panel } = makePanel();
    const state = makeState([]);
    panel.update(state);
    takeCandidate(state.hiringPool, 'driver');
    panel.update(state);
    expect(hireBtnsFor(panel, 'driver')).toHaveLength(2);
  });
});

describe('hiringSignature (#1385)', () => {
  it('is stable for an unchanged state', () => {
    const state = makeState([]);
    expect(hiringSignature(state)).toBe(hiringSignature(state));
    expect(hiringSignature(state)).not.toBe('');
  });

  it('changes when candidate ids change', () => {
    const state = makeState([]);
    const before = hiringSignature(state);
    takeCandidate(state.hiringPool, 'driller');
    expect(hiringSignature(state)).not.toBe(before);
  });

  it('changes when affordability of a role flips', () => {
    const state = makeState([]);
    state.cash = HIRING_COSTS.driller;
    const afford = hiringSignature(state);
    state.cash = HIRING_COSTS.driller - 1;
    expect(hiringSignature(state)).not.toBe(afford);
  });

  it('changes when the filter selection changes (#2160)', () => {
    const state = makeState([]);
    const sel = new FilterBarSelection();
    const before = hiringSignature(state, sel);
    sel.groups['union'] = 'union';
    expect(hiringSignature(state, sel)).not.toBe(before);
  });

  it('panel: clicking a role button narrows the groups and survives the next update (#2160)', () => {
    const { panel } = makePanel();
    const state = makeState([]);
    panel.update(state);
    // The roster has its own bar (#2161); the hiring bar is the one without the status group.
    const hiringBar = [...panel.root.querySelectorAll('.bs-filter-bar')].find(b => !b.querySelector('[data-filter-group="status"]'))!;
    (hiringBar.querySelector('[data-filter-value="driller"]') as HTMLButtonElement).click();
    const roles = () => [...panel.root.querySelectorAll<HTMLElement>('[data-hiring-role]')].map(n => n.dataset['hiringRole']);
    expect(roles()).toEqual(['driller']);
    panel.update(state);
    expect(roles()).toEqual(['driller']);
  });

  it('does not change on raw cash changes that keep every role affordability', () => {
    const state = makeState([]);
    state.cash = 1_000_000;
    const a = hiringSignature(state);
    state.cash = 1_000_123;
    expect(hiringSignature(state)).toBe(a);
  });
});

// ── Live refresh keeps scroll, expansion and in-flight clicks (#1592) ──

describe('CrewPanel — live refresh keeps the roster scroll (#1592)', () => {
  const rosterScroll = (panel: CrewPanel): HTMLElement =>
    panel.root.querySelector<HTMLElement>('.bsx-roster-scroll')!;

  function threeCrew(): Employee[] {
    return [
      makeEmployee({ id: 1, name: 'Walt Diggins' }),
      makeEmployee({ id: 2, name: 'Ada Blaster' }),
      makeEmployee({ id: 3, name: 'Bo Hauler' }),
    ];
  }

  it('keeps roster scrollTop and renders no detail when an employee changes activity', () => {
    const { panel } = makePanel();
    panel.update(makeState(threeCrew()));
    toggle(panel, 2);
    rosterScroll(panel).scrollTop = 80;

    // Employee 1 starts driving: activity kind (a signature input) and a status tag change.
    panel.update(makeState(threeCrew(), [makeVehicle({ id: 1, occupantIds: [1] })]));

    expect(rosterScroll(panel).scrollTop).toBe(80);
    expect(panel.root.querySelector('.bs-crew-detail')).toBeNull();
  });

  it('keeps roster scrollTop when injury hours remaining change', () => {
    const { panel } = makePanel();
    const injured = (ticks: number): Employee[] => [
      makeEmployee({ id: 1, injured: true, injuryTicksRemaining: ticks }),
      makeEmployee({ id: 2, name: 'Ada Blaster' }),
    ];
    panel.update(makeState(injured(100)));
    rosterScroll(panel).scrollTop = 80;

    panel.update(makeState(injured(60)));

    expect(rosterScroll(panel).scrollTop).toBe(80);
  });

  it('does not rebuild roster rows on an activity-only change, yet refreshes status tags', () => {
    const { panel } = makePanel();
    panel.update(makeState(threeCrew()));
    const rowBefore = panel.root.querySelector('[data-employee-id="1"]');
    const scrollBefore = rosterScroll(panel);
    expect(rowBefore!.querySelector('[title="Driving a vehicle"]')).toBeNull();

    panel.update(makeState(threeCrew(), [makeVehicle({ id: 1, occupantIds: [1] })]));

    expect(panel.root.querySelector('[data-employee-id="1"]')).toBe(rowBefore);
    expect(rosterScroll(panel)).toBe(scrollBefore);
    expect(rowBefore!.querySelector('[title="Driving a vehicle"]')).not.toBeNull();
  });

  it('removes a stale status tag in place when the activity ends', () => {
    const { panel } = makePanel();
    panel.update(makeState(threeCrew(), [makeVehicle({ id: 1, occupantIds: [1] })]));
    const rowBefore = panel.root.querySelector('[data-employee-id="1"]');
    expect(rowBefore!.querySelector('[title="Driving a vehicle"]')).not.toBeNull();

    panel.update(makeState(threeCrew()));

    expect(panel.root.querySelector('[data-employee-id="1"]')).toBe(rowBefore);
    expect(rowBefore!.querySelector('[title="Driving a vehicle"]')).toBeNull();
  });

  it('refreshes the injury tooltip in place when injury hours change', () => {
    const { panel } = makePanel();
    const crew = (ticks: number): Employee[] => [
      makeEmployee({ id: 1, injured: true, injuryTicksRemaining: ticks }),
      makeEmployee({ id: 2, name: 'Ada Blaster' }),
    ];
    panel.update(makeState(crew(100)));
    const rowBefore = panel.root.querySelector('[data-employee-id="1"]');
    const titleBefore = rowBefore!.querySelector('[title^="Injured"]')!.getAttribute('title');

    panel.update(makeState(crew(20)));

    expect(panel.root.querySelector('[data-employee-id="1"]')).toBe(rowBefore);
    expect(rowBefore!.querySelector('[title^="Injured"]')!.getAttribute('title')).not.toBe(titleBefore);
  });

  it('still rebuilds when the roster itself changes (a new hire appears)', () => {
    const { panel } = makePanel();
    panel.show(); // a hidden panel reads scrollTop 0, so scroll is only carried while visible
    panel.update(makeState(threeCrew()));
    rosterScroll(panel).scrollTop = 80;
    panel.update(makeState([...threeCrew(), makeEmployee({ id: 4, name: 'New Hire' })]));

    expect(panel.root.querySelector('[data-employee-id="4"]')).not.toBeNull();
    expect(rosterScroll(panel).scrollTop).toBe(80);
  });

  it('keeps roster scrollTop across a select click', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState(threeCrew()));
    rosterScroll(panel).scrollTop = 80;
    toggle(panel, 1);
    expect(rosterScroll(panel).scrollTop).toBe(80);
  });
});

describe('CrewPanel — row header only selects the employee (#1765)', () => {
  it('clicking .bs-detail-toggle calls the select handler with the employee id', () => {
    const { panel } = makePanel();
    const picked: number[] = [];
    panel.setSelectEmployeeHandler(id => picked.push(id));
    panel.update(makeState([makeEmployee({ id: 1 }), makeEmployee({ id: 2, name: 'Bea Rock' })]));
    (panel.root.querySelector('[data-employee-id="2"] .bs-detail-toggle') as HTMLButtonElement).click();
    expect(picked).toEqual([2]);
  });

  it('the click renders no inline detail, and a second click selects again', () => {
    const { panel } = makePanel();
    const picked: number[] = [];
    panel.setSelectEmployeeHandler(id => picked.push(id));
    panel.update(makeState([makeEmployee({ id: 1 })]));
    toggle(panel, 1);
    expect(panel.root.querySelector('.bs-crew-detail')).toBeNull();
    expect(panel.root.querySelector('.bs-employee-detail')).toBeNull();
    toggle(panel, 1);
    expect(panel.root.querySelector('.bs-crew-detail')).toBeNull();
    expect(picked).toEqual([1, 1]);
  });

  it('works without a select handler wired', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 1 })]));
    expect(() => toggle(panel, 1)).not.toThrow();
  });

  it('the row keeps avatar-row content, role attribute and Locate', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeEmployee({ id: 5, role: 'blaster', name: 'Walt Diggins', morale: 62 })]));
    const row = panel.root.querySelector('[data-employee-id="5"]')!;
    expect(row.getAttribute('data-employee-role')).toBe('blaster');
    expect(row.textContent).toContain('Walt Diggins');
    expect(row.textContent).toContain('62%');
    expect(row.querySelector('[data-action="locate"]')).not.toBeNull();
    expect(row.querySelector('.bs-detail-toggle')).not.toBeNull();
  });

  it('no longer exposes expandEmployee', () => {
    const { panel } = makePanel();
    expect((panel as unknown as { expandEmployee?: unknown }).expandEmployee).toBeUndefined();
  });
});

describe('CrewPanel — scene selection highlight (#1765)', () => {
  const SEL = 'bs-row-selected';
  const crew = (): Employee[] => [
    makeEmployee({ id: 1 }), makeEmployee({ id: 2, name: 'Bea Rock' }), makeEmployee({ id: 3, name: 'Cy Haul' }),
  ];
  const selectedIds = (panel: CrewPanel): string[] =>
    [...panel.root.querySelectorAll(`.${SEL}`)].map(n => n.closest('[data-employee-id]')?.getAttribute('data-employee-id') ?? n.getAttribute('data-employee-id') ?? '');

  it('highlights exactly the selected employee row', () => {
    const { panel } = makePanel();
    panel.update(makeState(crew()));
    panel.setSelectedEmployee({ kind: 'employee', id: 2 });
    expect(selectedIds(panel)).toEqual(['2']);
    expect(panel.root.querySelector('[data-employee-id="2"]')!.classList.contains(SEL)).toBe(true);
    expect(panel.root.querySelector('[data-employee-id="2"]')!.getAttribute('aria-selected')).toBe('true');
  });

  it('moving the selection moves the highlight', () => {
    const { panel } = makePanel();
    panel.update(makeState(crew()));
    panel.setSelectedEmployee({ kind: 'employee', id: 1 });
    panel.setSelectedEmployee({ kind: 'employee', id: 3 });
    expect(selectedIds(panel)).toEqual(['3']);
    expect(panel.root.querySelector('[data-employee-id="1"]')!.classList.contains(SEL)).toBe(false);
  });

  it.each([
    ['null', null],
    ['a building', { kind: 'building', id: 2 }],
    ['a vehicle', { kind: 'vehicle', id: 2 }],
  ] as const)('clears the highlight when the selection is %s', (_n, sel) => {
    const { panel } = makePanel();
    panel.update(makeState(crew()));
    panel.setSelectedEmployee({ kind: 'employee', id: 2 });
    panel.setSelectedEmployee(sel as never);
    expect(panel.root.querySelectorAll(`.${SEL}`).length).toBe(0);
    expect(panel.root.querySelector('[aria-selected="true"]')).toBeNull();
  });

  it('a non-employee selection never highlights an employee with the same id', () => {
    const { panel } = makePanel();
    panel.update(makeState(crew()));
    panel.setSelectedEmployee({ kind: 'building', id: 2 });
    expect(panel.root.querySelectorAll(`.${SEL}`).length).toBe(0);
  });

  it('highlight survives a structural re-render', () => {
    const { panel } = makePanel();
    panel.update(makeState(crew()));
    panel.setSelectedEmployee({ kind: 'employee', id: 2 });
    panel.update(makeState([...crew(), makeEmployee({ id: 4, name: 'New Hire' })]));
    expect(selectedIds(panel)).toEqual(['2']);
  });

  it('highlight survives refreshLocale', () => {
    const { panel } = makePanel();
    panel.update(makeState(crew()));
    panel.setSelectedEmployee({ kind: 'employee', id: 3 });
    panel.refreshLocale();
    expect(selectedIds(panel)).toEqual(['3']);
  });

  it('a selection made before the first update is applied once rows exist', () => {
    const { panel } = makePanel();
    panel.setSelectedEmployee({ kind: 'employee', id: 2 });
    panel.update(makeState(crew()));
    expect(selectedIds(panel)).toEqual(['2']);
  });

  it('selecting an employee not in the roster highlights nothing', () => {
    const { panel } = makePanel();
    panel.update(makeState(crew()));
    panel.setSelectedEmployee({ kind: 'employee', id: 99 });
    expect(panel.root.querySelectorAll(`.${SEL}`).length).toBe(0);
  });

  it('the neutral class replaces any build-specific one', () => {
    const { panel } = makePanel();
    panel.update(makeState(crew()));
    panel.setSelectedEmployee({ kind: 'employee', id: 1 });
    expect(panel.root.querySelector('.bs-build-row-selected')).toBeNull();
  });
});

describe('CrewPanel — union trade-off on hire cards (#1873)', () => {
  it('a union candidate card states the lower pay and the no-dismissal catch; a non-union card does not', () => {
    const { panel } = makePanel();
    const state = makeState([]);
    const cands = candidatesForRole(state.hiringPool, 'driller');
    cands[0]!.unionized = true;
    cands[1]!.unionized = false;
    panel.update(state);
    const line = t('ui.crew.candidate_union_tradeoff', { pct: 15 });
    expect(line).not.toBe('ui.crew.candidate_union_tradeoff');
    const cardText = (c: HireCandidate): string => {
      let node: HTMLElement | null = panel.root.querySelector(`button[data-candidate-id="${c.id}"]`);
      while (node && !(node.textContent ?? '').includes(c.name)) node = node.parentElement;
      return node!.textContent!;
    };
    expect(cardText(cands[0]!)).toContain(line);
    expect(cardText(cands[1]!)).not.toContain(line);
  });
});

describe('CrewPanel — hire card union line names demands and strikes (#1890)', () => {
  it('a union candidate card shows the trade-off line naming demands and strikes (en)', () => {
    const { panel } = makePanel();
    const state = makeState([]);
    const cands = candidatesForRole(state.hiringPool, 'driller');
    cands[0]!.unionized = true;
    panel.update(state);
    const line = t('ui.crew.candidate_union_tradeoff', { pct: 15 });
    let node: HTMLElement | null = panel.root.querySelector(`button[data-candidate-id="${cands[0]!.id}"]`);
    while (node && !(node.textContent ?? '').includes(cands[0]!.name)) node = node.parentElement;
    expect(node!.textContent).toContain(line);
    expect(line).toMatch(/demand/i);
    expect(line).toMatch(/strike/i);
  });

  it('the French line names revendications and grèves', () => {
    const fr = (frLocaleJson as Record<string, string>)['ui.crew.candidate_union_tradeoff']!;
    expect(fr).toMatch(/revendication/i);
    expect(fr).toMatch(/gr[eè]ve/i);
    expect(fr).toContain('{pct}');
  });
});

describe('CrewPanel — hiring filter and sort (#2160)', () => {
  type Level = 1 | 2 | 3 | 4 | 5;
  function cand(id: number, role: HireCandidate['role'], quals: [HireCandidate['qualifications'][number]['category'], Level][], salary: number, unionized: boolean): HireCandidate {
    return {
      id, role, name: `Zed Person${id}`, unionized, salary,
      qualifications: quals.map(([category, proficiencyLevel]) => ({ category, proficiencyLevel, xp: 0 })),
    };
  }

  // Pool order deliberately differs from salary order inside the driller group (1 before 2).
  function makePool(): HireCandidate[] {
    return [
      cand(1, 'driller', [['blasting', 1], ['driving.drill_rig', 1]], 400, false),
      cand(2, 'driller', [['blasting', 3], ['driving.drill_rig', 1]], 300, true),
      cand(3, 'blaster', [['blasting', 2], ['driving.truck', 1]], 900, false),
      cand(4, 'blaster', [['blasting', 1], ['driving.truck', 3]], 700, true),
      cand(5, 'driver', [['driving.truck', 1], ['driving.excavator', 1]], 500, false),
      cand(6, 'surveyor', [['geology', 1]], 600, false),
      cand(7, 'manager', [['management', 1]], 1000, true),
    ];
  }

  function setup(opts: { cash?: number; pool?: HireCandidate[] } = {}) {
    const state = makeState([]);
    state.hiringPool.candidates = opts.pool ?? makePool();
    state.cash = opts.cash ?? 100000;
    const sel = new FilterBarSelection();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const hires: [string, number][] = [];
    let changes = 0;
    const render = (): void => {
      host.replaceChildren(...makeHiringSection(state, (role, id) => { hires.push([role, id]); }, {
        selection: sel,
        onChange: () => { changes++; render(); },
      }));
    };
    render();
    return { state, sel, host, hires, render, changes: () => changes };
  }

  const click = (host: HTMLElement, selector: string): void => {
    const btn = host.querySelector<HTMLButtonElement>(selector);
    if (!btn) throw new Error(`no control ${selector}`);
    btn.click();
  };
  const roleBtn = (role: string): string => `button[data-filter-value="${role}"]`;
  const groupBtn = (group: string, value: string): string => `[data-filter-group="${group}"] button[data-filter-value="${value}"]`;
  const sortBtn = (key: string): string => `button[data-sort-key="${key}"]`;
  const shownIds = (host: HTMLElement): number[] =>
    [...host.querySelectorAll<HTMLElement>('[data-candidate-card]')].map(c => Number(c.dataset['candidateCard']));
  const shownRoles = (host: HTMLElement): string[] =>
    [...host.querySelectorAll<HTMLElement>('[data-hiring-role]')].map(g => g.dataset['hiringRole']!);
  const idsInGroup = (host: HTMLElement, role: string): number[] =>
    [...host.querySelectorAll<HTMLElement>(`[data-hiring-role="${role}"] [data-candidate-card]`)].map(c => Number(c.dataset['candidateCard']));

  it('without a view there is no filter bar and every role group and candidate shows', () => {
    const state = makeState([]);
    state.hiringPool.candidates = makePool();
    const host = document.createElement('div');
    host.append(...makeHiringSection(state, () => {}));
    expect(host.querySelector('.bs-filter-bar')).toBeNull();
    expect(shownRoles(host)).toEqual(['driller', 'blaster', 'driver', 'surveyor', 'manager']);
    expect(shownIds(host)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('with a view the shared filter bar comes before the role groups', () => {
    const { host } = setup();
    const bar = host.querySelector('.bs-filter-bar');
    expect(bar).not.toBeNull();
    const firstGroup = host.querySelector('[data-hiring-role]')!;
    expect(bar!.compareDocumentPosition(firstGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('an untouched view shows every group and candidate, no clear button and no no-match element', () => {
    const { host } = setup();
    expect(shownRoles(host)).toEqual(['driller', 'blaster', 'driver', 'surveyor', 'manager']);
    expect(shownIds(host)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(host.querySelector('.bs-filter-clear')).toBeNull();
    expect(host.querySelector('[data-hiring-no-match]')).toBeNull();
  });

  it('the bar offers every role in its main row', () => {
    const { host } = setup();
    for (const role of ['driller', 'blaster', 'driver', 'surveyor', 'manager']) {
      expect(host.querySelector(roleBtn(role))).not.toBeNull();
    }
  });

  it('a role button keeps only that role group, and the click calls onChange', () => {
    const { host, changes } = setup();
    click(host, roleBtn('blaster'));
    expect(changes()).toBe(1);
    expect(shownRoles(host)).toEqual(['blaster']);
    expect(shownIds(host)).toEqual([3, 4]);
  });

  it('the skill row offers exactly the categories some pool candidate holds', () => {
    const { host } = setup();
    const offered = [...host.querySelectorAll<HTMLElement>('[data-filter-group="skill"] button[data-filter-value]')]
      .map(b => b.dataset['filterValue']).sort();
    expect(offered).toEqual(['blasting', 'driving.drill_rig', 'driving.excavator', 'driving.truck', 'geology', 'management']);
  });

  it('a skill filter matches a candidate whose matching skill is not the first qualification', () => {
    const { host } = setup();
    click(host, groupBtn('skill', 'driving.truck'));
    expect(shownIds(host)).toEqual([3, 4, 5]);
    expect(shownRoles(host)).toEqual(['blaster', 'driver']);
  });

  it('min level without a skill matches any qualification at or above it', () => {
    const { host } = setup();
    click(host, groupBtn('level', '3'));
    expect(shownIds(host)).toEqual([2, 4]);
  });

  it('min level with a skill checks that skill only', () => {
    const { host } = setup();
    click(host, groupBtn('skill', 'blasting'));
    click(host, groupBtn('level', '3'));
    expect(shownIds(host)).toEqual([2]);
  });

  it('the union row narrows to union members and to non-members', () => {
    const { host } = setup();
    click(host, groupBtn('union', 'union'));
    expect(shownIds(host)).toEqual([2, 4, 7]);
    click(host, groupBtn('union', 'non_union'));
    expect(shownIds(host)).toEqual([1, 3, 5, 6]);
  });

  it('affordable keeps candidates whose role fee is within cash', () => {
    const { host } = setup({ cash: HIRING_COSTS.surveyor });
    click(host, groupBtn('affordable', 'yes'));
    const expected = makePool().filter(c => HIRING_COSTS[c.role] <= HIRING_COSTS.surveyor).map(c => c.id);
    expect(shownIds(host)).toEqual(expected);
    expect(shownIds(host)).toContain(6);
    expect(shownIds(host)).not.toContain(7);
  });

  it('affordable drops a role whose fee is one over cash', () => {
    const { host } = setup({ cash: HIRING_COSTS.surveyor - 1 });
    click(host, groupBtn('affordable', 'yes'));
    expect(shownIds(host)).not.toContain(6);
  });

  it('the salary sort orders ascending inside each role group', () => {
    const { host } = setup();
    click(host, sortBtn('salary'));
    expect(idsInGroup(host, 'driller')).toEqual([2, 1]);
    expect(idsInGroup(host, 'blaster')).toEqual([4, 3]);
    expect(shownRoles(host)).toEqual(['driller', 'blaster', 'driver', 'surveyor', 'manager']);
  });

  it('the level sort orders descending by the highest qualification', () => {
    const { host } = setup();
    click(host, sortBtn('level'));
    expect(idsInGroup(host, 'driller')).toEqual([2, 1]);
    expect(idsInGroup(host, 'blaster')).toEqual([4, 3]);
  });

  it('the level sort follows the chosen skill', () => {
    const { host } = setup();
    click(host, groupBtn('skill', 'blasting'));
    click(host, sortBtn('level'));
    expect(idsInGroup(host, 'blaster')).toEqual([3, 4]);
  });

  it('with no sort chosen candidates keep pool order', () => {
    const { host } = setup();
    expect(idsInGroup(host, 'driller')).toEqual([1, 2]);
  });

  it('a role group with no remaining candidate is not rendered while a filter is active', () => {
    const { host } = setup();
    click(host, groupBtn('union', 'non_union'));
    expect(host.querySelector('[data-hiring-role="manager"]')).toBeNull();
    expect(host.querySelector('[data-hiring-role="driller"]')).not.toBeNull();
    expect(host.querySelector('[data-hiring-no-match]')).toBeNull();
  });

  it('with an empty pool and no filter the old no-candidates line stays', () => {
    const { host } = setup({ pool: [] });
    expect(host.textContent).toContain(t('ui.crew.no_candidates'));
    expect(host.querySelector('[data-hiring-role]')).not.toBeNull();
    expect(host.querySelector('[data-hiring-no-match]')).toBeNull();
  });

  it('when no candidate matches a neutral no-match element replaces the groups', () => {
    const { host } = setup();
    click(host, groupBtn('skill', 'management'));
    click(host, groupBtn('union', 'non_union'));
    expect(host.querySelector('[data-hiring-no-match]')).not.toBeNull();
    expect(host.querySelector('[data-hiring-role]')).toBeNull();
    expect(host.querySelector('[data-candidate-card]')).toBeNull();
    expect(host.querySelector('.bs-filter-bar')).not.toBeNull();
  });

  it('filters combine, and clear resets them all', () => {
    const { host, sel } = setup();
    click(host, roleBtn('blaster'));
    click(host, groupBtn('union', 'union'));
    expect(shownIds(host)).toEqual([4]);
    click(host, groupBtn('skill', 'driving.truck'));
    click(host, groupBtn('level', '3'));
    click(host, sortBtn('salary'));
    expect(shownIds(host)).toEqual([4]);
    click(host, '.bs-filter-clear');
    expect(shownIds(host)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(shownRoles(host)).toHaveLength(5);
    expect(host.querySelector('.bs-filter-clear')).toBeNull();
    expect(sel.isActive()).toBe(false);
  });

  it('clear after a no-match result brings the candidates back', () => {
    const { host } = setup();
    click(host, groupBtn('skill', 'management'));
    click(host, groupBtn('union', 'non_union'));
    click(host, '.bs-filter-clear');
    expect(host.querySelector('[data-hiring-no-match]')).toBeNull();
    expect(shownIds(host)).toHaveLength(7);
  });

  it('a candidate card lists every qualification, not only the first', () => {
    const { host } = setup();
    const card = host.querySelector<HTMLElement>('[data-candidate-card="3"]')!;
    expect(card.textContent).toContain(t('skill.blasting'));
    expect(card.textContent).toContain(t('skill.driving.truck'));
    const other = host.querySelector<HTMLElement>('[data-candidate-card="5"]')!;
    expect(other.textContent).toContain(t('skill.driving.truck'));
    expect(other.textContent).toContain(t('skill.driving.excavator'));
  });

  it('hiring from a filtered card still reports the role and candidate id', () => {
    const { host, hires } = setup();
    click(host, groupBtn('union', 'union'));
    click(host, '[data-candidate-card="4"] button[data-candidate-id]');
    expect(hires).toEqual([['blaster', 4]]);
  });
});

// ── Roster filter and sort bar (#2161) ──────────────────────────────────────

describe('CrewPanel — roster filter and sort bar (#2161)', () => {
  const qual = (category: SkillCategory) => ({ category, proficiencyLevel: 1 as const, xp: 0 });

  /** Five employees, one per activity, with distinct names, morale, fatigue and salary. */
  function roster(): Employee[] {
    return [
      makeEmployee({ id: 1, name: 'Walt', role: 'driller', morale: 70, fatigue: 40, salary: 900, taskTicksRemaining: 5, qualifications: [qual('blasting'), qual('driving.drill_rig')] }),
      makeEmployee({ id: 2, name: 'amy', role: 'blaster', morale: 20, fatigue: 90, salary: 1500, restTicksRemaining: 4, qualifications: [qual('blasting')] }),
      makeEmployee({ id: 3, name: 'Bo', role: 'driver', morale: 50, fatigue: 10, salary: 700, qualifications: [qual('driving.truck')] }),
      makeEmployee({ id: 4, name: 'Cy', role: 'surveyor', morale: 90, fatigue: 60, salary: 1200, destinationX: 8, destinationZ: 8, isMoveStuck: true, qualifications: [qual('geology')] }),
      makeEmployee({ id: 5, name: 'Di', role: 'driller', morale: 35, fatigue: 75, salary: 1100, injured: true, qualifications: [qual('driving.drill_rig')] }),
    ];
  }

  function setup(employees: Employee[] = roster()) {
    const { panel } = makePanel();
    const state = makeState(employees);
    panel.update(state);
    return { panel, state };
  }

  /** The roster's own bar: the one carrying the status group (the hiring bar has none). */
  const bar = (panel: CrewPanel): HTMLElement =>
    [...panel.root.querySelectorAll<HTMLElement>('.bs-filter-bar')].find(b => b.querySelector('[data-filter-group="status"]'))!;
  const click = (panel: CrewPanel, selector: string): void => (bar(panel).querySelector(selector) as HTMLButtonElement).click();
  const roleBtn = (role: string): string => `.bs-filter-row:not([data-filter-group]) [data-filter-value="${role}"]`;
  const groupBtn = (group: string, value: string): string => `[data-filter-group="${group}"] [data-filter-value="${value}"]`;
  const sortBtn = (key: string): string => `[data-sort-key="${key}"]`;
  const shown = (panel: CrewPanel): number[] =>
    [...panel.root.querySelectorAll<HTMLElement>('[data-employee-id]')].map(r => Number(r.dataset['employeeId']));
  const groupValues = (panel: CrewPanel, group: string): string[] =>
    [...bar(panel).querySelectorAll<HTMLElement>(`[data-filter-group="${group}"] [data-filter-value]`)].map(b => b.dataset['filterValue']!);

  it('shows the shared filter bar above the roster rows', () => {
    const { panel } = setup();
    const first = panel.root.querySelector('[data-employee-id]')!;
    expect(bar(panel)).toBeTruthy();
    expect(bar(panel).compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers every role in the main filter row', () => {
    const { panel } = setup();
    const roles = [...bar(panel).querySelectorAll<HTMLElement>('.bs-filter-row:not([data-filter-group]) [data-filter-value]')]
      .map(b => b.dataset['filterValue']).sort();
    expect(roles).toEqual(['blaster', 'driller', 'driver', 'manager', 'surveyor']);
    expect(bar(panel).querySelector('[data-filter-all]')).not.toBeNull();
  });

  it('offers the five status choices', () => {
    const { panel } = setup();
    expect(groupValues(panel, 'status').sort()).toEqual(['idle', 'injured', 'resting', 'stuck', 'working']);
  });

  it('offers the four sort keys', () => {
    const { panel } = setup();
    const keys = [...bar(panel).querySelectorAll<HTMLElement>('[data-sort-key]')].map(b => b.dataset['sortKey']).sort();
    expect(keys).toEqual(['fatigue', 'morale', 'name', 'salary']);
  });

  it('offers only the skill categories a living employee holds', () => {
    const { panel } = setup([
      ...roster(),
      makeEmployee({ id: 6, name: 'Ghost', alive: false, qualifications: [qual('repair'), qual('management')] }),
    ]);
    expect(groupValues(panel, 'skill').sort()).toEqual(['blasting', 'driving.drill_rig', 'driving.truck', 'geology']);
  });

  it('offers no skill choice on a roster without qualifications', () => {
    const { panel } = setup([makeEmployee({ id: 1 })]);
    expect(groupValues(panel, 'skill')).toEqual([]);
  });

  it('shows the whole roster in stored order before any choice', () => {
    const { panel } = setup();
    expect(shown(panel)).toEqual([1, 2, 3, 4, 5]);
  });

  it('a role button hides the other roles, and All brings them back', () => {
    const { panel } = setup();
    click(panel, roleBtn('driller'));
    expect(shown(panel)).toEqual([1, 5]);
    click(panel, '[data-filter-all]');
    expect(shown(panel)).toEqual([1, 2, 3, 4, 5]);
  });

  it('the status buttons map to the activity of each employee', () => {
    const { panel } = setup();
    click(panel, groupBtn('status', 'working'));
    expect(shown(panel)).toEqual([1]);
    click(panel, groupBtn('status', 'resting'));
    expect(shown(panel)).toEqual([2]);
    click(panel, groupBtn('status', 'idle'));
    expect(shown(panel)).toEqual([3, 5]);
    click(panel, groupBtn('status', 'stuck'));
    expect(shown(panel)).toEqual([4]);
    click(panel, groupBtn('status', 'injured'));
    expect(shown(panel)).toEqual([5]);
  });

  it('a collapsed employee shows under stuck', () => {
    const { panel } = setup([makeEmployee({ id: 1, collapsing: true }), makeEmployee({ id: 2 })]);
    click(panel, groupBtn('status', 'stuck'));
    expect(shown(panel)).toEqual([1]);
  });

  it('a skill button keeps employees holding that category, whichever qualification', () => {
    const { panel } = setup();
    click(panel, groupBtn('skill', 'driving.drill_rig'));
    expect(shown(panel)).toEqual([1, 5]);
    click(panel, groupBtn('skill', 'blasting'));
    expect(shown(panel)).toEqual([1, 2]);
  });

  it('role, status and skill combine with AND', () => {
    const { panel } = setup();
    click(panel, roleBtn('driller'));
    click(panel, groupBtn('skill', 'driving.drill_rig'));
    expect(shown(panel)).toEqual([1, 5]);
    click(panel, groupBtn('status', 'working'));
    expect(shown(panel)).toEqual([1]);
  });

  it('clicking the pressed choice again removes the filter', () => {
    const { panel } = setup();
    click(panel, groupBtn('status', 'working'));
    click(panel, groupBtn('status', 'working'));
    expect(shown(panel)).toEqual([1, 2, 3, 4, 5]);
  });

  it('the name sort lists A to Z ignoring case', () => {
    const { panel } = setup();
    click(panel, sortBtn('name'));
    expect(shown(panel)).toEqual([2, 3, 4, 5, 1]);
  });

  it('the morale sort lists the lowest morale first', () => {
    const { panel } = setup();
    click(panel, sortBtn('morale'));
    expect(shown(panel)).toEqual([2, 5, 3, 1, 4]);
  });

  it('the fatigue sort lists the most tired (lowest gauge) first', () => {
    const { panel } = setup();
    click(panel, sortBtn('fatigue'));
    expect(shown(panel)).toEqual([3, 1, 4, 5, 2]);
  });

  it('the salary sort lists the highest salary first', () => {
    const { panel } = setup();
    click(panel, sortBtn('salary'));
    expect(shown(panel)).toEqual([2, 4, 5, 1, 3]);
  });

  it('clicking the pressed sort again restores the stored order', () => {
    const { panel } = setup();
    click(panel, sortBtn('salary'));
    click(panel, sortBtn('salary'));
    expect(shown(panel)).toEqual([1, 2, 3, 4, 5]);
  });

  it('a sort orders only the rows the filter keeps', () => {
    const { panel } = setup();
    click(panel, roleBtn('driller'));
    click(panel, sortBtn('morale'));
    expect(shown(panel)).toEqual([5, 1]);
  });

  it('Clear filter resets every choice', () => {
    const { panel } = setup();
    expect(bar(panel).querySelector('.bs-filter-clear')).toBeNull();
    click(panel, roleBtn('driller'));
    click(panel, groupBtn('status', 'injured'));
    click(panel, sortBtn('name'));
    click(panel, '.bs-filter-clear');
    expect(shown(panel)).toEqual([1, 2, 3, 4, 5]);
    expect(bar(panel).querySelector('.bs-filter-clear')).toBeNull();
  });

  it('the pressed buttons show the current choice', () => {
    const { panel } = setup();
    click(panel, roleBtn('blaster'));
    click(panel, sortBtn('name'));
    expect(bar(panel).querySelector(roleBtn('blaster'))!.getAttribute('aria-pressed')).toBe('true');
    expect(bar(panel).querySelector(sortBtn('name'))!.getAttribute('aria-pressed')).toBe('true');
    expect(bar(panel).querySelector(roleBtn('driller'))!.getAttribute('aria-pressed')).toBe('false');
  });

  it('the roster filter leaves the hiring section alone', () => {
    const { panel } = setup();
    const groups = () => panel.root.querySelectorAll('[data-hiring-role]').length;
    const before = groups();
    click(panel, roleBtn('driller'));
    expect(groups()).toBe(before);
  });

  it('a filtered row still selects its employee through the handler', () => {
    const { panel } = setup();
    const picked: number[] = [];
    panel.setSelectEmployeeHandler(id => picked.push(id));
    click(panel, groupBtn('status', 'injured'));
    (panel.root.querySelector('[data-employee-id="5"] .bs-detail-toggle') as HTMLButtonElement).click();
    expect(picked).toEqual([5]);
  });

  it('a sorted row still selects its employee through the handler', () => {
    const { panel } = setup();
    const picked: number[] = [];
    panel.setSelectEmployeeHandler(id => picked.push(id));
    click(panel, sortBtn('salary'));
    const first = panel.root.querySelector('[data-employee-id] .bs-detail-toggle') as HTMLButtonElement;
    first.click();
    expect(picked).toEqual([2]);
  });

  it('the scene selection highlight follows its row through filtering', () => {
    const { panel } = setup();
    panel.setSelectedEmployee({ kind: 'employee', id: 1 });
    click(panel, roleBtn('blaster'));
    expect(panel.root.querySelector('[data-employee-id="1"]')).toBeNull();
    click(panel, '[data-filter-all]');
    expect(panel.root.querySelector('[data-employee-id="1"]')!.classList.contains('bs-row-selected')).toBe(true);
  });

  it('the filter survives the next update, also when the roster changes', () => {
    const { panel, state } = setup();
    click(panel, roleBtn('driller'));
    panel.update(state);
    expect(shown(panel)).toEqual([1, 5]);
    state.employees.employees.push(makeEmployee({ id: 6, name: 'New driller', role: 'driller' }), makeEmployee({ id: 7, name: 'New blaster', role: 'blaster' }));
    panel.update(state);
    expect(shown(panel)).toEqual([1, 5, 6]);
    expect(bar(panel).querySelector(roleBtn('driller'))!.getAttribute('aria-pressed')).toBe('true');
  });

  it('the sort survives the next update, also when the roster changes', () => {
    const { panel, state } = setup();
    click(panel, sortBtn('salary'));
    state.employees.employees.push(makeEmployee({ id: 6, name: 'Rich', salary: 5000 }));
    panel.update(state);
    expect(shown(panel)).toEqual([6, 2, 4, 5, 1, 3]);
  });

  it('an employee who starts a task appears under working on the next update', () => {
    const { panel, state } = setup();
    click(panel, groupBtn('status', 'working'));
    expect(shown(panel)).toEqual([1]);
    state.employees.employees.find(e => e.id === 3)!.taskTicksRemaining = 6;
    panel.update(state);
    expect(shown(panel)).toEqual([1, 3]);
  });

  it('an employee who finishes working leaves the working list on the next update', () => {
    const { panel, state } = setup();
    click(panel, groupBtn('status', 'working'));
    state.employees.employees.find(e => e.id === 1)!.taskTicksRemaining = null;
    panel.update(state);
    expect(shown(panel)).toEqual([]);
  });

  it('an employee who falls injured joins the injured list on the next update', () => {
    const { panel, state } = setup();
    click(panel, groupBtn('status', 'injured'));
    state.employees.employees.find(e => e.id === 2)!.injured = true;
    panel.update(state);
    expect(shown(panel)).toEqual([2, 5]);
  });

  it('the sort order follows morale drift on the next update', () => {
    const { panel, state } = setup();
    click(panel, sortBtn('morale'));
    expect(shown(panel)).toEqual([2, 5, 3, 1, 4]);
    state.employees.employees.find(e => e.id === 4)!.morale = 5;
    panel.update(state);
    expect(shown(panel)).toEqual([4, 2, 5, 3, 1]);
  });

  it('a filter nobody matches shows the no-match line instead of rows', () => {
    const { panel } = setup();
    click(panel, roleBtn('manager'));
    expect(shown(panel)).toEqual([]);
    const empties = [...panel.root.querySelectorAll('.bsx-empty')];
    expect(empties).toHaveLength(1);
    expect(empties[0]!.textContent).toBe(t('ui.crew.filter_no_match'));
    expect(empties[0]!.textContent).not.toBe('ui.crew.filter_no_match');
  });

  it('the no-match line goes away when the filter is cleared', () => {
    const { panel } = setup();
    click(panel, roleBtn('manager'));
    click(panel, '.bs-filter-clear');
    expect(panel.root.querySelector('.bsx-empty')).toBeNull();
    expect(shown(panel)).toEqual([1, 2, 3, 4, 5]);
  });

  it('an empty roster without a filter keeps the no-crew line', () => {
    const { panel } = setup([]);
    const empty = panel.root.querySelector('.bsx-empty')!;
    expect(empty.textContent).toBe(t('ui.crew.none'));
  });

  it('a filter on a roster that has crew never shows the no-crew line', () => {
    const { panel } = setup();
    click(panel, roleBtn('manager'));
    expect(panel.root.textContent).not.toContain(t('ui.crew.none'));
  });

  it('has the no-match line in English and French, worded differently', () => {
    const en = enLocaleJson as Record<string, string>;
    const fr = frLocaleJson as Record<string, string>;
    expect(en['ui.crew.filter_no_match']).toBeTruthy();
    expect(fr['ui.crew.filter_no_match']).toBeTruthy();
    expect(fr['ui.crew.filter_no_match']).not.toBe(en['ui.crew.filter_no_match']);
  });
});

describe('CrewPanel — hiring candidate stat explanations (#2163)', () => {
  type Level = 1 | 2 | 3 | 4 | 5;
  const candidate = (id: number, unionized: boolean): HireCandidate => ({
    id, role: 'driller', name: `Zed Person${id}`, unionized, salary: 430,
    qualifications: [
      { category: 'blasting', proficiencyLevel: 2 as Level, xp: 0 },
      { category: 'driving.drill_rig', proficiencyLevel: 4 as Level, xp: 0 },
    ],
  });

  function cardFor(unionized: boolean): { card: HTMLElement; c: HireCandidate } {
    const { panel } = makePanel();
    const state = makeState([]);
    const c = candidate(901, unionized);
    state.hiringPool.candidates = [c];
    panel.update(state);
    const card = panel.root.querySelector<HTMLElement>('[data-candidate-card="901"]');
    expect(card).not.toBeNull();
    return { card: card!, c };
  }

  it('each skill is its own element carrying the explanation for its level', () => {
    const { card } = cardFor(false);
    const skills = [...card.querySelectorAll<HTMLElement>('[data-candidate-skill]')];
    expect(skills).toHaveLength(2);
    expect(skills[0]!.getAttribute('data-explain')).toBe(skillLevelExplain(2));
    expect(skills[1]!.getAttribute('data-explain')).toBe(skillLevelExplain(4));
    expect(skills[0]!.getAttribute('tabindex')).toBe('0');
    expect(skills[0]!.textContent).toContain(t('skill.blasting'));
    expect(skills[1]!.textContent).toContain(t('skill.driving.drill_rig'));
  });

  it('the salary is its own element carrying the salary explanation', () => {
    const { card, c } = cardFor(false);
    const salary = card.querySelector<HTMLElement>('[data-candidate-salary]');
    expect(salary).not.toBeNull();
    expect(salary!.getAttribute('data-explain')).toBe(salaryExplain());
    expect(salary!.getAttribute('tabindex')).toBe('0');
    expect(salary!.textContent).toContain(perHour(c.salary));
  });

  it('a union candidate label carries the union explanation', () => {
    const { card } = cardFor(true);
    const label = card.querySelector<HTMLElement>('[data-candidate-union]');
    expect(label).not.toBeNull();
    expect(label!.getAttribute('data-explain')).toBe(unionExplain());
    expect(label!.getAttribute('tabindex')).toBe('0');
    expect(label!.textContent).toContain(t('ui.crew.candidate_union'));
  });

  it('a non-union candidate label also carries the union explanation', () => {
    const { card } = cardFor(false);
    const label = card.querySelector<HTMLElement>('[data-candidate-union]');
    expect(label).not.toBeNull();
    expect(label!.getAttribute('data-explain')).toBe(unionExplain());
    expect(label!.textContent).toContain(t('ui.crew.candidate_non_union'));
  });

  it('the card text still reads salary · skills · union label', () => {
    const { card, c } = cardFor(true);
    const skills = c.qualifications
      .map(q => t('ui.crew.candidate_skill', { skill: t(`skill.${q.category}`), level: q.proficiencyLevel }))
      .join(', ');
    const expected = `${t('ui.crew.candidate_salary', { salary: perHour(c.salary) })} · ${skills} · ${t('ui.crew.candidate_union')}`;
    expect(card.textContent).toContain(expected);
  });

  it('a candidate with a single skill has exactly one skill element', () => {
    const { panel } = makePanel();
    const state = makeState([]);
    const c = candidate(902, false);
    c.qualifications = [{ category: 'blasting', proficiencyLevel: 1 as Level, xp: 0 }];
    state.hiringPool.candidates = [c];
    panel.update(state);
    const card = panel.root.querySelector<HTMLElement>('[data-candidate-card="902"]')!;
    const skills = card.querySelectorAll<HTMLElement>('[data-candidate-skill]');
    expect(skills).toHaveLength(1);
    expect(skills[0]!.getAttribute('data-explain')).toBe(skillLevelExplain(1));
  });
});

describe('CrewPanel — candidate sheet (#2164)', () => {
  type Level = 1 | 2 | 3 | 4 | 5;
  const candidate = (id: number, role: HireCandidate['role'], unionized: boolean): HireCandidate => ({
    id, role, name: `Sheeted Person${id}`, unionized, salary: 430,
    qualifications: [
      { category: 'blasting', proficiencyLevel: 2 as Level, xp: 0 },
      { category: 'driving.drill_rig', proficiencyLevel: 4 as Level, xp: 0 },
    ],
  });

  function setup(pool: HireCandidate[], cash = 100000) {
    const { panel } = makePanel();
    const calls: string[] = [];
    panel.setGameConsole(cmd => { calls.push(cmd); return { success: true, output: '' }; });
    const state = makeState([]);
    state.hiringPool.candidates = pool;
    state.cash = cash;
    panel.update(state);
    return { panel, state, calls };
  }
  const card = (panel: CrewPanel, id: number): HTMLElement => panel.root.querySelector<HTMLElement>(`[data-candidate-card="${id}"]`)!;
  const sheet = (panel: CrewPanel, id?: number): HTMLElement | null =>
    panel.root.querySelector<HTMLElement>(id === undefined ? '[data-candidate-sheet]' : `[data-candidate-sheet="${id}"]`);

  it('no sheet is open before any card is clicked', () => {
    const { panel } = setup([candidate(11, 'driller', false)]);
    expect(sheet(panel)).toBeNull();
  });

  it('clicking a candidate card opens its sheet inside the Crew panel', () => {
    const { panel, calls } = setup([candidate(11, 'driller', false)]);
    card(panel, 11).click();
    expect(sheet(panel, 11)).not.toBeNull();
    expect(calls).toEqual([]);
  });

  it('clicking the candidate name, not just the card edge, opens the sheet', () => {
    const { panel } = setup([candidate(11, 'driller', false)]);
    const name = [...card(panel, 11).querySelectorAll<HTMLElement>('span')].find(s => s.textContent === 'Sheeted Person11')!;
    name.click();
    expect(sheet(panel, 11)).not.toBeNull();
  });

  it('the sheet of a candidate with two qualifications lists both with their levels', () => {
    const { panel } = setup([candidate(11, 'driller', false)]);
    card(panel, 11).click();
    const s = sheet(panel, 11)!;
    expect(s.textContent).toContain(t('skill.blasting'));
    expect(s.textContent).toContain(t('skill.driving.drill_rig'));
    const explains = [...s.querySelectorAll<HTMLElement>('[data-explain]')].map(n => n.getAttribute('data-explain'));
    expect(explains).toContain(skillLevelExplain(2));
    expect(explains).toContain(skillLevelExplain(4));
  });

  it('the sheet shows name, role label, salary per hour, union status and the hire fee', () => {
    const { panel } = setup([candidate(11, 'blaster', false)]);
    card(panel, 11).click();
    const text = sheet(panel, 11)!.textContent!;
    expect(text).toContain('Sheeted Person11');
    expect(text).toContain(t('role.blaster'));
    expect(text).toContain(t('ui.crew.candidate_salary', { salary: perHour(430) }));
    expect(text).toContain(t('ui.crew.candidate_non_union'));
    expect(text).toContain(t('ui.crew.hire_fee', { fee: HIRING_COSTS.blaster }));
  });

  it('the sheet explains salary and union status on hover', () => {
    const { panel } = setup([candidate(11, 'driller', false)]);
    card(panel, 11).click();
    const explains = [...sheet(panel, 11)!.querySelectorAll<HTMLElement>('[data-explain]')].map(n => n.getAttribute('data-explain'));
    expect(explains).toContain(salaryExplain());
    expect(explains).toContain(unionExplain());
  });

  it('a union candidate sheet states the union trade-off; a non-union sheet does not', () => {
    const { panel } = setup([candidate(11, 'driller', true), candidate(12, 'driller', false)]);
    const line = t('ui.crew.candidate_union_tradeoff', { pct: 15 });
    card(panel, 11).click();
    expect(sheet(panel, 11)!.textContent).toContain(t('ui.crew.candidate_union'));
    expect(sheet(panel, 11)!.textContent).toContain(line);
    card(panel, 12).click();
    expect(sheet(panel, 12)!.textContent).not.toContain(line);
  });

  it('Hire on the sheet hires that candidate and closes the sheet', () => {
    const { panel, calls } = setup([candidate(11, 'driller', false), candidate(12, 'driller', false)]);
    card(panel, 12).click();
    panel.root.querySelector<HTMLButtonElement>('[data-candidate-sheet-hire]')!.click();
    expect(calls).toEqual(['employee hire role:driller candidate:12']);
    expect(sheet(panel)).toBeNull();
  });

  it('the card Hire button still hires directly and does not open the sheet', () => {
    const { panel, calls } = setup([candidate(11, 'driller', false)]);
    panel.root.querySelector<HTMLButtonElement>('button[data-candidate-id="11"]')!.click();
    expect(calls).toEqual(['employee hire role:driller candidate:11']);
    expect(sheet(panel)).toBeNull();
  });

  it('the close button closes the sheet without hiring', () => {
    const { panel, calls } = setup([candidate(11, 'driller', false)]);
    card(panel, 11).click();
    panel.root.querySelector<HTMLButtonElement>('[data-candidate-sheet-close]')!.click();
    expect(sheet(panel)).toBeNull();
    expect(calls).toEqual([]);
  });

  it('opening another card swaps the sheet: only the latest candidate is shown', () => {
    const { panel } = setup([candidate(11, 'driller', false), candidate(12, 'blaster', false)]);
    card(panel, 11).click();
    card(panel, 12).click();
    expect(panel.root.querySelectorAll('[data-candidate-sheet]')).toHaveLength(1);
    expect(sheet(panel, 12)).not.toBeNull();
    expect(sheet(panel, 11)).toBeNull();
  });

  it('the sheet survives a refresh while its candidate is still in the pool', () => {
    const { panel, state } = setup([candidate(11, 'driller', false)]);
    card(panel, 11).click();
    panel.update(state);
    expect(sheet(panel, 11)).not.toBeNull();
  });

  it('the sheet disappears when its candidate leaves the pool', () => {
    const { panel, state } = setup([candidate(11, 'driller', false), candidate(12, 'driller', false)]);
    card(panel, 11).click();
    takeCandidate(state.hiringPool, 'driller', 11);
    panel.update(state);
    expect(sheet(panel)).toBeNull();
    expect(card(panel, 12)).not.toBeNull();
  });

  describe('when cash is short of the fee', () => {
    const SHORT = 250;
    const cash = (role: HireCandidate['role']): number => HIRING_COSTS[role] - SHORT;

    it('the sheet Hire button is disabled and a reason line states the missing cash', () => {
      const { panel, calls } = setup([candidate(11, 'manager', false)], cash('manager'));
      card(panel, 11).click();
      const hire = panel.root.querySelector<HTMLButtonElement>('[data-candidate-sheet-hire]')!;
      expect(hire.disabled).toBe(true);
      const reason = panel.root.querySelector('[data-candidate-sheet] [data-hire-reason]');
      expect(reason).not.toBeNull();
      expect(reason!.textContent).toBe(t('ui.crew.hire_short_cash', { missing: SHORT }));
      hire.click();
      expect(calls).toEqual([]);
      expect(sheet(panel, 11)).not.toBeNull();
    });

    it('the disabled card Hire button carries the same reason inside the card', () => {
      const { panel } = setup([candidate(11, 'manager', false)], cash('manager'));
      expect(card(panel, 11).querySelector<HTMLButtonElement>('button[data-candidate-id="11"]')!.disabled).toBe(true);
      const reason = card(panel, 11).querySelector('[data-hire-reason]');
      expect(reason).not.toBeNull();
      expect(reason!.textContent).toBe(t('ui.crew.hire_short_cash', { missing: SHORT }));
    });

    it('each card reports the shortfall for its own role fee', () => {
      const { panel } = setup([candidate(11, 'driller', false), candidate(12, 'manager', false)], 0);
      expect(card(panel, 11).querySelector('[data-hire-reason]')!.textContent)
        .toBe(t('ui.crew.hire_short_cash', { missing: HIRING_COSTS.driller }));
      expect(card(panel, 12).querySelector('[data-hire-reason]')!.textContent)
        .toBe(t('ui.crew.hire_short_cash', { missing: HIRING_COSTS.manager }));
    });
  });

  it('with exactly the fee in cash there is no refusal on the card or the sheet', () => {
    const { panel } = setup([candidate(11, 'driller', false)], HIRING_COSTS.driller);
    expect(panel.root.querySelector('[data-hire-reason]')).toBeNull();
    card(panel, 11).click();
    expect(panel.root.querySelector('[data-hire-reason]')).toBeNull();
    expect(panel.root.querySelector<HTMLButtonElement>('[data-candidate-sheet-hire]')!.disabled).toBe(false);
  });

  it('the new locale keys exist in English and French and differ between them', () => {
    const en = enLocaleJson as Record<string, string>;
    const fr = frLocaleJson as Record<string, string>;
    for (const key of ['ui.crew.hire_short_cash', 'ui.crew.candidate_sheet_close']) {
      expect(en[key]).toBeTruthy();
      expect(fr[key]).toBeTruthy();
      expect(fr[key]).not.toBe(en[key]);
    }
    expect(en['ui.crew.hire_short_cash']).toContain('{missing}');
  });
});
