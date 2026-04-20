// BlastSimulator2026 — Vehicle Management Panel (10.5)
// Lists vehicles with status/HP; buy and scrap controls.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { Vehicle } from '../core/entities/Vehicle.js';
import { getAllVehicleRoles, getVehicleDef } from '../core/entities/Vehicle.js';

import type { CommandResult } from '../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

export class VehiclePanel {
  private readonly el: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly buySection: HTMLElement;
  private gameConsole?: GameConsoleFn;

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
    this.listEl.innerHTML = '';

    if (vehicles.length === 0) {
      const msg = document.createElement('div');
      msg.style.cssText = 'color:#806050;font-size:11px;margin:4px 0';
      msg.textContent = t('ui.vehicles.none');
      this.listEl.appendChild(msg);
    } else {
      for (const v of vehicles) {
        this.listEl.appendChild(this.makeVehicleRow(v));
      }
    }

    // Update buy button disabled states
    const buyBtns = this.buySection.querySelectorAll<HTMLButtonElement>('[data-vtype]');
    buyBtns.forEach(btn => {
      const type = btn.dataset['vtype']!;
      const def = getVehicleDef(type as any);
      btn.disabled = state.cash < def.purchaseCost;
    });
  }

  dispose(): void { this.el.remove(); }

  private makeVehicleRow(v: Vehicle): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bs-vehicle-row';

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;font-size:11px';
    info.textContent = `#${v.id} ${v.type}`;

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
    col.append(info, status);
    row.append(col, scrapBtn);
    return row;
  }

  private buildBuySection(): void {
    for (const type of getAllVehicleRoles()) {
      const def = getVehicleDef(type);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px';

      const label = document.createElement('div');
      label.style.cssText = 'flex:1;font-size:11px;color:#d0b090';
      label.textContent = `${type} ($${def.purchaseCost})`;

      const btn = document.createElement('button');
      btn.className = 'bs-btn bs-btn-primary';
      btn.style.cssText = 'padding:2px 8px;font-size:10px';
      btn.textContent = t('ui.vehicles.buy');
      btn.dataset['vtype'] = type;
      btn.addEventListener('click', () => this.gameConsole?.(`vehicle buy ${type}`));

      row.append(label, btn);
      this.buySection.appendChild(row);
    }
  }
}
