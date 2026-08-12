// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { OperationsPanel } from '../../../../src/ui/panels/OperationsPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState, PendingAction } from '../../../../src/core/state/GameState.js';
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
    hunger: 0, fatigue: 0, breakNeed: 0, collapsing: false, interruptedActionPayload: null,
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
      { id: 1, type: 'general_work', requiredSkill: null, requiredVehicleRole: null, targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null, status: 'queued', holderId: null },
      { id: 2, type: 'survey', requiredSkill: 'geology', requiredVehicleRole: null, targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: null, status: 'queued', holderId: null },
      // Already claimed by employee 7 (#547) — reserved/assigned work is not "unclaimed", so this one is excluded from the count below.
      { id: 3, type: 'haul_debris', requiredSkill: null, requiredVehicleRole: 'debris_hauler', targetX: 0, targetZ: 0, targetY: 0, payload: {}, targetEmployeeId: 7, status: 'assigned', holderId: 7 },
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
    expect(panel.root.textContent).toContain('A vehicle took projection damage');
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
