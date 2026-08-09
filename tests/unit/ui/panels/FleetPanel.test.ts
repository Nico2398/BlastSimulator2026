// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { FleetPanel } from '../../../../src/ui/panels/FleetPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { Vehicle } from '../../../../src/core/entities/Vehicle.js';
import type { Employee } from '../../../../src/core/entities/Employee.js';

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1, type: 'debris_hauler', tier: 1, x: 5, z: 5, hp: 100, task: 'idle',
    targetX: 5, targetZ: 5, driverId: null, state: 'idle', payloadKg: 0,
    waitingTicks: 0, moveConsecutiveFailures: 0, isMoveStuck: false,
    haulingFragmentId: null, haulingPhase: null, haulingDepotBuildingId: null,
    ...overrides,
  };
}

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1, name: 'Dorian Kask', role: 'driver', salary: 400, morale: 60,
    unionized: false, injured: false, alive: true, x: 0, z: 0,
    qualifications: [], trainingState: null, activeActionId: null,
    hunger: 100, fatigue: 100, breakNeed: 100, collapsing: false,
    interruptedActionPayload: null, ticksWorked: 0,
    restTicksRemaining: null, restNeedKey: null, taskTicksRemaining: null,
    activeTaskSkill: null, destinationX: null, destinationZ: null,
    moveConsecutiveFailures: 0, isMoveStuck: false,
    pendingRestDuration: null, pendingRestNeedKey: null,
    pendingTaskDuration: null, pendingActionType: null,
    pendingActionPayload: null, pendingDriverVehicleId: null,
    ...overrides,
  };
}

function makeState(vehicles: Vehicle[] = [], employees: Employee[] = []): GameState {
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.vehicles.vehicles = vehicles;
  state.vehicles.nextId = vehicles.length + 1;
  state.employees.employees = employees;
  return state;
}

function makePanel(): { panel: FleetPanel; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const panel = new FleetPanel(container);
  return { panel, container };
}

