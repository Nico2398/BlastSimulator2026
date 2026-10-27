// @vitest-environment jsdom
// BlastSimulator2026 — Unit tests: the cut-off alert (#2095)
//
// The game no longer fetches back what a blast cut off, so the notification centre says what is cut off:
// one toast per vehicle or employee when it is first cut off, one pip naming all of them while it lasts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const stranded = vi.hoisted(() => ({ vehicleIds: [] as number[], employeeIds: [] as number[] }));
vi.mock('../../../../src/core/engine/StrandedCrew.js', () => ({
  findStrandedCrew: () => ({ vehicleIds: [...stranded.vehicleIds], employeeIds: [...stranded.employeeIds] }),
}));

import { NotificationCenter } from '../../../../src/ui/notify/NotificationCenter.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { hireEmployee } from '../../../../src/core/entities/Employee.js';
import { purchaseVehicle } from '../../../../src/core/entities/Vehicle.js';
import { Random } from '../../../../src/core/math/Random.js';
import { t, setLocale } from '../../../../src/core/i18n/I18n.js';
import { vehicleDisplayName } from '../../../../src/ui/fleetDetailSections.js';

function setup() {
  setLocale('en');
  const state = createGame({ seed: 1, mineType: 'desert' });
  const { employee } = hireEmployee(state.employees, 'driver', new Random(1), 2, 2);
  const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 5, 5);
  return { state, employee, vehicle, center: new NotificationCenter() };
}

const cutOffPip = (pips: ReturnType<NotificationCenter['update']>) =>
  pips.find(p => p.label === t('notification.pip.cut_off_label', { count: 2 }) || p.label === t('notification.pip.cut_off_label', { count: 1 }));

beforeEach(() => { stranded.vehicleIds = []; stranded.employeeIds = []; });

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
