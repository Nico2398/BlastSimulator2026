// BlastSimulator2026 — Vehicle Management Panel (10.5)
// Lists vehicles with status/HP; buy and scrap controls.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { Vehicle, VehicleRole, VehicleTier } from '../core/entities/Vehicle.js';
import { getAllVehicleRoles, getVehicleDefByTier, ROLE_LICENCE_REQUIRED } from '../core/entities/Vehicle.js';

const VEHICLE_TIERS: VehicleTier[] = [1, 2, 3];

import type { CommandResult } from '../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

export class VehiclePanel {
  private readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly buySection: HTMLElement;
  private gameConsole?: GameConsoleFn;
  /** Fingerprint of the last rendered fleet — guards against per-frame rebuilds. */
  private lastSignature = '';

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-vehicle-panel';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    title.textContent = t('ui.vehicles.title');

    this.listEl = document.createElement('div');

    const buyHeader = document.createElement('div');
    buyHeader.className = 'bs-section-header';
    buyHeader.style.marginTop = '8px';
    buyHeader.textContent = t('ui.vehicles.buy');

    this.buySection = document.createElement('div');
    this.buildBuySection();

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bs-btn';
    closeBtn.style.cssText = 'width:100%;margin-top:6px';
    closeBtn.textContent = t('ui.vehicles.close');
    closeBtn.addEventListener('click', () => this.hide());

    this.el.append(title, this.listEl, buyHeader, this.buySection, closeBtn);
    container.appendChild(this.el);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  show(): void { this.el.style.display = ''; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  update(state: GameState): void {
    const { vehicles } = state.vehicles;

    // Rebuilt only when the fleet changes: this list holds a driver <select>,
    // and a per-frame rebuild would discard the player's choice mid-interaction.
    const signature = [
      vehicles.map(v => `${v.id}:${v.type}:${v.task}:${v.hp}:${v.driverId ?? '-'}`).join('|'),
      state.employees.employees.filter(e => e.alive).map(e => `${e.id}:${e.qualifications.length}`).join('|'),
    ].join('#');
    if (signature === this.lastSignature) {
      this.refreshTierButtons(state.cash);
      return;
    }
    this.lastSignature = signature;

    this.listEl.innerHTML = '';

    if (vehicles.length === 0) {
      const msg = document.createElement('div');
      msg.style.cssText = 'color:#806050;font-size:11px;margin:4px 0';
      msg.textContent = t('ui.vehicles.none');
      this.listEl.appendChild(msg);
    } else {
      for (const v of vehicles) {
        this.listEl.appendChild(this.makeVehicleRow(v, state));
      }
    }

    this.refreshTierButtons(state.cash);
  }

  dispose(): void { this.el.remove(); }

  private makeVehicleRow(v: Vehicle, state: GameState): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bs-vehicle-row';

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;font-size:11px';
    info.textContent = `#${v.id} ${this.vehicleDisplayName(v.type, v.tier)}`;

    const status = document.createElement('div');
    status.style.cssText = 'font-size:10px;color:#a08060';
    status.textContent = `${t('ui.vehicles.status')}: ${v.task} | HP: ${v.hp}`;

    const scrapBtn = document.createElement('button');
    scrapBtn.className = 'bs-btn bs-btn-danger';
    scrapBtn.style.cssText = 'padding:2px 6px;font-size:10px';
    scrapBtn.textContent = t('ui.vehicles.scrap');
    scrapBtn.addEventListener('click', () => this.gameConsole?.(`vehicle scrap id:${v.id}`));

    const col = document.createElement('div');
    col.style.cssText = 'flex:1;min-width:0';
    col.append(info, status, this.makeDriverRow(v, state));
    row.append(col, scrapBtn);
    return row;
  }

  /**
   * Driver picker for one vehicle. Only crew holding the licence this role
   * requires — and not already behind another wheel — are offered.
   */
  private makeDriverRow(v: Vehicle, state: GameState): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:4px;margin-top:3px';

    const label = document.createElement('span');
    label.style.cssText = 'font-size:10px;color:#908070';
    label.textContent = t('ui.vehicles.driver');

