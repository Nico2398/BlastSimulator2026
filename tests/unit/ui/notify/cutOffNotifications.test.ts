// @vitest-environment jsdom
// BlastSimulator2026 — Unit tests: the cut-off alert (#2095)
//
// The game no longer fetches back what a blast cut off, so the notification centre says what is cut off:
// one toast per vehicle or employee when it is first cut off, one pip naming all of them while it lasts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const stranded = vi.hoisted(() => ({ vehicleIds: [] as number[], employeeIds: [] as number[], real: false }));
vi.mock('../../../../src/core/engine/StrandedCrew.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/core/engine/StrandedCrew.js')>('../../../../src/core/engine/StrandedCrew.js');
  return {
    findStrandedCrew: (state: Parameters<typeof actual.findStrandedCrew>[0]) =>
      stranded.real ? actual.findStrandedCrew(state) : { vehicleIds: [...stranded.vehicleIds], employeeIds: [...stranded.employeeIds] },
  };
});

import { NotificationCenter } from '../../../../src/ui/notify/NotificationCenter.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { hireEmployee } from '../../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../../src/core/entities/Vehicle.js';
import { Random } from '../../../../src/core/math/Random.js';
import { t, setLocale } from '../../../../src/core/i18n/I18n.js';
import { vehicleDisplayName } from '../../../../src/ui/fleetDetailSections.js';
import { wireCrewNotifications } from '../../../../src/ui/notify/crewNotifications.js';
import { EventEmitter } from '../../../../src/core/state/EventEmitter.js';
import { NavGrid, type NavCell } from '../../../../src/core/nav/NavGrid.js';

function setup() {
  setLocale('en');
  const state = createGame({ seed: 1, mineType: 'desert' });
  const { employee } = hireEmployee(state.employees, 'driver', new Random(1), 2, 2);
  const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 5, 5);
  return { state, employee, vehicle, center: new NotificationCenter() };
}

const cutOffPip = (pips: ReturnType<NotificationCenter['update']>) =>
  pips.find(p => p.label === t('notification.pip.cut_off_label', { count: 2 }) || p.label === t('notification.pip.cut_off_label', { count: 1 }));

beforeEach(() => { stranded.vehicleIds = []; stranded.employeeIds = []; stranded.real = false; });

describe('cut-off alert (#2095)', () => {
  it('shows nothing while nothing is cut off', () => {
    const { state, center } = setup();
    expect(cutOffPip(center.update(state))).toBeUndefined();
    expect(center.getLog()).toEqual([]);
  });

  it('toasts each cut-off vehicle and employee once, by name, and keeps one pip naming both', () => {
    const { state, employee, vehicle, center } = setup();
    stranded.vehicleIds = [vehicle.id];
    stranded.employeeIds = [employee.id];
    const vehicleName = t('notification.cut_off_vehicle_name', { vehicle: vehicleDisplayName(vehicle.type, vehicle.tier), id: vehicle.id });

    const pip = cutOffPip(center.update(state));
    expect(pip?.label).toBe(t('notification.pip.cut_off_label', { count: 2 }));
    expect(pip?.tip).toBe(t('notification.pip.cut_off_tip', { names: `${vehicleName}, ${employee.name}` }));
    expect(center.getLog().map(e => e.body).sort()).toEqual([
      t('notification.cut_off_employee', { name: employee.name }),
      t('notification.cut_off_vehicle', { name: vehicleName }),
    ].sort());

    state.tickCount++;
    center.update(state);
    expect(center.getLog()).toHaveLength(2);
  });

  it('toasts again once a vehicle that was reached is cut off a second time', () => {
    const { state, vehicle, center } = setup();
    stranded.vehicleIds = [vehicle.id];
    center.update(state);
    stranded.vehicleIds = [];
    state.tickCount++;
    expect(cutOffPip(center.update(state))).toBeUndefined();
    stranded.vehicleIds = [vehicle.id];
    state.tickCount++;
    center.update(state);
    expect(center.getLog()).toHaveLength(2);
  });

  it('reads the crew once per tick, not once per frame', () => {
    const { state, vehicle, center } = setup();
    center.update(state);
    stranded.vehicleIds = [vehicle.id];
    expect(cutOffPip(center.update(state))).toBeUndefined();
    state.tickCount++;
    expect(cutOffPip(center.update(state))).toBeDefined();
  });
});

