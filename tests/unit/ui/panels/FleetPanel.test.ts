// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { FleetPanel } from '../../../../src/ui/panels/FleetPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { t } from '../../../../src/core/i18n/I18n.js';
import { vehicleCardLine, vehicleCardTooltip } from '../../../../src/ui/catalogCardText.js';
import { getVehicleDefByTier, type VehicleRole, type VehicleTier } from '../../../../src/core/entities/Vehicle.js';
import type { GameState } from '../../../../src/core/state/GameState.js';
import type { Vehicle } from '../../../../src/core/entities/Vehicle.js';
import type { Employee } from '../../../../src/core/entities/Employee.js';
import { NavGrid } from '../../../../src/core/nav/NavGrid.js';
import { addBlastFragments } from '../../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../../src/core/mining/BlastExecution.js';
import { createGradeState } from '../../../../src/core/economy/MineGrade.js';
import { SELECTED_ROW_CLASS } from '../../../../src/ui/selectionRoute.js';
import enLocaleJson from '../../../../src/core/i18n/locales/en.json' assert { type: 'json' };
import frLocaleJson from '../../../../src/core/i18n/locales/fr.json' assert { type: 'json' };

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return {
    id: 1, type: 'debris_hauler', tier: 1, x: 5, z: 5, hp: 100,
    cargo: [],
    occupantIds: [],
    ...overrides,
  };
}

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 1, name: 'Dorian Kask', role: 'driver', salary: 400, morale: 60,
    unionized: false, injured: false, alive: true, x: 0, z: 0,
    qualifications: [], trainingState: null, activeActionId: null,
    fatigue: 100, collapsing: false,
    interruptedActionPayload: null, ticksWorked: 0,
    restTicksRemaining: null, restNeedKey: null, taskTicksRemaining: null,
    activeTaskSkill: null, destinationX: null, destinationZ: null,
    moveConsecutiveFailures: 0, isMoveStuck: false,
    pendingRestDuration: null, pendingRestNeedKey: null,
    pendingTaskDuration: null, pendingActionType: null,
    pendingActionPayload: null, pendingDriverVehicleId: null,
    taskQueue: [],
    locomotion: { kind: 'on_foot' },
    itinerary: null,
    vehicleWaitingTicks: 0,
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
    origin: { x, y: 0, z },
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

  it('renders a vehicle row with its real name, id, and role', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle({ id: 3, type: 'debris_hauler', tier: 1 })]));
    const text = panel.root.textContent!;
    expect(text).toContain('Dumpster on Wheels');
    expect(text).toContain('#3');
    expect(text).toContain('Debris Hauler');
  });

  it('shows no Haul button for a debris_hauler with nothing reachable to haul (haulEligibility.ts, real eligibility check)', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle({ id: 5, type: 'debris_hauler', occupantIds: [1] })], [makeEmployee({ id: 1 })]));
    expect(panel.root.querySelector('.bs-vehicle-haul-btn')).toBeNull();
  });

  it('shows no Break button for a rock_fragmenter with a reachable oversized fragment (breakEligibility.ts retired, #618)', () => {
    const { panel } = makePanel();
    const state = makeState(
      [makeVehicle({ id: 5, type: 'rock_fragmenter', x: 0, z: 0, occupantIds: [1] })],
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
    // #1138: "waiting" is derived from the driving employee's own
    // vehicleWaitingTicks and current drive leg now — build a (vehicle,
    // employee) pair per jammed vehicle instead of poking Vehicle.state.
    const jammed = [1, 2, 3].map(id => makeVehicle({ id, occupantIds: [100 + id] }));
    const drivers = [1, 2, 3].map(id => makeEmployee({
      id: 100 + id,
      vehicleWaitingTicks: 15,
      itinerary: {
        legs: [{ mode: 'drive', vehicleId: id, destX: 8, destZ: 8, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5 }],
        goal: { kind: 'reposition', x: 8, z: 8 },
        workTicks: 0,
        estTotalTicks: 5,
      },
    }));
    panel.update(makeState(jammed, drivers));
    const banner = panel.root.querySelector('.bs-fleet-traffic');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('3 people and vehicles');
  });

  describe('jam banner on refresh (#1395)', () => {
    function jamFixture(ids: number[], waiting: number) {
      const vehicles = ids.map(id => makeVehicle({ id, occupantIds: [100 + id] }));
      const drivers = ids.map(id => makeEmployee({
        id: 100 + id,
        x: 8, z: 8, // jam coordinates derive from the stuck employees' own positions
        vehicleWaitingTicks: waiting,
        itinerary: {
          legs: [{ mode: 'drive', vehicleId: id, destX: 8, destZ: 8, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5 }],
          goal: { kind: 'reposition', x: 8, z: 8 },
          workTicks: 0,
          estTotalTicks: 5,
        },
      }));
      return { vehicles, drivers };
    }
    // Same vehicles/drivers every call; only the ids in jamIds carry waits.
    const stateFor = (ids: number[], waiting: number, jamIds: number[] = ids): GameState => {
      const { vehicles, drivers } = jamFixture(ids, 0);
      const jam = jamFixture(jamIds, waiting).drivers;
      return makeState(vehicles, drivers.map(d => jam.find(j => j.id === d.id) ?? d));
    };

    it('banner appears on a refresh with an unchanged signature', () => {
      const { panel } = makePanel();
      panel.update(stateFor([1, 2, 3], 0));
      expect(panel.root.querySelector('.bs-fleet-traffic')).toBeNull();
      panel.update(stateFor([1, 2, 3], 15));
      expect(panel.root.querySelector('.bs-fleet-traffic')).not.toBeNull();
    });

    it('new banner is the first child of the body with count and coordinates', () => {
      const { panel } = makePanel();
      panel.update(stateFor([1, 2, 3], 0));
      panel.update(stateFor([1, 2, 3], 15));
      const banner = panel.root.querySelector('.bs-fleet-traffic')!;
      expect(banner.parentElement!.firstElementChild).toBe(banner);
      expect(banner.textContent).toMatch(/^3 people and vehicles are stuck near \(\d+, \d+\)/);
      expect(banner.textContent).toContain(t('ui.fleet.traffic_advisory', { count: 3, x: 8, z: 8 }));
    });

    it('banner is removed when waits reset with an unchanged signature', () => {
      const { panel } = makePanel();
      panel.update(stateFor([1, 2, 3], 15));
      expect(panel.root.querySelector('.bs-fleet-traffic')).not.toBeNull();
      panel.update(stateFor([1, 2, 3], 0));
      expect(panel.root.querySelector('.bs-fleet-traffic')).toBeNull();
    });

    it('jam count change updates banner text and keeps one banner', () => {
      const { panel } = makePanel();
      panel.update(stateFor([1, 2, 3, 4], 15, [1, 2, 3]));
      expect(panel.root.querySelector('.bs-fleet-traffic')!.textContent).toContain('3 people and vehicles');
      panel.update(stateFor([1, 2, 3, 4], 15, [1, 2, 3, 4]));
      expect(panel.root.querySelectorAll('.bs-fleet-traffic').length).toBe(1);
      expect(panel.root.querySelector('.bs-fleet-traffic')!.textContent).toContain('4 people and vehicles');
    });

    it('vehicle rows keep DOM identity across jam appear and disappear', () => {
      const { panel } = makePanel();
      panel.update(stateFor([1, 2, 3], 0));
      const before = [1, 2, 3].map(id => panel.root.querySelector(`[data-vehicle-id="${id}"]`));
      expect(before.every(el => el !== null)).toBe(true);
      panel.update(stateFor([1, 2, 3], 15));
      expect(panel.root.querySelector('.bs-fleet-traffic')).not.toBeNull();
      [1, 2, 3].forEach((id, i) => expect(panel.root.querySelector(`[data-vehicle-id="${id}"]`)).toBe(before[i]));
      panel.update(stateFor([1, 2, 3], 0));
      expect(panel.root.querySelector('.bs-fleet-traffic')).toBeNull();
      [1, 2, 3].forEach((id, i) => expect(panel.root.querySelector(`[data-vehicle-id="${id}"]`)).toBe(before[i]));
    });

    it('repeated updates during a persisting jam leave one banner', () => {
      const { panel } = makePanel();
      panel.update(stateFor([1, 2, 3], 0));
      for (let i = 0; i < 4; i++) panel.update(stateFor([1, 2, 3], 15 + i));
      expect(panel.root.querySelectorAll('.bs-fleet-traffic').length).toBe(1);
    });
  });

  it('status chip reports a real stuck duration', () => {
    const { panel } = makePanel();
    const vehicle = makeVehicle({ occupantIds: [6] });
    const driver = makeEmployee({ id: 6, isMoveStuck: true, moveConsecutiveFailures: 14 });
    panel.update(makeState([vehicle], [driver]));
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

  // ── DEALERSHIP ──

  it('dealership lists every real role with all three tiers', () => {
    const { panel } = makePanel();
    panel.update(makeState([]));
    const buttons = panel.root.querySelectorAll('.bs-fleet-tier-btn');
    expect(buttons.length).toBe(6 * 3);
    expect(panel.root.textContent).toContain('DEALERSHIP');
    expect(panel.root.textContent).toContain('Dumpster on Wheels');
    expect(panel.root.textContent).toContain('Pour-Bucket Pete');
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
    expect(tier2Btn.textContent).toContain(vehicleCardLine(getVehicleDefByTier('debris_hauler', 2)));
    expect(tier2Btn.disabled).toBe(false);
    tier2Btn.click();
    expect(calls).toContain('vehicle buy debris_hauler tier:2');
  });

  it('each dealership button shows the "<desc> · $N/h" line and carries the absolute-stats tooltip (#1377)', () => {
    const { panel } = makePanel();
    const state = makeState([]);
    state.cash = 5_000_000;
    panel.update(state);
    const buttons = [...panel.root.querySelectorAll<HTMLButtonElement>('.bs-fleet-tier-btn')];
    expect(buttons.length).toBe(18);
    for (const btn of buttons) {
      const def = getVehicleDefByTier(btn.dataset['role'] as VehicleRole, Number(btn.dataset['tier']) as VehicleTier);
      const desc = btn.querySelector('.bs-fleet-tier-desc');
      expect(desc, `${def.type} T${def.tier}`).not.toBeNull();
      expect(desc!.textContent).toBe(vehicleCardLine(def));
      expect(btn.title).toBe(vehicleCardTooltip(def));
      expect(btn.textContent).not.toContain('1.0x');
      expect(btn.textContent).not.toContain('1.0×');
      expect(btn.textContent).not.toContain('spd');
    }
  });

  it('an unaffordable dealership button keeps the stats tooltip and adds the reason (#1377)', () => {
    const { panel } = makePanel();
    const state = makeState([]);
    state.cash = 0;
    panel.update(state);
    const btn = [...panel.root.querySelectorAll<HTMLButtonElement>('.bs-fleet-tier-btn')]
      .find(b => b.dataset['role'] === 'debris_hauler' && b.dataset['tier'] === '3')!;
    const stats = vehicleCardTooltip(getVehicleDefByTier('debris_hauler', 3));
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain(stats);
    expect(btn.title.length).toBeGreaterThan(stats.length);

    state.cash = 5_000_000;
    panel.update(state);
    expect(btn.disabled).toBe(false);
    expect(btn.title).toBe(stats);
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

  it('clicking a rendered vehicle row fires the select handler with the real vehicle id', () => {
    const { panel } = makePanel();
    let selectedId: number | null = null;
    panel.setSelectVehicleHandler(id => { selectedId = id; });
    panel.update(makeState([makeVehicle({ id: 3 })]));

    const row = panel.root.querySelector('[data-vehicle-id="3"]') as HTMLElement;
    expect(row).not.toBeNull();
    row.click();

    expect(selectedId).toBe(3);
  });

  it('clicking a vehicle row does not throw when no select handler is registered', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle({ id: 7 })]));

    const row = panel.root.querySelector('[data-vehicle-id="7"]') as HTMLElement;
    expect(() => row.click()).not.toThrow();
  });

  it('two different vehicle rows fire the select handler with two different, correct ids', () => {
    const { panel } = makePanel();
    const selected: number[] = [];
    panel.setSelectVehicleHandler(id => { selected.push(id); });
    panel.update(makeState([makeVehicle({ id: 2 }), makeVehicle({ id: 3 })]));

    (panel.root.querySelector('[data-vehicle-id="2"]') as HTMLElement).click();
    (panel.root.querySelector('[data-vehicle-id="3"]') as HTMLElement).click();

    expect(selected).toEqual([2, 3]);
  });
});

