// BlastSimulator2026 — Vehicle Management Panel (10.5)
// Lists vehicles with status/HP; buy and scrap controls.

import { t } from '../core/i18n/I18n.js';
import { LocaleTextRegistry } from './localeText.js';
import type { GameState } from '../core/state/GameState.js';
import type { Vehicle, VehicleRole, VehicleTier } from '../core/entities/Vehicle.js';
import { getAllVehicleRoles, getVehicleDefByTier, ROLE_LICENCE_REQUIRED } from '../core/entities/Vehicle.js';
import { HaulEligibilityCache, makeHaulButton, refreshHaulButtons } from './vehicleHaulButton.js';
import { BreakEligibilityCache, makeBreakButton, refreshBreakButtons } from './vehicleBreakButton.js';

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
  /** Latest state, so a locale switch can re-render the fleet rows. */
  private lastState: GameState | null = null;
  private readonly locale = new LocaleTextRegistry();
  /** Per-tick cache of each vehicle's best reachable haul fragment — see vehicleHaulButton.ts. */
  private readonly haulCache = new HaulEligibilityCache();
  /** Per-tick cache of each vehicle's best reachable oversized fragment — see vehicleBreakButton.ts. */
  private readonly breakCache = new BreakEligibilityCache();

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-vehicle-panel';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    this.locale.bindText(title, 'ui.vehicles.title');

    this.listEl = document.createElement('div');

    const buyHeader = document.createElement('div');
    buyHeader.className = 'bs-section-header';
    buyHeader.style.marginTop = '8px';
    this.locale.bindText(buyHeader, 'ui.vehicles.buy');

    this.buySection = document.createElement('div');
    this.buildBuySection();

    const closeBtn = document.createElement('button');
    closeBtn.className = 'bs-btn';
    closeBtn.style.cssText = 'width:100%;margin-top:6px';
    this.locale.bindText(closeBtn, 'ui.vehicles.close');
    closeBtn.addEventListener('click', () => this.hide());

    this.el.append(title, this.listEl, buyHeader, this.buySection, closeBtn);
    container.appendChild(this.el);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  /**
   * Stable dispatcher passed to the haul-button helpers instead of
   * `this.gameConsole` directly — those helpers capture the reference they're
   * given at button-creation time in a click closure, so a raw
   * possibly-undefined `this.gameConsole` would freeze at whatever it was
   * when the button was built. Reading `this.gameConsole` live here keeps a
   * late `setGameConsole()` call working, matching the driver-assign button's
   * own `() => this.gameConsole?.(...)` pattern.
   */
  private readonly dispatch = (cmd: string): unknown => this.gameConsole?.(cmd);

  /** Re-render locale-dependent text (title, rows, buy section) after a language change. */
  refreshLocale(): void {
    this.locale.refresh();
    // Both lists are rebuilt only on a fleet change, so they hold the previous
    // locale until one happens — rebuild them against the last known state.
    this.buySection.replaceChildren();
    this.buildBuySection();
    this.lastSignature = '';
    if (this.lastState) this.update(this.lastState);
  }

  show(): void { this.el.style.display = ''; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  update(state: GameState): void {
    this.lastState = state;
    const { vehicles } = state.vehicles;

    // Reachable-fragment eligibility only changes once per game tick, not
    // once per rendered frame — refresh() below is a no-op except on the
    // first update() call for a given state.tickCount.
    this.haulCache.refresh(state);
    this.breakCache.refresh(state);

    // Rebuilt only when the fleet changes: this list holds a driver <select>,
    // and a per-frame rebuild would discard the player's choice mid-interaction.
    const signature = [
      vehicles.map(v => `${v.id}:${v.type}:${v.task}:${v.hp}:${v.driverId ?? '-'}`).join('|'),
      state.employees.employees.filter(e => e.alive).map(e => `${e.id}:${e.qualifications.length}`).join('|'),
    ].join('#');
    if (signature === this.lastSignature) {
      this.refreshTierButtons(state.cash);
      refreshHaulButtons(this.listEl, state, this.haulCache, this.dispatch);
      refreshBreakButtons(this.listEl, state, this.breakCache, this.dispatch);
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
    refreshHaulButtons(this.listEl, state, this.haulCache, this.dispatch);
    refreshBreakButtons(this.listEl, state, this.breakCache, this.dispatch);
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
    col.className = 'bs-vehicle-col';
    col.dataset['vehicleId'] = String(v.id);
    col.style.cssText = 'flex:1;min-width:0';
    col.dataset['vehicleId'] = String(v.id);
    col.append(info, status, this.makeDriverRow(v, state));
    const haulBtn = makeHaulButton(v, this.haulCache, this.dispatch);
    if (haulBtn) col.appendChild(haulBtn);
    const breakBtn = makeBreakButton(v, this.breakCache, this.dispatch);
    if (breakBtn) col.appendChild(breakBtn);
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
   * Refreshes tier-button disabled state against current cash.
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
