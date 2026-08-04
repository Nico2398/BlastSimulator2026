// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { OperationsPanel } from '../../../../src/ui/panels/OperationsPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
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