    const licence = ROLE_LICENCE_REQUIRED[v.type];
    const taken = new Set(
      state.vehicles.vehicles.filter(o => o.id !== v.id && o.driverId !== null).map(o => o.driverId),
    );
    const eligible = state.employees.employees.filter(
      e => e.alive && !taken.has(e.id) && e.qualifications.some(q => q.category === licence),
    );

    if (v.driverId !== null) {
      const driver = state.employees.employees.find(e => e.id === v.driverId);
      const name = document.createElement('span');
      name.className = 'bs-vehicle-driver-name';
      name.style.cssText = 'font-size:10px;color:#90c070;flex:1';
      name.textContent = driver?.name ?? `#${v.driverId}`;
      wrap.append(label, name);
      return wrap;
    }

    if (eligible.length === 0) {
      const none = document.createElement('span');
      none.style.cssText = 'font-size:10px;color:#806050;flex:1';
      none.textContent = t('ui.vehicles.no_qualified', { licence });
      wrap.append(label, none);
      return wrap;
    }

    const select = document.createElement('select');
    select.className = 'bs-select bs-vehicle-driver-select';
    select.style.cssText = 'flex:1;font-size:10px;padding:1px 3px';
    select.dataset['vehicleId'] = String(v.id);
    for (const e of eligible) {
      const opt = document.createElement('option');
      opt.value = String(e.id);
      opt.textContent = e.name;
      select.appendChild(opt);
    }

    const assignBtn = document.createElement('button');
    assignBtn.className = 'bs-btn bs-btn-primary bs-vehicle-assign-btn';
    assignBtn.style.cssText = 'padding:1px 6px;font-size:10px';
    assignBtn.textContent = t('ui.vehicles.assign');
    assignBtn.addEventListener('click', () => {
      this.gameConsole?.(`vehicle driver ${v.id} ${select.value}`);
    });

    wrap.append(label, select, assignBtn);
    return wrap;
  }

  /**
   * Localized display name for a role+tier def — t(def.nameKey) instead of
   * the raw role id. Shared by the buy section and the owned-vehicle rows.
   */
  private vehicleDisplayName(type: VehicleRole, tier: VehicleTier): string {
    return t(getVehicleDefByTier(type, tier).nameKey);
  }

  /**
   * Tier 1/2/3 buy buttons for one role, each dispatching
   * `vehicle buy <type> tier:<n>` and labelled with t(def.nameKey) + cost.
   */
  private buildTierButtons(type: VehicleRole): HTMLElement {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;width:100%';

    for (const tier of VEHICLE_TIERS) {
      const def = getVehicleDefByTier(type, tier);
      const btn = document.createElement('button');
      btn.className = 'bs-btn bs-btn-primary';
      btn.style.cssText = 'padding:2px 6px;font-size:9px;flex:1 1 auto;min-width:0;white-space:normal;line-height:1.3';
      btn.textContent = `${this.vehicleDisplayName(type, tier)} ($${def.purchaseCost})`;
      btn.dataset['vtype'] = type;
      btn.dataset['tier'] = String(tier);
      btn.addEventListener('click', () => this.gameConsole?.(`vehicle buy ${type} tier:${tier}`));
      wrap.appendChild(btn);
    }

    return wrap;
  }

  /**
   * Refreshes tier-button disabled state against current cash — the
   * per-tier counterpart to refreshBuyButtons.
   */
  private refreshTierButtons(cash: number): void {
    const tierBtns = this.buySection.querySelectorAll<HTMLButtonElement>('[data-tier]');
    tierBtns.forEach(btn => {
      const type = btn.dataset['vtype'] as VehicleRole;
      const tier = Number(btn.dataset['tier']) as VehicleTier;
      const def = getVehicleDefByTier(type, tier);
      btn.disabled = cash < def.purchaseCost;
    });
  }

  private buildBuySection(): void {
    for (const type of getAllVehicleRoles()) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;flex-direction:column;gap:3px;margin-bottom:6px';

      const label = document.createElement('div');
      label.style.cssText = 'font-size:11px;color:#d0b090';
      label.textContent = this.vehicleDisplayName(type, 1);

      row.append(label, this.buildTierButtons(type));
      this.buySection.appendChild(row);
    }
  }
}
