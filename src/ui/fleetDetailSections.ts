// BlastSimulator2026 — Fleet row piece builders (redesign P6)
// Status chip, HP/load gauges and the driver name line shown on every Fleet
// row. The full driver block lives in inspector/vehicleDetailParts.ts.

import { t } from '../core/i18n/I18n.js';
import { el, chip, gauge, type ChipTone } from './dom.js';
import type { Vehicle, VehicleTier, VehicleState } from '../core/entities/Vehicle.js';
import { ROLE_LICENCE_REQUIRED, getVehicleDefByTier, vehicleCargoMassKg, vehicleDriverId } from '../core/entities/Vehicle.js';
import { getBuildingDef, type BuildingType, type BuildingTier } from '../core/entities/Building.js';
import type { Employee } from '../core/entities/Employee.js';
import { rosterCanDriveVehicleTier } from '../core/entities/VehicleUpgrade.js';
import { computeVehicleStatus, type VehicleStatus } from '../core/entities/VehicleStatus.js';

export function vehicleDisplayName(type: Vehicle['type'], tier: VehicleTier): string {
  return t(getVehicleDefByTier(type, tier).nameKey);
}

/** "<type name> (<joke name>)", the vehicle-kit convention: a joke name alone does not say what the building is. */
export function buildingDisplayName(type: BuildingType, tier: BuildingTier): string {
  return `${t(`building.${type}.name`)} (${t(getBuildingDef(type, tier).nameKey)})`;
}

const STATUS_TONE: Record<VehicleStatus['kind'], ChipTone> = {
  broken: 'critical',
  stuck: 'critical',
  waiting: 'warn',
  hauling: 'info',
  working: 'info',
  moving: 'neutral',
  idle: 'neutral',
};

const WORKING_TASK_KEY: Partial<Record<string, string>> = {
  drilling: 'ui.fleet.task_drilling',
  loading: 'ui.fleet.task_loading',
  clearing: 'ui.fleet.task_clearing',
  transport: 'ui.fleet.task_transport',
};

/** Player-facing status label, ticks-suffixed for stuck/waiting. */
export function describeStatus(status: VehicleStatus): string {
  const base = (() => {
    switch (status.kind) {
      case 'broken': return t('ui.fleet.status_broken');
      case 'stuck': return t('ui.fleet.status_stuck');
      case 'waiting': return t('ui.fleet.status_waiting');
      case 'hauling': return status.haulingPhase === 'to_depot' ? t('ui.fleet.status_hauling_to_depot') : t('ui.fleet.status_hauling_to_fragment');
      case 'working': return t(status.task && WORKING_TASK_KEY[status.task] ? WORKING_TASK_KEY[status.task]! : 'ui.fleet.task_working');
      case 'moving': return t('ui.fleet.status_moving');
      case 'idle': return t('ui.fleet.status_idle');
    }
  })();
  return status.ticks !== null ? t('ui.fleet.status_with_ticks', { status: base, n: status.ticks }) : base;
}

/**
 * `occupant`, when the caller has resolved it, makes working/moving read off
 * the driver's own activity rather than the vehicle's display fields
 * (#1092). `vehicleState` threads through to computeVehicleStatus's own
 * reservation lookup (#1138 — the hauling branch's getVehicleReservation
 * call).
 */
export function makeStatusChip(v: Vehicle, vehicleState: VehicleState, occupant?: Employee): HTMLElement {
  const status = computeVehicleStatus(v, vehicleState, occupant);
  return chip(describeStatus(status), STATUS_TONE[status.kind]);
}

export function makeHpGauge(v: Vehicle): HTMLElement {
  const maxHp = getVehicleDefByTier(v.type, v.tier).maxHp;
  const pct = maxHp > 0 ? Math.round((v.hp / maxHp) * 100) : 0;
  const color = pct > 50 ? 'var(--bsx-positive)' : pct > 20 ? 'var(--bsx-amber)' : 'var(--bsx-critical)';
  const row = gauge(t('ui.fleet.hp'), pct, color, { labelWidth: 30 });
  const value = row.querySelector('.bsx-gauge-value');
  if (value) value.textContent = `${pct}%`;
  return row;
}

/** Only debris_hauler ever carries a payload — every other role's massKg sits at 0 forever, so the gauge is omitted rather than shown always-empty. */
export function makeLoadGauge(v: Vehicle): HTMLElement | null {
  if (v.type !== 'debris_hauler') return null;
  const capacity = getVehicleDefByTier(v.type, v.tier).capacity;
  const massKg = vehicleCargoMassKg(v);
  // Clamped (#1092): a lone over-capacity fragment rides alone (#1370) and
  // would otherwise draw a gauge past its own track.
  const pct = capacity > 0 ? Math.min(100, Math.round((massKg / capacity) * 100)) : 0;
  const row = gauge(t('ui.fleet.load'), pct, 'var(--bsx-info)', { labelWidth: 30 });
  const value = row.querySelector('.bsx-gauge-value');
  if (value) value.textContent = t('ui.fleet.load_kg', { kg: Math.round(massKg), cap: Math.round(capacity) });
  return row;
}

type DriverState =
  | { kind: 'driver'; employee: Employee }
  | { kind: 'pending'; employee: Employee }
  | { kind: 'unmanned' }
  | { kind: 'no_licensed' };

/** Who drives a vehicle: its driver, an employee walking to board, nobody (unmanned), or nobody able to. */
export function vehicleDriverState(v: Vehicle, employees: readonly Employee[]): DriverState {
  const driverId = vehicleDriverId(v);
  if (driverId !== null) {
    const employee = employees.find(e => e.id === driverId);
    if (employee) return { kind: 'driver', employee };
  }
  const pending = employees.find(e => e.pendingDriverVehicleId === v.id);
  if (driverId === null && pending) return { kind: 'pending', employee: pending };
  return rosterCanDriveVehicleTier(employees, v.type, v.tier) ? { kind: 'unmanned' } : { kind: 'no_licensed' };
}

/** Driver line content: text plus colour token. */
function driverLineContent(v: Vehicle, employees: readonly Employee[]): { text: string; color: string } {
  const driver = vehicleDriverState(v, employees);
  const seatedId = vehicleDriverId(v);
  switch (driver.kind) {
    case 'driver':
      return { text: driver.employee.name, color: 'var(--bsx-text-secondary)' };
    case 'pending':
      return { text: t('ui.fleet.walking_to_board', { name: driver.employee.name }), color: 'var(--bsx-text-micro)' };
    case 'unmanned':
    case 'no_licensed':
      if (seatedId !== null) return { text: `#${seatedId}`, color: 'var(--bsx-text-micro)' }; // seated but off the roster
      if (driver.kind === 'unmanned') return { text: t('ui.fleet.unmanned'), color: 'var(--bsx-text-micro)' };
      return {
        text: t('ui.fleet.row_no_licensed', { licence: t(`skill.${ROLE_LICENCE_REQUIRED[v.type]}`), level: v.tier }),
        color: 'var(--bsx-amber)',
      };
  }
}

/**
 * Driver name line for a Fleet row: driver, pending driver, muted "Unmanned", or an amber
 * "no licensed driver" hint when nobody on the roster could drive it. No Train button.
 */
export function makeDriverNameLine(v: Vehicle, employees: readonly Employee[]): HTMLElement {
  const { text, color: muted } = driverLineContent(v, employees);
  return el('div', { text, className: 'bs-fleet-driver', attrs: { style: `font:500 10px/1.2 var(--bsx-font-ui);color:${muted}` } });
}