describe('cut-off notifications name their entity (#2169)', () => {
  it('the cut-off employee toast carries an employee ref', () => {
    const { state, employee, center } = setup();
    stranded.employeeIds = [employee.id];
    center.update(state);
    expect(center.getLog()).toHaveLength(1);
    expect(center.getLog()[0]!.ref).toEqual({ kind: 'employee', id: employee.id });
    expect(center.getToasts()[0]!.ref).toEqual({ kind: 'employee', id: employee.id });
  });

  it('the cut-off vehicle toast carries a vehicle ref', () => {
    const { state, vehicle, center } = setup();
    stranded.vehicleIds = [vehicle.id];
    center.update(state);
    expect(center.getLog()).toHaveLength(1);
    expect(center.getLog()[0]!.ref).toEqual({ kind: 'vehicle', id: vehicle.id });
  });

  it('each of two cut-off entities gets its own ref', () => {
    const { state, employee, vehicle, center } = setup();
    stranded.vehicleIds = [vehicle.id];
    stranded.employeeIds = [employee.id];
    center.update(state);
    const refs = center.getLog().map(e => e.ref).sort((a, b) => a!.kind.localeCompare(b!.kind));
    expect(refs).toEqual([{ kind: 'employee', id: employee.id }, { kind: 'vehicle', id: vehicle.id }]);
  });
});

describe('a walker crossing the crew plateau is not reported cut off (#2228)', () => {
  const WIDTH = 24;
  const HEIGHT = 12;
  const WALL_X = 10;

  /** Real StrandedCrew over an open floor, or two halves split by a wall at x = WALL_X. */
  function realSetup(wall: boolean) {
    stranded.real = true;
    setLocale('en');
    const state = createGame({ seed: 1, mineType: 'desert' });
    const cells: NavCell[][] = [];
    for (let z = 0; z < HEIGHT; z++) {
      const row: NavCell[] = [];
      for (let x = 0; x < WIDTH; x++) {
        const blocked = wall && x === WALL_X;
        row.push({ type: blocked ? 'blocked' : 'walkable', moveCost: blocked ? Infinity : 1.0, benchLevel: 0, vehicleOccupied: false });
      }
      cells.push(row);
    }
    state.navGrid = new NavGrid(WIDTH, HEIGHT, cells);
    const hire = (x: number, z: number) => hireEmployee(state.employees, 'driver', new Random(state.employees.nextId), x, z).employee;
    const center = new NotificationCenter();
    wireCrewNotifications(new EventEmitter(), () => state, n => center.notify(n));
    return { state, hire, center };
  }

  const cutOffBodies = (center: NotificationCenter, names: string[]) =>
    center.getLog().filter(e => names.some(n => e.body === t('notification.cut_off_employee', { name: n })));

  it('raises no cut-off toast or pip while an employee walks several cells on the plateau', () => {
    const { state, hire, center } = realSetup(false);
    const first = hire(3, 5);
    const second = hire(4, 6);
    const walker = hire(5, 5);
    for (let step = 0; step <= 40; step++) {
      walker.x = 5 + step * 0.1;
      walker.z = 5 + (step % 2) * 0.3;
      state.tickCount++;
      const pips = center.update(state);
      expect(cutOffPip(pips), `at x=${walker.x}`).toBeUndefined();
    }
    expect(cutOffBodies(center, [first.name, second.name, walker.name])).toEqual([]);
  });

  it('still toasts the employee who is walled off, so the alert is not simply silenced', () => {
    const { state, hire, center } = realSetup(true);
    hire(3, 5);
    hire(4, 5);
    const alone = hire(16.3, 5.7);
    state.tickCount++;
    const pips = center.update(state);
    expect(cutOffBodies(center, [alone.name])).toHaveLength(1);
    expect(cutOffPip(pips)).toBeDefined();
  });
});
