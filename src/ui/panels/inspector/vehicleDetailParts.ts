// BlastSimulator2026 — vehicle driver / upgrade / scrap / repair pieces of the
// vehicle inspector (moved from fleetDetailSections.ts, #1767).

import { t } from '../../../core/i18n/I18n.js';
import { el, button } from '../../dom.js';
import { iconEl } from '../../icons.js';
import type { Vehicle } from '../../../core/entities/Vehicle.js';
import { ROLE_LICENCE_REQUIRED, vehicleDriverId, computeScrapResidualValue } from '../../../core/entities/Vehicle.js';
import type { GameState, PendingAction } from '../../../core/state/GameState.js';
import type { Employee } from '../../../core/entities/Employee.js';
import type { ConfirmModalConfig } from '../ConfirmModal.js';
import { vehicleTierRefusal } from '../../../core/economy/VehicleTierGate.js';
import { rosterCanDriveVehicleTier, canAffordVehicleUpgrade, computeVehicleUpgradeCost, nextVehicleTier } from '../../../core/entities/VehicleUpgrade.js';
import { missingHp } from '../../../core/entities/VehicleRepair.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { vehicleDisplayName, vehicleDriverState } from '../../fleetDetailSections.js';

/** Shared shell for the drive-icon + single-line-label rows below: driver, pending driver, unmanned. */
function makeDriveIconRow(label: string, color: string, link?: { name: string; onClick: () => void; id: number }): HTMLElement {
  const wrap = el('div', { attrs: { style: 'display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:4px;background:var(--bsx-well)' } });
  const text = el('span', { attrs: { style: `font:500 10px/1 var(--bsx-font-ui);color:${color}` } });
  const at = link ? label.indexOf(link.name) : -1;
  if (link && at >= 0) {
    const btn = el('button', { text: link.name, attrs: { style: 'border:0;background:transparent;padding:0;color:var(--bsx-info);cursor:pointer;text-decoration:underline;font:inherit' } });
    btn.dataset['selectKind'] = 'employee';
    btn.dataset['selectId'] = String(link.id);
    btn.addEventListener('click', link.onClick);
    text.append(label.slice(0, at), btn, label.slice(at + link.name.length));
  } else {
    text.textContent = label;
  }
  wrap.append(iconEl('drive', 12, 0.6), text);
  return wrap;
}

/**
 * Driver row when a vehicle already has one. Player-facing driver assignment
 * is gone (#921) — a vehicle's driver is now claimed automatically by
 * ArrivalGate/VehicleReservation, so there is no unassign control here
 * anymore.
 */
export function makeDriverRow(v: Vehicle, state: GameState, link?: (employeeId: number) => void): HTMLElement {
  const driverId = vehicleDriverId(v);
  const driver = state.employees.employees.find(e => e.id === driverId);
  const name = driver?.name ?? `#${driverId}`;
  return makeDriveIconRow(name, 'var(--bsx-text-secondary)', link && driverId !== null ? { name, id: driverId, onClick: () => link(driverId) } : undefined);
}

/**
 * A driver already walking to board this vehicle, not yet arrived —
 * a vehicle's driver seat stays empty the whole walk (nobody is aboard until
 * the board arrival step), so without this the card would fall through to `makeNoDriverRow`
 * and, pre-#715, silently re-offer the same employee as if nobody had
 * claimed the vehicle yet. No unassign control: cancelling an in-progress
 * walk has no console command today, only display.
 */
export function makePendingDriverRow(employee: Employee, link?: (employeeId: number) => void): HTMLElement {
  return makeDriveIconRow(t('ui.fleet.walking_to_board', { name: employee.name }), 'var(--bsx-text-micro)',
    link ? { name: employee.name, id: employee.id, onClick: () => link(employee.id) } : undefined);
}

/**
 * No driver yet: replaces the old eligible-crew picker (#921) — a vehicle's
 * driver is now claimed automatically by a qualified employee's own queued
 * task (VehicleReservation/ArrivalGate), so there is nothing left for the
 * player to click here. Two display-only sub-states:
 *  - nobody on the roster holds the required licence at all: warning +
 *    cross-link to Crew (`onGoToCrew`);
 *  - somebody is licensed but nobody is currently driving/walking to this
 *    vehicle: a neutral "unmanned" label.
 * The check is roster-wide licence ownership, not claim state — there is no
 * picker left to keep honest, unlike the old canBoardVehicle-based filter.
 */
export function makeNoDriverRow(v: Vehicle, state: GameState, onGoToCrew: () => void): HTMLElement {
  const licence = ROLE_LICENCE_REQUIRED[v.type];
  const anyLicensed = rosterCanDriveVehicleTier(state.employees.employees, v.type, v.tier);

  if (!anyLicensed) {
    const warn = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:5px;padding:9px;border-radius:4px;background:var(--bsx-well)' } });
    const line = el('div', { attrs: { style: 'display:flex;gap:6px;align-items:center;color:var(--bsx-amber)' } });
    line.append(iconEl('warn', 11), el('span', { text: t('ui.fleet.no_licensed', { licence: t(`skill.${licence}`), level: v.tier }), attrs: { style: 'font:500 10px/1.3 var(--bsx-font-ui)' } }));
    const trainBtn = button('ghost', t('ui.fleet.train_someone'));
    trainBtn.style.cssText = 'height:26px;font-size:10px';
    trainBtn.addEventListener('click', onGoToCrew);
    warn.append(line, trainBtn);
    return warn;
  }

  return makeDriveIconRow(t('ui.fleet.unmanned'), 'var(--bsx-text-micro)');
}

