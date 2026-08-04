// BlastSimulator2026 — Finances panel (redesign P5)
// Balance + trend + runway, per-category income/expense bars
// (getFinancialReport), recent transactions ledger, bankruptcy countdown.
// Opened only from the TopBar balance click — no tool-rail entry, per the
// implementation plan's own wording ("Top-bar balance click opens it");
// Operations gets the rail slot instead.
//
// Deviations from the design mock: "THIS LEVEL" framing dropped —
// FinanceState accumulates for the whole run, not per level (LevelTransition
// .ts itself calls getFinancialReport with periodTicks=0 to read all-time
// profit at a level boundary), so a per-level reset the panel could honestly
// report doesn't exist; the section shows all-time totals instead. The
// ledger shows category + day rather than the mock's free-text description:
// Transaction.description is core-generated English prose ("Contract #3
// delivery", "Salary payment", …) written at dozens of addIncome/addExpense
// call sites across every subsystem — restructuring all of them to emit
// localizable data is out of scope for a money-surfaces panel. category is
// real, a closed set of 14 values, and fully localizable, so that carries
// the row instead.

import { t } from '../../core/i18n/I18n.js';
import { el, card, sectionHeader, emptyState, progressBar } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import { formatMoney } from '../../core/economy/formatMoney.js';
import { getFinancialReport, type CategoryTotal } from '../../core/economy/Finance.js';
import { formatBalance, netPerTick } from '../shell/TopBar.js';
import type { GameState } from '../../core/state/GameState.js';

const RECENT_TRANSACTIONS = 15;

export class FinancesPanel {
  private readonly el: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private onCloseCb?: () => void;
  private lastSignature = '';
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    this.el = el('div', { className: 'bsx-root', attrs: { id: 'bs-finances-panel' } });
    this.el.style.cssText = [
      'flex-direction:column', 'width:372px', 'max-height:100%',
      'border-radius:8px', 'background:var(--bsx-panel)', 'border:1px solid var(--bsx-hairline-strong)',
      'box-shadow:0 18px 44px rgba(0,0,0,.55)', 'overflow:hidden', 'pointer-events:all',
    ].join(';');
    this.el.style.display = 'none';

    const header = el('div');
    header.style.cssText = 'flex:0 0 auto;display:flex;align-items:center;gap:10px;height:46px;padding:0 12px;background:#1a2028;border-bottom:1px solid var(--bsx-hairline)';
    const iconChip = el('div', { children: [iconEl('finance', 15)] });
    iconChip.style.cssText = 'width:26px;height:26px;border-radius:5px;display:flex;align-items:center;justify-content:center;background:rgba(255,176,46,.14);color:var(--bsx-amber)';
    const titleEl = this.locale.bindText(
      el('div', { attrs: { style: 'font:700 12px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-primary)' } }),
      'ui.finances.title',
    );
    const closeBtn = el('button', { children: [iconEl('x', 12)] });
    closeBtn.style.cssText = 'margin-left:auto;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:1px solid var(--bsx-hairline-strong);border-radius:4px;background:transparent;color:var(--bsx-text-muted);cursor:pointer';
    closeBtn.addEventListener('click', () => this.onCloseCb?.());
    header.append(iconChip, titleEl, closeBtn);

    this.bodyEl = el('div');
    this.bodyEl.style.cssText = 'flex:1 1 auto;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px';

