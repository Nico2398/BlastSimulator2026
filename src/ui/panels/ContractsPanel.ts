// BlastSimulator2026 — Contracts panel (redesign P5)
// Section order: storage strip, running-contracts summary strip (only with
// active contracts; click jumps to ACTIVE), AVAILABLE offers (fillable first,
// sized to three cards before scrolling; Accept/Negotiate/Decline, negotiate
// result inline), ACTIVE contracts (progress + MAX-capped deliver), CLOSED history.
// Replaces ContractUI.ts's role (deleted in the P5 cleanup task).
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
import { el, fieldStyle, button, card, sectionHeader, emptyState, progressBar, panelRoot, panelHeader, panelBody, scrollBoundedSection, replaceChildrenKeepingScroll, flashStatus } from '../dom.js';
import { iconEl, type IconName } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import { formatMoney, formatPricePerKg, insufficientFundsText, wholeKg } from '../../core/economy/formatMoney.js';
import { resolveContractOres } from '../../core/campaign/Level.js';
import { getProfitShortfall } from '../../core/campaign/LevelObjective.js';
import { getOre } from '../../core/world/OreCatalog.js';
import { makeBuyerBadge, makeMarketStrip, type MarketStripInput } from './ContractsMarketStrip.js';
import { saturationReader } from '../../core/economy/OreSaturation.js';
import { oreContractBasePrice } from '../../core/economy/Market.js';
import type { GameState } from '../../core/state/GameState.js';
import { bestAvailableManagerLevel } from '../../core/entities/Employee.js';
import { negotiationRefusalReason } from '../../core/economy/Negotiation.js';
import { contractAcceptBlocker, contractTotal, isFillableSaleOffer, isPaidClearance, isWinningSaleOffer, remainingKg, type Contract, type ContractType, type NegotiationField } from '../../core/economy/Contract.js';
import { stateRubbleStockKg, totalSpoilKg } from '../../core/economy/SpoilHeaps.js';
import { freightWarehouseSites } from '../../core/entities/BuildingWarehouse.js';
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

/** Height budget (px) of one available-offer card, sizing the Available section. Measured card height is ~181px; 190 leaves headroom. */
export const CONTRACT_OFFER_CARD_PX = 190;
/** Offer cards the Available section shows before it scrolls. */
export const AVAILABLE_VISIBLE_CARDS = 3;
/** Vertical gap (px) between cards inside a section. */
export const SECTION_GAP_PX = 10;
const AVAILABLE_SECTION_MAX_PX = AVAILABLE_VISIBLE_CARDS * CONTRACT_OFFER_CARD_PX + (AVAILABLE_VISIBLE_CARDS - 1) * SECTION_GAP_PX;

/** Available offers in display order (fillable first). */
export function orderOffers(
  available: readonly Contract[],
  collectedOre: Readonly<Record<string, number>>,
  rubbleStockKg: number,
): Contract[] {
  const fillable = (c: Contract): boolean => isFillableSaleOffer(c, collectedOre, rubbleStockKg);
  return [...available.filter(fillable), ...available.filter(c => !fillable(c))];
}

/** One-line roll-up of the player's active contracts. */
interface ActiveSummary {
  /** Number of active contracts. */
  count: number;
  /** Hours left on the soonest deadline (same conversion as the card's time-left, floored at 0). */
  nextDeadlineHours: number;
  /** Sum of penaltyAmount over active contracts, excluding rubble_disposal contracts. */
  penaltyTotal: number;
}

/** Summarize active contracts; null when there are none. */
export function summarizeActive(active: readonly Contract[], tickCount: number): ActiveSummary | null {
  if (active.length === 0) return null;
  let nextDeadlineHours = Infinity;
  let penaltyTotal = 0;
  for (const c of active) {
    nextDeadlineHours = Math.min(nextDeadlineHours, remainingTicksOf(c, tickCount));
    if (c.type !== 'rubble_disposal') penaltyTotal += c.penaltyAmount;
  }
  return { count: active.length, nextDeadlineHours, penaltyTotal };
}

