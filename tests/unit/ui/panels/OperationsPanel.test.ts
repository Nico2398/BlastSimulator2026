// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { OperationsPanel, countQueuedByBlock } from '../../../../src/ui/panels/OperationsPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { createRunner } from '../../../../src/console-api.js';
import { t } from '../../../../src/core/i18n/I18n.js';
import { buildBlockedOrderMessage } from '../../../../src/ui/notify/blockedOrders.js';
import type { GameState, PendingAction, BlockedOrderReason } from '../../../../src/core/state/GameState.js';
import type { Employee } from '../../../../src/core/entities/Employee.js';
import type { AccidentRecord } from '../../../../src/core/entities/Damage.js';

function makeState(): GameState {
  return createGame({ seed: 1, mineType: 'desert' });
}

function addEmployee(state: GameState, overrides: Partial<Employee> = {}): Employee {
  const emp: Employee = {
    id: state.employees.nextId++, name: 'Walt Diggins', role: 'driller', salary: 500,
    morale: 60, unionized: false, injured: false, alive: true, x: 5, z: 5,
    qualifications: [], trainingState: null, activeActionId: null,
    fatigue: 0, collapsing: false, interruptedActionPayload: null,
    ticksWorked: 0, restTicksRemaining: null, restNeedKey: null, taskTicksRemaining: null,
    activeTaskSkill: null, destinationX: null, destinationZ: null,
    moveConsecutiveFailures: 0, isMoveStuck: false,
    pendingRestDuration: null, pendingRestNeedKey: null, pendingTaskDuration: null,
    pendingActionType: null, pendingActionPayload: null, pendingDriverVehicleId: null,
    taskQueue: [], locomotion: { kind: 'on_foot' },
    itinerary: null,
    vehicleWaitingTicks: 0,
    ...overrides,
  };
  state.employees.employees.push(emp);
  return emp;
}

function makeAccident(overrides: Partial<AccidentRecord> = {}): AccidentRecord {
  return { tick: 0, type: 'injury', entityId: 1, fragmentId: 1, kineticEnergy: 200, ...overrides };
}

function makePanel(): { panel: OperationsPanel; container: HTMLElement; gameConsole: ReturnType<typeof vi.fn> } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const panel = new OperationsPanel(container);
  const gameConsole = vi.fn().mockReturnValue({ success: true, output: '' });
  panel.setGameConsole(gameConsole);
  return { panel, container, gameConsole };
}

describe('OperationsPanel', () => {
  it('is hidden until show() is called', () => {
    const { panel } = makePanel();
    expect(panel.visible).toBe(false);
  });

  it('shows empty states with a fresh game', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    const text = panel.root.textContent ?? '';
    expect(text).toContain('No ore collected yet');
    expect(text).toContain('fire a blast over a surveyed vein');
    expect(text).toContain('No incidents on record');
  });

  it('shows a single unclaimed-work line instead of one per eligible employee (#39)', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.pendingActions = [
      { id: 1, type: 'general_work', requiredSkill: null, requiredVehicleRole: null, targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0 },
      { id: 2, type: 'survey', requiredSkill: 'geology', requiredVehicleRole: null, targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null, status: 'queued', holderId: null, queuedAtTick: 0 },
      // Already claimed by employee 7 (#547) — reserved/assigned work is not "unclaimed", so this one is excluded from the count below.
      { id: 3, type: 'haul_debris', requiredSkill: null, requiredVehicleRole: 'debris_hauler', targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: 7, status: 'assigned', holderId: 7, queuedAtTick: 0 },
    ];
    panel.update(state);
    const text = panel.root.textContent ?? '';
    expect(text).toContain('Unclaimed Work');
    expect(text).toContain('2 tasks');
  });

  it('renders ore on hand with a computed value from OreCatalog', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.collectedOre['dirtite'] = 100; // valuePerKg 2 → $200
    panel.show();
    panel.update(state);
    expect(panel.root.textContent).toContain('Dirtite');
    expect(panel.root.textContent).toContain('$200');
  });

  it('renders the last ore report with real yield stats', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.lastOreReport = {
      oreYields: { dirtite: 500 }, totalYieldKg: 500, estimatedYieldKg: 600,
      yieldRatio: 500 / 600, hasTreranium: false, absurdiumFraction: 0,
    };
    panel.show();
    panel.update(state);
    expect(panel.root.textContent).toContain('83%');
    expect(panel.root.textContent).toContain('500 kg');
    expect(panel.root.textContent).toContain('600 kg');
  });

  it('shows the Treranium and Absurdium flourish chips, ore name resolved through t() rather than hardcoded', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.lastOreReport = {
      oreYields: { treranium: 10 }, totalYieldKg: 10, estimatedYieldKg: 10,
      yieldRatio: 1, hasTreranium: true, absurdiumFraction: 0.3,
    };
    panel.show();
    panel.update(state);
    // English locale here — the fr.json side of this key resolves to the real
    // French pun name ("Terranium"/"Ineptium"), verified by i18n parity, not by this test.
    expect(panel.root.textContent).toContain('Treranium found!');
    expect(panel.root.textContent).toContain('30%');
  });

  it('resolves a live employee name for an injury/death incident', () => {
    const { panel } = makePanel();
    const state = makeState();
    const emp = addEmployee(state, { name: 'Oz Trill' });
    state.damage.accidents.push(makeAccident({ type: 'injury', entityId: emp.id, tick: 24 }));
    panel.show();
    panel.update(state);
    expect(panel.root.textContent).toContain('Oz Trill was injured');
    expect(panel.root.textContent).toContain('Day 2');
  });

  it('resolves a destroyed building by its entityLabel snapshot, not a live lookup', () => {
    const { panel } = makePanel();
    const state = makeState();
    // No building with this id exists in state.buildings — destroyBuilding() would have spliced it out.
    state.damage.accidents.push(makeAccident({ type: 'building_destroyed', entityId: 99, entityLabel: 'living_quarters' }));
    panel.show();
    panel.update(state);
    expect(panel.root.textContent).toContain('Living Quarters was destroyed');
  });

  it('falls back to a generic label when entityLabel is missing (pre-P5-core accident records)', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.damage.accidents.push(makeAccident({ type: 'vehicle_damage', entityId: 7 }));
    panel.show();
    panel.update(state);
    expect(panel.root.textContent).toContain('A vehicle took flying rock damage');
  });

  it('keeps seismic damage textually distinct from blast damage', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.damage.accidents.push(makeAccident({ type: 'seismic_destroyed', entityId: 5, entityLabel: 'management_office' }));
    panel.show();
    panel.update(state);
    expect(panel.root.textContent).toContain('seismic survey shockwave');
  });

  it('shows a chip for each currently injured, living employee', () => {
    const { panel } = makePanel();
    const state = makeState();
    addEmployee(state, { name: 'Dorian Kask', injured: true, alive: true });
    addEmployee(state, { name: 'Chuck Deadman', injured: true, alive: false }); // dead, not "currently injured"
    panel.show();
    panel.update(state);
    expect(panel.root.textContent).toContain('Dorian Kask injured');
    expect(panel.root.textContent).not.toContain('Chuck Deadman');
  });

  it('clicking a shift pill marks the policy dirty so update() stops overwriting it', () => {
    const { panel } = makePanel();
    const state = makeState();
    panel.show();
    panel.update(state);

    const pills = panel.root.querySelectorAll('.bsx-mono');
    const btn12h = Array.from(pills).find(b => b.textContent === '12-hour shifts') as HTMLButtonElement;
    btn12h.click();
    expect(btn12h.style.background).toContain('--bsx-amber');

    // A tick where core state is still shift_8h must not un-click the player's pending choice.
    panel.update(state);
    expect(btn12h.style.background).toContain('--bsx-amber');
  });

  it('marks the active shift button aria-pressed so the tutorial rails can read it (#1595)', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    const q = (m: string) => panel.root.querySelector(`[data-shift-mode="${m}"]`) as HTMLElement;
    expect(q('shift_8h').getAttribute('aria-pressed')).toBe('true');
    expect(q('continuous').getAttribute('aria-pressed')).toBe('false');
    q('continuous').click();
    expect(q('continuous').getAttribute('aria-pressed')).toBe('true');
    expect(q('shift_8h').getAttribute('aria-pressed')).toBe('false');
    expect(q('shift_12h').getAttribute('aria-pressed')).toBe('false');
  });

  it('renders exactly three shift mode buttons and no custom one (#1388)', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());

    const buttons = Array.from(panel.root.querySelectorAll('[data-shift-mode]')) as HTMLElement[];
    expect(buttons.map(b => b.dataset['shiftMode'])).toEqual(['shift_8h', 'shift_12h', 'continuous']);
    expect(panel.root.querySelector('[data-shift-mode="custom"]')).toBeNull();
  });

  it('Apply dispatches set_policy with the selected mode and thresholds', () => {
    const { panel, gameConsole } = makePanel();
    panel.show();
    panel.update(makeState());

    (panel.root.querySelector('[data-action="apply-policy"]') as HTMLButtonElement).click();

    expect(gameConsole).toHaveBeenCalledWith(expect.stringContaining('set_policy mode:shift_8h'));
  });

  it('Close dispatches the close handler', () => {
    const { panel } = makePanel();
    let closed = false;
    panel.setCloseHandler(() => { closed = true; });
    panel.show();
    panel.update(makeState());
    (panel.root.querySelector('button') as HTMLButtonElement).click();
    expect(closed).toBe(true);
  });

  it('refreshLocale() does not throw and keeps the active shift note correct', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    expect(() => panel.refreshLocale()).not.toThrow();
  });

  it('dispose() removes the panel from the DOM', () => {
    const { panel, container } = makePanel();
    panel.dispose();
    expect(container.contains(panel.root)).toBe(false);
  });
});