/** Whether a vehicle upgrade is available and affordable (#1761). */
interface UpgradeState {
  available: boolean;
  affordable: boolean;
  cost: number | null;
  /** Dealer refusal text when the next tier is above the mine grade; null when allowed. */
  locked?: string;
}

/** Next-tier upgrade availability and price; the single source for the Inspector. */
export function upgradeState(v: Pick<Vehicle, 'type' | 'tier'>, cash: number, grade?: number): UpgradeState {
  const cost = computeVehicleUpgradeCost(v.type, v.tier);
  const next = nextVehicleTier(v.tier);
  const available = next !== null && cost !== null;
  const refusal = next === null ? null : vehicleTierRefusal(grade, next);
  return {
    available, affordable: available && canAffordVehicleUpgrade(v, cash), cost: available ? cost : null,
    ...(refusal ? { locked: refusal } : {}),
  };
}

/** Why the upgrade control is disabled (max tier, or cost beyond cash); null when it can be used. Single source for the Inspector. */
export function upgradeDisabledReason({ available, affordable, cost, locked }: UpgradeState): string | null {
  if (!available || cost === null) return t('ui.fleet.upgrade_max');
  if (locked !== undefined) return locked;
  return affordable ? null : t('ui.fleet.tip.cannot_afford_upgrade', { cost: formatMoney(cost) });
}

/** Licence warning key + params, null when a licensed driver exists. */
interface LicenceWarning {
  key: string;
  params: Record<string, string | number>;
}

/** Warning when nobody on the roster can drive the next tier; null at max tier or when someone can. */
export function licenceWarning(v: Pick<Vehicle, 'type' | 'tier'>, employees: readonly Employee[]): LicenceWarning | null {
  const next = nextVehicleTier(v.tier);
  if (next === null || rosterCanDriveVehicleTier(employees, v.type, next)) return null;
  return { key: 'ui.fleet.upgrade_licence_warning', params: {} };
}

/** Confirm-modal config for scrapping a vehicle; `run` receives the console command. */
export function scrapConfirmConfig(v: Vehicle, run: (command: string) => void): ConfirmModalConfig {
  const residual = computeScrapResidualValue(v.type, v.tier, v.hp);
  return {
    icon: 'trash',
    title: t('ui.fleet.scrap_confirm_title'),
    body: t('ui.fleet.scrap_confirm_body', { name: vehicleDisplayName(v.type, v.tier), amount: formatMoney(residual) }),
    confirmLabel: t('ui.fleet.scrap'),
    onConfirm: () => run(`vehicle scrap ${v.id}`),
  };
}

/** Repair progress for a vehicle: the queued/active repair action, if any. */
interface RepairState {
  action: PendingAction | null;
  needsRepair: boolean;
}

export function repairState(v: Vehicle, actions: readonly PendingAction[]): RepairState {
  const action = actions.find(a => a.type === 'repair_vehicle' && a.payload['vehicleId'] === v.id) ?? null;
  return { action, needsRepair: missingHp(v) > 0 };
}


/** How the shared driver block differs between its hosts: employee links (Inspector) and the Train button's target. */
interface DriverBlockOptions {
  /** Makes the driver / pending-driver name a link that selects the employee. */
  select?: (employeeId: number) => void;
  onGoToCrew: () => void;
}

/**
 * The driver rows every vehicle view shows: driver, walking-to-board or no-driver row, plus the
 * next-tier licence warning line (omitted when the no-driver row already warns).
 */
export function makeDriverBlock(v: Vehicle, state: GameState, { select, onGoToCrew }: DriverBlockOptions): HTMLElement[] {
  // The driver seat stays empty for a driver's whole walk to the vehicle (only the board arrival
  // step fills it), so a pending claim needs its own row — falling through to makeNoDriverRow
  // would re-offer the vehicle as driverless even though someone's already en route to it (#715).
  const driver = vehicleDriverState(v, state.employees.employees);
  const rows: HTMLElement[] = [
    driver.kind === 'driver' ? makeDriverRow(v, state, select)
      : driver.kind === 'pending' ? makePendingDriverRow(driver.employee, select)
        : makeNoDriverRow(v, state, onGoToCrew),
  ];
  const warning = driver.kind === 'no_licensed' ? null : licenceWarning(v, state.employees.employees);
  if (warning) {
    rows.push(el('div', {
      text: t(warning.key, warning.params),
      className: 'bs-fleet-upgrade-warning',
      attrs: { style: 'font:400 10px/1.3 var(--bsx-font-ui);color:var(--bsx-amber)' },
    }));
  }
  return rows;
}
