// BlastSimulator2026 — Contracts panel (redesign P5)
// Storage strip, ACTIVE contracts (progress + MAX-capped deliver), OFFERED
// contracts (Accept/Negotiate/Decline, negotiate result inline), CLOSED
// history. Replaces ContractUI.ts's role (deleted in the P5 cleanup task).
//
// Root id and the accept/deliver/amount classes are preserved from the old
// panel so tutorialStages.ts and the tutorial scenario defs keep
// resolving unchanged — same convention ParamStrip.ts used for
// #bs-tile-select-confirm in P3.
//
// Deviations from the design mock: the mock's ACTIVE "DELIVER" control is a
// read-only max-amount readout; the real deliver amount is editable
// (pre-filled to the capped max, per the implementation plan's own wording)
// because a player may want to hold some material back for another contract.
// The mock's OFFERED cards show an invented "buyer" name with no backing
// state — replaced with the contract's real type, which is. Contract.description
// and Negotiation's old prose are both raw English generated in core; neither
// is used here — everything shown is built from structured fields through
// t(), so French actually reads French.

import { PanelBase } from './PanelBase.js';
import { t } from '../../core/i18n/I18n.js';
import { el, button, card, sectionHeader, emptyState, progressBar, panelRoot, panelHeader, panelBody, scrollBoundedSection } from '../dom.js';
import { iconEl, type IconName } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import { formatMoney, formatPricePerKg } from '../../core/economy/formatMoney.js';
import { getOre } from '../../core/world/OreCatalog.js';
import type { GameState } from '../../core/state/GameState.js';
import type { Contract, ContractType, NegotiationField } from '../../core/economy/Contract.js';
import type { GameConsoleFn } from '../gameConsole.js';


const TYPE_ICON: Record<ContractType, IconName> = {
  ore_sale: 'ore',
  rubble_disposal: 'trash',
  supply: 'storage',
};

const DESC_KEY: Record<ContractType, string> = {
  ore_sale: 'ui.contracts.desc_ore_sale',
  rubble_disposal: 'ui.contracts.desc_rubble_disposal',
  supply: 'ui.contracts.desc_supply',
};

const NEGOTIATE_KEY: Record<NegotiationField, { improved: string; worsened: string }> = {
  price: { improved: 'ui.contracts.negotiate.price_improved', worsened: 'ui.contracts.negotiate.price_worsened' },
  deadline: { improved: 'ui.contracts.negotiate.deadline_improved', worsened: 'ui.contracts.negotiate.deadline_worsened' },
  penalty: { improved: 'ui.contracts.negotiate.penalty_improved', worsened: 'ui.contracts.negotiate.penalty_worsened' },
};

export class ContractsPanel extends PanelBase {
  private readonly bodyEl: HTMLElement;
  private gameConsole?: GameConsoleFn;
  private onNavigateCb?: (panel: 'ops') => void;
  private lastSignature = '';
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    super(panelRoot('bs-contract-panel'));

    const { header, titleEl } = panelHeader({
      icon: 'contract',
      accent: 'amber',
      onClose: () => this.onCloseCb?.(),
    });
    this.locale.bindText(titleEl, 'ui.contracts.title');

    this.bodyEl = panelBody(10);