// ── Work queue (#548) ────────────────────────────────────────────────────────
//
// Renders one row per active PendingAction (queued/assigned/in_progress), each
// with a Cancel control, so a player can cancel an ordered action from the
// Operations panel. FAILS until makeWorkQueueRows/makeWorkQueueRow (currently
// throwing "not implemented") are wired into render().

function makePendingActionFixture(overrides: Partial<PendingAction> = {}): PendingAction {
  return {
    id: 1,
    type: 'general_work',
    requiredSkill: null,
    requiredVehicleRole: null,
    targetX: 3,
    targetZ: 7,
    targetY: 0,
    payload: {},
    targetEmployeeId: null,
    status: 'queued',
    holderId: null,
    queuedAtTick: 0,
    ...overrides,
  };
}

describe('OperationsPanel — work queue (#548)', () => {
  it('shows the empty-state text when there are no pending actions', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    expect(panel.root.textContent).toContain('Work Queue');
    expect(panel.root.textContent).toContain('No active orders.');
  });

  it('renders a queued action\'s type label, coordinates, "Unclaimed" holder text, and a cancel control', () => {
    const { panel } = makePanel();
    const state = makeState();
    const action = makePendingActionFixture({ id: 11, type: 'general_work', targetX: 3, targetZ: 7, status: 'queued', holderId: null });
    state.pendingActions.push(action);
    state.ghostPreviews.push({ id: 11, type: 'general_work', targetX: 3, targetZ: 7, targetY: 0, claimed: false });

    panel.show();
    panel.update(state);

    const text = panel.root.textContent ?? '';
    expect(text).toContain('Working'); // ui.crew.action_general_work label
    expect(text).toContain('3');
    expect(text).toContain('7');
    expect(text).toContain('Unclaimed'); // ui.operations.work_queue_holder_unclaimed
    expect(panel.root.querySelector('[data-cancel-action="11"]')).not.toBeNull();
  });

  it('shows the claimed employee\'s name for an assigned action with a known holderId', () => {
    const { panel } = makePanel();
    const state = makeState();
    const emp = addEmployee(state, { name: 'Oz Trill' });
    const action = makePendingActionFixture({ id: 12, status: 'assigned', holderId: emp.id });
    state.pendingActions.push(action);
    state.ghostPreviews.push({ id: 12, type: 'general_work', targetX: 3, targetZ: 7, targetY: 0, claimed: true });

    panel.show();
    panel.update(state);

    expect(panel.root.textContent).toContain('Oz Trill');
  });

  it('falls back to "Unknown" holder text when holderId points at nobody on the roster', () => {
    const { panel } = makePanel();
    const state = makeState();
    const action = makePendingActionFixture({ id: 13, status: 'assigned', holderId: 999 });
    state.pendingActions.push(action);
    state.ghostPreviews.push({ id: 13, type: 'general_work', targetX: 3, targetZ: 7, targetY: 0, claimed: true });

    panel.show();
    panel.update(state);

    expect(panel.root.textContent).toContain('Unknown'); // ui.operations.work_queue_holder_unknown
  });

  it('does not list a type:"rest" action in the work queue at all', () => {
    const { panel } = makePanel();
    const state = makeState();
    const emp = addEmployee(state, { name: 'Resting Randy' });
    const restAction = makePendingActionFixture({
      id: 14, type: 'rest', requiredSkill: null, status: 'assigned', holderId: emp.id, targetEmployeeId: emp.id,
    });
    state.pendingActions.push(restAction);

    panel.show();
    panel.update(state);

    expect(panel.root.querySelector('[data-cancel-action="14"]')).toBeNull();
    // The only pending action is a rest action, which the work queue excludes
    // entirely (issue #548: rest actions are engine-owned, not player-cancellable).
    // With nothing else pending, the queue's empty state is the correct result.
    expect(panel.root.textContent).toContain('No active orders.');
  });

  it('clicking a row\'s cancel control dispatches "employee cancel <id>" through gameConsole', () => {
    const { panel, gameConsole } = makePanel();
    const state = makeState();
    const action = makePendingActionFixture({ id: 15 });
    state.pendingActions.push(action);
    state.ghostPreviews.push({ id: 15, type: 'general_work', targetX: 3, targetZ: 7, targetY: 0, claimed: false });

    panel.show();
    panel.update(state);

    const cancelBtn = panel.root.querySelector('[data-cancel-action="15"]') as HTMLButtonElement;
    expect(cancelBtn).not.toBeNull();
    cancelBtn.click();

    expect(gameConsole).toHaveBeenCalledWith('employee cancel 15');
  });

  it('update() re-renders the work queue when a pending action\'s status changes between calls', () => {
    const { panel } = makePanel();
    const state = makeState();
    const action = makePendingActionFixture({ id: 16, status: 'queued', holderId: null });
    state.pendingActions.push(action);
    state.ghostPreviews.push({ id: 16, type: 'general_work', targetX: 3, targetZ: 7, targetY: 0, claimed: false });

    panel.show();
    panel.update(state);
    expect(panel.root.textContent).toContain('Queued'); // ui.operations.work_queue_status_queued

    // Mutate to assigned, as tickEmployees would on claim (#547).
    action.status = 'assigned';
    action.holderId = 42;
    panel.update(state);

    expect(panel.root.textContent).toContain('Walking'); // ui.operations.work_queue_status_assigned
    expect(panel.root.textContent).not.toContain('Queued');
  });
});