describe('FleetPanel', () => {
  it('shows an empty state with no vehicles', () => {
    const { panel } = makePanel();
    panel.update(makeState([]));
    expect(panel.root.textContent).toContain('No vehicles');
  });

  it('renders a vehicle card with its real name, id, and role', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle({ id: 3, type: 'debris_hauler', tier: 1 })]));
    const text = panel.root.textContent!;
    expect(text).toContain('Dumpster on Wheels');
    expect(text).toContain('#3');
    expect(text).toContain('Debris Hauler');
  });

  it('shows no Haul button for a debris_hauler with nothing reachable to haul (haulEligibility.ts, real eligibility check)', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle({ id: 5, type: 'debris_hauler', driverId: 1 })], [makeEmployee({ id: 1 })]));
    expect(panel.root.querySelector('.bs-vehicle-haul-btn')).toBeNull();
  });

  it('shows no traffic banner with no jam', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle()]));
    expect(panel.root.querySelector('.bs-fleet-traffic')).toBeNull();
  });

  it('shows a real traffic banner when enough vehicles are jammed at one target', () => {
    const { panel } = makePanel();
    const jammed = [1, 2, 3].map(id => makeVehicle({
      id, state: 'waiting', waitingTicks: 15, targetX: 8, targetZ: 8,
    }));
    panel.update(makeState(jammed));
    const banner = panel.root.querySelector('.bs-fleet-traffic');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('3 vehicles');
  });

  it('status chip reports a real stuck duration', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle({ isMoveStuck: true, waitingTicks: 14 })]));
    expect(panel.root.querySelector('.bs-fleet-status')!.textContent).toBe('Stuck · 14h');
  });

  it('status chip reports idle by default', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle()]));
    expect(panel.root.querySelector('.bs-fleet-status')!.textContent).toBe('Idle');
  });

  it('HP gauge reflects the real percentage against the tier def maxHp', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle({ type: 'debris_hauler', tier: 1, hp: 50 })]));
    expect(panel.root.querySelector('.bs-fleet-hp')!.textContent).toContain('50');
  });

  it('shows a LOAD gauge only for a debris_hauler', () => {
    const { panel: haulerPanel } = makePanel();
    haulerPanel.update(makeState([makeVehicle({ type: 'debris_hauler' })]));
    expect(haulerPanel.root.querySelector('.bs-fleet-load')).not.toBeNull();

    const { panel: rigPanel } = makePanel();
    rigPanel.update(makeState([makeVehicle({ type: 'drill_rig' })]));
    expect(rigPanel.root.querySelector('.bs-fleet-load')).toBeNull();
  });

  it('shows the real driver name and Unassign dispatches vehicle driver none', () => {
    const { panel } = makePanel();
    const calls: string[] = [];
    panel.setGameConsole(cmd => { calls.push(cmd); return { success: true, output: '' }; });
    panel.update(makeState(
      [makeVehicle({ id: 2, driverId: 6 })],
      [makeEmployee({ id: 6, name: 'Dorian Kask' })],
    ));
    expect(panel.root.textContent).toContain('Dorian Kask');

    const unassignBtn = [...panel.root.querySelectorAll('button')].find(b => b.textContent === 'Unassign')!;
    unassignBtn.click();
    expect(calls).toContain('vehicle driver 2 none');
  });

  it('offers only licensed, unclaimed crew in the assign picker, and Assign dispatches the real ids', () => {
    const { panel } = makePanel();
    const calls: string[] = [];
    panel.setGameConsole(cmd => { calls.push(cmd); return { success: true, output: '' }; });
    const eligible = makeEmployee({ id: 6, name: 'Dorian Kask', qualifications: [{ category: 'driving.truck', proficiencyLevel: 1, xp: 0 }] });
    const unqualified = makeEmployee({ id: 7, name: 'Bev Nunnally', qualifications: [] });
    panel.update(makeState([makeVehicle({ id: 2, type: 'debris_hauler' })], [eligible, unqualified]));

    const select = panel.root.querySelector('select') as HTMLSelectElement;
    const optionNames = [...select.options].map(o => o.textContent);
    expect(optionNames).toEqual(['Dorian Kask']);

    const assignBtn = [...panel.root.querySelectorAll('button')].find(b => b.textContent === 'Assign')!;
    assignBtn.click();
    expect(calls).toContain('vehicle driver 2 6');
  });

  it('shows a no-licensed warning and the TRAIN button navigates to Crew', () => {
    const { panel } = makePanel();
    let navigated: string | null = null;
    panel.setNavigateHandler(p => { navigated = p; });
    panel.update(makeState([makeVehicle({ id: 2, type: 'drill_rig' })], []));

    expect(panel.root.textContent).toContain('Nobody is licensed for');
    const trainBtn = [...panel.root.querySelectorAll('button')].find(b => b.textContent === 'Train someone in Crew')!;
    trainBtn.click();
    expect(navigated).toBe('crew');
  });

  it('scrap requests confirmation with the real residual value instead of scrapping immediately', () => {
    const { panel } = makePanel();
    const calls: string[] = [];
    panel.setGameConsole(cmd => { calls.push(cmd); return { success: true, output: '' }; });
    let requestedBody = '';
    panel.setConfirmHandler(config => { requestedBody = config.body; config.onConfirm(); });
    panel.update(makeState([makeVehicle({ id: 4, type: 'debris_hauler', tier: 1, hp: 100 })]));

    const scrapBtn = panel.root.querySelector('button[title="Scrap"]') as HTMLButtonElement;
    scrapBtn.click();

    expect(requestedBody).toContain('$10,000');
    expect(calls).toContain('vehicle scrap 4');
  });

  // ── DEALERSHIP ──

  it('dealership lists every real role with all three tiers', () => {
    const { panel } = makePanel();
    panel.update(makeState([]));
    const buttons = panel.root.querySelectorAll('.bs-fleet-tier-btn');
    expect(buttons.length).toBe(5 * 3);
    expect(panel.root.textContent).toContain('DEALERSHIP');
    expect(panel.root.textContent).toContain('Dumpster on Wheels');
    expect(panel.root.textContent).toContain('$25,000');
  });

  it('a tier button shows the real stat-multiplier line and dispatches vehicle buy on click', () => {
    const { panel } = makePanel();
    const calls: string[] = [];
    panel.setGameConsole(cmd => { calls.push(cmd); return { success: true, output: '' }; });
    const state = makeState([]);
    state.cash = 500000;
    panel.update(state);

    const tier2Btn = [...panel.root.querySelectorAll<HTMLButtonElement>('.bs-fleet-tier-btn')]
      .find(b => b.dataset['role'] === 'debris_hauler' && b.dataset['tier'] === '2')!;
    expect(tier2Btn.textContent).toContain('1.3');
    expect(tier2Btn.disabled).toBe(false);
    tier2Btn.click();
    expect(calls).toContain('vehicle buy debris_hauler tier:2');
  });

  it('tier buttons are disabled when unaffordable and re-enable as cash changes without a fleet change', () => {
    const { panel } = makePanel();
    const state = makeState([]);
    state.cash = 0;
    panel.update(state);
    const tier1Btn = () => [...panel.root.querySelectorAll<HTMLButtonElement>('.bs-fleet-tier-btn')]
      .find(b => b.dataset['role'] === 'debris_hauler' && b.dataset['tier'] === '1')!;
    expect(tier1Btn().disabled).toBe(true);

    state.cash = 100000;
    panel.update(state);
    expect(tier1Btn().disabled).toBe(false);
  });

  it('refreshLocale() re-renders the title and does not throw', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle()]));
    expect(() => panel.refreshLocale()).not.toThrow();
    expect(panel.root.textContent).toContain('Fleet');
  });

  it('close button dispatches the close handler', () => {
    const { panel } = makePanel();
    let closed = false;
    panel.setCloseHandler(() => { closed = true; });
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

  // ── vehicle selection via Fleet panel row click (issue #512) ──────────────
  //
  // A 3+ vehicle fleet gets snapped onto the same NavGrid cell by `vehicle
  // buy`, so scene-raycast selection can only ever hit one of them. Fleet
  // panel rows become clickable instead, routing through ScenePicking.select()
  // (wired by UIManager/main.ts) — these tests cover only FleetPanel's own
  // click-to-handler plumbing.

  it('clicking a rendered vehicle card fires the select handler with the real vehicle id', () => {
    const { panel } = makePanel();
    let selectedId: number | null = null;
    panel.setSelectVehicleHandler(id => { selectedId = id; });
    panel.update(makeState([makeVehicle({ id: 3 })]));

    const card = panel.root.querySelector('[data-vehicle-id="3"]') as HTMLElement;
    expect(card).not.toBeNull();
    card.click();

    expect(selectedId).toBe(3);
  });

  it('clicking a nested interactive control inside the card does not also fire the select handler', () => {
    const { panel } = makePanel();
    let selectedId: number | null = null;
    panel.setSelectVehicleHandler(id => { selectedId = id; });
    panel.setConfirmHandler(config => config.onConfirm());
    panel.update(makeState([makeVehicle({ id: 4, type: 'debris_hauler', tier: 1, hp: 100 })]));

    const scrapBtn = panel.root.querySelector('button[title="Scrap"]') as HTMLButtonElement;
    expect(scrapBtn).not.toBeNull();
    scrapBtn.click();

    expect(selectedId).toBeNull();
  });

  it('clicking the driver-assign select control does not fire the select handler', () => {
    const { panel } = makePanel();
    let selectedId: number | null = null;
    panel.setSelectVehicleHandler(id => { selectedId = id; });
    const eligible = makeEmployee({ id: 6, name: 'Dorian Kask', qualifications: [{ category: 'driving.truck', proficiencyLevel: 1, xp: 0 }] });
    panel.update(makeState([makeVehicle({ id: 2, type: 'debris_hauler' })], [eligible]));

    const select = panel.root.querySelector('select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    select.click();

    expect(selectedId).toBeNull();
  });

  it('clicking a vehicle card does not throw when no select handler is registered', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle({ id: 7 })]));

    const card = panel.root.querySelector('[data-vehicle-id="7"]') as HTMLElement;
    expect(() => card.click()).not.toThrow();
  });

  it('two different vehicle cards fire the select handler with two different, correct ids', () => {
    const { panel } = makePanel();
    const selected: number[] = [];
    panel.setSelectVehicleHandler(id => { selected.push(id); });
    panel.update(makeState([makeVehicle({ id: 2 }), makeVehicle({ id: 3 })]));

    (panel.root.querySelector('[data-vehicle-id="2"]') as HTMLElement).click();
    (panel.root.querySelector('[data-vehicle-id="3"]') as HTMLElement).click();

    expect(selected).toEqual([2, 3]);
  });
});