    this.el.append(header, this.bodyEl);
    container.appendChild(this.el);
  }

  get root(): HTMLElement { return this.el; }
  setCloseHandler(cb: () => void): void { this.onCloseCb = cb; }

  show(): void { this.el.style.display = 'flex'; }
  hide(): void { this.el.style.display = 'none'; }
  get visible(): boolean { return this.el.style.display !== 'none'; }

  update(state: GameState): void {
    const signature = JSON.stringify({
      cash: Math.round(state.cash),
      txCount: state.finances.transactions.length,
      belowThreshold: state.bankruptcy.ticksBelowThreshold,
      bankrupt: state.bankruptcy.bankrupt,
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

  dispose(): void { this.el.remove(); }

  private render(state: GameState): void {
    const report = getFinancialReport(state.finances, state.tickCount, 0);
    const sections: HTMLElement[] = [
      this.makeBalanceCard(state),
      sectionHeader(t('ui.finances.income')),
      ...this.makeCategoryRows(report.incomeByCategory, report.totalIncome, 'var(--bsx-positive)', t('ui.finances.none_income')),
      sectionHeader(t('ui.finances.expenses')),
      ...this.makeCategoryRows(report.expensesByCategory, report.totalExpenses, 'var(--bsx-critical-text)', t('ui.finances.none_expenses')),
      sectionHeader(t('ui.finances.ledger')),
      ...this.makeLedger(state),
    ];
    this.bodyEl.replaceChildren(...sections);
  }

  // ── Balance ──

  private makeBalanceCard(state: GameState): HTMLElement {
    const label = el('span', { text: t('ui.finances.balance'), attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-micro)' } });
    const value = el('span', {
      text: formatBalance(state.cash),
      attrs: { style: `font:600 28px/1 var(--bsx-font-mono);letter-spacing:-.02em;color:${state.cash < 0 ? 'var(--bsx-critical-text)' : 'var(--bsx-amber)'}` },
    });

    const net = netPerTick(state);
    const positive = net >= 0;
    const trendRow = el('div');
    trendRow.style.cssText = `display:flex;align-items:center;gap:5px;font:500 11px/1 var(--bsx-font-mono);color:${positive ? 'var(--bsx-positive)' : 'var(--bsx-critical-text)'}`;
    trendRow.append(
      iconEl(positive ? 'up' : 'down', 9),
      el('span', { text: `${positive ? '+' : '-'}$${formatMoney(Math.abs(net))}/h` }),
      el('span', { text: '·', attrs: { style: 'color:var(--bsx-text-micro)' } }),
      el('span', {
        text: positive ? t('ui.finances.runway_growing') : t('ui.finances.runway_days', { days: Math.max(0, state.cash / -net / 24).toFixed(1) }),
        attrs: { style: 'color:var(--bsx-text-secondary)' },
      }),
    );

    const children: (HTMLElement | null)[] = [label, value, trendRow];
    if (state.bankruptcy.bankrupt) {
      children.push(this.makeBankruptcyBanner(t('campaign.bankrupt'), true));
    } else if (state.bankruptcy.ticksBelowThreshold > 0) {
      const ticksRemaining = Math.max(0, 100 - state.bankruptcy.ticksBelowThreshold);
      children.push(this.makeBankruptcyBanner(t('notification.bankruptcy_warning', { ticksRemaining }), false));
    }

    return card(children);
  }

  private makeBankruptcyBanner(text: string, critical: boolean): HTMLElement {
    const wrap = el('div');
    const color = critical ? 'var(--bsx-critical-text)' : 'var(--bsx-amber)';
    wrap.style.cssText = `display:flex;gap:7px;align-items:center;padding:7px 9px;border-radius:4px;background:${critical ? 'rgba(255,91,76,.12)' : 'rgba(255,176,46,.12)'};border:1px solid ${critical ? 'rgba(255,91,76,.35)' : 'rgba(255,176,46,.35)'}`;
    wrap.append(
      el('div', { attrs: { style: `color:${color}` }, children: [iconEl(critical ? 'skull' : 'warn', 12)] }),
      el('span', { text, attrs: { style: `font:600 10px/1.3 var(--bsx-font-ui);color:${color}` } }),
    );
    return wrap;
  }

  // ── Category bars ──

  private makeCategoryRows(categories: CategoryTotal[], sectionTotal: number, color: string, emptyText: string): HTMLElement[] {
    if (categories.length === 0) return [emptyState(emptyText)];
    const sorted = [...categories].sort((a, b) => b.total - a.total);
    return sorted.map(cat => {
      const pct = sectionTotal > 0 ? Math.round((cat.total / sectionTotal) * 100) : 0;
      const row = el('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px';
      row.append(
        el('span', { text: t(`ui.finances.category.${cat.category}`), attrs: { style: 'font:400 11px/1 var(--bsx-font-ui);color:var(--bsx-text-secondary);width:88px;flex:0 0 88px' } }),
        el('div', { attrs: { style: 'flex:1' }, children: [progressBar(pct, color)] }),
        el('span', { text: `$${formatMoney(cat.total)}`, attrs: { style: `font:500 11px/1 var(--bsx-font-mono);color:${color};width:66px;text-align:right;flex:0 0 66px` } }),
      );
      return row;
    });
  }

  // ── Ledger ──

  private makeLedger(state: GameState): HTMLElement[] {
    const recent = state.finances.transactions.slice(-RECENT_TRANSACTIONS).reverse();
    if (recent.length === 0) return [emptyState(t('ui.finances.none_transactions'))];
    return recent.map(tx => {
      const day = Math.floor(tx.tick / 24) + 1;
      const color = tx.type === 'income' ? 'var(--bsx-positive)' : 'var(--bsx-critical-text)';
      const row = el('div');
      row.style.cssText = 'display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:4px;background:var(--bsx-well)';
      const col = el('div');
      col.style.cssText = 'display:flex;flex-direction:column;gap:2px;flex:1;min-width:0';
      col.append(
        el('span', { text: t(`ui.finances.category.${tx.category}`), attrs: { style: 'font:500 11px/1.2 var(--bsx-font-ui)' } }),
        el('span', { text: t('ui.finances.ledger_day', { day }), attrs: { style: 'font:600 10px/1 var(--bsx-font-mono);color:var(--bsx-text-micro)' } }),
      );
      row.append(col, el('span', {
        text: `${tx.type === 'income' ? '+' : '-'}$${formatMoney(tx.amount)}`,
        attrs: { style: `font:600 11px/1 var(--bsx-font-mono);color:${color}` },
      }));
      return row;
    });
  }
}