// ── One scroll area (#958, #2242) ───────────────────────────────────────────
//
// bodyEl is the window root's second child and its only scroll area. #958
// once bounded the vehicle list in its own scroll box so a large fleet could
// not bury the dealership; the central window (#2242) lays the fleet out as a
// card grid instead, followed by the dealership in the same single scroll.

function getBodyEl(panel: FleetPanel): HTMLElement {
  return panel.root.children[1] as HTMLElement;
}

function makeManyVehicles(count: number): ReturnType<typeof makeVehicle>[] {
  // Distinct (x,z) per vehicle and no occupant — avoids tripping the
  // traffic-jam banner, which would add an extra pre-DEALERSHIP child unrelated
  // to this test's own concern.
  return Array.from({ length: count }, (_, i) => makeVehicle({ id: i + 1, x: i, z: 0 }));
}

// ── Rows are master-list rows (#1767) ───────────────────────────────────────
// Upgrade, Reposition, Scrap and the driver block live in the vehicle
// inspector now; a row only shows state and selects.

describe('FleetPanel — rows hold no actions (#1767)', () => {
  const rowOf = (panel: FleetPanel, id: number) => panel.root.querySelector(`[data-vehicle-id="${id}"]`) as HTMLElement;

  it('a row has no Upgrade, Reposition, Scrap, select or upgrade-warning controls', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle({ id: 2, type: 'drill_rig' }), makeVehicle({ id: 3, type: 'debris_hauler', occupantIds: [6] })], [makeEmployee({ id: 6 })]));
    for (const id of [2, 3]) {
      const row = rowOf(panel, id);
      expect(row.querySelector('[data-action="upgrade"]')).toBeNull();
      expect(row.querySelector('[data-action="reposition"]')).toBeNull();
      expect(row.querySelector('.bs-fleet-upgrade-btn')).toBeNull();
      expect(row.querySelector('.bs-fleet-reposition-btn')).toBeNull();
      expect(row.querySelector('.bsx-btn-danger')).toBeNull();
      expect(row.querySelector('button[title="Scrap"]')).toBeNull();
      expect(row.querySelector('select')).toBeNull();
      expect(row.querySelector('.bs-fleet-upgrade-warning')).toBeNull();
    }
  });

  it('the only button in a row is Locate', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle({ id: 4 })]));
    const buttons = [...rowOf(panel, 4).querySelectorAll('button')];
    expect(buttons.length).toBe(1);
    expect(buttons[0]!.getAttribute('data-action')).toBe('locate');
  });

  it('a row shows icon, tier name, id, role, status, HP and driver line', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle({ id: 3, type: 'drill_rig', tier: 1 })]));
    const row = rowOf(panel, 3);
    expect(row.querySelector('bs-icon')).not.toBeNull(); // iconEl renders a <bs-icon> custom element, not an inline <svg>
    expect(row.textContent).toContain('#3');
    expect(row.textContent).toContain('Drill Rig');
    expect(row.querySelector('.bs-fleet-status')).not.toBeNull();
    expect(row.querySelector('.bs-fleet-hp')).not.toBeNull();
    expect(row.querySelector('.bs-fleet-driver')).not.toBeNull();
  });

  it('driver line shows the real driver name', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle({ id: 2, occupantIds: [6] })], [makeEmployee({ id: 6, name: 'Dorian Kask' })]));
    expect(rowOf(panel, 2).querySelector('.bs-fleet-driver')!.textContent).toContain('Dorian Kask');
  });

  it('driver line shows the pending driver walking to the vehicle', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle({ id: 2 })], [makeEmployee({ id: 6, name: 'Dorian Kask', pendingDriverVehicleId: 2 })]));
    expect(rowOf(panel, 2).querySelector('.bs-fleet-driver')!.textContent).toContain('Dorian Kask');
  });

  it('driver line reads Unmanned with no driver, and never warns or offers Train', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle({ id: 2, type: 'drill_rig' })], [makeEmployee({ id: 6, qualifications: [{ category: 'driving.drill_rig', proficiencyLevel: 1, xp: 0, licenceLevel: 1 }] })]));
    const row = rowOf(panel, 2);
    expect(row.querySelector('.bs-fleet-driver')!.textContent).toContain('Unmanned');
    expect(row.textContent).not.toContain('Nobody is licensed');
    expect(row.textContent).not.toContain('Train someone in Crew');
  });

  it('no row element exposes the old no-licensed / train block even with no licensed employee', () => {
    const { panel } = makePanel();
    panel.update(makeState([makeVehicle({ id: 2, type: 'drill_rig' })], []));
    expect(panel.root.textContent).not.toContain('Nobody is licensed for');
    expect([...panel.root.querySelectorAll('button')].some(b => b.textContent === 'Train someone in Crew')).toBe(false);
  });

  it('FleetPanel no longer has the navigate, confirm or placement-kit handlers', () => {
    const proto = FleetPanel.prototype as unknown as Record<string, unknown>;
    expect(proto['setNavigateHandler']).toBeUndefined();
    expect(proto['setConfirmHandler']).toBeUndefined();
    expect(proto['setPlacementKit']).toBeUndefined();
    expect(proto['requestReposition']).toBeUndefined();
  });

  it('a driver change patches the driver line in place; the row DOM identity survives', () => {
    const { panel } = makePanel();
    const vehicle = makeVehicle({ id: 2 });
    const licensed = makeEmployee({ id: 7, name: 'Lia Holder', qualifications: [{ category: 'driving.truck', proficiencyLevel: 1, xp: 0, licenceLevel: 1 }] });
    const state = makeState([vehicle], [licensed]);
    panel.update(state);
    const row = rowOf(panel, 2);
    expect(row.querySelector('.bs-fleet-driver')!.textContent).toContain('Unmanned');

    const driver = makeEmployee({ id: 6, name: 'Dorian Kask' });
    vehicle.occupantIds = [6];
    state.employees.employees = [driver];
    panel.update(state);

    expect(rowOf(panel, 2)).toBe(row);
    expect(row.querySelector('.bs-fleet-driver')!.textContent).toContain('Dorian Kask');
  });

  it('a qualification change does not rebuild rows', () => {
    const { panel } = makePanel();
    const state = makeState([makeVehicle({ id: 2 })], [makeEmployee({ id: 6 })]);
    panel.update(state);
    const row = rowOf(panel, 2);
    state.employees.employees[0]!.qualifications = [{ category: 'driving.truck', proficiencyLevel: 1, xp: 0 }];
    panel.update(state);
    expect(rowOf(panel, 2)).toBe(row);
  });

  it('a cash change does not rebuild rows', () => {
    const { panel } = makePanel();
    const state = makeState([makeVehicle({ id: 2 })]);
    panel.update(state);
    const row = rowOf(panel, 2);
    state.cash += 1234;
    panel.update(state);
    expect(rowOf(panel, 2)).toBe(row);
  });
});