// ── Scroll-bounded Work Queue / Incidents sections (#957) ───────────────────
//
// bodyEl (this.el.append(header, this.bodyEl) in the constructor) is always
// the panel root's second child. Sections are rendered in a flat sequence of
// sectionHeader()s and their content into bodyEl.replaceChildren(...) — a
// bounded section groups its content into one scrollBoundedSection() wrapper
// standing between one sectionHeader and the next, instead of spreading a
// row per pending action / incident directly into bodyEl.

function getBodyEl(panel: OperationsPanel): HTMLElement {
  return panel.root.children[1] as HTMLElement;
}

/**
 * Every direct child of `bodyEl` between the section header whose text
 * contains `label` and the next section header (or the end of bodyEl).
 */
function sectionChildren(bodyEl: HTMLElement, label: string): HTMLElement[] {
  const children = Array.from(bodyEl.children) as HTMLElement[];
  const idx = children.findIndex(c => c.classList.contains('bsx-section') && (c.textContent ?? '').includes(label));
  if (idx === -1) throw new Error(`section header not found for label: ${label}`);
  const result: HTMLElement[] = [];
  for (let i = idx + 1; i < children.length; i++) {
    if (children[i]!.classList.contains('bsx-section')) break;
    result.push(children[i]!);
  }
  return result;
}

function pushPendingActions(state: GameState, count: number): void {
  for (let i = 0; i < count; i++) {
    const id = 1000 + i;
    state.pendingActions.push({
      id, type: 'general_work', requiredSkill: null, requiredVehicleRole: null,
      targetX: i, targetZ: i, targetY: 0, payload: {}, targetEmployeeId: null,
      status: 'queued', holderId: null, queuedAtTick: 0,
    });
    state.ghostPreviews.push({ id, type: 'general_work', targetX: i, targetZ: i, targetY: 0, claimed: false });
  }
}

function pushAccidents(state: GameState, count: number): void {
  for (let i = 0; i < count; i++) {
    state.damage.accidents.push(makeAccident({ tick: i, entityId: i, type: 'vehicle_damage' }));
  }
}

