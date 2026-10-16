// @vitest-environment jsdom
// Vehicle inspector content (#1761): condition, job, cargo, driver, specs, cost, actions.
import { describe, it, expect, vi } from 'vitest';
import { vehicleContent } from '../../../../../src/ui/panels/inspector/vehicleContent.js';
import type { ActionSpec, InspectorLinks, InspectorView } from '../../../../../src/ui/panels/inspector/InspectorContent.js';
import { createGame } from '../../../../../src/core/state/GameState.js';
import type { GameState, PendingAction } from '../../../../../src/core/state/GameState.js';
import type { Vehicle } from '../../../../../src/core/entities/Vehicle.js';
import { getVehicleDefByTier } from '../../../../../src/core/entities/Vehicle.js';
import type { Employee } from '../../../../../src/core/entities/Employee.js';
import type { Building } from '../../../../../src/core/entities/Building.js';
import type { FragmentData } from '../../../../../src/core/mining/BlastExecution.js';
import { oreContributionKg } from '../../../../../src/core/mining/BlastOreReport.js';
import { computeVehicleUpgradeCost } from '../../../../../src/core/entities/VehicleUpgrade.js';
import { repairPartsCost } from '../../../../../src/core/entities/VehicleRepair.js';
import { formatMoney } from '../../../../../src/core/economy/formatMoney.js';
import type { ConfirmModalConfig } from '../../../../../src/ui/panels/ConfirmModal.js';
import { t, setLocale } from '../../../../../src/core/i18n/I18n.js';

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return { id: 1, type: 'debris_hauler', tier: 1, x: 5, z: 5, hp: 100, cargo: [], occupantIds: [], ...overrides };
}

function makeEmployee(overrides: Partial<Employee> = {}): Employee {
  return {
    id: 6, name: 'Dorian Kask', role: 'driver', salary: 400, morale: 60,
    unionized: false, injured: false, alive: true, x: 0, z: 0,
    qualifications: [{ category: 'driving.truck', proficiencyLevel: 1, xp: 0, licenceLevel: 3 }],
    trainingState: null, activeActionId: null, fatigue: 100, collapsing: false,
    interruptedActionPayload: null, ticksWorked: 0, restTicksRemaining: null, restNeedKey: null,
    taskTicksRemaining: null, activeTaskSkill: null, destinationX: null, destinationZ: null,
    moveConsecutiveFailures: 0, isMoveStuck: false, pendingRestDuration: null, pendingRestNeedKey: null,
    pendingTaskDuration: null, pendingActionType: null, pendingActionPayload: null,
    pendingDriverVehicleId: null, taskQueue: [], locomotion: { kind: 'on_foot' }, itinerary: null,
    vehicleWaitingTicks: 0,
    ...overrides,
  } as Employee;
}

function frag(id: number, mass: number, oreDensities: Record<string, number>): FragmentData {
  return {
    id, position: { x: 0, y: 0, z: 0 }, volume: mass / 2500, mass, rockId: 'sandite', oreDensities,
    initialVelocity: { x: 0, y: 0, z: 0 }, isProjection: false, halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: id, origin: { x: 0, y: 0, z: 0 },
  };
}

function makeState(vehicle: Vehicle | null, employees: Employee[] = [], cash = 9_999_999): GameState {
  setLocale('en');
  const s = createGame({ seed: 42, mineType: 'desert' });
  s.cash = cash;
  s.vehicles.vehicles = vehicle ? [vehicle] : [];
  s.employees.employees = employees;
  return s;
}

function makeLinks() {
  const select = vi.fn();
  const run = vi.fn();
  const confirm = vi.fn<[ConfirmModalConfig], void>();
  // `navigate` (open a panel by id, 'crew' for the Train button) is the optional InspectorLinks
  // member the implementer adds in #1761; cast so this file compiles before it exists.
  const navigate = vi.fn<[string], void>();
  const links = { select, run, confirm, navigate } as InspectorLinks;
  return { links, select, run, confirm, navigate };
}

function viewOf(s: GameState, links: InspectorLinks = makeLinks().links, id = 1): InspectorView {
  return vehicleContent.view({ kind: 'vehicle', id }, s, links)!;
}

function mount(view: InspectorView): HTMLElement {
  const root = document.createElement('div');
  root.append(...view.sections);
  document.body.append(root);
  return root;
}

function actionOf(view: InspectorView, name: ActionSpec['action']): ActionSpec | undefined {
  return view.actions.find(a => a.action === name);
}

