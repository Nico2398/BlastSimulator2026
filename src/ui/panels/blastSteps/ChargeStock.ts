// BlastSimulator2026 — Blast Workshop Charge step: warehouse stock block (#1685)
// Stock per offered explosive, buy-into-stock control and the paid-from line.
// A pure view builder (core numbers in, plain data out) plus a small renderer.

import { t } from '../../../core/i18n/I18n.js';
import { el, stepper, sectionHeader, button } from '../../dom.js';
import { formatMoney } from '../../../core/economy/formatMoney.js';
import { getExplosive } from '../../../core/world/ExplosiveCatalog.js';
import { stockAwareChargesCost } from '../../../core/mining/ChargePlan.js';
import {
  buyStockBlockReason, bulkPricePerKg, explosivePriceFactor, orderDeliveryTicks, type BuyStockFailure,
} from '../../../core/mining/ExplosiveStock.js';
import { earliestChargeDeliveryTick } from '../../../core/mining/ChargeOrder.js';
import { getExplosivesCapacity, getExplosivesFreeCapacity, getExplosivesStockByType } from '../../../core/entities/Building.js';
import { STOCK_BUY_STEP_KG } from '../../../core/config/balance.js';
import type { GameState } from '../../../core/state/GameState.js';

/** Everything the stock block draws, as plain data. Also serves as the repaint signature. */
interface StockView {
  rows: Array<{ id: string; nameKey: string; kg: number }>;
  buyKg: number;
  /** Bulk cost of the selected purchase (list order price x bulk factor x live event factor). */
  buyCost: number;
  blockReason: BuyStockFailure | null;
  freeKg: number;
  /** Cash a refused purchase would have needed (insufficient_funds). */
  need: number;
  paidFromStockKg: number;
  paidCash: number;
  selectedId: string;
  /** Kg of the planned pattern neither covered by stock nor yet delivered (#1895). */
  uncoveredKg: number;
  /** Delivery wait in ticks for the cash-bought part (#1895). */
  deliveryTicks: number;
  hasWarehouse: boolean;
  /** Tick an in-transit delivery arrives, or null (#1895). */
  inTransitUntilTick: number | null;
  /** Current tick while a delivery is in transit (0 otherwise), so the countdown repaints (#1895). */
  nowTick: number;
}

/** Stock view for the Charge step; `holeCount` x `amountKg` of the selected explosive is the current pattern. */
export function buildStockView(
  state: GameState, offeredIds: readonly string[], selectedId: string, buyKg: number, holeCount: number, amountKg: number,
): StockView {
  const stock = getExplosivesStockByType(state.buildings);
  const rows = offeredIds.flatMap(id => {
    const explosive = getExplosive(id);
    return explosive ? [{ id, nameKey: explosive.nameKey, kg: Math.round(stock[id] ?? 0) }] : [];
  });
  const buyCost = buyKg * bulkPricePerKg(selectedId, explosivePriceFactor(state));
  const orders = Array.from({ length: holeCount }, () => ({ explosiveId: selectedId, amountKg }));
  const split = stockAwareChargesCost(orders, stock);
  const uncoveredKg = Math.round(split.totalKg - split.fromStockKg);
  const inTransitUntilTick = earliestChargeDeliveryTick(state);
  return {
    rows, buyKg, buyCost, selectedId,
    blockReason: buyStockBlockReason(state, selectedId, buyKg),
    freeKg: Math.floor(getExplosivesFreeCapacity(state.buildings)),
    need: Math.ceil(buyCost),
    paidFromStockKg: Math.round(split.fromStockKg),
    paidCash: split.cashCost,
    uncoveredKg,
    deliveryTicks: orderDeliveryTicks(uncoveredKg),
    hasWarehouse: getExplosivesCapacity(state.buildings) > 0,
    inTransitUntilTick,
    // Only while a delivery is in transit: the remaining ticks repaint per tick, otherwise the view stays still.
    nowTick: inTransitUntilTick === null ? 0 : state.tickCount,
  };
}

export class ChargeStockBlock {
  private readonly el: HTMLElement;
  private readonly rowsEl: HTMLElement;
  private readonly valueEl: HTMLElement;
  private readonly buyHostEl: HTMLElement;
  private readonly paidEl: HTMLElement;
  private buyKg = STOCK_BUY_STEP_KG;
  private blocked = false;