describe('OperationsPanel — scroll-bounded Work Queue / Incidents sections (#957)', () => {
  it('nests all 50 Work Queue rows inside a single bounded wrapper, not flattened directly into bodyEl', () => {
    const { panel } = makePanel();
    const state = makeState();
    pushPendingActions(state, 50);

    panel.show();
    panel.update(state);

    const bodyEl = getBodyEl(panel);
    const workQueueChildren = sectionChildren(bodyEl, t('ui.operations.work_queue'));

    // The 50 rows must be nested inside exactly one wrapper element that is
    // itself the only direct child of bodyEl for this section — proving the
    // rows didn't flatten directly into bodyEl (today's behavior).
    expect(workQueueChildren.length).toBe(1);
    const wrapper = workQueueChildren[0]!;
    expect(wrapper.querySelectorAll('[data-cancel-action]').length).toBe(50);
  });

  it('gives the Work Queue wrapper inline overflow-y:auto and a numeric max-height (not vh/%)', () => {
    const { panel } = makePanel();
    const state = makeState();
    pushPendingActions(state, 50);

    panel.show();
    panel.update(state);

    const bodyEl = getBodyEl(panel);
    const wrapper = sectionChildren(bodyEl, t('ui.operations.work_queue'))[0]!;

    expect(wrapper.style.overflowY).toBe('auto');
    expect(wrapper.style.maxHeight).toMatch(/^\d+px$/);
  });

  it('keeps #bs-policy-apply in the Policy section, outside the Work Queue bounded wrapper, reachable regardless of queue length', () => {
    const { panel } = makePanel();
    const state = makeState();
    pushPendingActions(state, 50);

    panel.show();
    panel.update(state);

    const bodyEl = getBodyEl(panel);
    const workQueueWrapper = sectionChildren(bodyEl, t('ui.operations.work_queue'))[0]!;
    // Scoped attribute selector, not an id selector: jsdom's querySelector can
    // return null for an id-selector query on a scoped root when the same id
    // exists elsewhere in the shared test document (other panels created by
    // earlier tests in this file are never removed from `document.body`).
    // `data-action` is unique to this button within the panel and side-steps it.
    const applyBtn = panel.root.querySelector('[data-action="apply-policy"]');

    expect(applyBtn).not.toBeNull();
    expect(applyBtn?.id).toBe('bs-policy-apply');
    expect(bodyEl.contains(applyBtn)).toBe(true);
    expect(workQueueWrapper.contains(applyBtn)).toBe(false);
  });

  it('Incidents rows nest inside their own bounded wrapper, distinct from the Work Queue wrapper', () => {
    const { panel } = makePanel();
    const state = makeState();
    pushPendingActions(state, 50);
    pushAccidents(state, 20);

    panel.show();
    panel.update(state);

    const bodyEl = getBodyEl(panel);
    const workQueueWrapper = sectionChildren(bodyEl, t('ui.operations.work_queue'))[0]!;
    const incidentsChildren = sectionChildren(bodyEl, t('ui.operations.incidents'));

    expect(incidentsChildren.length).toBe(1);
    const incidentsWrapper = incidentsChildren[0]!;
    expect(incidentsWrapper).not.toBe(workQueueWrapper);
    expect(incidentsWrapper.style.overflowY).toBe('auto');
    expect(incidentsWrapper.style.maxHeight).toMatch(/^\d+px$/);
    // Recent-incidents cap (RECENT_INCIDENTS=10) still applies inside the wrapper.
    expect(incidentsWrapper.children.length).toBeGreaterThan(0);
  });

  it('keeps bodyEl the sole outer scroll owner: overflow-y:auto and flex unchanged regardless of section content size', () => {
    const { panel: emptyPanel } = makePanel();
    emptyPanel.show();
    emptyPanel.update(makeState());
    const emptyBodyEl = getBodyEl(emptyPanel);

    const { panel: fullPanel } = makePanel();
    const state = makeState();
    pushPendingActions(state, 50);
    pushAccidents(state, 20);
    fullPanel.show();
    fullPanel.update(state);
    const fullBodyEl = getBodyEl(fullPanel);

    for (const bodyEl of [emptyBodyEl, fullBodyEl]) {
      expect(bodyEl.style.overflowY).toBe('auto');
      expect(bodyEl.style.flex).toBe('1 1 auto');
    }
  });

  it('every section is present as a descendant of bodyEl at both extremes: 0 items and 50/20 items', () => {
    const labels = [
      t('ui.operations.logistics'),
      t('ui.operations.work_queue'),
      t('ui.operations.ore_on_hand'),
      t('ui.operations.last_ore_report'),
      t('ui.operations.incidents'),
      t('ui.policy.title'),
    ];

    const { panel: emptyPanel } = makePanel();
    emptyPanel.show();
    emptyPanel.update(makeState());
    const emptyBodyEl = getBodyEl(emptyPanel);

    const { panel: fullPanel } = makePanel();
    const state = makeState();
    pushPendingActions(state, 50);
    pushAccidents(state, 20);
    fullPanel.show();
    fullPanel.update(state);
    const fullBodyEl = getBodyEl(fullPanel);

    for (const bodyEl of [emptyBodyEl, fullBodyEl]) {
      for (const label of labels) {
        expect(() => sectionChildren(bodyEl, label)).not.toThrow();
      }
    }
  });

  it('with zero pending actions, the Work Queue bounded wrapper is still present and contains the empty state', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());

    const bodyEl = getBodyEl(panel);
    const workQueueChildren = sectionChildren(bodyEl, t('ui.operations.work_queue'));

    expect(workQueueChildren.length).toBe(1);
    const wrapper = workQueueChildren[0]!;
    expect(wrapper.style.overflowY).toBe('auto');
    expect(wrapper.style.maxHeight).toMatch(/^\d+px$/);
    expect(wrapper.textContent).toContain(t('ui.operations.work_queue_empty'));
  });

  it('with zero incidents, the Incidents bounded wrapper is still present and contains the empty state', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());

    const bodyEl = getBodyEl(panel);
    const incidentsChildren = sectionChildren(bodyEl, t('ui.operations.incidents'));

    expect(incidentsChildren.length).toBe(1);
    const wrapper = incidentsChildren[0]!;
    expect(wrapper.style.overflowY).toBe('auto');
    expect(wrapper.style.maxHeight).toMatch(/^\d+px$/);
    expect(wrapper.textContent).toContain(t('ui.operations.no_incidents'));
  });
});

// ── Scroll survives a live refresh (#1592) ──

describe('OperationsPanel — scroll survives a refresh (#1592)', () => {
  const bounded = (panel: OperationsPanel): HTMLElement[] =>
    Array.from(panel.root.querySelectorAll<HTMLElement>('div'))
      .filter(d => d.style.overflowY === 'auto' && /^(200|220)px$/.test(d.style.maxHeight));

  it('keeps the work-queue and incidents scrollTop when the queue content changes', () => {
    const { panel } = makePanel();
    const state = makeState();
    addEmployee(state, { id: 1 });
    panel.show();
    panel.update(state);
    const before = bounded(panel);
    expect(before.length).toBeGreaterThanOrEqual(2);
    before.forEach((s, i) => { s.scrollTop = 20 + i * 10; });

    state.damage.accidents.push(makeAccident());
    state.employees.employees[0]!.injured = true;
    panel.update(state);

    const after = bounded(panel);
    expect(after.map(s => s.scrollTop)).toEqual(before.map((_, i) => 20 + i * 10));
  });
});

// ── Blocked orders in the Work Queue and Unclaimed Work (#1810) ──

const ALL_BLOCK_REASONS: BlockedOrderReason[] = [
  'no_qualified_employee', 'no_dual_qualified_employee', 'no_vehicle_in_fleet', 'no_licensed_driver',
  'target_unreachable', 'debris_out_of_reach', 'no_freight_warehouse', 'storage_full',
  'licence_level_too_low', 'no_spoil_heap', 'spoil_heap_full', 'no_reaching_vehicle',
];
const UNCLAIMED_NOTE = 'Open to any qualified, available worker.';

function blockedFixture(id: number, reason: BlockedOrderReason | null, overrides: Partial<PendingAction> = {}): PendingAction {
  return makePendingActionFixture({
    id, type: 'demolish_building', requiredSkill: 'driving.excavator', requiredVehicleRole: 'building_destroyer',
    blockedReason: reason, ...overrides,
  });
}

function renderWith(actions: PendingAction[]): { panel: OperationsPanel; state: GameState } {
  const { panel } = makePanel();
  const state = makeState();
  state.pendingActions.push(...actions);
  panel.show();
  panel.update(state);
  return { panel, state };
}

function chipTexts(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll('.bsx-chip')).map(c => c.textContent ?? '');
}

