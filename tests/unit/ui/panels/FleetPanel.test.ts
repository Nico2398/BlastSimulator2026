// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
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
import { SELECTED_ROW_CLASS } from '../../../../src/ui/selectionRoute.js';

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

    it('vehicle cards keep DOM identity across jam appear and disappear', () => {
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

  // guard, and the sibling "nested interactive control" test above (scrap
  // button) already covers the same click-propagation contract.

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

// ── Scroll-bounded vehicle list section (#958) ──────────────────────────────
//
// bodyEl (this.el.append(header, this.bodyEl) in the constructor) is always
// the panel root's second child. Vehicle cards (one per fleet vehicle,
// unbounded) are rendered directly into bodyEl today, followed by the
// DEALERSHIP sectionHeader and its fixed role × tier catalog rows — a large
// fleet buries the dealership far below the panel's fold. The fix nests
// every vehicle card inside one scrollBoundedSection wrapper standing before
// the DEALERSHIP section header, leaving the dealership unwrapped, a
// reachable bodyEl-level sibling.

function getBodyEl(panel: FleetPanel): HTMLElement {
  return panel.root.children[1] as HTMLElement;
}

/** Every direct child of `bodyEl` before the section header whose text contains `label`. */
function childrenBeforeSection(bodyEl: HTMLElement, label: string): HTMLElement[] {
  const children = Array.from(bodyEl.children) as HTMLElement[];
  const idx = children.findIndex(c => c.classList.contains('bsx-section') && (c.textContent ?? '').includes(label));
  if (idx === -1) throw new Error(`section header not found for label: ${label}`);
  return children.slice(0, idx);
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
    expect(row.querySelector('svg')).not.toBeNull();
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
    panel.update(makeState([makeVehicle({ id: 2, type: 'drill_rig' })], []));
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
    const state = makeState([vehicle], []);
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

describe('FleetPanel — scroll-bounded vehicle list section (#958)', () => {
  it('nests all 12 vehicle cards inside a single bounded wrapper, not flattened directly into bodyEl', () => {
    const { panel } = makePanel();
    panel.update(makeState(makeManyVehicles(12)));

    const bodyEl = getBodyEl(panel);
    const preDealership = childrenBeforeSection(bodyEl, t('ui.fleet.dealership'));

    expect(preDealership.length).toBe(1);
    const wrapper = preDealership[0]!;
    expect(wrapper.querySelectorAll('[data-vehicle-id]').length).toBe(12);
  });

  it('gives the vehicle wrapper inline overflow-y:auto and a numeric max-height (not vh/%)', () => {
    const { panel } = makePanel();
    panel.update(makeState(makeManyVehicles(12)));

    const bodyEl = getBodyEl(panel);
    const wrapper = childrenBeforeSection(bodyEl, t('ui.fleet.dealership'))[0]!;

    expect(wrapper.style.overflowY).toBe('auto');
    expect(wrapper.style.maxHeight).toMatch(/^\d+px$/);
  });

  it('keeps the DEALERSHIP section reachable as a bodyEl-level sibling, outside the vehicle wrapper', () => {
    const { panel } = makePanel();
    panel.update(makeState(makeManyVehicles(12)));

    const bodyEl = getBodyEl(panel);
    const children = Array.from(bodyEl.children) as HTMLElement[];
    const dealershipIdx = children.findIndex(c => c.classList.contains('bsx-section') && (c.textContent ?? '').includes(t('ui.fleet.dealership')));
    expect(dealershipIdx).toBeGreaterThan(-1);

    const vehicleWrapper = children[0]!;
    expect(vehicleWrapper.contains(children[dealershipIdx]!)).toBe(false);
    // 6 roles × 3 tiers of dealership buttons still resolve, unwrapped.
    expect(bodyEl.querySelectorAll('.bs-fleet-tier-btn').length).toBe(6 * 3);
  });

  it('keeps bodyEl itself scrollable (overflow-y:auto unchanged) regardless of fleet size', () => {
    const { panel: emptyPanel } = makePanel();
    emptyPanel.update(makeState([]));
    const emptyBodyEl = getBodyEl(emptyPanel);

    const { panel: fullPanel } = makePanel();
    fullPanel.update(makeState(makeManyVehicles(12)));
    const fullBodyEl = getBodyEl(fullPanel);

    for (const bodyEl of [emptyBodyEl, fullBodyEl]) {
      expect(bodyEl.style.overflowY).toBe('auto');
    }
  });
});
