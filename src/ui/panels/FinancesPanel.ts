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

import { PanelBase } from './PanelBase.js';
import { t } from '../../core/i18n/I18n.js';
import { formatGameDuration } from '../formatGameDuration.js';
import { el, card, sectionHeader, emptyState, progressBar, panelRoot, panelHeader, panelBody, scrollBoundedSection } from '../dom.js';
import { iconEl } from '../icons.js';
import { LocaleTextRegistry } from '../localeText.js';
import { formatMoney, formatDollars } from '../../core/economy/formatMoney.js';
import { getFinancialReport, type CategoryTotal } from '../../core/economy/Finance.js';
import type { OperatingCostBreakdown } from '../../core/economy/OperatingFinance.js';
import { getOperatingCostPerHour, getOperatingIncomePerHour, getOperatingNetPerHour, getRunway } from '../../core/economy/OperatingFinance.js';
import type { GameState } from '../../core/state/GameState.js';
import { BANKRUPTCY_GRACE_TICKS } from '../../core/campaign/Bankruptcy.js';

const RECENT_TRANSACTIONS = 15;

export class FinancesPanel extends PanelBase {
  private readonly bodyEl: HTMLElement;
  private lastSignature = '';
  private readonly locale = new LocaleTextRegistry();

  constructor(container: HTMLElement) {
    super(panelRoot('bs-finances-panel'));

    const { header, titleEl } = panelHeader({
      icon: 'finance',
      accent: 'amber',
      onClose: () => this.onCloseCb?.(),
    });
    this.locale.bindText(titleEl, 'ui.finances.title');

    this.bodyEl = panelBody(10);

    this.el.append(header, this.bodyEl);
    container.appendChild(this.el);
  }



  update(state: GameState): void {
    const cost = getOperatingCostPerHour(state);
    const signature = JSON.stringify({
      cash: Math.round(state.cash),
      cost,
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


  private render(state: GameState): void {
    const report = getFinancialReport(state.finances, state.tickCount, 0);
    const sections: HTMLElement[] = [
      this.makeBalanceCard(state),
      sectionHeader(t('ui.finances.income')),
      ...this.makeCategoryRows(report.incomeByCategory, report.totalIncome, 'var(--bsx-positive)', t('ui.finances.none_income')),
      sectionHeader(t('ui.finances.expenses')),
      ...this.makeCategoryRows(report.expensesByCategory, report.totalExpenses, 'var(--bsx-critical-text)', t('ui.finances.none_expenses')),
      sectionHeader(t('ui.finances.ledger')),
      scrollBoundedSection(this.makeLedger(state), 200, { gap: 10 }),
    ];
    this.bodyEl.replaceChildren(...sections);
  }

  // ── Balance ──

  private makeBalanceCard(state: GameState): HTMLElement {
    const label = el('span', { text: t('ui.finances.balance'), attrs: { style: 'font:600 10px/1 var(--bsx-font-ui);letter-spacing:.14em;color:var(--bsx-text-micro)' } });
    const value = el('span', {
      text: formatDollars(state.cash),
      attrs: { style: `font:600 28px/1 var(--bsx-font-mono);letter-spacing:-.02em;color:${state.cash < 0 ? 'var(--bsx-critical-text)' : 'var(--bsx-amber)'}` },
    });

    const cost = getOperatingCostPerHour(state);
    const income = getOperatingIncomePerHour(state.finances, state.tickCount);
    const net = getOperatingNetPerHour(income, cost.total);
    const runway = getRunway(state.cash, cost.total, income);
    const positive = net >= 0;
    const trendRow = el('div');
    trendRow.style.cssText = `display:flex;align-items:center;gap:5px;font:500 11px/1 var(--bsx-font-mono);color:${positive ? 'var(--bsx-positive)' : 'var(--bsx-critical-text)'}`;
    trendRow.title = t('ui.finances.operating_cost_tip', { cost: formatDollars(Math.round(cost.total)) });
    trendRow.append(
      iconEl(positive ? 'up' : 'down', 9),
      el('span', { text: `${positive ? '+' : '-'}$${formatMoney(Math.abs(net))}/h` }),
      el('span', { text: '·', attrs: { style: 'color:var(--bsx-text-micro)' } }),
      el('span', {
        text: runway.kind === 'sustainable' ? t('ui.finances.runway_sustainable') : t('ui.finances.runway_days', { days: runway.days.toFixed(1) }),
        attrs: { style: 'color:var(--bsx-text-secondary)' },
      }),
    );

    const children: (HTMLElement | null)[] = [label, value, trendRow, ...this.makeOperatingCostRows(cost)];
    if (state.bankruptcy.bankrupt) {
      children.push(this.makeBankruptcyBanner(t('campaign.bankrupt'), true));
    } else if (state.bankruptcy.ticksBelowThreshold > 0) {
      const ticksRemaining = Math.max(0, BANKRUPTCY_GRACE_TICKS - state.bankruptcy.ticksBelowThreshold);
      children.push(this.makeBankruptcyBanner(t('notification.bankruptcy_warning', { duration: formatGameDuration(ticksRemaining) }), false));
    }

    return card(children);
  }

  private makeOperatingCostRows(cost: OperatingCostBreakdown): HTMLElement[] {
    const row = (key: string, amount: number, strong: boolean): HTMLElement => {
      const r = el('div');
      r.style.cssText = `display:flex;justify-content:space-between;font:${strong ? 600 : 400} 10px/1.3 var(--bsx-font-ui);color:var(--bsx-text-secondary)`;
      r.append(el('span', { text: t(key) }), el('span', { text: `$${formatMoney(amount)}/h`, attrs: { style: 'font-family:var(--bsx-font-mono)' } }));
      return r;
    };
    return [
      row('ui.finances.operating_cost', cost.total, true),
      row('ui.finances.operating_cost_payroll', cost.payroll, false),
      row('ui.finances.operating_cost_buildings', cost.buildings, false),
      row('ui.finances.operating_cost_vehicles', cost.vehicleMaintenance, false),
      row('ui.finances.operating_cost_fuel', cost.fuel, false),
    ];
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