describe('OperationsPanel — blocked orders (#1810)', () => {
  it('shows a Blocked chip and the toast reason for no_vehicle_in_fleet', () => {
    const action = blockedFixture(1, 'no_vehicle_in_fleet');
    const { panel } = renderWith([action]);
    expect(t('ui.operations.work_queue_status_blocked')).toBe('Blocked');
    expect(chipTexts(panel.root)).toContain('Blocked');
    expect(chipTexts(panel.root)).not.toContain('Queued');
    const reason = panel.root.querySelector('[data-blocked-reason]');
    expect(reason).not.toBeNull();
    expect(reason!.textContent).toBe(buildBlockedOrderMessage(action));
    expect(reason!.textContent).toContain('Building Destroyer');
  });

  it.each(ALL_BLOCK_REASONS.filter(r => r !== 'debris_out_of_reach'))('row text equals toast text for %s', (reason) => {
    const action = blockedFixture(2, reason, { blockedLicenceLevel: 2 });
    const { panel } = renderWith([action]);
    const el = panel.root.querySelector('[data-blocked-reason]');
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe(buildBlockedOrderMessage(action));
    expect(chipTexts(panel.root)).toContain('Blocked');
  });

  it('a queued action without blockedReason reads Queued / Unclaimed with no blocked chip or reason', () => {
    const { panel } = renderWith([blockedFixture(3, null)]);
    const text = panel.root.textContent ?? '';
    expect(chipTexts(panel.root)).toContain('Queued');
    expect(text).toContain('Unclaimed');
    expect(chipTexts(panel.root)).not.toContain('Blocked');
    expect(panel.root.querySelector('[data-blocked-reason]')).toBeNull();
  });

  it('debris_out_of_reach is neutral: Out of reach chip, reason line, no Blocked or warn chip', () => {
    const action = blockedFixture(4, 'debris_out_of_reach', { type: 'general_work', requiredSkill: null, requiredVehicleRole: null });
    const { panel } = renderWith([action]);
    expect(chipTexts(panel.root)).not.toContain('Blocked');
    expect(chipTexts(panel.root)).toContain('Out of reach');
    expect(panel.root.querySelector('.bsx-chip-warn')).toBeNull();
    expect(panel.root.querySelector('.bsx-chip-critical')).toBeNull();
    const out = Array.from(panel.root.querySelectorAll('.bsx-chip')).find(c => c.textContent === 'Out of reach');
    expect(out!.className).toContain('bsx-chip-neutral');
    const reason = panel.root.querySelector('[data-blocked-reason]');
    expect(reason).not.toBeNull();
    expect(reason!.textContent).toBe(buildBlockedOrderMessage(action));
  });

  it('assigned and in_progress actions never show blocked, even with a stale blockedReason', () => {
    const { panel } = renderWith([
      blockedFixture(5, 'no_vehicle_in_fleet', { status: 'assigned', holderId: 9 }),
      blockedFixture(6, 'no_vehicle_in_fleet', { status: 'in_progress', holderId: 9 }),
    ]);
    expect(chipTexts(panel.root)).not.toContain('Blocked');
    expect(panel.root.querySelector('[data-blocked-reason]')).toBeNull();
  });

  it('update() re-renders when blockedReason appears and clears', () => {
    const { panel } = makePanel();
    const state = makeState();
    const action = blockedFixture(7, null);
    state.pendingActions.push(action);
    panel.show();
    panel.update(state);
    expect(panel.root.querySelector('[data-blocked-reason]')).toBeNull();
    action.blockedReason = 'no_vehicle_in_fleet';
    panel.update(state);
    expect(panel.root.querySelector('[data-blocked-reason]')).not.toBeNull();
    expect(chipTexts(panel.root)).toContain('Blocked');
    action.blockedReason = null;
    panel.update(state);
    expect(panel.root.querySelector('[data-blocked-reason]')).toBeNull();
    expect(chipTexts(panel.root)).not.toContain('Blocked');
    expect(chipTexts(panel.root)).toContain('Queued');
  });

  it('update() re-renders when the reason changes', () => {
    const { panel } = makePanel();
    const state = makeState();
    const action = blockedFixture(8, 'no_vehicle_in_fleet');
    state.pendingActions.push(action);
    panel.show();
    panel.update(state);
    action.blockedReason = 'no_licensed_driver';
    panel.update(state);
    expect(panel.root.querySelector('[data-blocked-reason]')!.textContent).toBe(buildBlockedOrderMessage(action));
  });
});

describe('OperationsPanel — Unclaimed Work with blocked orders (#1810)', () => {
  it('counts only open orders in "N tasks"', () => {
    const { panel } = renderWith([
      blockedFixture(1, null),
      blockedFixture(2, 'no_vehicle_in_fleet'),
      blockedFixture(3, 'no_qualified_employee'),
    ]);
    const text = panel.root.textContent ?? '';
    expect(text).toContain('1 tasks');
    expect(text).not.toContain('3 tasks');
    expect(text).toContain(UNCLAIMED_NOTE);
  });

  it('does not describe blocked-only work as open to any worker', () => {
    const { panel } = renderWith([blockedFixture(1, 'no_vehicle_in_fleet')]);
    const text = panel.root.textContent ?? '';
    expect(text).not.toContain(UNCLAIMED_NOTE);
    expect(text).not.toContain('1 tasks');
  });

  it('keeps the open-to-anyone note for unblocked work', () => {
    const { panel } = renderWith([blockedFixture(1, null)]);
    expect(panel.root.textContent).toContain(UNCLAIMED_NOTE);
  });

  it('note shows both the blocked and out-of-reach clauses for a mixed queue', () => {
    const { panel } = renderWith([
      blockedFixture(1, 'no_vehicle_in_fleet'),
      blockedFixture(2, 'debris_out_of_reach', { type: 'haul_debris', requiredSkill: null, requiredVehicleRole: 'debris_hauler' }),
    ]);
    const text = panel.root.textContent ?? '';
    expect(text).toContain('1 blocked - waiting on the site');
    expect(text).toContain('1 out of reach - waiting on the site');
    expect(text).not.toContain(UNCLAIMED_NOTE);
  });

  it('i18n has the blocked-note wording with a {blocked} placeholder', () => {
    expect(t('ui.operations.unclaimed_work_note_blocked', { blocked: 2 })).toContain('2');
    expect(t('ui.operations.work_queue_status_stranded')).toBe('Out of reach');
  });
});

describe('countQueuedByBlock (#1810)', () => {
  const q = (blockedReason: BlockedOrderReason | null | undefined, status: PendingAction['status'] = 'queued'): Pick<PendingAction, 'status' | 'blockedReason'> =>
    (blockedReason === undefined ? { status } : { status, blockedReason });

  it('returns zeros for no actions', () => {
    expect(countQueuedByBlock([])).toEqual({ open: 0, blocked: 0, stranded: 0 });
  });

  it('splits queued actions into open, blocked and stranded', () => {
    expect(countQueuedByBlock([
      q(null), q(undefined), q('no_vehicle_in_fleet'), q('no_licensed_driver'), q('debris_out_of_reach'),
    ])).toEqual({ open: 2, blocked: 2, stranded: 1 });
  });

  it('ignores assigned and in_progress actions', () => {
    expect(countQueuedByBlock([q(null, 'assigned'), q('no_vehicle_in_fleet', 'in_progress')]))
      .toEqual({ open: 0, blocked: 0, stranded: 0 });
  });

  it('does not count an in-transit charge order as blocked or stranded (#1895)', () => {
    const counts = countQueuedByBlock([q('explosives_in_transit'), q('explosives_in_transit')]);
    expect(counts.blocked).toBe(0);
    expect(counts.stranded).toBe(0);
  });

  it('in-transit does not disturb the counts of real blocks (#1895)', () => {
    const counts = countQueuedByBlock([q('explosives_in_transit'), q('no_vehicle_in_fleet'), q('debris_out_of_reach')]);
    expect(counts.blocked).toBe(1);
    expect(counts.stranded).toBe(1);
  });
});