describe('FleetPanel — selected row highlight (#1767)', () => {
  const selectedRows = (panel: FleetPanel) => [...panel.root.querySelectorAll<HTMLElement>('.bs-row-selected')];
  const rowOf = (panel: FleetPanel, id: number) => panel.root.querySelector(`[data-vehicle-id="${id}"]`) as HTMLElement;
  const threeVehicles = () => makeState([makeVehicle({ id: 1, x: 1 }), makeVehicle({ id: 2, x: 2 }), makeVehicle({ id: 3, x: 3 })]);

  it('setSelectedVehicle highlights exactly the matching row with aria-selected', () => {
    const { panel } = makePanel();
    panel.update(threeVehicles());
    panel.setSelectedVehicle({ kind: 'vehicle', id: 2 });
    expect(selectedRows(panel)).toEqual([rowOf(panel, 2)]);
    expect(rowOf(panel, 2).classList.contains(SELECTED_ROW_CLASS)).toBe(true);
    expect(rowOf(panel, 2).getAttribute('aria-selected')).toBe('true');
    expect(rowOf(panel, 1).hasAttribute('aria-selected')).toBe(false);
  });

  it('moving the selection moves the highlight', () => {
    const { panel } = makePanel();
    panel.update(threeVehicles());
    panel.setSelectedVehicle({ kind: 'vehicle', id: 1 });
    panel.setSelectedVehicle({ kind: 'vehicle', id: 3 });
    expect(selectedRows(panel)).toEqual([rowOf(panel, 3)]);
  });

  it('null clears the highlight', () => {
    const { panel } = makePanel();
    panel.update(threeVehicles());
    panel.setSelectedVehicle({ kind: 'vehicle', id: 2 });
    panel.setSelectedVehicle(null);
    expect(selectedRows(panel).length).toBe(0);
    expect(panel.root.querySelector('[aria-selected]')).toBeNull();
  });

  it('a selection of another kind clears the highlight, even with a matching id', () => {
    const { panel } = makePanel();
    panel.update(threeVehicles());
    panel.setSelectedVehicle({ kind: 'vehicle', id: 2 });
    panel.setSelectedVehicle({ kind: 'employee', id: 2 });
    expect(selectedRows(panel).length).toBe(0);
  });

  it('a vehicle id that has no row highlights nothing', () => {
    const { panel } = makePanel();
    panel.update(threeVehicles());
    panel.setSelectedVehicle({ kind: 'vehicle', id: 99 });
    expect(selectedRows(panel).length).toBe(0);
  });

  it('the highlight survives a structural re-render', () => {
    const { panel } = makePanel();
    const state = threeVehicles();
    panel.update(state);
    panel.setSelectedVehicle({ kind: 'vehicle', id: 2 });
    state.vehicles.vehicles.push(makeVehicle({ id: 4, x: 4 }));
    panel.update(state);
    expect(selectedRows(panel)).toEqual([rowOf(panel, 2)]);
  });

  it('the highlight survives refreshDynamic (unchanged signature)', () => {
    const { panel } = makePanel();
    const state = threeVehicles();
    panel.update(state);
    panel.setSelectedVehicle({ kind: 'vehicle', id: 2 });
    state.vehicles.vehicles[1]!.hp = 40;
    panel.update(state);
    expect(selectedRows(panel)).toEqual([rowOf(panel, 2)]);
  });

  it('a selection made before the first update is applied once rows exist', () => {
    const { panel } = makePanel();
    panel.setSelectedVehicle({ kind: 'vehicle', id: 3 });
    panel.update(threeVehicles());
    expect(selectedRows(panel)).toEqual([rowOf(panel, 3)]);
  });

  it('a row click selects through the handler once; the highlight is applied by the route, not the click', () => {
    const { panel } = makePanel();
    const selected: number[] = [];
    panel.setSelectVehicleHandler(id => selected.push(id));
    panel.update(threeVehicles());
    rowOf(panel, 2).click();
    expect(selected).toEqual([2]);
    expect(selectedRows(panel)).toEqual([]);
  });

  it('a click on a row child (not the Locate button) selects once', () => {
    const { panel } = makePanel();
    const selected: number[] = [];
    panel.setSelectVehicleHandler(id => selected.push(id));
    panel.update(threeVehicles());
    (rowOf(panel, 2).firstElementChild as HTMLElement).click();
    expect(selected).toEqual([2]);
  });
});