function haulOrder(s: GameState, vehicleId: number, fragmentId: number): void {
  const a: PendingAction = {
    id: 10, type: 'haul_debris', requiredSkill: null, requiredVehicleRole: 'debris_hauler',
    targetX: 20, targetZ: 20, targetY: 0, payload: { fragmentId }, targetEmployeeId: null,
    status: 'in_progress', holderId: 6, queuedAtTick: 0,
  };
  s.pendingActions.push(a);
  s.vehicles.reservations.push({ vehicleId, actionId: a.id });
}

function haulerOnTheRoad(): { s: GameState; v: Vehicle } {
  const v = makeVehicle({ occupantIds: [6], cargo: [{ fragmentId: 5, massKg: 1000 }, { fragmentId: 6, massKg: 600 }] });
  const driver = makeEmployee({
    id: 6, locomotion: { kind: 'mounted', vehicleId: 1 } as Employee['locomotion'],
    itinerary: {
      legs: [{ mode: 'drive', vehicleId: 1, destX: 60, destZ: 4, arrival: 'exact', onArrive: { kind: 'alight' }, estTicks: 20 }],
      goal: { kind: 'work', actionId: 10 }, workTicks: 0, estTotalTicks: 20,
    },
  });
  const s = makeState(v, [driver]);
  const wh: Building = { id: 7, type: 'freight_warehouse', tier: 1, x: 60, z: 4, hp: 100, active: true, occupantIds: [] };
  s.buildings.buildings = [wh];
  s.logistics.fragments = [
    { fragment: frag(5, 1000, { goldite: 0.2 }), state: 'in_transit', vehicleId: '1', warehouseId: 7 },
    { fragment: frag(6, 600, { goldite: 0.1, dirtite: 0.1 }), state: 'in_transit', vehicleId: '1', warehouseId: 7 },
  ];
  haulOrder(s, 1, 5);
  return { s, v };
}

describe('vehicle inspector — view', () => {
  it('returns null for a missing vehicle', () => {
    expect(vehicleContent.view({ kind: 'vehicle', id: 99 }, makeState(makeVehicle()), makeLinks().links)).toBeNull();
  });

  it('titles with the vehicle type and tier', () => {
    const view = viewOf(makeState(makeVehicle({ tier: 2 })));
    expect(view.title).toBe(t('vehicle_type.debris_hauler'));
    expect(view.sub).toContain('#1');
  });

  it('status chip text follows the derived status', () => {
    expect(viewOf(makeState(makeVehicle({ hp: 0 }))).status).toBe(t('ui.fleet.status_broken'));
    expect(viewOf(makeState(makeVehicle())).status).toBe(t('ui.fleet.status_idle'));
  });
});

describe('vehicle inspector — sections per vehicle type', () => {
  it('a hauler has condition, job, cargo, driver, specs and cost sections', () => {
    const root = mount(viewOf(makeState(makeVehicle())));
    for (const cls of ['.bs-vehicle-condition', '.bs-vehicle-job', '.bs-vehicle-cargo', '.bs-vehicle-driver', '.bs-vehicle-specs', '.bs-vehicle-cost']) {
      expect(root.querySelector(cls), cls).not.toBeNull();
    }
  });

  it.each(['drill_rig', 'rock_digger', 'rock_fragmenter', 'charging_truck', 'building_destroyer'] as const)('%s has no cargo section', (type) => {
    const root = mount(viewOf(makeState(makeVehicle({ type }))));
    expect(root.querySelector('.bs-vehicle-cargo')).toBeNull();
    expect(root.querySelector('.bs-vehicle-job')).not.toBeNull();
    expect(root.querySelector('.bs-vehicle-driver')).not.toBeNull();
  });
});

describe('vehicle inspector — condition', () => {
  it('shows current and max HP', () => {
    const root = mount(viewOf(makeState(makeVehicle({ hp: 60 }))));
    const text = root.querySelector('.bs-vehicle-condition')!.textContent!;
    expect(text).toContain('60');
    expect(text).toContain(String(getVehicleDefByTier('debris_hauler', 1).maxHp));
  });

  it('a full-HP vehicle has no repair line', () => {
    expect(mount(viewOf(makeState(makeVehicle({ hp: 100 })))).querySelector('.bs-vehicle-repair')).toBeNull();
  });

  it('a damaged vehicle shows missing HP and the parts cost', () => {
    const root = mount(viewOf(makeState(makeVehicle({ hp: 60 }))));
    const line = root.querySelector('.bs-vehicle-repair')!;
    expect(line).not.toBeNull();
    expect(line.textContent).toContain('40');
    expect(line.textContent).toContain(formatMoney(repairPartsCost(40)));
  });

  it('a vehicle under repair says so differently from a merely damaged one', () => {
    const damaged = makeState(makeVehicle({ hp: 60 }));
    const repairing = makeState(makeVehicle({ hp: 60 }));
    repairing.pendingActions.push({
      id: 3, type: 'repair_vehicle', requiredSkill: null, requiredVehicleRole: null,
      targetX: 5, targetZ: 5, targetY: 0, payload: { vehicleId: 1 }, targetEmployeeId: null,
      status: 'in_progress', holderId: 6, queuedAtTick: 0,
    });
    const a = mount(viewOf(damaged)).querySelector('.bs-vehicle-repair')!.textContent;
    const b = mount(viewOf(repairing)).querySelector('.bs-vehicle-repair')!.textContent;
    expect(b).not.toBe(a);
  });
});