function remainingTicksOf(c: Contract, tickCount: number): number {
  return Math.max(0, c.acceptedAtTick + c.deadlineTicks - tickCount);
}

/** Largest deliverable amount (kg, 0.1 kg steps) that never exceeds `maxDeliverableKg`. */
export function deliverableAmountKg(maxDeliverableKg: number): number {
  if (!(maxDeliverableKg > 0)) return 0;
  const floored = Math.floor(maxDeliverableKg * 10 + 1e-9) / 10;
  return floored < 0.1 ? 0 : Math.min(floored, maxDeliverableKg);
}

export class ContractsPanel extends PanelBase {
  private readonly statusEl: HTMLElement;
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

    this.statusEl = el('div', {
      attrs: { class: 'bs-contract-status', style: 'font:400 10px/1.4 var(--bsx-font-ui);color:var(--bsx-critical-text);min-height:14px' },
    });

    this.el.append(header, this.bodyEl, this.statusEl);
    container.appendChild(this.el);
  }

  setGameConsole(fn: GameConsoleFn): void { this.gameConsole = fn; }
  setNavigateHandler(cb: (panel: 'ops') => void): void { this.onNavigateCb = cb; }


  update(state: GameState): void {
    const market = this.marketInput(state, resolveContractOres(state));
    const signature = JSON.stringify({
      stored: Math.round(state.logistics.storedMassKg), spoil: Math.round(totalSpoilKg(state.buildings.buildings)), storedTenths: deliverableAmountKg(stateRubbleStockKg(state)), cap: state.logistics.storageCapacityKg,
      ore: state.collectedOre, oreTenths: Object.values(state.collectedOre).map(deliverableAmountKg),
      active: state.contracts.active.map(c => `${c.id}:${c.deliveredKg}:${c.acceptedAtTick}:${c.held ? 1 : 0}`),
      available: state.contracts.available.map(c => `${c.id}:${c.pricePerKg}:${c.quantityKg}:${c.penaltyAmount}:${c.deadlineTicks}:${c.negotiationAttempts ?? 0}:${contractAcceptBlocker(c, true, state.cash) === null ? 1 : 0}`),
      history: state.contracts.completedHistory.map(c => c.id),
      neg: state.contracts.lastNegotiation,
      managerLevel: bestAvailableManagerLevel(state.employees.employees),
      market: market && {
        grade: market.grade,
        sat: market.ores.map(o => Math.round(market.saturation(o) * 100)),
        tiers: state.contracts.available.map(c => c.buyerTier ?? ''),
      },
    });
    if (signature === this.lastSignature) {
      this.refreshDynamic(state);
      return;
    }
    this.lastSignature = signature;
    this.render(state);
  }

  refreshLocale(): void {
    this.locale.refresh();
    this.lastSignature = '';
  }


  private setStatus(msg: string): void {
    flashStatus(this.statusEl, msg);
  }

  private render(state: GameState): void {
    const managerLevel = bestAvailableManagerLevel(state.employees.employees);
    const siteOres = resolveContractOres(state);
    const activeHeader = sectionHeader(t('ui.contracts.active_count', { count: state.contracts.active.length }));
    const sections: (HTMLElement | null)[] = [
      this.makeMarketSection(state, siteOres),
      this.makeStorageStrip(state),
      this.makeActiveSummaryStrip(state, activeHeader),
      sectionHeader(t('ui.contracts.available_count', { count: state.contracts.available.length })),
      scrollBoundedSection(
        state.contracts.available.length > 0
          ? orderOffers(state.contracts.available, state.collectedOre, stateRubbleStockKg(state)).map(c => this.makeOfferedCard(c, state, managerLevel, siteOres))
          : [emptyState(t('ui.contracts.none'))],
        AVAILABLE_SECTION_MAX_PX,
        { gap: SECTION_GAP_PX, scrollKey: 'available' },
      ),
      activeHeader,
      scrollBoundedSection(
        state.contracts.active.length > 0
          ? state.contracts.active.map(c => this.makeActiveCard(c, state))
          : [emptyState(t('ui.contracts.none_active'))],
        200,
        { gap: SECTION_GAP_PX, scrollKey: 'active' },
      ),
      sectionHeader(t('ui.contracts.closed')),
      scrollBoundedSection(
        state.contracts.completedHistory.length > 0
          ? [...state.contracts.completedHistory].reverse().map(c => this.makeHistoryRow(c))
          : [emptyState(t('ui.contracts.none_closed'))],
        200,
        { gap: SECTION_GAP_PX, scrollKey: 'closed' },
      ),
    ];
    replaceChildrenKeepingScroll(this.bodyEl, sections);
  }

  /** Time-left text and urgency colour tick every hour; patch them in place so scroll and typed input survive. */
  private refreshDynamic(state: GameState): void {
    this.refreshActiveSummary(state);
    for (const c of state.contracts.active) {
      const cardEl = this.bodyEl.querySelector<HTMLElement>(`[data-contract-id="${c.id}"]`);
      if (!cardEl) continue;
      const color = this.urgencyColor(c, state.tickCount);
      const timeLeft = cardEl.querySelector<HTMLElement>('.bs-contract-time-left');
      if (timeLeft) {
        timeLeft.textContent = t('ui.contracts.time_left', { hours: remainingTicksOf(c, state.tickCount) });
        timeLeft.style.color = color;
      }
      const fill = cardEl.querySelector<HTMLElement>('.bsx-progress-fill');
      if (fill) fill.style.background = color;
    }
  }

  /** Kilograms of `materialId` available to deliver — collected ore by type, or barren rock (heaps plus barren stored fragments) for rubble ('' materialId). */
  private storedOf(materialId: string, state: GameState): number {
    return materialId === '' ? stateRubbleStockKg(state) : (state.collectedOre[materialId] ?? 0);
  }

  private materialLabel(materialId: string): string {
    return materialId === '' ? t('ui.contracts.material_rubble') : t(getOre(materialId)?.nameKey ?? materialId);
  }

  // ── Storage strip ──

  /** Market strip input; null before mine grades exist (no market yet). */
  private marketInput(state: GameState, ores: readonly string[]): MarketStripInput | null {
    if (state.grade === undefined) return null;
    return {
      grade: state.grade.grade, ores,
      saturation: saturationReader(state.saturation, state.tickCount),
      basePrice: ore => oreContractBasePrice(ore, state.contracts.market),
    };
  }

  private makeMarketSection(state: GameState, ores: readonly string[]): HTMLElement | null {
    const input = this.marketInput(state, ores);
    return input && ores.length > 0 ? makeMarketStrip(input) : null;
  }

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

  // ── Active summary strip ──

  /** The active contract with the soonest deadline: its urgency colours the strip. */
  private soonestActive(state: GameState): Contract | undefined {
    return state.contracts.active.reduce<Contract | undefined>(
      (best, c) => (!best || remainingTicksOf(c, state.tickCount) < remainingTicksOf(best, state.tickCount) ? c : best),
      undefined,
    );
  }

  private makeActiveSummaryStrip(state: GameState, activeHeader: HTMLElement): HTMLElement | null {
    const summary = summarizeActive(state.contracts.active, state.tickCount);
    const soonest = this.soonestActive(state);
    if (!summary || !soonest) return null;
    const strip = el('button', {
      className: 'bs-contract-active-summary',
      attrs: { type: 'button', style: 'display:flex;align-items:center;gap:8px;flex-shrink:0;width:100%;padding:6px 10px;border-radius:4px;border:1px solid var(--bsx-border,rgba(255,255,255,.1));background:rgba(255,255,255,.05);cursor:pointer;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:600 11px/1.2 var(--bsx-font-ui)' },
    });
    strip.dataset['action'] = 'goto-active';
    strip.append(
      el('span', {
        text: t('ui.contracts.active_summary', { count: summary.count }),
        className: 'bs-contract-active-summary-label',
        attrs: { style: 'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' },
      }),
      el('span', {
        text: t('ui.contracts.active_deadline', { hours: summary.nextDeadlineHours }),
        className: 'bs-contract-active-summary-deadline',
        attrs: { style: `flex-shrink:0;white-space:nowrap;color:${this.urgencyColor(soonest, state.tickCount)}` },
      }),
    );
    if (summary.penaltyTotal > 0) {
      strip.append(el('span', {
        text: t('ui.contracts.penalty_line', { amount: formatMoney(summary.penaltyTotal) }),
        attrs: { style: 'margin-left:auto;flex-shrink:0;white-space:nowrap;color:var(--bsx-critical-text)' },
      }));
    }
    strip.addEventListener('click', () => activeHeader.scrollIntoView?.({ block: 'start' }));
    return strip;
  }

  private refreshActiveSummary(state: GameState): void {
    const label = this.bodyEl.querySelector<HTMLElement>('.bs-contract-active-summary-label');
    const deadline = this.bodyEl.querySelector<HTMLElement>('.bs-contract-active-summary-deadline');
    const summary = summarizeActive(state.contracts.active, state.tickCount);
    const soonest = this.soonestActive(state);
    if (!label || !deadline || !summary || !soonest) return;
    label.textContent = t('ui.contracts.active_summary', { count: summary.count });
    deadline.textContent = t('ui.contracts.active_deadline', { hours: summary.nextDeadlineHours });
    deadline.style.color = this.urgencyColor(soonest, state.tickCount);
  }

  // ── Active ──

  private urgencyColor(c: Contract, tickCount: number): string {
    const remaining = remainingTicksOf(c, tickCount);
    const fraction = c.deadlineTicks > 0 ? remaining / c.deadlineTicks : 0;
    if (fraction > 0.5) return 'var(--bsx-positive)';
    if (fraction > 0.2) return 'var(--bsx-amber)';
    return 'var(--bsx-critical-text)';
  }

  private makeActiveCard(c: Contract, state: GameState): HTMLElement {
    const remainingTicks = remainingTicksOf(c, state.tickCount);
    const color = this.urgencyColor(c, state.tickCount);
    const pct = c.quantityKg > 0 ? Math.round((c.deliveredKg / c.quantityKg) * 100) : 0;
    const stored = this.storedOf(c.materialId, state);
    const maxDeliverable = deliverableAmountKg(Math.min(Math.max(0, remainingKg(c)), stored));

    const headRow = el('div');
    headRow.style.cssText = 'display:flex;align-items:center;gap:8px';
    headRow.append(
      iconEl(TYPE_ICON[c.type], 14),
      el('span', { text: this.materialLabel(c.materialId), attrs: { style: 'font:600 12px/1 var(--bsx-font-ui)' } }),
      el('span', { text: `#${c.id}`, attrs: { style: 'font:500 10px/1 var(--bsx-font-mono);color:var(--bsx-text-micro)' } }),
      ...(c.held ? [el('span', { text: t('ui.contracts.held_badge'), attrs: { class: 'bs-contract-held', style: 'font:700 9px/1 var(--bsx-font-ui);letter-spacing:.1em;padding:3px 5px;border-radius:3px;background:rgba(255,255,255,.08);color:var(--bsx-amber)' } })] : []),
      el('span', {
        text: t('ui.contracts.time_left', { hours: remainingTicks }),
        className: 'bs-contract-time-left',
        attrs: { style: `margin-left:auto;display:flex;align-items:center;gap:4px;font:700 10px/1 var(--bsx-font-ui);letter-spacing:.1em;color:${color}` },
      }),
    );

    const progressLine = el('div');
    progressLine.style.cssText = 'display:flex;gap:12px;font:500 10px/1 var(--bsx-font-mono);color:var(--bsx-text-secondary)';
    progressLine.append(
      el('span', { text: t('ui.contracts.delivered_line', { delivered: wholeKg(c.deliveredKg), total: wholeKg(c.quantityKg) }) }),
      this.activeMoneyLabel(c),
    );
    if (c.type !== 'rubble_disposal') {
      progressLine.append(el('span', { text: t('ui.contracts.penalty_line', { amount: formatMoney(c.penaltyAmount) }), attrs: { style: 'margin-left:auto;color:var(--bsx-critical-text)' } }));
    }

    const amountValue = maxDeliverable > 0 ? maxDeliverable : 0.1;
    const amountInput = el('input', { className: 'bs-contract-amount', attrs: { type: 'number', min: '0.1', step: '0.1', value: String(amountValue), 'data-preserve-key': `contract-amount-${c.id}` } }) as HTMLInputElement;
    amountInput.max = String(amountValue);
    amountInput.disabled = maxDeliverable <= 0;
    amountInput.style.cssText = `flex:1;${fieldStyle({ height: 30, padX: 10 })}`;

    const maxBtn = button('ghost', t('ui.contracts.max'), {
      dataAction: 'deliver-max',
      disabled: maxDeliverable <= 0,
      onClick: () => { amountInput.value = String(maxDeliverable); },
    });
    maxBtn.style.cssText = 'height:30px;padding:0 10px;font-size:10px';

    const deliverBtn = button('primary', t('ui.contracts.deliver'), {
      dataAction: 'deliver',
      disabled: maxDeliverable <= 0,
      onClick: () => {
        const result = this.gameConsole?.(`contract deliver ${c.id} amount:${amountInput.value}`);
        this.setStatus(result?.success === false ? (result.output || t('ui.contracts.deliver_failed')) : result ? '' : t('ui.contracts.deliver_failed'));
      },
    });
    deliverBtn.classList.add('bs-contract-deliver');
    deliverBtn.style.cssText = 'height:30px;padding:0 14px;font-size:10px';

    const deliverRow = el('div');
    deliverRow.style.cssText = 'display:flex;align-items:center;gap:7px';
    deliverRow.append(amountInput, maxBtn, deliverBtn);

    const holdBtn = button('ghost', t(c.held ? 'ui.contracts.resume' : 'ui.contracts.hold'), {
      dataAction: 'hold-toggle',
      onClick: () => this.gameConsole?.(`contract ${c.held ? 'release' : 'hold'} ${c.id}`),
    });
    holdBtn.style.cssText = 'height:30px;padding:0 10px;font-size:10px';
    deliverRow.append(holdBtn);

    const storedNote = el('span', {
      text: c.type === 'rubble_disposal'
        ? t('ui.contracts.stock_spoil_heaps', { kg: wholeKg(stored) })
        : t('ui.contracts.stored_note', { kg: wholeKg(stored), material: this.materialLabel(c.materialId) }),
      attrs: { style: 'font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' },
    });

    const cardEl = card([headRow, progressBar(pct, color), progressLine, deliverRow, storedNote]);
    cardEl.dataset['contractId'] = String(c.id);
    // See makeOfferedCard's own comment on data-contract-type/-material (#554).
    cardEl.dataset['contractType'] = c.type;
    cardEl.dataset['contractMaterial'] = c.materialId;
    return cardEl;
  }

  /** Money figure on an active card: rubble says Costs/Pays (#1892), other contracts a signed amount. */
  private activeMoneyLabel(c: Contract): HTMLElement {
    if (c.type === 'rubble_disposal') return this.rubbleMoneyLabel(c);
    return el('span', { text: `+$${formatMoney(contractTotal(c))}`, attrs: { style: 'color:var(--bsx-positive)' } });
  }

  /** Costs/Pays figure of a rubble contract, shared by the offered and the active card (#1892). */
  private rubbleMoneyLabel(c: Contract, attrs: Record<string, string> = {}): HTMLElement {
    const paid = isPaidClearance(c);
    return el('span', {
      text: t(paid ? 'ui.contracts.rubble_costs' : 'ui.contracts.rubble_pays', { amount: formatMoney(contractTotal(c)) }),
      attrs: { ...attrs, style: `color:var(${paid ? '--bsx-critical-text' : '--bsx-positive'})` },
    });
  }

  // ── Offered ──

  private makeOfferedCard(c: Contract, state: GameState, managerLevel: number | null, siteOres: readonly string[]): HTMLElement {
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
    const idSpan = el('span', { text: `#${c.id}`, attrs: { style: 'margin-left:auto;font:500 10px/1 var(--bsx-font-mono);color:var(--bsx-text-micro)' } });
    headRow.append(iconBox, titleCol, idSpan);
    if (c.buyerTier && state.grade !== undefined) headRow.insertBefore(makeBuyerBadge(c.buyerTier), idSpan);

    const statRow = el('div');
    statRow.style.cssText = 'display:flex;border-radius:4px;background:var(--bsx-well);overflow:hidden';
    statRow.append(
      this.miniStat(t('ui.contracts.qty'), `${c.quantityKg.toLocaleString('en-US')} kg`),
      this.miniStat(t('ui.contracts.price'), `$${formatPricePerKg(c.pricePerKg)}/kg`),
      this.miniStat(t('ui.contracts.total'), `$${formatMoney(contractTotal(c))}`, isPaidClearance(c) ? 'var(--bsx-critical-text)' : 'var(--bsx-positive)', true),
    );

    const haveRow = el('div');
    haveRow.style.cssText = 'display:flex;flex-direction:column;gap:5px';
    const haveLabels = el('div');
    haveLabels.style.cssText = 'display:flex;justify-content:space-between;font:400 10px/1 var(--bsx-font-ui);color:var(--bsx-text-secondary)';
    haveLabels.append(
      el('span', { text: t(c.type === 'rubble_disposal' ? 'ui.contracts.stock_spoil_heaps' : 'ui.contracts.have_line', { kg: wholeKg(stored) }) }),
      el('span', { text: t('ui.contracts.deadline_line', { hours: c.deadlineTicks }), attrs: { style: 'color:var(--bsx-text-micro)' } }),
    );
    haveRow.append(haveLabels, progressBar(havePct, haveColor));

    const termsRow = el('div');
    termsRow.style.cssText = 'display:flex;gap:10px;font:400 10px/1 var(--bsx-font-mono)';
    // Rubble is never fined, and a paid clearance has no early bonus either (#1892).
    if (c.type === 'rubble_disposal') {
      termsRow.append(
        el('span', { text: t('ui.contracts.rubble_removes', { kg: wholeKg(c.quantityKg) }), attrs: { class: 'bs-contract-removes' } }),
        this.rubbleMoneyLabel(c, { class: isPaidClearance(c) ? 'bs-contract-costs' : 'bs-contract-pays' }),
      );
      if (!isPaidClearance(c)) {
        termsRow.append(el('span', { text: t('ui.contracts.bonus_line', { amount: formatMoney(c.earlyBonus) }), attrs: { style: 'color:var(--bsx-positive)' } }));
      }
    } else {
      termsRow.append(
        el('span', { text: t('ui.contracts.penalty_line', { amount: formatMoney(c.penaltyAmount) }), attrs: { style: 'color:var(--bsx-critical-text)' } }),
        el('span', { text: t('ui.contracts.bonus_line', { amount: formatMoney(c.earlyBonus) }), attrs: { style: 'color:var(--bsx-positive)' } }),
      );
    }

    const neg = state.contracts.lastNegotiation;
    const negBox = neg && neg.contractId === c.id && neg.changes.length > 0 ? this.makeNegotiateResult(neg) : null;

    const blocked = contractAcceptBlocker(c, freightWarehouseSites(state.buildings).length > 0, state.cash);
    const acceptBtn = button('primary', t('ui.contracts.accept'), {
      dataAction: 'accept',
      ...(blocked === null ? {} : {
        disabled: true,
        title: blocked === 'insufficient_funds_for_fee'
          ? insufficientFundsText(contractTotal(c), state.cash)
          : t('economy.contract.needs_warehouse'),
      }),
      onClick: () => this.gameConsole?.(`contract accept id:${c.id}`),
    });
    acceptBtn.classList.add('bs-contract-accept');
    acceptBtn.style.cssText = 'flex:1;height:30px;font-size:10px';

    const refusal = negotiationRefusalReason(c, managerLevel);
    const negotiateBtn = button('ghost', t('ui.contracts.negotiate'), {
      dataAction: 'negotiate',
      ...(refusal === null ? {} : {
        disabled: true,
        title: t(refusal === 'no_manager' ? 'ui.contracts.negotiate_no_manager' : 'ui.contracts.negotiate_used'),
      }),
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

    const offSiteBadge = c.materialId === '' || siteOres.includes(c.materialId)
      ? null
      : el('span', { text: t('ui.contracts.not_on_site'), attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);color:var(--bsx-critical-text)' } });

    const cardEl = card([headRow, offSiteBadge, statRow, haveRow, termsRow, negBox, btnRow]);
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
    // Whether the site could fill this offer outright today, per
    // isFillableSaleOffer (a supply contract is never a one-click sale; on the
    // production market it is fillable by delivery over time, #1789), exposed so a
    // click can be scoped to an offer that can actually be
    // completed. Which ore the pool asks for and how much of it are both
    // random (Contract.ts's generateContracts), so a scenario that must sell
    // what its own blast produced cannot name the material up front and stay
    // true across a re-timing that re-rolls the pool.
    const onSite = offSiteBadge === null;
    cardEl.dataset['contractOnsite'] = String(onSite);
    if (c.type === 'rubble_disposal') cardEl.dataset['contractPays'] = String(!isPaidClearance(c));
    cardEl.dataset['contractFillable'] = String(isFillableSaleOffer(c, state.collectedOre, stateRubbleStockKg(state)));
    // Whether this sale alone lifts operating profit to the level's target, so a click can be
    // scoped to the offer that wins (the pool's fillable offers differ widely in payout, #1724).
    cardEl.dataset['contractWins'] = String(
      isWinningSaleOffer(c, state.collectedOre, getProfitShortfall(state.campaign.activeLevelId, state.finances)),
    );
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
    const color = ok && !isPaidClearance(c) ? 'var(--bsx-positive)' : 'var(--bsx-critical-text)';
    const settled = c.paidTotal ?? c.deliveredKg * c.pricePerKg;
    // Rubble carries no penalty: its row shows what was settled, expired or not (#1892).
    const outcome = ok || c.type === 'rubble_disposal'
      ? `${isPaidClearance(c) ? '-' : '+'}$${formatMoney(settled)}`
      : `-$${formatMoney(c.penaltyCharged ?? c.penaltyAmount)}`;
    // An expired contract may still have paid for what was delivered before the deadline.
    const paid = c.paidTotal ?? 0;
    const detail = !ok && paid > 0 && c.type !== 'rubble_disposal' ? ` · ${t('ui.contracts.history_paid', { amount: formatMoney(paid) })}` : '';
    const row = el('div');
    row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:4px;background:var(--bsx-well)';
    const col = el('div');
    col.style.cssText = 'display:flex;flex-direction:column;gap:2px';
    col.append(
      el('span', { text: this.materialLabel(c.materialId), attrs: { style: 'font:600 11px/1 var(--bsx-font-ui)' } }),
      el('span', { text: t(ok ? 'ui.contracts.history_completed' : 'ui.contracts.history_expired') + detail, attrs: { style: 'font:400 11px/1 var(--bsx-font-ui);color:var(--bsx-text-micro)' } }),
    );
    row.append(
      el('span', { text: `#${c.id}`, attrs: { style: 'font:500 10px/1 var(--bsx-font-mono);color:var(--bsx-text-micro)' } }),
      col,
      el('span', { text: outcome, attrs: { style: `margin-left:auto;font:600 11px/1 var(--bsx-font-mono);color:${color}` } }),
    );
    return row;
  }
}