describe('FleetPanel — one scroll area per window (#958, #2242)', () => {
  const nestedScrollers = (root: HTMLElement): HTMLElement[] =>
    Array.from(root.querySelectorAll<HTMLElement>('*')).filter(n => n.style.overflowY === 'auto' || n.style.overflowY === 'scroll');

  it('lays all 12 vehicles out in one card grid inside the vehicles section', () => {
    const { panel } = makePanel();
    panel.update(makeState(makeManyVehicles(12)));

    const list = getBodyEl(panel).querySelector<HTMLElement>(':scope > .bs-fleet-list')!;
    const grid = list.querySelector<HTMLElement>('.bs-fleet-grid')!;
    expect(grid.querySelectorAll(':scope > [data-vehicle-id]').length).toBe(12);
    expect(grid.dataset['scrollKey']).toBe('fleet');
  });

  it('nests no scroll area inside the body', () => {
    const { panel } = makePanel();
    panel.update(makeState(makeManyVehicles(12)));
    expect(nestedScrollers(getBodyEl(panel))).toEqual([]);
  });

  it('keeps the dealership outside the vehicle grid, every role and tier still resolving', () => {
    const { panel } = makePanel();
    panel.update(makeState(makeManyVehicles(12)));

    const bodyEl = getBodyEl(panel);
    const grid = bodyEl.querySelector<HTMLElement>('.bs-fleet-grid')!;
    const dealership = bodyEl.querySelector<HTMLElement>(':scope > .bs-fleet-dealership')!;
    expect(grid.contains(dealership)).toBe(false);
    // 6 roles × 3 tiers of dealership buttons still resolve.
    expect(dealership.querySelectorAll('.bs-fleet-tier-btn').length).toBe(6 * 3);
  });

  it('keeps bodyEl itself scrollable (overflow-y:auto) regardless of fleet size', () => {
    const { panel: emptyPanel } = makePanel();
    emptyPanel.update(makeState([]));
    const { panel: fullPanel } = makePanel();
    fullPanel.update(makeState(makeManyVehicles(12)));

    for (const bodyEl of [getBodyEl(emptyPanel), getBodyEl(fullPanel)]) {
      expect(bodyEl.style.overflowY).toBe('auto');
    }
  });
});