describe('vehicle inspector — job', () => {
  it('an idle vehicle shows its idle status in the job section without links', () => {
    const job = mount(viewOf(makeState(makeVehicle()))).querySelector('.bs-vehicle-job')!;
    expect(job.querySelector('[data-select-kind]')).toBeNull();
  });

  it('a loaded hauler links its destination warehouse and selecting it calls links.select', () => {
    const { s } = haulerOnTheRoad();
    const { links, select } = makeLinks();
    const root = mount(viewOf(s, links));
    const link = root.querySelector<HTMLElement>('.bs-vehicle-job [data-select-kind="building"][data-select-id="7"]');
    expect(link).not.toBeNull();
    link!.click();
    expect(select).toHaveBeenCalledWith('building', 7);
  });

  it('an empty hauler links the fragment it is heading for', () => {
    const { s, v } = haulerOnTheRoad();
    v.cargo = [];
    const root = mount(viewOf(s));
    expect(root.querySelector('.bs-vehicle-job [data-select-kind="fragment"][data-select-id="5"]')).not.toBeNull();
    expect(root.querySelector('.bs-vehicle-job [data-select-kind="building"]')).toBeNull();
  });

  it('the ETA counts down live as the hauler drives closer', () => {
    const { s, v } = haulerOnTheRoad();
    const view = viewOf(s);
    const root = mount(view);
    const eta = () => root.querySelector('.bs-vehicle-job [data-live="eta"]')!.textContent;
    v.x = 0; v.z = 0;
    view.sync(root);
    const far = eta();
    v.x = 55; v.z = 4;
    view.sync(root);
    expect(eta()).not.toBe(far);
  });

  it('a blocked haul order names why the hauler is not working', () => {
    const v = makeVehicle();
    const s = makeState(v, [makeEmployee({ qualifications: [] })]);
    s.pendingActions.push({
      id: 11, type: 'haul_debris', requiredSkill: null, requiredVehicleRole: 'debris_hauler',
      targetX: 1, targetZ: 1, targetY: 0, payload: { fragmentId: 5 }, targetEmployeeId: null,
      status: 'queued', holderId: null, queuedAtTick: 0, blockedReason: 'no_licensed_driver',
    });
    const plain = mount(viewOf(makeState(makeVehicle(), [makeEmployee({ qualifications: [] })]))).querySelector('.bs-vehicle-job')!.textContent;
    expect(mount(viewOf(s)).querySelector('.bs-vehicle-job')!.textContent).not.toBe(plain);
  });
});

describe('vehicle inspector — cargo', () => {
  it('shows a load gauge, kg per ore, barren and fragment count', () => {
    const { s } = haulerOnTheRoad();
    const cargo = mount(viewOf(s)).querySelector('.bs-vehicle-cargo')!;
    expect(cargo.textContent).toContain('1600');
    const gold = cargo.querySelector('[data-cargo-ore="goldite"]')!;
    const goldKg = oreContributionKg(1000 / 2500, 0.2) + oreContributionKg(600 / 2500, 0.1);
    expect(gold.textContent).toContain(String(Math.round(goldKg)));
    expect(cargo.querySelector('[data-cargo-ore="dirtite"]')).not.toBeNull();
    expect(cargo.querySelector('[data-cargo-barren]')).not.toBeNull();
    expect(cargo.textContent).toContain('2');
  });

  it('an empty hauler shows no ore rows', () => {
    const cargo = mount(viewOf(makeState(makeVehicle()))).querySelector('.bs-vehicle-cargo')!;
    expect(cargo.querySelector('[data-cargo-ore]')).toBeNull();
    expect(cargo.textContent).toContain('0');
  });

  it('cargo ids with no tracked fragment do not break the section', () => {
    const v = makeVehicle({ cargo: [{ fragmentId: 404, massKg: 300 }] });
    expect(() => mount(viewOf(makeState(v)))).not.toThrow();
  });

  it('cargo follows the load live', () => {
    const { s, v } = haulerOnTheRoad();
    const view = viewOf(s);
    const root = mount(view);
    v.cargo = [];
    view.sync(root);
    expect(root.querySelector('.bs-vehicle-cargo [data-cargo-ore]')).toBeNull();
  });
});

