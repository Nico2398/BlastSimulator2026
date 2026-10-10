// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { FinancesPanel } from '../../../../src/ui/panels/FinancesPanel.js';
import { createGame } from '../../../../src/core/state/GameState.js';
import { formatGameDuration } from '../../../../src/ui/formatGameDuration.js';
import { hireEmployee, PAY_CYCLE_TICKS } from '../../../../src/core/entities/Employee.js';
import { Random } from '../../../../src/core/math/Random.js';
import { TICKS_PER_DAY } from '../../../../src/core/config/balance.js';
import { t, setLocale } from '../../../../src/core/i18n/I18n.js';
import { getOperatingSummary } from '../../../../src/core/economy/OperatingFinance.js';
import { purchaseVehicle, getVehicleDefByTier } from '../../../../src/core/entities/Vehicle.js';
import { formatMoney } from '../../../../src/core/economy/formatMoney.js';
import { BANKRUPTCY_GRACE_TICKS } from '../../../../src/core/campaign/Bankruptcy.js';
import type { GameState } from '../../../../src/core/state/GameState.js';

function makeState(): GameState {
  const s = createGame({ seed: 1, mineType: 'desert' });
  s.cash = 75000;
  s.tickCount = 100;
  return s;
}

function makePanel(): { panel: FinancesPanel; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const panel = new FinancesPanel(container);
  return { panel, container };
}

