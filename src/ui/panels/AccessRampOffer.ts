// BlastSimulator2026 — "Dig access ramp" offer card (#2144)
// One card shared by the blast report and the Operations panel: previews the proposed ramp with cost and length,
// orders it on one click through the console, or hands it to the manual ramp tool to adjust.
// Nothing here orders by itself (#2095): the ramp is paid for and dug only on the player's click.

import { t } from '../../core/i18n/I18n.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import type { GameState } from '../../core/state/GameState.js';
import type { AccessRampProposal } from '../../core/mining/CraterAccessProposal.js';
import type { GameConsoleFn } from '../gameConsole.js';
import { el } from '../dom.js';

type OkProposal = Extract<AccessRampProposal, { ok: true }>;

export class AccessRampOffer {
  readonly root: HTMLElement = document.createElement('div');
  private provider: (() => AccessRampProposal | null) | null = null;
  private runConsole: GameConsoleFn | null = null;
  private onAdjust: ((proposal: OkProposal) => void) | null = null;
  private lastState: GameState | null = null;
  private shownKey = '';
  /** Console refusal of the last dig click, shown on the card until the proposal changes. */
  private failure: string | null = null;

  /** `prefix` namespaces the buttons' data-action: `<prefix>-dig-ramp`, `<prefix>-adjust-ramp`. */
  constructor(readonly prefix: 'report' | 'ops') {
    this.root.dataset['accessRampOffer'] = prefix;
    this.root.style.display = 'none';
  }

  setProposalProvider(fn: () => AccessRampProposal | null): void { this.provider = fn; }
  setGameConsole(fn: GameConsoleFn): void { this.runConsole = fn; }
  setAdjustHandler(fn: (proposal: OkProposal) => void): void { this.onAdjust = fn; }

  /** Re-reads the proposal (once per game tick) and rebuilds the card; hidden while there is nothing stranded. */
  refresh(state: GameState): void {
    this.lastState = state;
    const proposal = this.provider?.() ?? null;
    const key = proposal === null ? '' : JSON.stringify([this.failure, proposal.ok ? [proposal.line, proposal.cost, proposal.length, proposal.orderCount] : proposal.reasonKey]);
    if (key === this.shownKey) return;
    this.shownKey = key;
    if (proposal === null) {
      this.failure = null;
      this.root.style.display = 'none';
      this.root.replaceChildren();
      return;
    }
    this.root.style.display = '';
    this.root.replaceChildren(proposal.ok ? this.offerCard(proposal) : this.noPlanCard(proposal.reasonKey));
  }

  private card(...children: HTMLElement[]): HTMLElement {
    const wrap = el('div', { attrs: { 'data-field': 'access-ramp-card' } });
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:5px;background:rgba(255,176,46,.08);border:1px solid rgba(255,176,46,.28)';
    wrap.append(...children);
    return wrap;
  }

  private text(text: string, strong = false): HTMLElement {
    return el('span', {
      text,
      attrs: { style: strong ? 'font:600 12px/1.3 var(--bsx-font-ui)' : 'font:400 11px/1.45 var(--bsx-font-ui);color:var(--bsx-text-secondary)' },
    });
  }

  private noPlanCard(reasonKey: string): HTMLElement {
    return this.card(
      this.text(t('ui.access_ramp.title'), true),
      this.text(`${t(reasonKey)} ${t('ui.access_ramp.use_manual')}`),
    );
  }

  private offerCard(proposal: OkProposal): HTMLElement {
    const detail = el('span', {
      text: t('ui.access_ramp.detail', {
        length: Math.round(proposal.length), cost: formatMoney(proposal.cost), orders: proposal.orderCount,
      }),
      attrs: { 'data-field': 'access-ramp-detail', style: 'font:500 11px/1.45 var(--bsx-font-mono)' },
    });
    const dig = el('button', { className: 'bsx-btn bsx-btn-primary', text: t('ui.access_ramp.dig') });
    dig.dataset['action'] = `${this.prefix}-dig-ramp`;
    dig.addEventListener('click', () => this.dig(proposal));
    const adjust = el('button', { className: 'bsx-btn', text: t('ui.access_ramp.adjust') });
    adjust.dataset['action'] = `${this.prefix}-adjust-ramp`;
    adjust.addEventListener('click', () => this.onAdjust?.(proposal));
    const buttons = el('div', { children: [dig, adjust] });
    buttons.style.cssText = 'display:flex;gap:8px';
    const parts = [this.text(t('ui.access_ramp.title'), true), this.text(t('ui.access_ramp.explain')), detail, buttons];
    if (this.failure !== null) parts.push(el('span', { text: this.failure, attrs: { style: 'font:500 11px/1.4 var(--bsx-font-ui);color:var(--bsx-critical-text)' } }));
    return this.card(...parts);
  }

  private dig(proposal: OkProposal): void {
    const result = this.runConsole?.(proposal.line);
    this.failure = result !== undefined && !result.success ? result.output : null;
    if (this.lastState !== null) { this.shownKey = ''; this.refresh(this.lastState); }
  }
}
