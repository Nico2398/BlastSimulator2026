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

  it('renders the ledger most-recent-first with category, day and description', () => {
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
    expect(panel.root.textContent).toContain('Payroll');
    expect(panel.root.textContent).toContain('Contract #1 delivery');
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

// ── Ledger filter and sort bar (#2162) ──────────────────────────────────────

describe('FinancesPanel — ledger filter and sort bar (#2162)', () => {
  /**
   * Oldest first: 1 income sales 500, 2 expense fuel 200, 3 income contracts 1500,
   * 4 expense contracts 700, 5 expense salaries 300, 6 income sales 250.
   * Every amount is unique so a row is identified by its amount.
   */
  function fixtureState(): GameState {
    const state = makeState();
    state.tickCount = 100;
    state.finances.transactions.push(
      { tick: 10, type: 'income', amount: 500, category: 'sales', description: 'a' },
      { tick: 20, type: 'expense', amount: 200, category: 'fuel', description: 'b' },
      { tick: 30, type: 'income', amount: 1500, category: 'contracts', description: 'c' },
      { tick: 40, type: 'expense', amount: 700, category: 'contracts', description: 'd' },
      { tick: 50, type: 'expense', amount: 300, category: 'salaries', description: 'e' },
      { tick: 60, type: 'income', amount: 250, category: 'sales', description: 'f' },
    );
    return state;
  }

  function setup(state: GameState = fixtureState()): { panel: FinancesPanel; state: GameState } {
    const { panel } = makePanel();
    panel.show();
    panel.update(state);
    return { panel, state };
  }

  const bar = (panel: FinancesPanel): HTMLElement => panel.root.querySelector<HTMLElement>('.bs-filter-bar')!;
  const click = (panel: FinancesPanel, selector: string): void => (bar(panel).querySelector(selector) as HTMLButtonElement).click();
  const categoryBtn = (category: string): string => `.bs-filter-row:not([data-filter-group]) [data-filter-value="${category}"]`;
  const typeBtn = (type: string): string => `[data-filter-group="type"] [data-filter-value="${type}"]`;
  const sortBtn = (key: string): string => `[data-sort-key="${key}"]`;
  const rows = (panel: FinancesPanel): HTMLElement[] => [...panel.root.querySelectorAll<HTMLElement>('[data-ledger-row]')];
  /** Signed amounts of the listed rows, in display order. */
  const shown = (panel: FinancesPanel): string[] =>
    rows(panel).map(r => /[+-]\$[\d,]+/.exec(r.textContent ?? '')![0]);
  const totalEl = (panel: FinancesPanel): HTMLElement | null => panel.root.querySelector<HTMLElement>('[data-ledger-total]');

  it('shows the shared filter bar above the ledger rows', () => {
    const { panel } = setup();
    expect(panel.root.querySelectorAll('.bs-filter-bar')).toHaveLength(1);
    const first = rows(panel)[0]!;
    expect(bar(panel).compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bar(panel).contains(first)).toBe(false);
  });

  it('offers exactly the categories present in the transactions, each once', () => {
    const { panel } = setup();
    const categories = [...bar(panel).querySelectorAll<HTMLElement>('.bs-filter-row:not([data-filter-group]) [data-filter-value]')]
      .map(b => b.dataset['filterValue']).sort();
    expect(categories).toEqual(['contracts', 'fuel', 'salaries', 'sales']);
    expect(bar(panel).querySelector('[data-filter-all]')).not.toBeNull();
  });

  it('offers the income and expense types and the amount and date sorts', () => {
    const { panel } = setup();
    const types = [...bar(panel).querySelectorAll<HTMLElement>('[data-filter-group="type"] [data-filter-value]')]
      .map(b => b.dataset['filterValue']).sort();
    expect(types).toEqual(['expense', 'income']);
    const sorts = [...bar(panel).querySelectorAll<HTMLElement>('[data-sort-key]')].map(b => b.dataset['sortKey']).sort();
    expect(sorts).toEqual(['amount', 'date']);
  });

  it('labels the bar with the localized finance keys, never raw keys', () => {
    const { panel } = setup();
    const text = bar(panel).textContent ?? '';
    for (const key of ['ui.finances.filter_category', 'ui.finances.filter_type', 'ui.finances.filter_type_income', 'ui.finances.filter_type_expense', 'ui.finances.sort_amount', 'ui.finances.sort_date']) {
      expect(t(key)).not.toBe(key);
      expect(text).toContain(t(key));
    }
    expect(text).not.toContain('ui.finances.');
  });

  it('tags every row with its category and type', () => {
    const { panel } = setup();
    const tags = rows(panel).map(r => `${r.dataset['category']}/${r.dataset['type']}`);
    expect(tags).toEqual(['sales/income', 'salaries/expense', 'contracts/expense', 'contracts/income', 'fuel/expense', 'sales/income']);
  });

  it('lists the ledger newest first with nothing selected', () => {
    const { panel } = setup();
    expect(shown(panel)).toEqual(['+$250', '-$300', '-$700', '+$1,500', '-$200', '+$500']);
  });

  it('shows no total while nothing is selected', () => {
    const { panel } = setup();
    expect(totalEl(panel)).toBeNull();
  });

  it('a category filter lists only that category', () => {
    const { panel } = setup();
    click(panel, categoryBtn('contracts'));
    expect(shown(panel)).toEqual(['-$700', '+$1,500']);
    expect(rows(panel).every(r => r.dataset['category'] === 'contracts')).toBe(true);
  });

  it('a type filter lists only that type', () => {
    const { panel } = setup();
    click(panel, typeBtn('expense'));
    expect(shown(panel)).toEqual(['-$300', '-$700', '-$200']);
    click(panel, typeBtn('income'));
    expect(shown(panel)).toEqual(['+$250', '+$1,500', '+$500']);
  });

  it('category and type combine to tell apart a category used both ways', () => {
    const { panel } = setup();
    click(panel, categoryBtn('contracts'));
    click(panel, typeBtn('income'));
    expect(shown(panel)).toEqual(['+$1,500']);
    click(panel, typeBtn('expense'));
    expect(shown(panel)).toEqual(['-$700']);
  });

  it('the amount sort lists the largest amount first', () => {
    const { panel } = setup();
    click(panel, sortBtn('amount'));
    expect(shown(panel)).toEqual(['+$1,500', '-$700', '+$500', '-$300', '+$250', '-$200']);
  });

  it('the date sort lists the oldest first', () => {
    const { panel } = setup();
    click(panel, sortBtn('date'));
    expect(shown(panel)).toEqual(['+$500', '-$200', '+$1,500', '-$700', '-$300', '+$250']);
  });

  it('a sort orders only the rows the filter keeps', () => {
    const { panel } = setup();
    click(panel, typeBtn('expense'));
    click(panel, sortBtn('amount'));
    expect(shown(panel)).toEqual(['-$700', '-$300', '-$200']);
  });

  it('clicking the pressed choice again removes the filter', () => {
    const { panel } = setup();
    click(panel, categoryBtn('fuel'));
    expect(shown(panel)).toEqual(['-$200']);
    click(panel, categoryBtn('fuel'));
    expect(shown(panel)).toHaveLength(6);
  });

  it('the All button and Clear filter restore the full ledger', () => {
    const { panel } = setup();
    click(panel, categoryBtn('sales'));
    click(panel, '[data-filter-all]');
    expect(shown(panel)).toHaveLength(6);
    click(panel, typeBtn('income'));
    click(panel, sortBtn('amount'));
    click(panel, '.bs-filter-clear');
    expect(shown(panel)).toEqual(['+$250', '-$300', '-$700', '+$1,500', '-$200', '+$500']);
    expect(totalEl(panel)).toBeNull();
  });

  it('marks the pressed choices', () => {
    const { panel } = setup();
    click(panel, categoryBtn('sales'));
    click(panel, sortBtn('date'));
    expect(bar(panel).querySelector(categoryBtn('sales'))!.getAttribute('aria-pressed')).toBe('true');
    expect(bar(panel).querySelector(categoryBtn('fuel'))!.getAttribute('aria-pressed')).not.toBe('true');
    expect(bar(panel).querySelector(sortBtn('date'))!.getAttribute('aria-pressed')).toBe('true');
  });

  it('unfiltered it lists the 15 most recent; a filter lifts the cap', () => {
    const state = makeState();
    for (let i = 0; i < 20; i++) {
      state.finances.transactions.push({ tick: i, type: 'expense', amount: 10 + i, category: 'fuel', description: 'f' });
    }
    for (let i = 20; i < 40; i++) {
      state.finances.transactions.push({ tick: i, type: 'income', amount: 10 + i, category: 'sales', description: 's' });
    }
    const { panel } = setup(state);
    expect(rows(panel)).toHaveLength(15);
    click(panel, categoryBtn('fuel'));
    expect(rows(panel)).toHaveLength(20);
    click(panel, '[data-filter-all]');
    click(panel, typeBtn('income'));
    expect(rows(panel)).toHaveLength(20);
  });

  it('a sort alone keeps the 15-row cap', () => {
    const state = makeState();
    for (let i = 0; i < 30; i++) {
      state.finances.transactions.push({ tick: i, type: 'expense', amount: 10 + i, category: 'fuel', description: 'f' });
    }
    const { panel } = setup(state);
    click(panel, sortBtn('date'));
    expect(rows(panel)).toHaveLength(15);
  });

  it('a filter finds a transaction older than the unfiltered window', () => {
    const state = makeState();
    state.finances.transactions.push({ tick: 1, type: 'income', amount: 8000, category: 'smuggling', description: 'old' });
    for (let i = 0; i < 20; i++) {
      state.finances.transactions.push({ tick: 2 + i, type: 'expense', amount: 10 + i, category: 'fuel', description: 'f' });
    }
    const { panel } = setup(state);
    expect(shown(panel)).not.toContain('+$8,000');
    click(panel, categoryBtn('smuggling'));
    expect(shown(panel)).toEqual(['+$8,000']);
  });

  describe('signed total', () => {
    it('shows the signed net of the listed rows for a category', () => {
      const { panel } = setup();
      click(panel, categoryBtn('contracts'));
      expect(totalEl(panel)!.textContent).toContain('+$800');
    });

    it('shows a negative net with a minus sign for an expense selection', () => {
      const { panel } = setup();
      click(panel, typeBtn('expense'));
      expect(totalEl(panel)!.textContent).toContain('-$1,200');
    });

    it('shows a positive net for an income selection', () => {
      const { panel } = setup();
      click(panel, typeBtn('income'));
      expect(totalEl(panel)!.textContent).toContain('+$2,250');
    });

    it('appears for a sort alone and totals the listed window', () => {
      const { panel } = setup();
      click(panel, sortBtn('amount'));
      expect(totalEl(panel)!.textContent).toContain('+$1,050');
    });

    it('a sort alone totals only the 15 listed rows, not the older ones', () => {
      const state = makeState();
      let listed = 0;
      for (let i = 0; i < 20; i++) {
        const type = i % 2 === 0 ? 'income' : 'expense';
        state.finances.transactions.push({ tick: i, type, amount: 100 + i, category: 'fuel', description: 'f' });
        if (i >= 5) listed += type === 'income' ? 100 + i : -(100 + i);
      }
      const { panel } = setup(state);
      click(panel, sortBtn('amount'));
      const expected = `${listed < 0 ? '-' : '+'}$${formatMoney(Math.abs(listed))}`;
      expect(totalEl(panel)!.textContent).toContain(expected);
    });

    it('follows a changed selection and disappears when cleared', () => {
      const { panel } = setup();
      click(panel, categoryBtn('sales'));
      expect(totalEl(panel)!.textContent).toContain('+$750');
      click(panel, categoryBtn('fuel'));
      expect(totalEl(panel)!.textContent).toContain('-$200');
      click(panel, '.bs-filter-clear');
      expect(totalEl(panel)).toBeNull();
    });
  });

  describe('no match', () => {
    function noMatch(): FinancesPanel {
      const { panel } = setup();
      click(panel, categoryBtn('sales'));
      click(panel, typeBtn('expense'));
      return panel;
    }

    it('shows the no-match line instead of rows', () => {
      const panel = noMatch();
      expect(rows(panel)).toHaveLength(0);
      const line = t('ui.finances.filter_no_match');
      expect(line).not.toBe('ui.finances.filter_no_match');
      expect(panel.root.textContent).toContain(line);
      expect(panel.root.textContent).not.toContain(t('ui.finances.none_transactions'));
    });

    it('keeps the bar so the filter can be changed', () => {
      const panel = noMatch();
      expect(panel.root.querySelectorAll('.bs-filter-bar')).toHaveLength(1);
      click(panel, typeBtn('expense'));
      expect(shown(panel)).toEqual(['+$250', '+$500']);
      expect(panel.root.textContent).not.toContain(t('ui.finances.filter_no_match'));
    });

    it('an empty ledger without a filter keeps the no-transactions line', () => {
      const { panel } = setup(makeState());
      expect(panel.root.textContent).toContain(t('ui.finances.none_transactions'));
      expect(panel.root.textContent).not.toContain(t('ui.finances.filter_no_match'));
    });
  });

  describe('selection survives re-renders', () => {
    it('re-renders at once on a click, without waiting for the next update', () => {
      const { panel } = setup();
      click(panel, categoryBtn('fuel'));
      expect(shown(panel)).toEqual(['-$200']);
    });

    it('keeps the filter when a new transaction arrives and lists it if it matches', () => {
      const { panel, state } = setup();
      click(panel, categoryBtn('sales'));
      state.finances.transactions.push({ tick: 70, type: 'income', amount: 900, category: 'sales', description: 'g' });
      state.finances.transactions.push({ tick: 71, type: 'expense', amount: 111, category: 'fuel', description: 'h' });
      panel.update(state);
      expect(shown(panel)).toEqual(['+$900', '+$250', '+$500']);
      expect(bar(panel).querySelector(categoryBtn('sales'))!.getAttribute('aria-pressed')).toBe('true');
      expect(totalEl(panel)!.textContent).toContain('+$1,650');
    });

    it('keeps the sort and type when the balance changes', () => {
      const { panel, state } = setup();
      click(panel, typeBtn('expense'));
      click(panel, sortBtn('amount'));
      state.cash += 12345;
      panel.update(state);
      expect(shown(panel)).toEqual(['-$700', '-$300', '-$200']);
    });

    it('keeps the filter across a locale refresh', () => {
      const { panel, state } = setup();
      click(panel, categoryBtn('contracts'));
      panel.refreshLocale();
      panel.update(state);
      expect(shown(panel)).toEqual(['-$700', '+$1,500']);
    });

    it('offers a category that appears later', () => {
      const { panel, state } = setup();
      expect(bar(panel).querySelector(categoryBtn('events'))).toBeNull();
      state.finances.transactions.push({ tick: 80, type: 'income', amount: 77, category: 'events', description: 'x' });
      panel.update(state);
      expect(bar(panel).querySelector(categoryBtn('events'))).not.toBeNull();
    });
  });
});

// ── Explanations and ledger descriptions (#2170) ────────────────────────────

describe('FinancesPanel — explanations and descriptions (#2170)', () => {
  function setup(txs: GameState['finances']['transactions']): FinancesPanel {
    const { panel } = makePanel();
    const state = makeState();
    state.finances.transactions.push(...txs);
    panel.show();
    panel.update(state);
    return panel;
  }

  const categoryRow = (panel: FinancesPanel, category: string, type: string): HTMLElement | null =>
    panel.root.querySelector<HTMLElement>(`[data-category-row][data-category="${category}"][data-type="${type}"]`);

  it('every category bar row carries its category and type and an explanation', () => {
    const panel = setup([
      { tick: 1, type: 'income', amount: 500, category: 'sales', description: 'Ore to Acme' },
      { tick: 2, type: 'expense', amount: 200, category: 'fuel', description: 'Diesel run' },
    ]);
    const rows = [...panel.root.querySelectorAll<HTMLElement>('[data-category-row]')];
    expect(rows.map(r => `${r.dataset['category']}/${r.dataset['type']}`).sort()).toEqual(['fuel/expense', 'sales/income']);
    for (const r of rows) expect(r.dataset['explain']).toBeTruthy();
  });

  it('the explanation gives transaction count, share and the entry descriptions', () => {
    const panel = setup([
      { tick: 1, type: 'income', amount: 600, category: 'sales', description: 'Ore to Acme' },
      { tick: 2, type: 'income', amount: 150, category: 'sales', description: 'Scrap lot' },
      { tick: 3, type: 'income', amount: 250, category: 'contracts', description: 'Contract payout' },
    ]);
    const sales = categoryRow(panel, 'sales', 'income')!.dataset['explain']!;
    expect(sales).toContain('2');
    expect(sales).toContain('75');
    expect(sales).toContain('Ore to Acme');
    const contracts = categoryRow(panel, 'contracts', 'income')!.dataset['explain']!;
    expect(contracts).toContain('25');
    expect(contracts).toContain('Contract payout');
    expect(contracts).not.toContain('Ore to Acme');
  });

  it('lists only the largest entries of a busy category', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      tick: i + 1, type: 'income' as const, amount: 1000 - i * 10, category: 'sales' as const, description: `Sale number ${i}`,
    }));
    const panel = setup(many);
    const text = categoryRow(panel, 'sales', 'income')!.dataset['explain']!;
    expect(text).toContain('Sale number 0');
    expect(text).not.toContain('Sale number 11');
  });

  it('keeps income and expense rows of one category apart', () => {
    const panel = setup([
      { tick: 1, type: 'income', amount: 1500, category: 'contracts', description: 'Paid out' },
      { tick: 2, type: 'expense', amount: 700, category: 'contracts', description: 'Penalty charged' },
    ]);
    expect(categoryRow(panel, 'contracts', 'income')!.dataset['explain']).toContain('Paid out');
    expect(categoryRow(panel, 'contracts', 'income')!.dataset['explain']).not.toContain('Penalty charged');
    expect(categoryRow(panel, 'contracts', 'expense')!.dataset['explain']).toContain('Penalty charged');
  });

  it('a category whose entries have no description still explains itself', () => {
    const panel = setup([{ tick: 1, type: 'expense', amount: 90, category: 'fuel', description: '' }]);
    expect(categoryRow(panel, 'fuel', 'expense')!.dataset['explain']).toBeTruthy();
  });

  it('shows no category rows, hence no explanations, with no transactions', () => {
    expect(setup([]).root.querySelectorAll('[data-category-row]')).toHaveLength(0);
  });

  describe('ledger descriptions', () => {
    const descriptions = (panel: FinancesPanel): string[] =>
      [...panel.root.querySelectorAll<HTMLElement>('[data-ledger-row]')]
        .map(r => r.querySelector('[data-role="ledger-description"]')?.textContent ?? '');

    it('shows the transaction description in its own element', () => {
      const panel = setup([{ tick: 1, type: 'income', amount: 500, category: 'sales', description: 'Ore to Acme' }]);
      expect(descriptions(panel)).toEqual(['Ore to Acme']);
    });

    it('shows each row its own description', () => {
      const panel = setup([
        { tick: 1, type: 'income', amount: 500, category: 'sales', description: 'First' },
        { tick: 2, type: 'expense', amount: 200, category: 'fuel', description: 'Second' },
      ]);
      expect(descriptions(panel).sort()).toEqual(['First', 'Second']);
    });

    it('omits the element when the description is empty', () => {
      const panel = setup([{ tick: 1, type: 'income', amount: 500, category: 'sales', description: '' }]);
      const row = panel.root.querySelector('[data-ledger-row]')!;
      expect(row).not.toBeNull();
      expect(row.querySelector('[data-role="ledger-description"]')).toBeNull();
    });

    it('keeps the category and day beside the description', () => {
      const panel = setup([{ tick: 30, type: 'income', amount: 500, category: 'sales', description: 'Ore to Acme' }]);
      const text = panel.root.querySelector('[data-ledger-row]')!.textContent!;
      expect(text).toContain(t('ui.finances.category.sales'));
      expect(text).toContain(t('ui.finances.ledger_day', { day: 2 }));
      expect(text).toContain('+$500');
    });
  });
});