describe('FleetPanel dealership grade gate (#1928)', () => {
  const tierBtn = (panel: FleetPanel, role: string, tier: number) =>
    [...panel.root.querySelectorAll<HTMLButtonElement>('.bs-fleet-tier-btn')]
      .find(b => b.dataset['role'] === role && b.dataset['tier'] === String(tier))!;

  function progressionState(grade: number): GameState {
    const state = makeState([]);
    state.cash = 50_000_000;
    state.grade = createGradeState();
    state.grade.grade = grade;
    return state;
  }

  it('at grade 1 tier-2 and tier-3 buttons are locked with a "Needs <grade>" line, tier 1 is open', () => {
    const { panel } = makePanel();
    panel.update(progressionState(1));
    const t1 = tierBtn(panel, 'debris_hauler', 1);
    const t2 = tierBtn(panel, 'debris_hauler', 2);
    const t3 = tierBtn(panel, 'debris_hauler', 3);
    expect(t1.disabled).toBe(false);
    expect(t1.dataset['locked']).toBeUndefined();
    expect(t1.querySelector('.bs-fleet-tier-lock')).toBeNull();
    expect(t2.disabled).toBe(true);
    expect(t2.dataset['locked']).toBe('grade');
    expect(t2.querySelector('.bs-fleet-tier-lock')!.textContent).toBe('Needs Licensed Quarry');
    expect(t3.disabled).toBe(true);
    expect(t3.dataset['locked']).toBe('grade');
    expect(t3.querySelector('.bs-fleet-tier-lock')!.textContent).toBe('Needs Strategic National Excavation');
  });

  it('every role is locked the same way', () => {
    const { panel } = makePanel();
    panel.update(progressionState(1));
    const locked = [...panel.root.querySelectorAll<HTMLButtonElement>('.bs-fleet-tier-btn')]
      .filter(b => b.dataset['locked'] === 'grade');
    expect(locked.length).toBe(6 * 2);
  });

  it('clicking a locked button dispatches nothing', () => {
    const { panel } = makePanel();
    const calls: string[] = [];
    panel.setGameConsole(cmd => { calls.push(cmd); return { success: true, output: '' }; });
    panel.update(progressionState(1));
    tierBtn(panel, 'debris_hauler', 2).click();
    expect(calls).toEqual([]);
  });

  it('unlocks in place when the grade rises', () => {
    const { panel } = makePanel();
    const calls: string[] = [];
    panel.setGameConsole(cmd => { calls.push(cmd); return { success: true, output: '' }; });
    const state = progressionState(1);
    panel.update(state);
    state.grade!.grade = 2;
    panel.update(state);
    const t2 = tierBtn(panel, 'debris_hauler', 2);
    expect(t2.disabled).toBe(false);
    expect(t2.dataset['locked']).toBeUndefined();
    expect(t2.querySelector('.bs-fleet-tier-lock')).toBeNull();
    expect(tierBtn(panel, 'debris_hauler', 3).dataset['locked']).toBe('grade');
    t2.click();
    expect(calls).toContain('vehicle buy debris_hauler tier:2');
  });

  it('grade 4 unlocks tier 3', () => {
    const { panel } = makePanel();
    panel.update(progressionState(4));
    expect(tierBtn(panel, 'debris_hauler', 3).disabled).toBe(false);
  });

  it('a non-progression site shows no lock', () => {
    const { panel } = makePanel();
    const state = makeState([]);
    state.cash = 50_000_000;
    panel.update(state);
    expect(panel.root.querySelectorAll('.bs-fleet-tier-lock').length).toBe(0);
    expect(tierBtn(panel, 'debris_hauler', 3).disabled).toBe(false);
  });
});

