// BlastSimulator2026 — Fleet panel (redesign P6)
// Traffic advisory banner, then one master-list row per vehicle (#1767): icon
// chip, tier name, #id, role, status chip, HP gauge, LOAD gauge (haulers
// only), driver name line, Locate. Upgrade/Reposition/Scrap and the driver
// block live in the vehicle inspector. Haul and Break are self-dispatching
// (#552, #618) — there is no button for either.
// DEALERSHIP below the roster: every role/tier with a real stat-multiplier
// line from VEHICLE_TIER_MULTIPLIERS, dispatching `vehicle buy`.
//
// Root id and the dealership buttons' [data-vtype]/[data-tier] are preserved
// from the old VehiclePanel so tutorialStages.ts, uiActionProbe.ts, and the
// tutorial/scenario defs keep resolving unchanged — same convention
// ContractsPanel.ts already established for #bs-contract-panel in P5.

import { PanelBase } from './PanelBase.js';
import { makeLocateButton, focusCameraOn } from '../locateButton.js';
import { t } from '../../core/i18n/I18n.js';
import { el, card, sectionHeader, panelRoot, panelHeader, panelBody, scrollBoundedSection } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import type { GameState } from '../../core/state/GameState.js';
import type { Vehicle, VehicleRole, VehicleTier } from '../../core/entities/Vehicle.js';
import type { Employee } from '../../core/entities/Employee.js';
import { vehicleTierGate, vehicleTierRefusal, vehicleTierLockLabel } from '../../core/economy/VehicleTierGate.js';
import { getAllVehicleRoles, getVehicleDefByTier, vehicleDriverId, ROLE_LICENCE_REQUIRED } from '../../core/entities/Vehicle.js';
import { countLicenceHolders } from '../../core/entities/VehicleDriverAssignment.js';
import { formatDollars, formatMoney } from '../../core/economy/formatMoney.js';
import { vehicleCardLine, vehicleCardTooltip } from '../catalogCardText.js';
import { findTrafficJams } from '../../core/events/TrafficJams.js';
import { syncRowSelection, selectionChanged, type ListSelection } from '../selectionRoute.js';
import { onRowBodyClick } from '../buildMenuRows.js';
import { vehicleDisplayName, makeStatusChip, makeHpGauge, makeLoadGauge, makeDriverNameLine } from '../fleetDetailSections.js';
import type { GameConsoleFn } from '../gameConsole.js';


/** Per-row pieces that drift between structural renders: render() builds them, refreshDynamic() swaps them in place by class. */
const ROW_PART_CLASS = {
  status: 'bs-fleet-status',
  hp: 'bs-fleet-hp',
  load: 'bs-fleet-load',
  driver: 'bs-fleet-driver',
} as const;

type RowParts = Record<Exclude<keyof typeof ROW_PART_CLASS, 'load'>, HTMLElement> & { load: HTMLElement | null };

/** Dealer grade lock on a tier button: tooltip refusal plus the short badge label. */
interface TierLock { refusal: string; label: string }

function tierLock(grade: number | undefined, tier: VehicleTier): TierLock | null {
  const gate = vehicleTierGate(grade, tier);
  const refusal = vehicleTierRefusal(grade, tier);
  return gate && refusal ? { refusal, label: vehicleTierLockLabel(gate.needed) } : null;
}

const TIER_BTN_BASE_STYLE = 'display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid var(--bsx-hairline);border-radius:5px;background:var(--bsx-card);color:var(--bsx-text-primary);text-align:left';

export class FleetPanel extends PanelBase {
  private readonly bodyEl: HTMLElement;
  private gameConsole?: GameConsoleFn;
  private onSelectVehicleCb?: (vehicleId: number) => void;
  private lastSignature: string | null = null;
  private lastState: GameState | null = null;
  private readonly locale = new LocaleTextRegistry();
  private selection: ListSelection = null;