// ── Grouped debris work queue (#1972) ──

function debrisOrders(state: GameState, type: 'haul_debris' | 'fragment_debris', count: number, startId: number): void {
  for (let i = 0; i < count; i++) {
    state.pendingActions.push(makePendingActionFixture({
      id: startId + i, type, requiredVehicleRole: type === 'haul_debris' ? 'debris_hauler' : null,
      targetX: i % 50, targetZ: Math.floor(i / 50), payload: { fragmentId: startId + i },
    }));
  }
}

function playerOrders(state: GameState): void {
  state.pendingActions.push(
    makePendingActionFixture({ id: 1, type: 'place_building' }),
    makePendingActionFixture({ id: 2, type: 'survey', requiredSkill: 'geology' }),
    makePendingActionFixture({ id: 3, type: 'drill_hole', status: 'queued', blockedReason: 'no_qualified_employee' }),
  );
}

function debrisState(haul = 2000, frag = 500): GameState {
  const state = makeState();
  // Debris first so "player orders first" is a rendering decision, not an input-order artifact.
  debrisOrders(state, 'haul_debris', haul, 10000);
  debrisOrders(state, 'fragment_debris', frag, 20000);
  playerOrders(state);
  return state;
}

function openPanel(state: GameState) {
  const ctx = makePanel();
  ctx.panel.show();
  ctx.panel.update(state);
  return ctx;
}

function summary(panel: OperationsPanel, type: string): HTMLElement {
  const btn = panel.root.querySelector(`[data-cancel-debris-group="${type}"]`) as HTMLElement | null;
  expect(btn, `cancel button for ${type}`).not.toBeNull();
  // Summary card = parent of the button row that holds toggle and cancel.
  const node = btn!.parentElement?.parentElement ?? null;
  expect(node, `summary row for ${type}`).not.toBeNull();
  return node!;
}