describe('FinancesPanel', () => {
  it('is hidden until show() is called', () => {
    const { panel } = makePanel();
    expect(panel.visible).toBe(false);
  });

  it('shows the real balance', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    expect(panel.root.textContent).toContain('$75,000');
  });

  it('shows empty states with no transactions at all', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    const text = panel.root.textContent ?? '';
    expect(text).toContain('No income yet');
    expect(text).toContain('No expenses yet');
    expect(text).toContain('No transactions yet');
  });

  it('shows a runway line for a mine with nothing running (sustainable)', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    expect(panel.root.textContent).toContain(t('ui.finances.runway_sustainable'));
    expect(t('ui.finances.runway_sustainable')).not.toBe('ui.finances.runway_sustainable');
  });

  it('reads sustainable when operating income covers operating cost', () => {
    const { panel } = makePanel();
    const state = makeState();
    hireEmployee(state.employees, 'driller', new Random(1));
    state.finances.transactions.push({ tick: 99, type: 'income', amount: 100000, category: 'sales', description: 'x' });
    panel.show();
    panel.update(state);
    expect(panel.root.textContent).toContain(t('ui.finances.runway_sustainable'));
    expect(panel.root.textContent).not.toContain('d runway');
  });

  it('computes runway days from operating cost, not from the ledger burn', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.cash = 2400;
    hireEmployee(state.employees, 'manager', new Random(1));
    const perHour = state.employees.employees[0]!.salary / PAY_CYCLE_TICKS;
    // a huge one-off purchase must not move the runway
    state.finances.transactions.push({ tick: 99, type: 'expense', amount: 35000, category: 'equipment', description: 'rig' });
    panel.show();
    panel.update(state);
    const days = (2400 / perHour / TICKS_PER_DAY).toFixed(1);
    expect(panel.root.textContent).toContain(`${days}d runway`);
  });

  it('formats runway days with the locale decimal separator', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.cash = 2400;
    hireEmployee(state.employees, 'manager', new Random(1));
    const perHour = state.employees.employees[0]!.salary / PAY_CYCLE_TICKS;
    const days = (2400 / perHour / TICKS_PER_DAY).toFixed(1);
    setLocale('fr');
    try {
      panel.show();
      panel.update(state);
      expect(panel.root.textContent).toContain(days.replace('.', ','));
    } finally {
      setLocale('en');
    }
  });

  it('shows an Operating cost / h row with the payroll breakdown', () => {
    const { panel } = makePanel();
    const state = makeState();
    hireEmployee(state.employees, 'manager', new Random(1));
    const perHour = Math.round(state.employees.employees[0]!.salary / PAY_CYCLE_TICKS);
    panel.show();
    panel.update(state);
    const text = panel.root.textContent ?? '';
    expect(text).toContain(t('ui.finances.operating_cost'));
    expect(text).toContain(t('ui.finances.operating_cost_payroll'));
    expect(text).toContain(t('ui.finances.operating_cost_buildings'));
    expect(text).toContain(t('ui.finances.operating_cost_vehicles'));
    expect(text).toContain(t('ui.finances.operating_cost_fuel'));
    expect(text).toContain(`$${perHour.toLocaleString('en-US')}`);
    expect(text).not.toContain('ui.finances.operating_cost');
  });

  it('a one-off vehicle purchase expense leaves operating cost alone; owning the vehicle adds exactly its maintenance', () => {
    const state = makeState();
    hireEmployee(state.employees, 'manager', new Random(1));
    const before = getOperatingSummary(state).cost;
    state.finances.transactions.push({ tick: 99, type: 'expense', amount: 35000, category: 'equipment', description: 'rig' });
    expect(getOperatingSummary(state).cost.total).toBe(before.total);

    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    const maintenance = getVehicleDefByTier(vehicle.type, vehicle.tier).maintenanceCostPerTick;
    const after = getOperatingSummary(state).cost;
    expect(after.total - before.total).toBeCloseTo(maintenance, 8);
    expect(after.vehicleMaintenance - before.vehicleMaintenance).toBeCloseTo(maintenance, 8);

    const { panel } = makePanel();
    panel.show();
    panel.update(state);
    expect(panel.root.textContent).toContain(`$${formatMoney(after.total)}/h`);
  });

  it('labels vehicle maintenance under its own category', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.finances.transactions.push(
      { tick: 3, type: 'expense', amount: 321, category: 'vehicle_maintenance', description: 'x' },
    );
    panel.show();
    panel.update(state);
    const text = panel.root.textContent ?? '';
    expect(text).toContain(t('ui.finances.category.vehicle_maintenance'));
    expect(text).not.toContain('ui.finances.category.vehicle_maintenance');
    expect(text).toContain('$321');
  });

  it('renders income and expense category bars from getFinancialReport, sorted by size', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.finances.transactions.push(
      { tick: 1, type: 'income', amount: 100, category: 'contracts', description: 'a' },
      { tick: 2, type: 'income', amount: 500, category: 'sales', description: 'b' },
      { tick: 3, type: 'expense', amount: 200, category: 'fuel', description: 'c' },
    );
    panel.show();
    panel.update(state);

    const text = panel.root.textContent ?? '';
    expect(text).toContain('Sales');
    expect(text).toContain('$500');
    expect(text).toContain('Contracts');
    expect(text).toContain('Fuel');
    expect(text).toContain('$200');
  });

  it('renders a localized smuggling income line (#1408)', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.finances.transactions.push(
      { tick: 5, type: 'income', amount: 8000, category: 'smuggling', description: 'Smuggling' },
    );
    panel.show();
    panel.update(state);
    const text = panel.root.textContent ?? '';
    expect(text).toContain(t('ui.finances.category.smuggling'));
    expect(text).toContain('Smuggling');
    expect(text).toContain('$8,000');
    expect(text).not.toContain('ui.finances.category.smuggling');
  });

  it('renders the ledger most-recent-first with category and day, not raw description', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.tickCount = 50;
    state.finances.transactions.push(
      { tick: 24, type: 'income', amount: 300, category: 'contracts', description: 'Contract #1 delivery' },
      { tick: 48, type: 'expense', amount: 150, category: 'salaries', description: 'Payroll' },
    );
    panel.show();
    panel.update(state);

    const rows = Array.from(panel.root.querySelectorAll('div')).map(d => d.textContent);
    expect(rows.some(r => r?.includes('Salaries') && r.includes('Day 3'))).toBe(true);
    expect(panel.root.textContent).not.toContain('Payroll');
    expect(panel.root.textContent).not.toContain('Contract #1 delivery');
  });

  it('shows a bankruptcy warning banner when below threshold', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.bankruptcy.ticksBelowThreshold = 40;
    panel.show();
    panel.update(state);
    expect(panel.root.textContent).toContain('Bankruptcy in');
  });

  it('shows the bankrupt banner once bankruptcy has actually triggered', () => {
    const { panel } = makePanel();
    const state = makeState();
    state.bankruptcy.bankrupt = true;
    panel.show();
    panel.update(state);
    expect(panel.root.textContent).toContain('mine has been seized');
  });

  it('Close dispatches the close handler', () => {
    const { panel } = makePanel();
    let closed = false;
    panel.setCloseHandler(() => { closed = true; });
    panel.show();
    panel.update(makeState());
    (panel.root.querySelector('button') as HTMLButtonElement).click();
    expect(closed).toBe(true);
  });

  it('refreshLocale() does not throw', () => {
    const { panel } = makePanel();
    panel.show();
    panel.update(makeState());
    expect(() => panel.refreshLocale()).not.toThrow();
  });

  it('dispose() removes the panel from the DOM', () => {
    const { panel, container } = makePanel();
    panel.dispose();
    expect(container.contains(panel.root)).toBe(false);
  });
});

