// BlastSimulator2026 — Fleet panel card-piece builders (redesign P6)
// Status chip, HP/load gauges, and the driver row/no-driver warning shown on
// every fleet card. Split out of FleetPanel.ts to keep both files under the
// file-size guideline, mirroring the CrewPanel/crewDetailSections split.

import { t } from '../core/i18n/I18n.js';
import { el, chip, gauge, button, type ChipTone } from './dom.js';
import { iconEl } from './icons.js';
import type { Vehicle, VehicleTier } from '../core/entities/Vehicle.js';
import { getVehicleDefByTier, ROLE_LICENCE_REQUIRED } from '../core/entities/Vehicle.js';
import type { GameState } from '../core/state/GameState.js';
import type { Employee } from '../core/entities/Employee.js';
import { computeVehicleStatus, type VehicleStatus } from '../core/entities/VehicleStatus.js';
import { canBoardVehicle } from '../core/entities/VehicleBoarding.js';

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
 * Driver row when a vehicle already has one — no assignment control while
 * occupied, matching CrewPanel's own toggle-not-both convention. UNASSIGN
 * refuses mid-haul at the core layer (unassignDriver), so it is left
 * enabled here and lets the console command's own rejection message surface
 * rather than duplicating that rule in the UI.
 */
export function makeDriverRow(v: Vehicle, state: GameState, onUnassign: () => void): HTMLElement {
  const wrap = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:4px;background:var(--bsx-well)' } });
  const driver = state.employees.employees.find(e => e.id === v.driverId);
  wrap.append(
    iconEl('drive', 12, 0.6),
    el('span', { text: driver?.name ?? `#${v.driverId}`, attrs: { style: 'font:500 10px/1 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } }),
  );
  const unassignBtn = el('button', { text: t('ui.fleet.unassign'), attrs: { style: 'margin-left:auto;padding:0;border:0;background:transparent;color:var(--bsx-text-micro);font:600 10px/1 var(--bsx-font-ui);letter-spacing:.1em;cursor:pointer' } });
  unassignBtn.addEventListener('click', onUnassign);
  wrap.appendChild(unassignBtn);
  return wrap;
}

/**
 * A driver already walking to board this vehicle, not yet arrived —
 * `v.driverId` stays null the whole walk (ArrivalGate.ts only sets it on
 * arrival), so without this the card would fall through to `makeAssignRow`
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

/** No driver: an eligible-crew picker, or a warning + cross-link to Crew when nobody on the roster holds the licence. */
export function makeAssignRow(v: Vehicle, state: GameState, onAssign: (employeeId: number) => void, onGoToCrew: () => void): HTMLElement {
  const licence = ROLE_LICENCE_REQUIRED[v.type];
  // canBoardVehicle is the single source of truth requestBoardVehicle itself
  // enforces — not a hand-rolled driverId-only "taken" set: an employee
  // already walking to board a different vehicle has pendingDriverVehicleId
  // set, but vehicle.driverId stays null for the whole walk (ArrivalGate.ts
  // only sets it on arrival), so the old driverId-only filter kept offering
  // them here. Clicking Assign for them then silently failed
  // canBoardVehicle's own already-walking check inside requestBoardVehicle,
  // with no feedback in the UI (#715).
  const eligible = state.employees.employees.filter(e => canBoardVehicle(state, v.id, e.id).success);

  if (eligible.length === 0) {
    const warn = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:5px;padding:9px;border-radius:4px;background:var(--bsx-well)' } });
    const line = el('div', { attrs: { style: 'display:flex;gap:6px;align-items:center;color:var(--bsx-amber)' } });
    line.append(iconEl('warn', 11), el('span', { text: t('ui.fleet.no_licensed', { licence: t(`skill.${licence}`) }), attrs: { style: 'font:500 10px/1.3 var(--bsx-font-ui)' } }));
    const trainBtn = button('ghost', t('ui.fleet.train_someone'));
    trainBtn.style.cssText = 'height:26px;font-size:10px';
    trainBtn.addEventListener('click', onGoToCrew);
    warn.append(line, trainBtn);
    return warn;
  }

  const wrap = el('div', { attrs: { style: 'display:flex;align-items:center;gap:6px' } });
  const select = el('select', { attrs: { style: 'flex:1;height:28px;border-radius:4px;background:var(--bsx-well);color:var(--bsx-text-secondary);border:1px solid var(--bsx-hairline-strong);font-size:10px' } }) as HTMLSelectElement;
  for (const e of eligible) select.appendChild(el('option', { text: e.name, attrs: { value: String(e.id) } }));
  const assignBtn = button('primary', t('ui.fleet.assign'));
  assignBtn.classList.add('bs-vehicle-assign-btn');
  assignBtn.style.cssText = 'height:28px;padding:0 10px';
  assignBtn.addEventListener('click', () => onAssign(Number(select.value)));
  wrap.append(select, assignBtn);
  return wrap;
}
