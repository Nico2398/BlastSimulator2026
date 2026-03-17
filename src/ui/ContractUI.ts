// BlastSimulator2026 — Contract UI (10.3)
// Shows available and active contracts; accept/negotiate/decline actions.

import { t } from '../core/i18n/I18n.js';
import type { GameState } from '../core/state/GameState.js';
import type { Contract } from '../core/economy/Contract.js';

export type GameConsoleFn = (cmd: string) => string;

export class ContractUI {
  private readonly el: HTMLElement;
  private readonly availableList: HTMLElement;
  private readonly activeList: HTMLElement;
  private gameConsole?: GameConsoleFn;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-contract-panel';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    title.textContent = t('ui.contracts.title');

    const availHeader = document.createElement('div');
    availHeader.className = 'bs-section-header';
    availHeader.textContent = t('ui.contracts.available');

    this.availableList = document.createElement('div');

    const activeHeader = document.createElement('div');
    activeHeader.className = 'bs-section-header';
    activeHeader.style.marginTop = '8px';
    activeHeader.textContent = t('ui.contracts.active');

    this.activeList = document.createElement('div');

    this.el.append(title, availHeader, this.availableList, activeHeader, this.activeList);
    container.appendChild(this.el);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  show(): void { this.el.style.display = ''; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  update(state: GameState): void {
    const { available, active } = state.contracts;

    this.availableList.innerHTML = '';
    if (available.length === 0) {
      const msg = document.createElement('div');
      msg.style.cssText = 'color:#806050;font-size:11px;margin:4px 0';
      msg.textContent = t('ui.contracts.none');
      this.availableList.appendChild(msg);
    } else {
      for (const c of available) {
        this.availableList.appendChild(this.makeAvailableRow(c, state.tickCount));
      }
    }

    this.activeList.innerHTML = '';
    if (active.length === 0) {
      const msg = document.createElement('div');
      msg.style.cssText = 'color:#806050;font-size:11px;margin:4px 0';
      msg.textContent = t('ui.contracts.none_active');
      this.activeList.appendChild(msg);
    } else {
      for (const c of active) {
        this.activeList.appendChild(this.makeActiveRow(c, state.tickCount));
      }
    }
  }

  dispose(): void { this.el.remove(); }

  private makeAvailableRow(c: Contract, _currentTick: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bs-contract-row';

    const desc = document.createElement('div');
    desc.className = 'bs-contract-desc';
    desc.textContent = c.description;

    const details = document.createElement('div');
    details.className = 'bs-contract-details';
    details.textContent = `${c.quantityKg}kg @ $${c.pricePerKg}/kg — ${c.deadlineTicks}t deadline`;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:4px;margin-top:4px';

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'bs-btn bs-btn-primary';
    acceptBtn.style.cssText = 'padding:2px 6px;font-size:10px';
    acceptBtn.textContent = t('ui.contracts.accept');
    acceptBtn.addEventListener('click', () => this.gameConsole?.(`contract accept id:${c.id}`));

    const negBtn = document.createElement('button');
    negBtn.className = 'bs-btn';
    negBtn.style.cssText = 'padding:2px 6px;font-size:10px';
    negBtn.textContent = t('ui.contracts.negotiate');
    negBtn.addEventListener('click', () => this.gameConsole?.(`contract negotiate id:${c.id}`));

    const declineBtn = document.createElement('button');
    declineBtn.className = 'bs-btn bs-btn-danger';
    declineBtn.style.cssText = 'padding:2px 6px;font-size:10px';
    declineBtn.textContent = t('ui.contracts.decline');
    declineBtn.addEventListener('click', () => this.gameConsole?.(`contract decline id:${c.id}`));

    btnRow.append(acceptBtn, negBtn, declineBtn);
    row.append(desc, details, btnRow);
    return row;
  }

  private makeActiveRow(c: Contract, currentTick: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bs-contract-row bs-contract-active';

    const desc = document.createElement('div');
    desc.className = 'bs-contract-desc';
    desc.textContent = c.description;

    const pct = c.quantityKg > 0 ? Math.round((c.deliveredKg / c.quantityKg) * 100) : 0;
    const deadline = c.acceptedAtTick + c.deadlineTicks - currentTick;

    const progress = document.createElement('div');
    progress.className = 'bs-contract-details';
    progress.textContent = `${t('ui.contracts.progress')}: ${pct}% — ${Math.max(0, deadline)}t left`;

    const bar = document.createElement('div');
    bar.style.cssText = 'background:#3a2a1a;height:4px;border-radius:2px;margin:3px 0';
    const fill = document.createElement('div');
    fill.style.cssText = `background:#70c050;height:100%;border-radius:2px;width:${pct}%`;
    bar.appendChild(fill);

    row.append(desc, progress, bar);
    return row;
  }
}