describe('OperationsPanel — grouped debris queue (#1972)', () => {
  it('renders only the 3 player rows plus one summary per debris type for 2,500 debris orders', () => {
    const { panel } = openPanel(debrisState());
    expect(panel.root.querySelectorAll('[data-cancel-action]').length).toBe(3);
    expect(panel.root.querySelectorAll('[data-debris-toggle]').length).toBe(2);
    expect(panel.root.querySelectorAll('[data-cancel-debris-group]').length).toBe(2);
    expect(panel.root.querySelectorAll('*').length).toBeLessThan(1500);
  });

  it('titles the summary with label and count and lists status parts', () => {
    const state = debrisState(10, 0);
    state.pendingActions.find(a => a.id === 10000)!.status = 'in_progress';
    state.pendingActions.find(a => a.id === 10000)!.holderId = 3;
    state.pendingActions.find(a => a.id === 10001)!.blockedReason = 'debris_out_of_reach';
    state.pendingActions.find(a => a.id === 10002)!.blockedReason = 'debris_out_of_reach';
    const { panel } = openPanel(state);
    const text = summary(panel, 'haul_debris').textContent ?? '';
    expect(text).toContain(t('ui.operations.work_queue_debris_title', { label: t('ui.crew.action_haul_debris'), count: 10 }));
    expect(text).toContain(t('ui.operations.work_queue_debris_status_part_in_progress', { count: 1 }));
    expect(text).toContain(t('ui.operations.work_queue_debris_status_part_stranded', { count: 2 }));
  });

  it('counts blocked and in-transit orders in the summary', () => {
    const state = makeState();
    debrisOrders(state, 'haul_debris', 5, 100);
    state.pendingActions[0]!.blockedReason = 'no_vehicle_in_fleet';
    state.pendingActions[1]!.blockedReason = 'explosives_in_transit';
    const { panel } = openPanel(state);
    const text = summary(panel, 'haul_debris').textContent ?? '';
    expect(text).toContain(t('ui.operations.work_queue_debris_status_part_blocked', { count: 1 }));
    expect(text).toContain(t('ui.operations.work_queue_debris_status_part_in_transit', { count: 1 }));
  });

  it('gives each debris type its own correct total', () => {
    const { panel } = openPanel(debrisState(2000, 500));
    expect(summary(panel, 'haul_debris').textContent).toContain(
      t('ui.operations.work_queue_debris_title', { label: t('ui.crew.action_haul_debris'), count: 2000 }));
    expect(summary(panel, 'fragment_debris').textContent).toContain(
      t('ui.operations.work_queue_debris_title', { label: t('ui.crew.action_fragment_debris'), count: 500 }));
  });

  it('lists player orders before the debris summaries', () => {
    const { panel } = openPanel(debrisState(20, 20));
    const all = Array.from(panel.root.querySelectorAll('[data-cancel-action], [data-debris-toggle]'));
    const lastPlayer = Math.max(...all.map((n, i) => (n.hasAttribute('data-cancel-action') ? i : -1)));
    const firstSummary = all.findIndex(n => n.hasAttribute('data-debris-toggle'));
    expect(lastPlayer).toBeGreaterThanOrEqual(0);
    expect(lastPlayer).toBeLessThan(firstSummary);
  });

  it('keeps the blocked reason on player rows', () => {
    const { panel } = openPanel(debrisState(5, 0));
    expect(panel.root.querySelector('[data-blocked-reason="no_qualified_employee"]')).not.toBeNull();
  });

  it('shows the empty state only when there are no orders at all', () => {
    const state = makeState();
    debrisOrders(state, 'haul_debris', 3, 100);
    const { panel } = openPanel(state);
    expect(panel.root.textContent).not.toContain(t('ui.operations.work_queue_empty'));
  });

  describe('expand', () => {
    it('shows no individual debris rows until expanded', () => {
      const { panel } = openPanel(debrisState());
      expect(panel.root.querySelector('[data-cancel-action="10000"]')).toBeNull();
    });

    it('expanding shows at most 25 individual rows and paging controls', () => {
      const { panel } = openPanel(debrisState());
      (panel.root.querySelector('[data-debris-toggle="haul_debris"]') as HTMLElement).click();
      const rows = panel.root.querySelectorAll('[data-cancel-action]');
      expect(rows.length).toBe(3 + 25);
      expect(panel.root.querySelector('[data-cancel-action="10000"]')).not.toBeNull();
      expect(panel.root.querySelector('[data-cancel-action="10025"]')).toBeNull();
      expect(panel.root.querySelector('[data-debris-page="next"]')).not.toBeNull();
    });

    it('next and prev page through the group', () => {
      const { panel } = openPanel(debrisState());
      (panel.root.querySelector('[data-debris-toggle="haul_debris"]') as HTMLElement).click();
      (panel.root.querySelector('[data-debris-page="next"]') as HTMLElement).click();
      expect(panel.root.querySelector('[data-cancel-action="10000"]')).toBeNull();
      expect(panel.root.querySelector('[data-cancel-action="10025"]')).not.toBeNull();
      expect(panel.root.querySelectorAll('[data-cancel-action]').length).toBe(3 + 25);
      (panel.root.querySelector('[data-debris-page="prev"]') as HTMLElement).click();
      expect(panel.root.querySelector('[data-cancel-action="10000"]')).not.toBeNull();
    });

    it('collapsing hides the individual rows again', () => {
      const { panel } = openPanel(debrisState());
      const toggle = () => panel.root.querySelector('[data-debris-toggle="haul_debris"]') as HTMLElement;
      toggle().click();
      toggle().click();
      expect(panel.root.querySelectorAll('[data-cancel-action]').length).toBe(3);
    });

    it('expanded rows still cancel one order through the console', () => {
      const { panel, gameConsole } = openPanel(debrisState());
      (panel.root.querySelector('[data-debris-toggle="haul_debris"]') as HTMLElement).click();
      (panel.root.querySelector('[data-cancel-action="10003"]') as HTMLElement).click();
      expect(gameConsole).toHaveBeenCalledWith('employee cancel 10003');
    });
  });

  describe('cancel group', () => {
    it('requests confirmation and sends nothing until confirmed', () => {
      const { panel, gameConsole } = openPanel(debrisState(4, 3));
      const handler = vi.fn();
      panel.setConfirmHandler(handler);
      (panel.root.querySelector('[data-cancel-debris-group="haul_debris"]') as HTMLElement).click();
      expect(handler).toHaveBeenCalledTimes(1);
      const cfg = handler.mock.calls[0]![0];
      expect(cfg.title).toBe(t('ui.operations.work_queue_debris_confirm_title'));
      expect(cfg.body).toContain('4');
      expect(cfg.confirmLabel).toBe(t('ui.operations.work_queue_debris_confirm_label'));
      expect(typeof cfg.onConfirm).toBe('function');
      expect(gameConsole).not.toHaveBeenCalled();
    });

    it('confirming cancels exactly the group members, not player orders or the other type', () => {
      const { panel, gameConsole } = openPanel(debrisState(4, 3));
      const handler = vi.fn();
      panel.setConfirmHandler(handler);
      (panel.root.querySelector('[data-cancel-debris-group="haul_debris"]') as HTMLElement).click();
      handler.mock.calls[0]![0].onConfirm();
      const sent = gameConsole.mock.calls.map(c => c[0] as string).sort();
      expect(sent).toEqual([10000, 10001, 10002, 10003].map(id => `employee cancel ${id}`).sort());
    });

    it('cancels the fragment group independently', () => {
      const { panel, gameConsole } = openPanel(debrisState(4, 3));
      const handler = vi.fn();
      panel.setConfirmHandler(handler);
      (panel.root.querySelector('[data-cancel-debris-group="fragment_debris"]') as HTMLElement).click();
      handler.mock.calls[0]![0].onConfirm();
      expect(gameConsole).toHaveBeenCalledTimes(3);
      expect(gameConsole).toHaveBeenCalledWith('employee cancel 20000');
    });

    it('sends no command when no confirm handler is set', () => {
      const { panel, gameConsole } = openPanel(debrisState(4, 3));
      (panel.root.querySelector('[data-cancel-debris-group="haul_debris"]') as HTMLElement).click();
      expect(gameConsole).not.toHaveBeenCalled();
    });
  });

  describe('incremental refresh', () => {
    it('updates counts when one debris order changes without replacing player rows', () => {
      const state = debrisState(50, 0);
      const { panel } = openPanel(state);
      const before = panel.root.querySelector('[data-cancel-action="2"]');
      expect(before).not.toBeNull();
      const beforeText = summary(panel, 'haul_debris').textContent;

      const a = state.pendingActions.find(x => x.id === 10000)!;
      a.status = 'in_progress';
      a.holderId = 4;
      panel.update(state);

      expect(panel.root.querySelector('[data-cancel-action="2"]')).toBe(before);
      expect(summary(panel, 'haul_debris').textContent).not.toBe(beforeText);
      expect(summary(panel, 'haul_debris').textContent).toContain(
        t('ui.operations.work_queue_debris_status_part_in_progress', { count: 1 }));
    });

    it('does not rebuild the summary rows when nothing changed', () => {
      const state = debrisState(50, 10);
      const { panel } = openPanel(state);
      const before = panel.root.querySelector('[data-debris-toggle="haul_debris"]');
      panel.update(state);
      expect(panel.root.querySelector('[data-debris-toggle="haul_debris"]')).toBe(before);
    });

    it('reflects a player order status change', () => {
      const state = debrisState(5, 0);
      const { panel } = openPanel(state);
      const o = state.pendingActions.find(x => x.id === 1)!;
      o.status = 'in_progress';
      o.holderId = 9;
      panel.update(state);
      expect(panel.root.querySelector('[data-cancel-action="1"]')!.closest('div')!.parentElement!.textContent)
        .toContain(t('ui.operations.work_queue_status_in_progress'));
    });

    it('updates the expanded page when a debris order is cancelled away', () => {
      const state = debrisState(30, 0);
      const { panel } = openPanel(state);
      (panel.root.querySelector('[data-debris-toggle="haul_debris"]') as HTMLElement).click();
      state.pendingActions = state.pendingActions.filter(a => a.id !== 10000);
      panel.update(state);
      expect(panel.root.querySelector('[data-cancel-action="10000"]')).toBeNull();
      expect(panel.root.querySelector('[data-cancel-action="10001"]')).not.toBeNull();
    });

    it('drops a summary row once its last order is gone', () => {
      const state = debrisState(3, 2);
      const { panel } = openPanel(state);
      state.pendingActions = state.pendingActions.filter(a => a.type !== 'fragment_debris');
      panel.update(state);
      expect(panel.root.querySelector('[data-debris-toggle="fragment_debris"]')).toBeNull();
      expect(panel.root.querySelector('[data-debris-toggle="haul_debris"]')).not.toBeNull();
    });
  });

  describe('cost', () => {
    it('one update at 2,500 debris orders stays within a generous budget after warm-up', () => {
      const state = debrisState(2000, 500);
      const { panel } = openPanel(state);
      panel.update(state);
      let id = 10000;
      const t0 = performance.now();
      for (let i = 0; i < 5; i++) {
        const target = id++;
        const a = state.pendingActions.find(x => x.id === target)!;
        a.status = 'in_progress';
        a.holderId = 4;
        panel.update(state);
      }
      const perUpdate = (performance.now() - t0) / 5;
      expect(perUpdate).toBeLessThan(100);
    });

    it('renders far fewer DOM nodes at 2,500 orders than one row per order', () => {
      const { panel } = openPanel(debrisState(2000, 500));
      expect(panel.root.querySelectorAll('*').length).toBeLessThan(2500);
    });
  });
});