  constructor(container: HTMLElement) {
    super(panelRoot('bs-vehicle-panel'));

    const { header, titleEl } = panelHeader({
      icon: 'vehicle',
      accent: 'info',
      onClose: () => this.onCloseCb?.(),
    });
    this.locale.bindText(titleEl, 'ui.fleet.title');

    this.bodyEl = panelBody(9);

    this.el.append(header, this.bodyEl);
    container.appendChild(this.el);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  /** Register a callback fired when a vehicle's Fleet panel row is clicked to select it. */
  setSelectVehicleHandler(cb: (vehicleId: number) => void): void { this.onSelectVehicleCb = cb; }

  /** Highlights the row matching the scene selection `sel`; kept across re-renders, not part of the signature. */
  setSelectedVehicle(sel: ListSelection): void {
    const changed = selectionChanged(this.selection, sel);
    this.selection = sel;
    this.applySelection(changed);
  }

  private applySelection(scroll = false): void {
    syncRowSelection(this.bodyEl, this.selection, 'vehicle', 'data-vehicle-id', scroll);
  }

  /** Locate button action: focus the camera on the live vehicle and select it. */
  private locateVehicle(id: number): void {
    const live = this.lastState?.vehicles.vehicles.find(x => x.id === id);
    if (!live) return;
    focusCameraOn(live.x, live.z);
    this.onSelectVehicleCb?.(id);
  }

  update(state: GameState): void {
    this.lastState = state;

    const signature = this.computeSignature(state);
    if (signature === this.lastSignature) {
      this.refreshDynamic(state);
      this.refreshDealershipAffordability(state);
      this.applySelection();
      return;
    }
    this.lastSignature = signature;
    this.render(state);
    this.refreshDealershipAffordability(state);
    this.applySelection();
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = null;
    if (this.lastState) this.update(this.lastState);
  }


  /**
   * Structural facts only: which rows exist and their type/tier. Status, HP,
   * load, driver line and the traffic banner drift on their own —
   * refreshDynamic patches those in place.
   */
  private computeSignature(state: GameState): string {
    return state.vehicles.vehicles.map(v => `${v.id}:${v.type}:${v.tier}`).join('|');
  }

  private refreshDynamic(state: GameState): void {
    this.syncTrafficBanner(state);

    for (const v of state.vehicles.vehicles) {
      const row = this.bodyEl.querySelector<HTMLElement>(`[data-vehicle-id="${v.id}"]`);
      if (!row) continue;
      const parts = this.makeRowParts(v, state);
      for (const key of Object.keys(ROW_PART_CLASS) as Array<keyof RowParts>) {
        const node = parts[key];
        if (node) row.querySelector(`.${ROW_PART_CLASS[key]}`)?.replaceWith(node);
      }
    }
  }

  /** Add, update or remove the jam banner in place; render() puts it first in the body (#1395). */
  private syncTrafficBanner(state: GameState): void {
    const banner = this.makeTrafficBanner(state);
    const existing = this.bodyEl.querySelector('.bs-fleet-traffic');
    if (!banner) existing?.remove();
    else if (existing) existing.replaceWith(this.tag(banner, 'bs-fleet-traffic'));
    else this.bodyEl.prepend(this.tag(banner, 'bs-fleet-traffic'));
  }

  /** The employee in `v`'s driver seat, for the occupant-derived status line (#1092) — undefined when nobody is aboard. */
  private occupantOf(v: Vehicle, state: GameState): Employee | undefined {
    const driverId = vehicleDriverId(v);
    return driverId === null ? undefined : state.employees.employees.find(e => e.id === driverId);
  }

  /** The drifting pieces of `v`'s row, each carrying its ROW_PART_CLASS; load is null for roles that never carry a payload. */
  private makeRowParts(v: Vehicle, state: GameState): RowParts {
    const parts: RowParts = {
      status: makeStatusChip(v, state.vehicles, this.occupantOf(v, state)),
      hp: makeHpGauge(v),
      load: makeLoadGauge(v),
      driver: makeDriverNameLine(v, state.employees.employees),
    };
    for (const key of Object.keys(parts) as Array<keyof RowParts>) parts[key]?.classList.add(ROW_PART_CLASS[key]);
    return parts;
  }

  private tag(elToTag: HTMLElement, className: string): HTMLElement {
    elToTag.classList.add(className);
    return elToTag;
  }

  private makeTrafficBanner(state: GameState): HTMLElement | null {
    // Unsilenced on purpose: the banner shows a jam forming even after the player answered the event.
    const jams = findTrafficJams(state.builtRamps, state.employees.employees);
    if (jams.length === 0) return null;
    const worst = jams.reduce((a, b) => (b.agentIds.length > a.agentIds.length ? b : a));
    const banner = el('div', { attrs: { style: 'display:flex;gap:8px;padding:9px 11px;border-radius:5px;background:rgba(255,176,46,.08);border:1px solid rgba(255,176,46,.26)' } });
    banner.append(
      el('div', { attrs: { style: 'color:var(--bsx-amber)' }, children: [iconEl('warn', 14)] }),
      el('span', {
        text: t('ui.fleet.traffic_advisory', { count: worst.agentIds.length, x: Math.floor(worst.x), z: Math.floor(worst.z) }),
        attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary);flex:1' },
      }),
    );
    return banner;
  }