// ── Scroll-bounded ledger section (#958) ────────────────────────────────────
//
// bodyEl (this.el.append(header, this.bodyEl) in the constructor) is always
// the panel root's second child. The ledger (makeLedger, capped at
// RECENT_TRANSACTIONS=15 but still one row per transaction) is spread
// directly into bodyEl after the fixed Income/Expenses category rows — the
// fix nests those rows inside one scrollBoundedSection wrapper standing
// after the Ledger section header, leaving Balance/Income/Expenses
// unwrapped, reachable bodyEl-level siblings before it.

function getBodyEl(panel: FinancesPanel): HTMLElement {
  return panel.root.children[1] as HTMLElement;
}

/**
 * Every direct child of `bodyEl` between the section header whose text
 * contains `label` and the next section header (or the end of bodyEl).
 */
function sectionChildren(bodyEl: HTMLElement, label: string): HTMLElement[] {
  const children = Array.from(bodyEl.children) as HTMLElement[];
  const idx = children.findIndex(c => c.classList.contains('bsx-section') && (c.textContent ?? '').includes(label));
  if (idx === -1) throw new Error(`section header not found for label: ${label}`);
  const result: HTMLElement[] = [];
  for (let i = idx + 1; i < children.length; i++) {
    if (children[i]!.classList.contains('bsx-section')) break;
    result.push(children[i]!);
  }
  return result;
}

function pushTransactions(state: GameState, count: number): void {
  for (let i = 0; i < count; i++) {
    state.finances.transactions.push({
      tick: i, type: i % 2 === 0 ? 'income' : 'expense', amount: 10 + i, category: 'fuel', description: `tx ${i}`,
    });
  }
}