    this.el.append(header, this.bodyEl);
    container.appendChild(this.el);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }
  setNavigateHandler(cb: (panel: 'ops') => void): void { this.onNavigateCb = cb; }


  update(state: GameState): void {
    const signature = JSON.stringify({
      stored: Math.round(state.logistics.storedMassKg), cap: state.logistics.storageCapacityKg,
      ore: state.collectedOre,
      active: state.contracts.active.map(c => `${c.id}:${c.deliveredKg}:${c.acceptedAtTick}`),
      available: state.contracts.available.map(c => `${c.id}:${c.pricePerKg}:${c.quantityKg}:${c.penaltyAmount}:${c.deadlineTicks}`),
      history: state.contracts.completedHistory.map(c => c.id),
      neg: state.contracts.lastNegotiation,
      tick: state.tickCount,
    });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.render(state);
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = '';
  }


  private render(state: GameState): void {
    const sections: HTMLElement[] = [
      this.makeStorageStrip(state),
      sectionHeader(t('ui.contracts.active')),
      scrollBoundedSection(
        state.contracts.active.length > 0
          ? state.contracts.active.map(c => this.makeActiveCard(c, state))
          : [emptyState(t('ui.contracts.none_active'))],
        200,
      ),
      sectionHeader(t('ui.contracts.available')),
      scrollBoundedSection(
        state.contracts.available.length > 0
          ? state.contracts.available.map(c => this.makeOfferedCard(c, state))
          : [emptyState(t('ui.contracts.none'))],
        200,
      ),
      sectionHeader(t('ui.contracts.closed')),
      scrollBoundedSection(
        state.contracts.completedHistory.length > 0
          ? [...state.contracts.completedHistory].reverse().map(c => this.makeHistoryRow(c))
          : [emptyState(t('ui.contracts.none_closed'))],
        200,
      ),
    ];
    this.bodyEl.replaceChildren(...sections);
  }

  /** Kilograms of `materialId` available to deliver — collected ore by type, or raw stored mass for rubble ('' materialId). */
  private storedOf(materialId: string, state: GameState): number {
    return materialId === '' ? state.logistics.storedMassKg : (state.collectedOre[materialId] ?? 0);
  }

  private materialLabel(materialId: string): string {
    return materialId === '' ? t('ui.contracts.material_rubble') : t(getOre(materialId)?.nameKey ?? materialId);
  }

  // ── Storage strip ──

  private makeStorageStrip(state: GameState): HTMLElement {
    const used = Math.round(state.logistics.storedMassKg);
    const cap = state.logistics.storageCapacityKg;
    const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;

    const headRow = el('div');
    headRow.style.cssText = 'display:flex;align-items:baseline;gap:8px';
    headRow.append(
      iconEl('storage', 13),
      el('span', { text: t('ui.contracts.storage'), attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-micro)' } }),
      el('span', {
        text: t('ui.contracts.storage_value', { used: used.toLocaleString('en-US'), cap: cap.toLocaleString('en-US') }),
        attrs: { style: 'margin-left:auto;font:600 12px/1 var(--bsx-font-mono)' },
      }),
    );

    const oreEntries = Object.entries(state.collectedOre).filter(([, kg]) => kg > 0.5);
    const chipsRow = el('div');
    chipsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px';
    for (const [oreId, kg] of oreEntries) {
      const ore = getOre(oreId);
      const dot = el('span');
      dot.style.cssText = `width:6px;height:6px;border-radius:2px;background:${ore?.color ?? '#8a94a2'}`;
      const label = el('span', { text: ore ? t(ore.nameKey) : oreId, attrs: { style: 'font:500 10px/1 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } });
      const kgEl = el('span', { text: `${Math.round(kg).toLocaleString('en-US')} kg`, attrs: { style: 'font:500 10px/1 var(--bsx-font-mono);color:var(--bsx-text-micro)' } });
      chipsRow.appendChild(el('span', {
        attrs: { style: 'display:flex;align-items:center;gap:5px;padding:3px 7px;border-radius:3px;background:rgba(255,255,255,.05)' },
        children: [dot, label, kgEl],
      }));
    }

    const linkBtn = button('ghost', t('ui.contracts.storage_link'), {
      icon: 'ops',
      dataAction: 'goto-ops',
      onClick: () => this.onNavigateCb?.('ops'),
    });
    linkBtn.style.cssText = 'height:26px;align-self:flex-start;font-size:10px;padding:0 9px';

    return card([headRow, progressBar(pct, 'var(--bsx-amber)'), oreEntries.length > 0 ? chipsRow : null, linkBtn]);
  }

  // ── Active ──

  private urgencyColor(c: Contract, tickCount: number): string {
    const remaining = Math.max(0, c.acceptedAtTick + c.deadlineTicks - tickCount);
    const fraction = c.deadlineTicks > 0 ? remaining / c.deadlineTicks : 0;
    if (fraction > 0.5) return 'var(--bsx-positive)';
    if (fraction > 0.2) return 'var(--bsx-amber)';
    return 'var(--bsx-critical-text)';
  }

  private makeActiveCard(c: Contract, state: GameState): HTMLElement {
    const remainingTicks = Math.max(0, c.acceptedAtTick + c.deadlineTicks - state.tickCount);
    const color = this.urgencyColor(c, state.tickCount);
    const pct = c.quantityKg > 0 ? Math.round((c.deliveredKg / c.quantityKg) * 100) : 0;
    const stored = this.storedOf(c.materialId, state);
    const remainingKg = Math.max(0, c.quantityKg - c.deliveredKg);
    const maxDeliverable = Math.max(0, Math.min(remainingKg, stored));

    const headRow = el('div');
    headRow.style.cssText = 'display:flex;align-items:center;gap:8px';
    headRow.append(
      iconEl(TYPE_ICON[c.type], 14),
      el('span', { text: this.materialLabel(c.materialId), attrs: { style: 'font:600 12px/1 var(--bsx-font-ui)' } }),
      el('span', { text: `#${c.id}`, attrs: { style: 'font:500 10px/1 var(--bsx-font-mono);color:var(--bsx-text-micro)' } }),
      el('span', {
        text: t('ui.contracts.time_left', { hours: remainingTicks }),
        attrs: { style: `margin-left:auto;display:flex;align-items:center;gap:4px;font:700 10px/1 var(--bsx-font-ui);letter-spacing:.1em;color:${color}` },
      }),
    );

    const progressLine = el('div');
    progressLine.style.cssText = 'display:flex;gap:12px;font:500 10px/1 var(--bsx-font-mono);color:var(--bsx-text-secondary)';
    progressLine.append(
      el('span', { text: t('ui.contracts.delivered_line', { delivered: c.deliveredKg.toLocaleString('en-US'), total: c.quantityKg.toLocaleString('en-US') }) }),
      el('span', { text: `+$${formatMoney(c.quantityKg * c.pricePerKg)}`, attrs: { style: 'color:var(--bsx-positive)' } }),
      el('span', { text: t('ui.contracts.penalty_line', { amount: formatMoney(c.penaltyAmount) }), attrs: { style: 'margin-left:auto;color:var(--bsx-critical-text)' } }),
    );

    const amountInput = el('input', { className: 'bs-input bs-contract-amount', attrs: { type: 'number', min: '1', step: '1', value: String(Math.max(1, Math.round(maxDeliverable))) } }) as HTMLInputElement;
    amountInput.max = String(Math.max(1, Math.round(maxDeliverable)));
    amountInput.disabled = maxDeliverable <= 0;
    amountInput.style.cssText = 'flex:1;height:30px;padding:0 10px;border:1px solid rgba(255,255,255,.1);border-radius:4px;background:var(--bsx-well);color:var(--bsx-text-primary);font:600 11px/1 var(--bsx-font-mono)';

    const maxBtn = button('ghost', t('ui.contracts.max'), {
      dataAction: 'deliver-max',
      disabled: maxDeliverable <= 0,
      onClick: () => { amountInput.value = String(Math.max(1, Math.round(maxDeliverable))); },
    });
    maxBtn.style.cssText = 'height:30px;padding:0 10px;font-size:10px';

    const deliverBtn = button('primary', t('ui.contracts.deliver'), {
      dataAction: 'deliver',
      disabled: maxDeliverable <= 0,
      onClick: () => this.gameConsole?.(`contract deliver ${c.id} amount:${amountInput.value}`),
    });
    deliverBtn.classList.add('bs-contract-deliver');
    deliverBtn.style.cssText = 'height:30px;padding:0 14px;font-size:10px';

    const deliverRow = el('div');
    deliverRow.style.cssText = 'display:flex;align-items:center;gap:7px';
    deliverRow.append(amountInput, maxBtn, deliverBtn);

    const storedNote = el('span', {
      text: t('ui.contracts.stored_note', { kg: Math.round(stored).toLocaleString('en-US'), material: this.materialLabel(c.materialId) }),
      attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' },
    });

    const cardEl = card([headRow, progressBar(pct, color), progressLine, deliverRow, storedNote]);
    cardEl.dataset['contractId'] = String(c.id);
    // See makeOfferedCard's own comment on data-contract-type/-material (#554).
    cardEl.dataset['contractType'] = c.type;
    cardEl.dataset['contractMaterial'] = c.materialId;
    return cardEl;
  }

  // ── Offered ──

  private makeOfferedCard(c: Contract, state: GameState): HTMLElement {
    const stored = this.storedOf(c.materialId, state);
    const havePct = c.quantityKg > 0 ? Math.min(100, Math.round((stored / c.quantityKg) * 100)) : 0;
    const haveColor = stored >= c.quantityKg ? 'var(--bsx-positive)' : 'var(--bsx-amber)';

    const headRow = el('div');
    headRow.style.cssText = 'display:flex;align-items:center;gap:8px';
    const iconBox = el('div', { children: [iconEl(TYPE_ICON[c.type], 13)] });
    iconBox.style.cssText = 'width:24px;height:24px;border-radius:4px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06);color:var(--bsx-amber)';
    const titleCol = el('div');
    titleCol.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0';
    titleCol.append(
      el('span', { text: t(DESC_KEY[c.type], { material: this.materialLabel(c.materialId) }), attrs: { style: 'font:600 12px/1.2 var(--bsx-font-ui)' } }),
      el('span', { text: t(`ui.contracts.type_${c.type}`), attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' } }),
    );
    headRow.append(iconBox, titleCol, el('span', { text: `#${c.id}`, attrs: { style: 'margin-left:auto;font:500 10px/1 var(--bsx-font-mono);color:var(--bsx-text-micro)' } }));

    const statRow = el('div');
    statRow.style.cssText = 'display:flex;border-radius:4px;background:var(--bsx-well);overflow:hidden';
    statRow.append(
      this.miniStat(t('ui.contracts.qty'), `${c.quantityKg.toLocaleString('en-US')} kg`),
      this.miniStat(t('ui.contracts.price'), `$${formatPricePerKg(c.pricePerKg)}/kg`),
      this.miniStat(t('ui.contracts.total'), `$${formatMoney(c.quantityKg * c.pricePerKg)}`, 'var(--bsx-positive)', true),
    );

    const haveRow = el('div');
    haveRow.style.cssText = 'display:flex;flex-direction:column;gap:5px';
    const haveLabels = el('div');
    haveLabels.style.cssText = 'display:flex;justify-content:space-between;font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-secondary)';
    haveLabels.append(
      el('span', { text: t('ui.contracts.have_line', { kg: Math.round(stored).toLocaleString('en-US') }) }),
      el('span', { text: t('ui.contracts.deadline_line', { hours: c.deadlineTicks }), attrs: { style: 'color:var(--bsx-text-micro)' } }),
    );
    haveRow.append(haveLabels, progressBar(havePct, haveColor));

    const termsRow = el('div');
    termsRow.style.cssText = 'display:flex;gap:10px;font:400 10px/1 var(--bsx-font-mono)';
    termsRow.append(
      el('span', { text: t('ui.contracts.penalty_line', { amount: formatMoney(c.penaltyAmount) }), attrs: { style: 'color:var(--bsx-critical-text)' } }),
      el('span', { text: t('ui.contracts.bonus_line', { amount: formatMoney(c.earlyBonus) }), attrs: { style: 'color:var(--bsx-positive)' } }),
    );

    const neg = state.contracts.lastNegotiation;
    const negBox = neg && neg.contractId === c.id && neg.changes.length > 0 ? this.makeNegotiateResult(neg) : null;

    const acceptBtn = button('primary', t('ui.contracts.accept'), {
      dataAction: 'accept',
      onClick: () => this.gameConsole?.(`contract accept id:${c.id}`),
    });
    acceptBtn.classList.add('bs-contract-accept');
    acceptBtn.style.cssText = 'flex:1;height:30px;font-size:10px';

    const negotiateBtn = button('ghost', t('ui.contracts.negotiate'), {
      dataAction: 'negotiate',
      onClick: () => this.gameConsole?.(`contract negotiate id:${c.id}`),
    });
    negotiateBtn.style.cssText = 'flex:1;height:30px;font-size:10px';

    const declineBtn = button('danger', '', {
      icon: 'x',
      dataAction: 'decline',
      onClick: () => this.gameConsole?.(`contract decline id:${c.id}`),
    });
    declineBtn.style.cssText = 'width:34px;height:30px';

    const btnRow = el('div');
    btnRow.style.cssText = 'display:flex;gap:6px';
    btnRow.append(acceptBtn, negotiateBtn, declineBtn);

    const cardEl = card([headRow, statRow, haveRow, termsRow, negBox, btnRow]);
    cardEl.dataset['contractId'] = String(c.id);
    // data-contract-type/data-contract-material, alongside data-contract-id
    // (#554): a fixed id is a moving target once the tick-based offer pool
    // has had time to refresh underneath it — every scenario file that
    // scoped a click to `[data-contract-id="N"]` for exactly this "guaranteed
    // same contract in both modes" reason (#513/#581) needs a selector that
    // survives that rotation the same way the console's own `type:`/
    // `material:` ContractSelector (#597) already does.
    cardEl.dataset['contractType'] = c.type;
    cardEl.dataset['contractMaterial'] = c.materialId;
    return cardEl;
  }

  private miniStat(label: string, value: string, color?: string, last = false): HTMLElement {
    const cell = el('div');
    cell.style.cssText = `flex:1;padding:7px 9px;display:flex;flex-direction:column;gap:3px${last ? '' : ';border-right:1px solid rgba(255,255,255,.05)'}`;
    cell.append(
      el('span', { text: label, attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.1em;color:var(--bsx-text-micro)' } }),
      el('span', { text: value, attrs: { style: `font:600 11px/1 var(--bsx-font-mono)${color ? `;color:${color}` : ''}` } }),
    );
    return cell;
  }

  private makeNegotiateResult(neg: NonNullable<GameState['contracts']['lastNegotiation']>): HTMLElement {
    const wrap = el('div');
    wrap.style.cssText = 'display:flex;gap:7px;padding:8px 9px;border-radius:4px;background:rgba(169,140,255,.1);border:1px solid rgba(169,140,255,.28)';
    const text = neg.changes
      .map(c => t(c.improved ? NEGOTIATE_KEY[c.field].improved : NEGOTIATE_KEY[c.field].worsened, { pct: c.pct }))
      .join(' · ');
    wrap.append(
      el('div', { attrs: { style: 'color:#a98cff' }, children: [iconEl('person', 12)] }),
      el('span', { text, attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary)' } }),
    );
    return wrap;
  }

  // ── History ──

  private makeHistoryRow(c: Contract): HTMLElement {
    const ok = c.completed && !c.expired;
    const color = ok ? 'var(--bsx-positive)' : 'var(--bsx-critical-text)';
    const outcome = ok
      ? `+$${formatMoney(c.deliveredKg * c.pricePerKg)}`
      : `-$${formatMoney(c.penaltyAmount)}`;
    const row = el('div');
    row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:4px;background:var(--bsx-well)';
    const col = el('div');
    col.style.cssText = 'display:flex;flex-direction:column;gap:2px';
    col.append(
      el('span', { text: this.materialLabel(c.materialId), attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
      el('span', { text: t(ok ? 'ui.contracts.history_completed' : 'ui.contracts.history_expired'), attrs: { style: 'font:400 11px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' } }),
    );
    row.append(
      el('span', { text: `#${c.id}`, attrs: { style: 'font:500 10px/1 var(--bsx-font-mono);color:var(--bsx-text-micro)' } }),
      col,
      el('span', { text: outcome, attrs: { style: `margin-left:auto;font:600 11px/1 var(--bsx-font-mono);color:${color}` } }),
    );
    return row;
  }
}