  /** `onChange` fires after the step size changes (repaint); `onBuy` receives the kg to buy. */
  constructor(private readonly onChange: () => void, private readonly onBuy: (kg: number) => void) {
    this.el = el('div');
    this.el.style.cssText = 'display:flex;flex-direction:column;gap:6px';
    this.rowsEl = el('div');
    this.rowsEl.style.cssText = 'display:flex;flex-direction:column;gap:2px';
    const stepperEl = stepper(`${this.buyKg} kg`, () => this.adjust(-STOCK_BUY_STEP_KG), () => this.adjust(STOCK_BUY_STEP_KG));
    this.valueEl = stepperEl.querySelector('.bsx-stepper-value') as HTMLElement;
    const field = el('div', { attrs: { 'data-field': 'stock-kg' }, children: [stepperEl] });
    this.buyHostEl = el('div');
    this.buyHostEl.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    this.paidEl = el('div');
    this.el.append(sectionHeader(t('ui.blast_workshop.charge.stock_section')), this.rowsEl, field, this.buyHostEl, this.paidEl);
  }

  get root(): HTMLElement { return this.el; }
  get stepKg(): number { return this.buyKg; }

  render(view: StockView): void {
    this.blocked = view.blockReason !== null;
    this.valueEl.textContent = `${view.buyKg} kg`;
    this.rowsEl.replaceChildren(...view.rows.map(r => {
      const row = el('div', {
        text: t('ui.blast_workshop.charge.stock_row', { name: t(r.nameKey), kg: r.kg }),
        attrs: { style: 'font:400 11px/1.4 var(--bsx-font-mono);color:var(--bsx-text-secondary)' },
      });
      row.dataset['stock'] = r.id;
      row.dataset['kg'] = String(r.kg);
      return row;
    }));

    const buyBtn = button('ghost', t('ui.blast_workshop.charge.stock_buy', { kg: view.buyKg, cost: `$${formatMoney(view.buyCost)}` }), {
      dataAction: 'stock-buy',
      onClick: () => { if (!this.blocked) this.onBuy(this.buyKg); },
    });
    buyBtn.disabled = this.blocked;
    const reason = view.blockReason === null ? [] : [this.reasonEl(view)];
    this.buyHostEl.replaceChildren(buyBtn, ...reason);

    const paid = el('div', {
      text: t('ui.blast_workshop.charge.paid_from', { kg: view.paidFromStockKg, cash: `$${formatMoney(view.paidCash)}` }),
      attrs: { style: 'font:400 11px/1.4 var(--bsx-font-ui);color:var(--bsx-text-secondary)' },
    });
    paid.dataset['info'] = 'paid-from';
    paid.dataset['cash'] = String(Math.round(view.paidCash));
    const notes: HTMLElement[] = [paid];
    // No hint for a fully stock-covered pattern; a stocked warehouse is what makes that so.
    if (view.uncoveredKg > 0) {
      notes.push(this.noteEl('delivery-hint', t('ui.blast_workshop.charge.delivery_hint', { ticks: view.deliveryTicks })));
    }
    if (view.inTransitUntilTick !== null) {
      const remaining = Math.max(0, view.inTransitUntilTick - view.nowTick);
      notes.push(this.noteEl('delivery-transit', t('ui.blast_workshop.charge.delivery_transit', { tick: view.inTransitUntilTick, remaining })));
    }
    this.paidEl.replaceChildren(...notes);
  }

  private noteEl(info: string, text: string): HTMLElement {
    const line = el('div', {
      text,
      attrs: { style: `font:500 10px/1.4 var(--bsx-font-ui);color:var(--bsx-amber)` },
    });
    line.dataset['info'] = info;
    return line;
  }

  private reasonEl(view: StockView): HTMLElement {
    // Not `.bsx-reason`: that class marks the step's charge-blocking reasons, which a stock refusal is not.
    const line = el('div', {
      text: t(`ui.blast_workshop.charge.stock_reason_${view.blockReason}`, { free: view.freeKg, need: `$${formatMoney(view.need)}` }),
      attrs: { style: 'font:500 10px/1.4 var(--bsx-font-ui);color:var(--bsx-amber)' },
    });
    line.dataset['info'] = 'stock-buy-reason';
    return line;
  }

  private adjust(delta: number): void {
    this.buyKg = Math.max(STOCK_BUY_STEP_KG, this.buyKg + delta);
    this.valueEl.textContent = `${this.buyKg} kg`;
    this.onChange();
  }
}