describe('FinancesPanel — scroll-bounded ledger section (#958)', () => {
  it('nests all 15 ledger rows inside a single bounded wrapper, not flattened directly into bodyEl', () => {
    const { panel } = makePanel();
    const state = makeState();
    pushTransactions(state, 15);
    panel.show();
    panel.update(state);

    const bodyEl = getBodyEl(panel);
    const ledgerChildren = sectionChildren(bodyEl, t('ui.finances.ledger'));

    expect(ledgerChildren.length).toBe(1);
    const wrapper = ledgerChildren[0]!;
    expect(wrapper.children.length).toBe(15);
  });

  it('gives the ledger wrapper inline overflow-y:auto and a numeric max-height (not vh/%)', () => {
    const { panel } = makePanel();
    const state = makeState();
    pushTransactions(state, 15);
    panel.show();
    panel.update(state);

    const bodyEl = getBodyEl(panel);
    const wrapper = sectionChildren(bodyEl, t('ui.finances.ledger'))[0]!;

    expect(wrapper.style.overflowY).toBe('auto');
    expect(wrapper.style.maxHeight).toMatch(/^\d+px$/);
  });

  it('keeps Balance/Income/Expenses sections reachable as bodyEl-level siblings before the ledger wrapper', () => {
    const { panel } = makePanel();
    const state = makeState();
    pushTransactions(state, 15);
    panel.show();
    panel.update(state);

    const bodyEl = getBodyEl(panel);
    const children = Array.from(bodyEl.children) as HTMLElement[];
    const ledgerIdx = children.findIndex(c => c.classList.contains('bsx-section') && (c.textContent ?? '').includes(t('ui.finances.ledger')));
    const incomeIdx = children.findIndex(c => c.classList.contains('bsx-section') && (c.textContent ?? '').includes(t('ui.finances.income')));
    const expensesIdx = children.findIndex(c => c.classList.contains('bsx-section') && (c.textContent ?? '').includes(t('ui.finances.expenses')));

    expect(incomeIdx).toBeGreaterThan(-1);
    expect(expensesIdx).toBeGreaterThan(-1);
    expect(ledgerIdx).toBeGreaterThan(-1);
    expect(incomeIdx).toBeLessThan(ledgerIdx);
    expect(expensesIdx).toBeLessThan(ledgerIdx);

    const ledgerWrapper = children[ledgerIdx + 1]!;
    expect(ledgerWrapper.contains(children[incomeIdx]!)).toBe(false);
    expect(ledgerWrapper.contains(children[expensesIdx]!)).toBe(false);
    // First child is the balance card, not a section header.
    expect(children[0]!.classList.contains('bsx-section')).toBe(false);
  });

  it('keeps bodyEl itself scrollable (overflow-y:auto unchanged) regardless of ledger size', () => {
    const { panel: emptyPanel } = makePanel();
    emptyPanel.show();
    emptyPanel.update(makeState());
    const emptyBodyEl = getBodyEl(emptyPanel);

    const { panel: fullPanel } = makePanel();
    const state = makeState();
    pushTransactions(state, 15);
    fullPanel.show();
    fullPanel.update(state);
    const fullBodyEl = getBodyEl(fullPanel);

    for (const bodyEl of [emptyBodyEl, fullBodyEl]) {
      expect(bodyEl.style.overflowY).toBe('auto');
    }
  });

  describe('bankruptcy countdown (#1376)', () => {
    function textFor(ticksBelowThreshold: number, bankrupt = false): string {
      const { panel } = makePanel();
      panel.show();
      const s = makeState();
      s.bankruptcy.ticksBelowThreshold = ticksBelowThreshold;
      s.bankruptcy.bankrupt = bankrupt;
      panel.update(s);
      return panel.root.textContent ?? '';
    }

    it('counts down from BANKRUPTCY_GRACE_TICKS', () => {
      const remaining = BANKRUPTCY_GRACE_TICKS - 40;
      expect(textFor(40)).toContain(`Bankruptcy in ${formatGameDuration(remaining)}`);
    });

    it('shows the full grace period after one tick below threshold', () => {
      expect(textFor(1)).toContain(`Bankruptcy in ${formatGameDuration(BANKRUPTCY_GRACE_TICKS - 1)}`);
    });

    it('shows 0 when the streak equals the grace period', () => {
      expect(textFor(BANKRUPTCY_GRACE_TICKS)).toContain(`Bankruptcy in ${formatGameDuration(0)}`);
    });

    it('clamps at 0 when the streak exceeds the grace period', () => {
      const text = textFor(BANKRUPTCY_GRACE_TICKS + 25);
      expect(text).toContain(`Bankruptcy in ${formatGameDuration(0)}`);
      expect(text).not.toContain('-');
    });

    it('shows no countdown when not below threshold', () => {
      expect(textFor(0)).not.toContain('Bankruptcy in');
    });

    it('still shows the seized banner when bankrupt', () => {
      const text = textFor(40, true);
      expect(text).toContain(t('campaign.bankrupt'));
      expect(text).not.toContain('Bankruptcy in');
    });
  });

  describe('operating profit row (#1374 regression)', () => {
    it('shows operating profit against the target in a campaign level', () => {
      const { panel } = makePanel();
      const state = makeState();
      state.campaign.activeLevelId = 'dusty_hollow';
      panel.show();
      panel.update(state);
      expect(panel.root.textContent).toContain(t('ui.finances.operating_profit'));
      expect(panel.root.textContent).toContain('/ $80,000');
    });

    it('omits the row in sandbox', () => {
      const { panel } = makePanel();
      const state = makeState();
      state.campaign.activeLevelId = 'sandbox';
      panel.show();
      panel.update(state);
      expect(panel.root.textContent).not.toContain(t('ui.finances.operating_profit'));
    });
  });
});

// ── Scroll survives a live refresh (#1592) ──

describe('FinancesPanel — scroll survives a refresh (#1592)', () => {
  it('keeps the ledger scrollTop when a tick changes the content', () => {
    const { panel } = makePanel();
    const state = makeState();
    panel.show();
    panel.update(state);
    const ledger = (): HTMLElement => Array.from(panel.root.querySelectorAll<HTMLElement>('div'))
      .find(d => d.style.overflowY === 'auto' && d.style.maxHeight === '200px')!;
    ledger().scrollTop = 70;

    state.tickCount += 1;
    state.cash += 500;
    panel.update(state);

    expect(ledger().scrollTop).toBe(70);
  });
});