  private render(state: GameState): void {
    const { vehicles } = state.vehicles;
    const children: HTMLElement[] = [];
    const banner = this.makeTrafficBanner(state);
    if (banner) children.push(this.tag(banner, 'bs-fleet-traffic'));

    const vehicleCards = vehicles.length === 0
      ? [el('div', { className: 'bsx-empty', text: t('ui.fleet.none') })]
      : vehicles.map(v => this.makeVehicleCard(v, state));
    children.push(scrollBoundedSection(vehicleCards, 200, { gap: 9 }));
    children.push(sectionHeader(t('ui.fleet.dealership')), ...this.makeDealershipRows(state));
    this.bodyEl.replaceChildren(...children);
  }

  // ── Dealership ──

  private makeDealershipRows(state: GameState): HTMLElement[] {
    return getAllVehicleRoles().map(role => {
      const group = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:5px' } });
      group.appendChild(el('span', { text: t(`vehicle_type.${role}`), attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.1em;color:var(--bsx-text-secondary)' } }));
      const tiers: VehicleTier[] = [1, 2, 3];
      for (const tier of tiers) group.appendChild(this.makeTierButton(role, tier, state));
      return group;
    });
  }

  private makeTierButton(role: VehicleRole, tier: VehicleTier, state: GameState): HTMLElement {
    const cash = state.cash;
    const def = getVehicleDefByTier(role, tier);
    const btn = el('button', {
      className: 'bs-fleet-tier-btn',
      attrs: { style: TIER_BTN_BASE_STYLE, 'data-role': role, 'data-tier': String(tier), 'data-vtype': role },
    });
    const info = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0' } });
    info.append(
      el('span', { text: t(getVehicleDefByTier(role, tier).nameKey), attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
      el('span', {
        text: vehicleCardLine(def),
        className: 'bs-fleet-tier-desc',
        attrs: { style: 'font-size:10px;color:var(--bsx-text-micro)' },
      }),
      el('span', {
        text: this.licenceLineText(role, tier, countLicenceHolders(state.employees.employees, role, tier)),
        className: 'bs-fleet-tier-licence',
        attrs: { style: 'font-size:10px;color:var(--bsx-text-micro)' },
      }),
    );
    btn.dataset['stats'] = vehicleCardTooltip(def);
    const cost = el('span', { text: formatDollars(def.purchaseCost), className: 'bsx-mono', attrs: { style: 'font-size:11px;font-weight:600;color:var(--bsx-amber)' } });
    btn.append(info, cost);
    this.applyTierButtonState(btn, cash >= def.purchaseCost, def.purchaseCost, tierLock(state.grade?.grade, tier));
    btn.addEventListener('click', () => this.gameConsole?.(`vehicle buy ${role} tier:${tier}`));
    return btn;
  }

  /** `lock` (dealer grade lock) wins over affordability: a locked, affordable tier still shows locked. */
  private applyTierButtonState(btn: HTMLButtonElement, affordable: boolean, purchaseCost: number, lock: TierLock | null): void {
    const usable = affordable && lock === null;
    btn.disabled = !usable;
    const stats = btn.dataset['stats'] ?? '';
    if (lock) btn.title = `${stats}\n${lock.refusal}`;
    else btn.title = affordable ? stats : `${stats}\n${t('ui.fleet.tip.cannot_afford', { cost: formatMoney(purchaseCost) })}`;
    if (lock) btn.dataset['locked'] = 'grade'; else delete btn.dataset['locked'];
    // Rewrite the whole attribute: mutating btn.style piecemeal can drop the var() colour in some CSSOM implementations.
    btn.setAttribute('style', `${TIER_BTN_BASE_STYLE};opacity:${usable ? '1' : '.45'};cursor:${usable ? 'pointer' : 'not-allowed'}`);
    this.syncTierLockBadge(btn, lock);
  }

  /** Adds, updates or removes the "Needs <grade>" badge on a dealership tier button. */
  private syncTierLockBadge(btn: HTMLButtonElement, lock: TierLock | null): void {
    let badge = btn.querySelector<HTMLElement>('.bs-fleet-tier-lock');
    if (!lock) { badge?.remove(); return; }
    if (!badge) {
      badge = el('span', { className: 'bs-fleet-tier-lock', attrs: { style: 'font-size:10px;font-weight:600;color:var(--bsx-amber)' } });
      btn.querySelector('div')?.appendChild(badge);
    }
    badge.textContent = lock.label;
  }

  /** "Licence <name> level N — M hold it" for a dealership tier row. */
  private licenceLineText(role: VehicleRole, tier: VehicleTier, holders: number): string {
    return t('ui.fleet.licence_line', { licence: t(`skill.${ROLE_LICENCE_REQUIRED[role]}`), level: tier, count: holders });
  }

  private refreshDealershipAffordability(state: GameState): void {
    const cash = state.cash;
    const employees = state.employees.employees;
    this.bodyEl.querySelectorAll<HTMLButtonElement>('.bs-fleet-tier-btn').forEach(btn => {
      const role = btn.dataset['role'] as VehicleRole;
      const tier = Number(btn.dataset['tier']) as VehicleTier;
      const def = getVehicleDefByTier(role, tier);
      this.applyTierButtonState(btn, cash >= def.purchaseCost, def.purchaseCost, tierLock(state.grade?.grade, tier));
      const line = btn.querySelector<HTMLElement>('.bs-fleet-tier-licence');
      if (line) line.textContent = this.licenceLineText(role, tier, countLicenceHolders(employees, role, tier));
    });
  }

  private makeVehicleCard(v: Vehicle, state: GameState): HTMLElement {
    const head = el('div', { attrs: { style: 'display:flex;align-items:flex-start;gap:9px' } });
    const iconChip = el('div', { attrs: { style: 'width:26px;height:26px;border-radius:4px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06);color:var(--bsx-info)' }, children: [iconEl('vehicle', 14)] });
    const nameCol = el('div', { attrs: { style: 'display:flex;flex-direction:column;gap:3px;flex:1;min-width:0' } });
    nameCol.append(
      el('div', { attrs: { style: 'display:flex;align-items:baseline;gap:6px' }, children: [
        el('span', { text: vehicleDisplayName(v.type, v.tier), attrs: { style: 'font:600 12px/1 var(--bsx-font-ui);color:var(--bsx-text-primary)' } }),
        el('span', { text: `#${v.id}`, className: 'bsx-mono', attrs: { style: 'font-size:10px;color:var(--bsx-text-micro)' } }),
      ] }),
      el('span', { text: t(`vehicle_type.${v.type}`), attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' } }),
    );
    const locateBtn = makeLocateButton({ title: t('ui.fleet.locate'), onClick: () => this.locateVehicle(v.id) });
    const parts = this.makeRowParts(v, state);
    head.append(iconChip, nameCol, parts.status, locateBtn);

    const rows: HTMLElement[] = [head, parts.hp];
    if (parts.load) rows.push(parts.load);
    rows.push(parts.driver);

    const wrap = card(rows);
    wrap.dataset['vehicleId'] = String(v.id);
    // Mirrors the dealership buy buttons' own [data-vtype] so a tutorial stage
    // can scope its target to a vehicle TYPE (tutorialStages.ts, #557).
    wrap.dataset['vtype'] = v.type;
    wrap.style.cursor = 'pointer';
    onRowBodyClick(wrap, () => this.onSelectVehicleCb?.(v.id));
    return wrap;
  }
}
