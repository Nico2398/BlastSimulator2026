// BlastSimulator2026 — Contract UI (10.3)
// Shows available and active contracts; accept/negotiate/decline actions.

import { t } from '../core/i18n/I18n.js';
import { LocaleTextRegistry } from './localeText.js';
import type { GameState } from '../core/state/GameState.js';
import type { Contract } from '../core/economy/Contract.js';

import type { CommandResult } from '../console/ConsoleRunner.js';

export type GameConsoleFn = (cmd: string) => CommandResult;

/**
 * Price per kilo for display: two decimals, thousands separators, and never
 * rounded down to "$0.00" for the cheap rubble-disposal contracts.
 */
export function formatPricePerKg(price: number): string {
  const decimals = price < 1 ? 3 : 2;
  return price.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export class ContractUI {
  private readonly el: HTMLElement;
  private readonly availableList: HTMLElement;
  private readonly activeList: HTMLElement;
  private gameConsole?: GameConsoleFn;
  /** Fingerprint of the last rendered contract lists — guards per-frame rebuilds. */
  private lastSignature = '';
  /** Last rendered offer lists, so a locale switch can rebuild their rows. */
  private lastAvailable: Contract[] = [];
  private lastActive: Contract[] = [];
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'bs-contract-panel';
    this.el.classList.add('bs-ui', 'bs-panel');
    this.el.style.display = 'none';

    const title = document.createElement('div');
    title.className = 'bs-panel-title';
    this.locale.bindText(title, 'ui.contracts.title');

    const availHeader = document.createElement('div');
    availHeader.className = 'bs-section-header';
    this.locale.bindText(availHeader, 'ui.contracts.available');

    this.availableList = document.createElement('div');

    const activeHeader = document.createElement('div');
    activeHeader.className = 'bs-section-header';
    activeHeader.style.marginTop = '8px';
    this.locale.bindText(activeHeader, 'ui.contracts.active');

    this.activeList = document.createElement('div');

    this.el.append(title, availHeader, this.availableList, activeHeader, this.activeList);
    container.appendChild(this.el);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }

  /** Re-render locale-dependent text (title, headers, rows) after a language change. */
  refreshLocale(): void {
    this.locale.refresh();
    // Row buttons are only built when the offer list changes, so they would
    // otherwise keep the previous locale until an offer appeared or expired.
    this.availableList.replaceChildren();
    this.activeList.replaceChildren();
    this.lastSignature = '';
    this.rebuildRows(this.lastAvailable, this.lastActive);
  }

  show(): void { this.el.style.display = ''; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  update(state: GameState): void {
    const { available, active } = state.contracts;

    // Called every rendered frame. Rebuilding the rows each time destroys the
    // Accept buttons ~60 times a second, so a click can land on a node that is
    // already detached. Rows are rebuilt only when the offer list itself
    // changes; the countdown and progress bar are refreshed in place.
    const structure = [
      available.map(c => `${c.id}:${c.pricePerKg}:${c.quantityKg}`).join(','),
      active.map(c => c.id).join(','),
    ].join('#');

    this.lastAvailable = available;
    this.lastActive = active;

    if (structure !== this.lastSignature) {
      this.lastSignature = structure;
      this.rebuildRows(available, active);
    }

    this.refreshActiveRows(active, state.tickCount);
  }

  dispose(): void { this.el.remove(); }

  private rebuildRows(available: Contract[], active: Contract[]): void {
    this.syncList(this.availableList, available, t('ui.contracts.none'), c => this.makeAvailableRow(c));
    this.syncList(this.activeList, active, t('ui.contracts.none_active'), c => this.makeActiveRow(c));
  }

  /**
   * Bring a list in line with its contracts without touching rows that are
   * already correct.
   *
   * Replacing the whole list detached the Accept button under an in-flight
   * click whenever an unrelated offer appeared or expired — offers refresh on a
   * timer, so this happened while the player was reaching for a different row.
   */
  private syncList(
    listEl: HTMLElement,
    contracts: Contract[],
    emptyText: string,
    makeRow: (c: Contract) => HTMLElement,
  ): void {
    const wanted = new Set(contracts.map(c => String(c.id)));

    for (const child of Array.from(listEl.children)) {
      const id = (child as HTMLElement).dataset['contractId'];
      if (id === undefined || !wanted.has(id)) child.remove();
    }

    if (contracts.length === 0) {
      if (listEl.children.length === 0) listEl.appendChild(this.makeEmptyMessage(emptyText));
      return;
    }

    for (const c of contracts) {
      if (!listEl.querySelector(`[data-contract-id="${c.id}"]`)) {
        listEl.appendChild(makeRow(c));
      }
    }
  }

  /** Update the live numbers on existing rows without replacing any nodes. */
  private refreshActiveRows(active: Contract[], currentTick: number): void {
    for (const c of active) {
      const row = this.activeList.querySelector<HTMLElement>(`[data-contract-id="${c.id}"]`);
      if (!row) continue;
      const pct = c.quantityKg > 0 ? Math.round((c.deliveredKg / c.quantityKg) * 100) : 0;
      const remaining = Math.max(0, c.acceptedAtTick + c.deadlineTicks - currentTick);
      const details = row.querySelector<HTMLElement>('.bs-contract-details');
      if (details) details.textContent = t('ui.contracts.progress_line', { pct, remaining });
      const fill = row.querySelector<HTMLElement>('.bs-progress-bar-fill');
      if (fill) fill.style.width = `${pct}%`;
    }
  }

  /**
   * Delivery controls for an active contract. Deliveries are explicit — nothing
   * ships itself — so an active contract needs a way to send tonnage.
   */
  private makeDeliverRow(c: Contract): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'bs-contract-btns';

    const amount = document.createElement('input');
    amount.type = 'number';
    amount.className = 'bs-input bs-contract-amount';
    amount.style.cssText = 'flex:1;font-size:10px;padding:1px 4px';
    amount.min = '1';
    amount.step = '100';
    amount.value = String(Math.max(1, c.quantityKg - c.deliveredKg));
    // Rebuilt per row, so it is re-translated by the rebuild rather than the
    // registry — registering here would grow a binding per rebuild.
    amount.title = t('ui.contracts.deliver_amount');

    const deliverBtn = document.createElement('button');
    deliverBtn.className = 'bs-btn bs-btn-primary bs-contract-deliver';
    deliverBtn.style.cssText = 'padding:2px 6px;font-size:10px';
    deliverBtn.textContent = t('ui.contracts.deliver');
    deliverBtn.addEventListener('click', () => {
      this.gameConsole?.(`contract deliver ${c.id} amount:${amount.value}`);
    });

    wrap.append(amount, deliverBtn);
    return wrap;
  }

  private makeEmptyMessage(text: string): HTMLElement {
    const msg = document.createElement('div');
    msg.style.cssText = 'color:#806050;font-size:11px;margin:4px 0';
    msg.textContent = text;
    return msg;
  }

  private makeAvailableRow(c: Contract): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bs-contract-row';
    row.dataset['contractId'] = String(c.id);

    const desc = document.createElement('div');
    desc.className = 'bs-contract-desc';
    desc.textContent = c.description;

    const details = document.createElement('div');
    details.className = 'bs-contract-details';
    // pricePerKg is a raw float from the offer generator — printing it straight
    // gives the player "$0.6273750268155709/kg".
    details.textContent = t('ui.contracts.offer_line', {
      qty: c.quantityKg.toLocaleString('en-US'),
      price: formatPricePerKg(c.pricePerKg),
      deadline: c.deadlineTicks,
    });

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:4px;margin-top:4px';

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'bs-btn bs-btn-primary bs-contract-accept';
    acceptBtn.style.cssText = 'padding:2px 6px;font-size:10px';
    acceptBtn.textContent = t('ui.contracts.accept');
    acceptBtn.addEventListener('click', () => this.gameConsole?.(`contract accept id:${c.id}`));

    const negBtn = document.createElement('button');
    negBtn.className = 'bs-btn bs-contract-negotiate';
    negBtn.style.cssText = 'padding:2px 6px;font-size:10px';
    negBtn.textContent = t('ui.contracts.negotiate');
    negBtn.addEventListener('click', () => this.gameConsole?.(`contract negotiate id:${c.id}`));

    const declineBtn = document.createElement('button');
    declineBtn.className = 'bs-btn bs-btn-danger bs-contract-decline';
    declineBtn.style.cssText = 'padding:2px 6px;font-size:10px';
    declineBtn.textContent = t('ui.contracts.decline');
    declineBtn.addEventListener('click', () => this.gameConsole?.(`contract decline id:${c.id}`));

    btnRow.append(acceptBtn, negBtn, declineBtn);
    row.append(desc, details, btnRow);
    return row;
  }

  /** Structure only — the numbers are filled in by refreshActiveRows(). */
  private makeActiveRow(c: Contract): HTMLElement {
    const row = document.createElement('div');
    row.className = 'bs-contract-row bs-contract-active';
    row.dataset['contractId'] = String(c.id);

    const desc = document.createElement('div');
    desc.className = 'bs-contract-desc';
    desc.textContent = c.description;

    const progress = document.createElement('div');
    progress.className = 'bs-contract-details';

    const bar = document.createElement('div');
    bar.className = 'bs-progress-bar-bg';
    bar.style.cssText = 'background:#3a2a1a;height:4px;border-radius:2px;margin:3px 0';
    const fill = document.createElement('div');
    fill.className = 'bs-progress-bar-fill';
    fill.style.cssText = 'background:#70c050;height:100%;border-radius:2px;width:0%';
    bar.appendChild(fill);

    row.append(desc, progress, bar, this.makeDeliverRow(c));
    return row;
  }
}