// ── Fleet filter and sort bar (#2161) ───────────────────────────────────────

describe('FleetPanel — vehicle filter and sort bar (#2161)', () => {
  const maxHp = (role: VehicleRole, tier: VehicleTier): number => getVehicleDefByTier(role, tier).maxHp;

  /**
   * 1 hauler t1 working, 2 drill_rig t2 waiting, 3 hauler t3 stuck, 4 drill_rig t1 broken, 5 rock_digger t2 idle.
   * hp fractions: 1 → 0.9, 2 → 0.6, 3 → 0.5, 4 → 0, 5 → 0.75.
   */
  function fleet(): { vehicles: Vehicle[]; crew: Employee[] } {
    return {
      vehicles: [
        makeVehicle({ id: 1, type: 'debris_hauler', tier: 1, hp: maxHp('debris_hauler', 1) * 0.9, occupantIds: [11] }),
        makeVehicle({ id: 2, type: 'drill_rig', tier: 2, hp: maxHp('drill_rig', 2) * 0.6, occupantIds: [12] }),
        makeVehicle({ id: 3, type: 'debris_hauler', tier: 3, hp: maxHp('debris_hauler', 3) * 0.5, occupantIds: [13] }),
        makeVehicle({ id: 4, type: 'drill_rig', tier: 1, hp: 0 }),
        makeVehicle({ id: 5, type: 'rock_digger', tier: 2, hp: maxHp('rock_digger', 2) * 0.75, occupantIds: [14] }),
      ],
      crew: [
        makeEmployee({ id: 11, taskTicksRemaining: 5 }),
        makeEmployee({ id: 12, vehicleWaitingTicks: 3 }),
        makeEmployee({ id: 13, isMoveStuck: true, moveConsecutiveFailures: 2 }),
        makeEmployee({ id: 14 }),
      ],
    };
  }

  function setup(f = fleet()) {
    const { panel } = makePanel();
    const state = makeState(f.vehicles, f.crew);
    panel.update(state);
    return { panel, state };
  }

  const bar = (panel: FleetPanel): HTMLElement => panel.root.querySelector<HTMLElement>('.bs-filter-bar')!;
  const click = (panel: FleetPanel, selector: string): void => (bar(panel).querySelector(selector) as HTMLButtonElement).click();
  const roleBtn = (role: string): string => `.bs-filter-row:not([data-filter-group]) [data-filter-value="${role}"]`;
  const groupBtn = (group: string, value: string): string => `[data-filter-group="${group}"] [data-filter-value="${value}"]`;
  const sortBtn = (key: string): string => `[data-sort-key="${key}"]`;
  const shown = (panel: FleetPanel): number[] =>
    [...panel.root.querySelectorAll<HTMLElement>('[data-vehicle-id]')].map(r => Number(r.dataset['vehicleId']));
  const groupValues = (panel: FleetPanel, group: string): string[] =>
    [...bar(panel).querySelectorAll<HTMLElement>(`[data-filter-group="${group}"] [data-filter-value]`)].map(b => b.dataset['filterValue']!);

  it('shows the shared filter bar above the vehicle rows', () => {
    const { panel } = setup();
    expect(panel.root.querySelectorAll('.bs-filter-bar')).toHaveLength(1);
    const first = panel.root.querySelector('[data-vehicle-id]')!;
    expect(bar(panel).compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers every vehicle role in the main filter row', () => {
    const { panel } = setup();
    const roles = [...bar(panel).querySelectorAll<HTMLElement>('.bs-filter-row:not([data-filter-group]) [data-filter-value]')]
      .map(b => b.dataset['filterValue']).sort();
    expect(roles).toEqual(['building_destroyer', 'charging_truck', 'debris_hauler', 'drill_rig', 'rock_digger', 'rock_fragmenter']);
    expect(bar(panel).querySelector('[data-filter-all]')).not.toBeNull();
  });

  it('offers the three tiers and the four status choices', () => {
    const { panel } = setup();
    expect(groupValues(panel, 'tier').sort()).toEqual(['1', '2', '3']);
    expect(groupValues(panel, 'status').sort()).toEqual(['damaged', 'stuck', 'waiting', 'working']);
  });

  it('offers the hp and tier sorts', () => {
    const { panel } = setup();
    const keys = [...bar(panel).querySelectorAll<HTMLElement>('[data-sort-key]')].map(b => b.dataset['sortKey']).sort();
    expect(keys).toEqual(['hp', 'tier']);
  });

  it('shows the whole fleet in stored order before any choice', () => {
    const { panel } = setup();
    expect(shown(panel)).toEqual([1, 2, 3, 4, 5]);
  });

  it('a role button hides the other roles, and All brings them back', () => {
    const { panel } = setup();
    click(panel, roleBtn('drill_rig'));
    expect(shown(panel)).toEqual([2, 4]);
    click(panel, '[data-filter-all]');
    expect(shown(panel)).toEqual([1, 2, 3, 4, 5]);
  });

  it('a tier button keeps only that tier', () => {
    const { panel } = setup();
    click(panel, groupBtn('tier', '2'));
    expect(shown(panel)).toEqual([2, 5]);
    click(panel, groupBtn('tier', '3'));
    expect(shown(panel)).toEqual([3]);
  });

  it('the status buttons map to what each driver is doing', () => {
    const { panel } = setup();
    click(panel, groupBtn('status', 'working'));
    expect(shown(panel)).toEqual([1]);
    click(panel, groupBtn('status', 'waiting'));
    expect(shown(panel)).toEqual([2]);
    click(panel, groupBtn('status', 'stuck'));
    expect(shown(panel)).toEqual([3]);
    click(panel, groupBtn('status', 'damaged'));
    expect(shown(panel)).toEqual([4]);
  });

  it('an idle vehicle shows under no status choice', () => {
    const { panel } = setup();
    for (const status of ['working', 'waiting', 'stuck', 'damaged']) {
      click(panel, groupBtn('status', status));
      expect(shown(panel)).not.toContain(5);
    }
  });

  it('role, tier and status combine with AND', () => {
    const { panel } = setup();
    click(panel, roleBtn('debris_hauler'));
    expect(shown(panel)).toEqual([1, 3]);
    click(panel, groupBtn('tier', '3'));
    expect(shown(panel)).toEqual([3]);
    click(panel, groupBtn('status', 'working'));
    expect(shown(panel)).toEqual([]);
  });

  it('clicking the pressed choice again removes the filter', () => {
    const { panel } = setup();
    click(panel, groupBtn('tier', '1'));
    click(panel, groupBtn('tier', '1'));
    expect(shown(panel)).toEqual([1, 2, 3, 4, 5]);
  });

  it('the hp sort lists the lowest hp fraction of the tier maximum first', () => {
    const { panel } = setup();
    click(panel, sortBtn('hp'));
    expect(shown(panel)).toEqual([4, 3, 2, 5, 1]);
  });

  it('the tier sort lists the highest tier first, ties by id', () => {
    const { panel } = setup();
    click(panel, sortBtn('tier'));
    expect(shown(panel)).toEqual([3, 2, 5, 1, 4]);
  });

  it('clicking the pressed sort again restores the stored order', () => {
    const { panel } = setup();
    click(panel, sortBtn('tier'));
    click(panel, sortBtn('tier'));
    expect(shown(panel)).toEqual([1, 2, 3, 4, 5]);
  });

  it('a sort orders only the rows the filter keeps', () => {
    const { panel } = setup();
    click(panel, roleBtn('drill_rig'));
    click(panel, sortBtn('hp'));
    expect(shown(panel)).toEqual([4, 2]);
  });

  it('Clear filter resets every choice', () => {
    const { panel } = setup();
    expect(bar(panel).querySelector('.bs-filter-clear')).toBeNull();
    click(panel, roleBtn('drill_rig'));
    click(panel, groupBtn('tier', '2'));
    click(panel, sortBtn('hp'));
    click(panel, '.bs-filter-clear');
    expect(shown(panel)).toEqual([1, 2, 3, 4, 5]);
    expect(bar(panel).querySelector('.bs-filter-clear')).toBeNull();
  });

  it('the pressed buttons show the current choice', () => {
    const { panel } = setup();
    click(panel, roleBtn('rock_digger'));
    click(panel, sortBtn('hp'));
    expect(bar(panel).querySelector(roleBtn('rock_digger'))!.getAttribute('aria-pressed')).toBe('true');
    expect(bar(panel).querySelector(sortBtn('hp'))!.getAttribute('aria-pressed')).toBe('true');
    expect(bar(panel).querySelector(roleBtn('drill_rig'))!.getAttribute('aria-pressed')).toBe('false');
  });

  it('the filter leaves the dealership alone', () => {
    const { panel } = setup();
    const buttons = () => panel.root.querySelectorAll('.bs-fleet-tier-btn').length;
    const before = buttons();
    expect(before).toBeGreaterThan(0);
    click(panel, roleBtn('drill_rig'));
    expect(buttons()).toBe(before);
  });

  it('a filtered row still selects its vehicle through the handler', () => {
    const { panel } = setup();
    const picked: number[] = [];
    panel.setSelectVehicleHandler(id => picked.push(id));
    click(panel, groupBtn('status', 'damaged'));
    (panel.root.querySelector('[data-vehicle-id="4"]') as HTMLElement).click();
    expect(picked).toEqual([4]);
  });

  it('a sorted row still selects its vehicle through the handler', () => {
    const { panel } = setup();
    const picked: number[] = [];
    panel.setSelectVehicleHandler(id => picked.push(id));
    click(panel, sortBtn('tier'));
    (panel.root.querySelector('[data-vehicle-id]') as HTMLElement).click();
    expect(picked).toEqual([3]);
  });

  it('the scene selection highlight follows its row through filtering', () => {
    const { panel } = setup();
    panel.setSelectedVehicle({ kind: 'vehicle', id: 1 });
    click(panel, roleBtn('drill_rig'));
    expect(panel.root.querySelector('[data-vehicle-id="1"]')).toBeNull();
    click(panel, '[data-filter-all]');
    expect(panel.root.querySelector('[data-vehicle-id="1"]')!.classList.contains(SELECTED_ROW_CLASS)).toBe(true);
  });

  it('the filter survives the next update, also when the fleet changes', () => {
    const { panel, state } = setup();
    click(panel, roleBtn('drill_rig'));
    panel.update(state);
    expect(shown(panel)).toEqual([2, 4]);
    state.vehicles.vehicles.push(makeVehicle({ id: 6, type: 'drill_rig', tier: 3 }), makeVehicle({ id: 7, type: 'rock_digger' }));
    panel.update(state);
    expect(shown(panel)).toEqual([2, 4, 6]);
    expect(bar(panel).querySelector(roleBtn('drill_rig'))!.getAttribute('aria-pressed')).toBe('true');
  });

  it('a vehicle whose driver starts working joins the working list on the next update', () => {
    const { panel, state } = setup();
    click(panel, groupBtn('status', 'working'));
    expect(shown(panel)).toEqual([1]);
    state.employees.employees.find(e => e.id === 14)!.taskTicksRemaining = 4;
    panel.update(state);
    expect(shown(panel)).toEqual([1, 5]);
  });

  it('a vehicle that gets unstuck leaves the stuck list on the next update', () => {
    const { panel, state } = setup();
    click(panel, groupBtn('status', 'stuck'));
    expect(shown(panel)).toEqual([3]);
    state.employees.employees.find(e => e.id === 13)!.isMoveStuck = false;
    panel.update(state);
    expect(shown(panel)).toEqual([]);
  });

  it('a vehicle that breaks down joins the damaged list on the next update', () => {
    const { panel, state } = setup();
    click(panel, groupBtn('status', 'damaged'));
    state.vehicles.vehicles.find(v => v.id === 1)!.hp = 0;
    panel.update(state);
    expect(shown(panel)).toEqual([1, 4]);
  });

  it('the hp sort order follows damage on the next update', () => {
    const { panel, state } = setup();
    click(panel, sortBtn('hp'));
    expect(shown(panel)).toEqual([4, 3, 2, 5, 1]);
    state.vehicles.vehicles.find(v => v.id === 1)!.hp = 1;
    panel.update(state);
    expect(shown(panel)).toEqual([4, 1, 3, 2, 5]);
  });

  it('a filter nobody matches shows the no-match line instead of rows', () => {
    const { panel } = setup();
    click(panel, roleBtn('charging_truck'));
    expect(shown(panel)).toEqual([]);
    const empties = [...panel.root.querySelectorAll('.bsx-empty')];
    expect(empties).toHaveLength(1);
    expect(empties[0]!.textContent).toBe(t('ui.fleet.filter_no_match'));
    expect(empties[0]!.textContent).not.toBe('ui.fleet.filter_no_match');
  });

  it('the no-match line goes away when the filter is cleared', () => {
    const { panel } = setup();
    click(panel, roleBtn('charging_truck'));
    click(panel, '.bs-filter-clear');
    expect(panel.root.querySelector('.bsx-empty')).toBeNull();
    expect(shown(panel)).toEqual([1, 2, 3, 4, 5]);
  });

  it('an empty fleet without a filter keeps the no-vehicles line', () => {
    const { panel } = setup({ vehicles: [], crew: [] });
    expect(panel.root.querySelector('.bsx-empty')!.textContent).toBe(t('ui.fleet.none'));
  });

  it('a filter on a fleet that has vehicles never shows the no-vehicles line', () => {
    const { panel } = setup();
    click(panel, roleBtn('charging_truck'));
    expect(panel.root.textContent).not.toContain(t('ui.fleet.none'));
  });

  it('has the no-match line in English and French, worded differently', () => {
    const en = enLocaleJson as Record<string, string>;
    const fr = frLocaleJson as Record<string, string>;
    expect(en['ui.fleet.filter_no_match']).toBeTruthy();
    expect(fr['ui.fleet.filter_no_match']).toBeTruthy();
    expect(fr['ui.fleet.filter_no_match']).not.toBe(en['ui.fleet.filter_no_match']);
  });
});

// ── Traffic banner coordinates as a camera link (#2165) ──

describe('FleetPanel — traffic banner coordinate link (#2165)', () => {
  function jamState(): GameState {
    const ids = [1, 2, 3];
    const vehicles = ids.map(id => makeVehicle({ id, occupantIds: [100 + id] }));
    const drivers = ids.map(id => makeEmployee({
      id: 100 + id,
      x: 8, z: 8,
      vehicleWaitingTicks: 15,
      itinerary: {
        legs: [{ mode: 'drive', vehicleId: id, destX: 8, destZ: 8, arrival: 'exact', onArrive: { kind: 'none' }, estTicks: 5 }],
        goal: { kind: 'reposition', x: 8, z: 8 },
        workTicks: 0,
        estTotalTicks: 5,
      },
    }));
    return makeState(vehicles, drivers);
  }

  function withOpener() {
    const { panel } = makePanel();
    const open = vi.fn();
    const focus = vi.fn();
    panel.setEntityOpener({ open, focus });
    return { panel, open, focus };
  }

  it('the banner coordinates are a focus button carrying the jam x and z', () => {
    const { panel } = withOpener();
    panel.update(jamState());
    const link = panel.root.querySelector<HTMLElement>('.bs-fleet-traffic button[data-focus-x][data-focus-z]');
    expect(link).not.toBeNull();
    expect(link!.dataset['focusX']).toBe('8');
    expect(link!.dataset['focusZ']).toBe('8');
  });

  it('clicking the banner coordinates calls opener.focus with the jam position', () => {
    const { panel, open, focus } = withOpener();
    panel.update(jamState());
    panel.root.querySelector<HTMLElement>('.bs-fleet-traffic button[data-focus-x]')!.click();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalledWith(8, 8);
    expect(open).not.toHaveBeenCalled();
  });

  it('the banner text is unchanged by the link', () => {
    const { panel } = withOpener();
    panel.update(jamState());
    const banner = panel.root.querySelector('.bs-fleet-traffic')!;
    expect(banner.textContent).toContain(t('ui.fleet.traffic_advisory', { count: 3, x: 8, z: 8 }));
  });

  it('the link survives the in-place banner refresh', () => {
    const { panel, focus } = withOpener();
    const calm = jamState();
    for (const e of calm.employees.employees) e.vehicleWaitingTicks = 0;
    panel.update(calm);
    expect(panel.root.querySelector('.bs-fleet-traffic')).toBeNull();
    panel.update(jamState());
    panel.root.querySelector<HTMLElement>('.bs-fleet-traffic button[data-focus-x]')!.click();
    expect(focus).toHaveBeenCalledWith(8, 8);
  });

  it('without an opener the coordinates stay plain text', () => {
    const { panel } = makePanel();
    panel.update(jamState());
    const banner = panel.root.querySelector('.bs-fleet-traffic')!;
    expect(banner.textContent).toContain(t('ui.fleet.traffic_advisory', { count: 3, x: 8, z: 8 }));
    expect(banner.querySelector('button')).toBeNull();
  });
});