describe('OperationsPanel — grouped debris queue, review fixes (#1972)', () => {
  const expandHaul = (panel: OperationsPanel) =>
    (panel.root.querySelector('[data-debris-toggle="haul_debris"]') as HTMLElement).click();

  it('refreshes "Unclaimed Work" when only a queued rest order appears (not a queue row)', () => {
    const state = makeState();
    state.pendingActions.push(makePendingActionFixture({ id: 1 }));
    const { panel } = openPanel(state);
    expect(panel.root.textContent).toContain(t('ui.operations.unclaimed_work_count', { count: 1 }));
    state.pendingActions.push(makePendingActionFixture({ id: 2, type: 'rest' }));
    panel.update(state);
    expect(panel.root.textContent).toContain(t('ui.operations.unclaimed_work_count', { count: 2 }));
  });

  it('an expanded debris row still shows the out-of-reach chip and reason', () => {
    const state = makeState();
    debrisOrders(state, 'haul_debris', 3, 100);
    state.pendingActions[0]!.blockedReason = 'debris_out_of_reach';
    const { panel } = openPanel(state);
    expandHaul(panel);
    const reason = panel.root.querySelector('[data-blocked-reason="debris_out_of_reach"]');
    expect(reason).not.toBeNull();
    expect(reason!.parentElement!.textContent).toContain(t('ui.operations.work_queue_status_stranded'));
    expect(reason!.textContent).toBe(buildBlockedOrderMessage(state.pendingActions[0]!));
  });

  it('shows the positive empty state when there are no orders at all', () => {
    const { panel } = openPanel(makeState());
    expect(panel.root.textContent).toContain(t('ui.operations.work_queue_empty'));
  });

  it('re-clamps the expanded page when the last page empties', () => {
    const state = makeState();
    debrisOrders(state, 'haul_debris', 26, 100);
    const { panel } = openPanel(state);
    expandHaul(panel);
    (panel.root.querySelector('[data-debris-page="next"]') as HTMLElement).click();
    expect(panel.root.querySelector('[data-cancel-action="125"]')).not.toBeNull();
    state.pendingActions = state.pendingActions.filter(a => a.id !== 125);
    panel.update(state);
    expect(panel.root.querySelector('[data-cancel-action="100"]')).not.toBeNull();
    expect(panel.root.querySelector('[data-cancel-action="124"]')).not.toBeNull();
    expect((panel.root.querySelector('[data-debris-page="next"]') as HTMLButtonElement).disabled).toBe(true);
    expect((panel.root.querySelector('[data-debris-page="prev"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('summary counts assigned as working and shows a queued part for open orders', () => {
    const state = makeState();
    debrisOrders(state, 'haul_debris', 4, 100);
    state.pendingActions[0]!.status = 'assigned';
    state.pendingActions[0]!.holderId = 2;
    state.pendingActions[1]!.status = 'in_progress';
    state.pendingActions[1]!.holderId = 3;
    state.pendingActions[2]!.blockedReason = 'no_vehicle_in_fleet';
    const { panel } = openPanel(state);
    const text = summary(panel, 'haul_debris').textContent ?? '';
    expect(text).toContain(t('ui.operations.work_queue_debris_status_part_in_progress', { count: 2 }));
    expect(text).toContain(t('ui.operations.work_queue_debris_status_part_queued', { count: 1 }));
    expect(text).toContain(t('ui.operations.work_queue_debris_status_part_blocked', { count: 1 }));
  });

  it('confirm body names the count and the label', () => {
    const { panel } = openPanel(debrisState(4, 0));
    const handler = vi.fn();
    panel.setConfirmHandler(handler);
    (panel.root.querySelector('[data-cancel-debris-group="haul_debris"]') as HTMLElement).click();
    expect(handler.mock.calls[0]![0].body).toBe(
      t('ui.operations.work_queue_debris_confirm_body', { count: 4, label: t('ui.crew.action_haul_debris') }));
  });

  describe('cost', () => {
    function timePerUpdate(state: GameState, panel: OperationsPanel, rounds: number): number {
      panel.update(state);
      const t0 = performance.now();
      for (let i = 0; i < rounds; i++) {
        const a = state.pendingActions.find(x => x.id === 10000 + i)!;
        a.status = 'in_progress';
        a.holderId = 4;
        panel.update(state);
      }
      return (performance.now() - t0) / rounds;
    }

    it('an update with the group expanded at 2,500 orders is not far above the same update at 50', () => {
      const big = debrisState(2000, 500);
      const small = debrisState(40, 10);
      const bigCtx = openPanel(big);
      const smallCtx = openPanel(small);
      expandHaul(bigCtx.panel);
      expandHaul(smallCtx.panel);
      timePerUpdate(big, bigCtx.panel, 3);
      timePerUpdate(small, smallCtx.panel, 3);
      const bigMs = timePerUpdate(big, bigCtx.panel, 20);
      const smallMs = timePerUpdate(small, smallCtx.panel, 20);
      // Measured ~14.6 ms/update at 2,500 orders vs ~13 ms at 50 (jsdom): the floor is the fixed sections, not the orders.
      expect(bigMs).toBeLessThan(Math.max(smallMs, 0.2) * 100);
      expect(bigMs).toBeLessThan(100);
    });

    it('confirming a 2,500-order group cancel through the real console stays within a generous budget', () => {
      const { runner, ctx } = createRunner();
      runner.run('new_game mine_type:desert seed:1 size:32');
      const state = ctx.state!;
      debrisOrders(state, 'haul_debris', 2500, 10000);
      const { panel } = makePanel();
      panel.show();
      // The browser updates every panel after each command (main.ts afterGameCommand); mirror that here.
      panel.setGameConsole(cmd => { const r = runner.run(cmd); panel.update(ctx.state!); return r; });
      panel.update(state);
      const handler = vi.fn();
      panel.setConfirmHandler(handler);
      (panel.root.querySelector('[data-cancel-debris-group="haul_debris"]') as HTMLElement).click();
      const t0 = performance.now();
      handler.mock.calls[0]![0].onConfirm();
      const totalMs = performance.now() - t0;
      expect(ctx.state!.pendingActions.filter(a => a.type === 'haul_debris').length).toBe(0);
      expect(panel.root.querySelector('[data-debris-toggle="haul_debris"]')).toBeNull();
      // Measured ~30 ms with the panel's own repaints suppressed during the loop (~6.3 s when it repainted per command).
      expect(totalMs).toBeLessThan(2000);
    });
  });
});