describe('vehicle inspector — driver', () => {
  it('links the driver name; selecting calls links.select employee', () => {
    const { s } = haulerOnTheRoad();
    const { links, select } = makeLinks();
    const root = mount(viewOf(s, links));
    const link = Array.from(root.querySelectorAll<HTMLElement>('.bs-vehicle-driver [data-select-kind="employee"]'))
      .find(l => l.textContent === 'Dorian Kask');
    expect(link).toBeDefined();
    link!.click();
    expect(select).toHaveBeenCalledWith('employee', 6);
  });

  it('a pending driver is walking to board, with the employee as a link', () => {
    const v = makeVehicle();
    const walker = makeEmployee({ id: 8, name: 'Pip Walker', pendingDriverVehicleId: 1 });
    const root = mount(viewOf(makeState(v, [walker])));
    const driver = root.querySelector('.bs-vehicle-driver')!;
    expect(driver.textContent).toContain(t('ui.fleet.walking_to_board', { name: 'Pip Walker' }).replace('Pip Walker', ''));
    expect(driver.querySelector('[data-select-kind="employee"][data-select-id="8"]')).not.toBeNull();
  });

  it('unmanned: licensed roster, nobody aboard, no employee link', () => {
    const root = mount(viewOf(makeState(makeVehicle(), [makeEmployee()])));
    const driver = root.querySelector('.bs-vehicle-driver')!;
    expect(driver.textContent).toContain(t('ui.fleet.unmanned'));
    expect(driver.querySelector('[data-select-kind="employee"]')).toBeNull();
  });

  it('no licensed driver: says so and the Train button navigates to crew', () => {
    const { links, navigate, run, select } = makeLinks();
    const root = mount(viewOf(makeState(makeVehicle(), [makeEmployee({ qualifications: [] })]), links));
    const driver = root.querySelector('.bs-vehicle-driver')!;
    expect(driver.textContent).toContain(t('ui.fleet.no_licensed', { licence: t('skill.driving.truck') }));
    const train = Array.from(driver.querySelectorAll('button')).find(b => b.textContent === t('ui.fleet.train_someone'));
    expect(train).toBeDefined();
    train!.click();
    expect(navigate).toHaveBeenCalledWith('crew');
    expect(run).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });
});

describe('vehicle inspector — specs and running cost', () => {
  it('shows speed, capacity and work rate of the tier', () => {
    const def = getVehicleDefByTier('debris_hauler', 2);
    const specs = mount(viewOf(makeState(makeVehicle({ tier: 2 })))).querySelector('.bs-vehicle-specs')!.textContent!;
    expect(specs).toContain(String(Math.round(def.speed * 10) / 10));
    expect(specs).toContain(Math.round(def.capacity).toLocaleString('en-US'));
    expect(specs).toContain(String(Math.round(def.workRate * 10) / 10));
  });

  it('idle running cost is the maintenance per hour', () => {
    const def = getVehicleDefByTier('debris_hauler', 1);
    const cost = mount(viewOf(makeState(makeVehicle()))).querySelector('.bs-vehicle-cost')!.textContent!;
    expect(cost).toContain(String(def.maintenanceCostPerTick));
  });

  it('a working vehicle also shows the fuel cost per hour', () => {
    const def = getVehicleDefByTier('debris_hauler', 1);
    const { s } = haulerOnTheRoad();
    const cost = mount(viewOf(s)).querySelector('.bs-vehicle-cost')!.textContent!;
    expect(cost).toContain(String(def.fuelCostPerTick));
  });
});

