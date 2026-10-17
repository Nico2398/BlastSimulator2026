// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { CrewPanel } from '../../../../src/ui/panels/CrewPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { t } from '../../../../src/core/i18n/I18n.js';
import { managerNegotiationBonusPct } from '../../../../src/core/economy/Negotiation.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { Employee } from '../../../../src/core/entities/Employee.js';
import type { Vehicle } from '../../../../src/core/entities/Vehicle.js';
import type { Building } from '../../../../src/core/entities/Building.js';
import frLocaleJson from '../../../../src/core/i18n/locales/fr.json' assert { type: 'json' };
import { perHour } from '../../../../src/ui/crewDetailSections.js';
import { hiringSignature } from '../../../../src/ui/panels/CrewHiring.js';
import { candidatesForRole, takeCandidate, type HireCandidate } from '../../../../src/core/entities/HiringPool.js';
import { HIRING_COSTS } from '../../../../src/core/entities/Employee.js';

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
    expect(row.querySelectorAll('[title]:not([data-action="locate"])').length).toBe(2);
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
  it('a union candidate card line mentions demands and strikes in en and fr', () => {
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
