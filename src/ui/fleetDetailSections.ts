// BlastSimulator2026 — Fleet panel card-piece builders (redesign P6)
// Status chip, HP/load gauges, and the driver row/no-driver warning shown on
// every fleet card. Split out of FleetPanel.ts to keep both files under the
// file-size guideline, mirroring the CrewPanel/crewDetailSections split.

import { t } from '../core/i18n/I18n.js';
import { el, chip, gauge, type ChipTone } from './dom.js';
import { iconEl } from './icons.js';
import type { Vehicle, VehicleTier } from '../core/entities/Vehicle.js';
import { getVehicleDefByTier } from '../core/entities/Vehicle.js';
import type { GameState } from '../core/state/GameState.js';
import type { Employee } from '../core/entities/Employee.js';
import { computeVehicleStatus, type VehicleStatus } from '../core/entities/VehicleStatus.js';

export function vehicleDisplayName(type: Vehicle['type'], tier: VehicleTier): string {
  return t(getVehicleDefByTier(type, tier).nameKey);
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

export function makeStatusChip(v: Vehicle): HTMLElement {
  const status = computeVehicleStatus(v);
  return chip(describeStatus(status), STATUS_TONE[status.kind]);
}

export function makeHpGauge(v: Vehicle): HTMLElement {
  const maxHp = getVehicleDefByTier(v.type, v.tier).maxHp;
  const pct = maxHp > 0 ? Math.round((v.hp / maxHp) * 100) : 0;
  const color = pct > 50 ? 'var(--bsx-positive)' : pct > 20 ? 'var(--bsx-amber)' : 'var(--bsx-critical)';
  return gauge(t('ui.fleet.hp'), pct, color, { labelWidth: 30 });
}

/** Only debris_hauler ever carries a payload — every other role's payloadKg sits at 0 forever, so the gauge is omitted rather than shown always-empty. */
export function makeLoadGauge(v: Vehicle): HTMLElement | null {
  if (v.type !== 'debris_hauler') return null;
  const capacity = getVehicleDefByTier(v.type, v.tier).capacity;
  const pct = capacity > 0 ? Math.round((v.payloadKg / capacity) * 100) : 0;
  const row = gauge(t('ui.fleet.load'), pct, 'var(--bsx-info)', { labelWidth: 30 });
  const value = row.querySelector('.bsx-gauge-value');
  if (value) value.textContent = t('ui.fleet.load_kg', { kg: Math.round(v.payloadKg), cap: Math.round(capacity) });
  return row;
}

/**
 * Driver row when a vehicle already has one. Player-facing driver assignment
 * is gone (#921) — a vehicle's driver is now claimed automatically by
 * ArrivalGate/VehicleReservation, so there is no unassign control here
 * anymore.
 * TODO(#921): drop the unassign-button remnants once implementer lands.
 */
export function makeDriverRow(v: Vehicle, state: GameState): HTMLElement {
  const wrap = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:4px;background:var(--bsx-well)' } });
  const driver = state.employees.employees.find(e => e.id === v.driverId);
  wrap.append(
    iconEl('drive', 12, 0.6),
    el('span', { text: driver?.name ?? `#${v.driverId}`, attrs: { style: 'font:500 10px/1 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } }),
  );
  return wrap;
}

/**
 * A driver already walking to board this vehicle, not yet arrived —
 * `v.driverId` stays null the whole walk (ArrivalGate.ts only sets it on
 * arrival), so without this the card would fall through to `makeNoDriverRow`
 * and, pre-#715, silently re-offer the same employee as if nobody had
 * claimed the vehicle yet. No unassign control: cancelling an in-progress
 * walk has no console command today, only display.
 */
export function makePendingDriverRow(employee: Employee): HTMLElement {
  const wrap = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:4px;background:var(--bsx-well)' } });
  wrap.append(
    iconEl('drive', 12, 0.6),
    el('span', { text: t('ui.fleet.walking_to_board', { name: employee.name }), attrs: { style: 'font:500 10px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' } }),
  );
  return wrap;
}

/**
 * No driver yet: replaces the old eligible-crew picker (#921) — a vehicle's
 * driver is now claimed automatically by a qualified employee's own queued
 * task (VehicleReservation/ArrivalGate), so there is nothing left for the
 * player to click here. `onGoToCrew` is kept on the signature for the
 * nobody-licensed case (cross-link to Crew), wired up by implementer.
 * TODO(#921): render the unmanned/no-licensed-crew states (ui.fleet.unmanned,
 * ui.fleet.no_licensed) instead of this placeholder.
 */
export function makeNoDriverRow(v: Vehicle, state: GameState, onGoToCrew: () => void): HTMLElement {
  void v;
  void state;
  void onGoToCrew;
  return el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:4px;background:var(--bsx-well)' } });
}