describe('vehicle inspector — actions', () => {
  it('offers move_here, upgrade_vehicle and scrap_vehicle', () => {
    const view = viewOf(makeState(makeVehicle()));
    expect(view.actions.map(a => a.action)).toEqual(expect.arrayContaining(['move_here', 'upgrade_vehicle', 'scrap_vehicle']));
  });

  it('scrap is a danger action and is enabled', () => {
    const scrap = actionOf(viewOf(makeState(makeVehicle())), 'scrap_vehicle')!;
    expect(scrap.variant).toBe('danger');
    expect(scrap.disabled).toBeFalsy();
  });

  it('upgrade is enabled with enough cash and names the cost', () => {
    const up = actionOf(viewOf(makeState(makeVehicle())), 'upgrade_vehicle')!;
    expect(up.disabled).toBeFalsy();
    const cost = computeVehicleUpgradeCost('debris_hauler', 1)!;
    expect(`${up.label ?? ''} ${up.title ?? ''}`).toContain(formatMoney(cost));
  });

  it('upgrade is disabled with the cannot-afford reason when cash is short', () => {
    const cost = computeVehicleUpgradeCost('debris_hauler', 1)!;
    const up = actionOf(viewOf(makeState(makeVehicle(), [], cost - 1)), 'upgrade_vehicle')!;
    expect(up.disabled).toBe(true);
    expect(up.title).toBe(t('ui.fleet.tip.cannot_afford_upgrade', { cost: formatMoney(cost) }));
  });

  it('upgrade is disabled at the maximum tier with the max-tier reason', () => {
    const up = actionOf(viewOf(makeState(makeVehicle({ tier: 3 }))), 'upgrade_vehicle')!;
    expect(up.disabled).toBe(true);
    expect(up.title).toBe(t('ui.fleet.upgrade_max'));
  });

  it('warns when nobody on the roster can drive the next tier', () => {
    const view = viewOf(makeState(makeVehicle(), [makeEmployee({ qualifications: [{ category: 'driving.truck', proficiencyLevel: 1, xp: 0, licenceLevel: 1 }] })]));
    const up = actionOf(view, 'upgrade_vehicle')!;
    const text = `${mount(view).textContent} ${up.title ?? ''}`;
    expect(text).toContain(t('ui.fleet.upgrade_licence_warning'));
  });

  it('no licence warning when a driver can drive the next tier', () => {
    const view = viewOf(makeState(makeVehicle(), [makeEmployee()]));
    const up = actionOf(view, 'upgrade_vehicle')!;
    expect(`${mount(view).textContent} ${up.title ?? ''}`).not.toContain(t('ui.fleet.upgrade_licence_warning'));
  });
});

describe('vehicle inspector — live refresh', () => {
  it('sync updates HP in place without replacing the section node', () => {
    const v = makeVehicle({ hp: 100 });
    const s = makeState(v);
    const view = viewOf(s);
    const root = mount(view);
    const node = root.querySelector('.bs-vehicle-condition');
    v.hp = 55;
    view.sync(root);
    expect(root.querySelector('.bs-vehicle-condition')!.textContent).toContain('55');
    expect(root.querySelector('.bs-vehicle-condition')).toBe(node);
  });

  it('an unchanged frame leaves the DOM untouched', () => {
    const { s } = haulerOnTheRoad();
    const view = viewOf(s);
    const root = mount(view);
    const html = root.innerHTML;
    view.sync(root);
    view.sync(root);
    expect(root.innerHTML).toBe(html);
  });

  it('the status chip text refreshes', () => {
    const v = makeVehicle();
    const s = makeState(v);
    const view = viewOf(s);
    const root = mount(view);
    v.hp = 0;
    view.sync(root);
    expect(root.textContent).toContain(t('ui.fleet.status_broken'));
  });

  it('the driver section refreshes when a driver boards', () => {
    const v = makeVehicle();
    const e = makeEmployee();
    const s = makeState(v, [e]);
    const view = viewOf(s);
    const root = mount(view);
    expect(root.querySelector('.bs-vehicle-driver [data-select-kind="employee"]')).toBeNull();
    v.occupantIds = [6];
    view.sync(root);
    expect(root.querySelector('.bs-vehicle-driver [data-select-kind="employee"][data-select-id="6"]')).not.toBeNull();
  });
});

describe('vehicle inspector — signature', () => {
  it('changes with tier', () => {
    expect(viewOf(makeState(makeVehicle({ tier: 1 }))).signature).not.toBe(viewOf(makeState(makeVehicle({ tier: 2 }))).signature);
  });

  it('changes with vehicle type', () => {
    expect(viewOf(makeState(makeVehicle({ type: 'drill_rig' }))).signature).not.toBe(viewOf(makeState(makeVehicle())).signature);
  });

  it('is stable across HP and cargo changes that sync handles in place', () => {
    const v = makeVehicle();
    const s = makeState(v);
    const before = viewOf(s).signature;
    v.hp = 30;
    expect(viewOf(s).signature).toBe(before);
  });
});
