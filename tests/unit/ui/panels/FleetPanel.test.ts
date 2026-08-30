// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { FleetPanel } from '../../../../src/ui/panels/FleetPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { Vehicle } from '../../../../src/core/entities/Vehicle.js';
import type { Employee } from '../../../../src/core/entities/Employee.js';
import { NavGrid } from '../../../../src/core/nav/NavGrid.js';
import { addBlastFragments } from '../../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../../src/core/mining/BlastExecution.js';

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1, type: 'debris_hauler', tier: 1, x: 5, z: 5, hp: 100, task: 'idle',
    targetX: 5, targetZ: 5, driverId: null, state: 'idle', payloadKg: 0,
    waitingTicks: 0, moveConsecutiveFailures: 0, isMoveStuck: false,
    haulingFragmentId: null, haulingPhase: null, haulingDepotBuildingId: null,
    breakFragmentId: null, breakPhase: null, reservedForActionId: null,
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
    taskQueue: [],
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

/** A flat, fully walkable size×size NavGrid, mirroring the retired
 *  FleetPanel.break.test.ts's own fixture — GameState.navGrid is null until
 *  a world is built via `new_game`. */
function makeFlatNavGrid(size: number): NavGrid {
  const cells = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ type: 'walkable' as const, moveCost: 1.0, benchLevel: 0, vehicleOccupied: false })));
  return new NavGrid(size, size, cells, 0);
}

// Oversized boulder — volume must exceed OVERSIZED_FRAGMENT_THRESHOLD (0.5 m³,
// see BoulderFragmentation.ts) so it would have been eligible for
// findReachableOversizedFragment (the retired #484 break-eligibility gate).
function makeOversizedFragment(id: number, x: number, z: number, mass = 5000): FragmentData {
  return {
    id,
    position: { x, y: 0, z },
    volume: 1.0,
    mass,
    rockId: 'cruite',
    oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
  };
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

  it('shows no Break button for a rock_fragmenter with a reachable oversized fragment (breakEligibility.ts retired, #618)', () => {
    const { panel } = makePanel();
    const state = makeState(
      [makeVehicle({ id: 5, type: 'rock_fragmenter', x: 0, z: 0, targetX: 0, targetZ: 0, driverId: 1 })],
      [makeEmployee({ id: 1 })],
    );
    state.navGrid = makeFlatNavGrid(20);
    addBlastFragments(state.logistics, [makeOversizedFragment(1, 3, 3)]);

    panel.update(state);

    expect(panel.root.querySelector('.bs-vehicle-break-btn')).toBeNull();
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

  // #715: `driverId` stays null for a vehicle's whole assign-then-walk
  // window (ArrivalGate.ts sets it only on arrival), so a picker that
  // filtered on driverId alone kept offering an employee already walking to
  // board a *different* vehicle — the click then silently failed
  // requestBoardVehicle's own already-walking guard, with no feedback. Two
  // cards rendered from one `update()` call (no purchase in between to force
  // a second render) is the scenario that most directly exercises this: both
  // pickers must reflect the claim the other one just made.
  it('excludes an employee already walking to board a different vehicle from the picker, even before that vehicle has a confirmed driverId', () => {
    const { panel } = makePanel();
    panel.setGameConsole(() => ({ success: true, output: '' }));
    const dorian = makeEmployee({ id: 6, name: 'Dorian Kask', qualifications: [{ category: 'driving.truck', proficiencyLevel: 1, xp: 0 }] });
    const bev = makeEmployee({ id: 7, name: 'Bev Nunnally', qualifications: [{ category: 'driving.truck', proficiencyLevel: 1, xp: 0 }] });
    const vehicleA = makeVehicle({ id: 2, type: 'debris_hauler' });
    const vehicleB = makeVehicle({ id: 3, type: 'debris_hauler' });

    panel.update(makeState([vehicleA, vehicleB], [dorian, bev]));
    const [selectA, selectB] = [...panel.root.querySelectorAll('select')] as HTMLSelectElement[];
    expect([...selectA!.options].map(o => o.textContent)).toEqual(['Dorian Kask', 'Bev Nunnally']);
    expect([...selectB!.options].map(o => o.textContent)).toEqual(['Dorian Kask', 'Bev Nunnally']);

    // Dorian claims vehicle A — vehicle.driverId stays null (walking, not
    // yet arrived); only the employee's pendingDriverVehicleId changes.
    dorian.pendingDriverVehicleId = vehicleA.id;
    panel.update(makeState([vehicleA, vehicleB], [dorian, bev]));

    const selectBAfter = panel.root.querySelector(`[data-vehicle-id="${vehicleB.id}"] select`) as HTMLSelectElement;
    expect([...selectBAfter.options].map(o => o.textContent)).toEqual(['Bev Nunnally']);

    const assignBtnB = panel.root.querySelector<HTMLButtonElement>(`[data-vehicle-id="${vehicleB.id}"] .bs-vehicle-assign-btn`)!;
    const calls: string[] = [];
    panel.setGameConsole(cmd => { calls.push(cmd); return { success: true, output: '' }; });
    assignBtnB.click();
    expect(calls).toEqual(['vehicle driver 3 7']);
  });

  // #715 follow-up: excluding a pending driver from every OTHER vehicle's
  // picker (the test above) must not also hide them from their OWN
  // vehicle's card — v.driverId stays null for the whole walk, so without a
  // dedicated pending row that card fell through to makeAssignRow and, once
  // the only licensed employee was excluded, showed the misleading
  // "Nobody is licensed" warning for a vehicle that already has someone
  // walking to it.
  it('shows a pending-driver row, not the no-licensed warning, for a vehicle its only licensed employee is already walking to', () => {
    const { panel } = makePanel();
    const dorian = makeEmployee({
      id: 6, name: 'Dorian Kask',
      qualifications: [{ category: 'driving.truck', proficiencyLevel: 1, xp: 0 }],
      pendingDriverVehicleId: 2,
    });
    const vehicle = makeVehicle({ id: 2, type: 'debris_hauler' });

    panel.update(makeState([vehicle], [dorian]));

    expect(panel.root.textContent).toContain('Dorian Kask');
    expect(panel.root.textContent).not.toContain('Nobody is licensed');
    expect(panel.root.querySelector('select')).toBeNull();
    expect([...panel.root.querySelectorAll('button')].some(b => b.textContent === 'Assign')).toBe(false);
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
