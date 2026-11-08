// @vitest-environment jsdom
// BlastSimulator2026 — finances ledger filter criteria and ledger filtering (#2162).
import { describe, it, expect } from 'vitest';
import {
  LEDGER_SORT_KEYS,
  ledgerCriteriaFromSelection,
  filterLedger,
  type LedgerCriteria,
} from '../../../src/ui/ledgerFilter.js';
import { FilterBarSelection } from '../../../src/ui/filterBar.js';
import type { Transaction } from '../../../src/core/economy/Finance.js';

const NONE: LedgerCriteria = { category: null, type: null, sort: null };
const crit = (over: Partial<LedgerCriteria>): LedgerCriteria => ({ ...NONE, ...over });

function tx(tick: number, type: 'income' | 'expense', category: Transaction['category'], amount: number): Transaction {
  return { tick, type, category, amount, description: `tx@${tick}` };
}

/** Oldest first, as the game stores them. */
const LEDGER: Transaction[] = [
  tx(10, 'income', 'sales', 500),
  tx(20, 'expense', 'fuel', 200),
  tx(30, 'income', 'contracts', 1500),
  tx(40, 'expense', 'contracts', 700),
  tx(50, 'expense', 'salaries', 300),
  tx(60, 'income', 'sales', 250),
];

const ticks = (rows: readonly Transaction[]): number[] => rows.map(r => r.tick);
const rowsOf = (criteria: LedgerCriteria, limit = 15, list: readonly Transaction[] = LEDGER): number[] =>
  ticks(filterLedger(list, criteria, limit).rows);

describe('ledgerFilter constants', () => {
  it('offers sort keys amount and date', () => {
    expect([...LEDGER_SORT_KEYS].sort()).toEqual(['amount', 'date']);
  });
});

describe('ledgerCriteriaFromSelection', () => {
  it('an untouched selection yields no criteria', () => {
    expect(ledgerCriteriaFromSelection(new FilterBarSelection())).toEqual(NONE);
  });

  it('reads the category from the main filter', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'contracts';
    expect(ledgerCriteriaFromSelection(sel).category).toBe('contracts');
  });

  it('reads the type group', () => {
    const sel = new FilterBarSelection();
    for (const type of ['income', 'expense'] as const) {
      sel.groups['type'] = type;
      expect(ledgerCriteriaFromSelection(sel).type).toBe(type);
    }
  });

  it('reads every sort key', () => {
    const sel = new FilterBarSelection();
    for (const key of LEDGER_SORT_KEYS) {
      sel.sort = key;
      expect(ledgerCriteriaFromSelection(sel).sort).toBe(key);
    }
  });

  it('a type group set back to null reads as unset', () => {
    const sel = new FilterBarSelection();
    sel.groups['type'] = null;
    expect(ledgerCriteriaFromSelection(sel)).toEqual(NONE);
  });

  it('reads several choices at once', () => {
    const sel = new FilterBarSelection();
    sel.filter = 'fuel';
    sel.groups['type'] = 'expense';
    sel.sort = 'amount';
    expect(ledgerCriteriaFromSelection(sel)).toEqual({ category: 'fuel', type: 'expense', sort: 'amount' });
  });
});

describe('filterLedger — nothing selected', () => {
  it('lists the transactions newest first', () => {
    expect(rowsOf(NONE)).toEqual([60, 50, 40, 30, 20, 10]);
  });

  it('keeps only the last `limit` transactions', () => {
    expect(rowsOf(NONE, 4)).toEqual([60, 50, 40, 30]);
  });

  it('a ledger of exactly `limit` entries is listed whole', () => {
    expect(rowsOf(NONE, 6)).toEqual([60, 50, 40, 30, 20, 10]);
  });

  it('an empty ledger lists nothing and totals zero', () => {
    const out = filterLedger([], NONE, 15);
    expect(out.rows).toEqual([]);
    expect(out.total).toBeCloseTo(0, 8);
  });

  it('does not mutate the input list', () => {
    const input = [...LEDGER];
    filterLedger(input, crit({ sort: 'amount' }), 15);
    expect(ticks(input)).toEqual(ticks(LEDGER));
  });
});

describe('filterLedger — category and type', () => {
  it('a category keeps only its transactions, newest first', () => {
    expect(rowsOf(crit({ category: 'contracts' }))).toEqual([40, 30]);
    expect(rowsOf(crit({ category: 'sales' }))).toEqual([60, 10]);
  });

  it('a type keeps only that type', () => {
    expect(rowsOf(crit({ type: 'income' }))).toEqual([60, 30, 10]);
    expect(rowsOf(crit({ type: 'expense' }))).toEqual([50, 40, 20]);
  });

  it('category and type combine (AND)', () => {
    expect(rowsOf(crit({ category: 'contracts', type: 'expense' }))).toEqual([40]);
    expect(rowsOf(crit({ category: 'contracts', type: 'income' }))).toEqual([30]);
  });

  it('a category/type pair nothing matches lists nothing', () => {
    const out = filterLedger(LEDGER, crit({ category: 'sales', type: 'expense' }), 15);
    expect(out.rows).toEqual([]);
    expect(out.total).toBeCloseTo(0, 8);
  });

  it('an unknown category lists nothing', () => {
    expect(rowsOf(crit({ category: 'smuggling' }))).toEqual([]);
  });

  it('an active filter ignores the limit and lists every match', () => {
    const many = Array.from({ length: 40 }, (_, i) => tx(i, 'expense', 'fuel', 10 + i));
    expect(filterLedger(many, crit({ category: 'fuel' }), 15).rows).toHaveLength(40);
    expect(filterLedger(many, crit({ type: 'expense' }), 15).rows).toHaveLength(40);
  });

  it('a filter reaches matches older than the limit window', () => {
    const list = [tx(0, 'income', 'smuggling', 999), ...Array.from({ length: 20 }, (_, i) => tx(i + 1, 'expense', 'fuel', 5))];
    expect(rowsOf(crit({ category: 'smuggling' }), 15, list)).toEqual([0]);
  });
});

describe('filterLedger — sorting', () => {
  it('amount sort lists the largest amount first', () => {
    expect(rowsOf(crit({ sort: 'amount' }))).toEqual([30, 40, 10, 50, 60, 20]);
  });

  it('date sort lists the oldest first', () => {
    expect(rowsOf(crit({ sort: 'date' }))).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('a sort without a filter still lists only the last `limit` transactions', () => {
    // last 4 are ticks 30..60
    expect(rowsOf(crit({ sort: 'date' }), 4)).toEqual([30, 40, 50, 60]);
    expect(rowsOf(crit({ sort: 'amount' }), 4)).toEqual([30, 40, 50, 60]);
    expect(rowsOf(crit({ sort: 'amount' }), 3)).toEqual([40, 50, 60]);
  });

  it('a sort orders only the rows the filter keeps', () => {
    expect(rowsOf(crit({ type: 'expense', sort: 'amount' }))).toEqual([40, 50, 20]);
    expect(rowsOf(crit({ type: 'expense', sort: 'date' }))).toEqual([20, 40, 50]);
    expect(rowsOf(crit({ category: 'sales', sort: 'amount' }))).toEqual([10, 60]);
  });
});

describe('filterLedger — signed total', () => {
  const totalOf = (criteria: LedgerCriteria, limit = 15, list: readonly Transaction[] = LEDGER): number =>
    filterLedger(list, criteria, limit).total;

  it('counts income as plus and expense as minus over the listed rows', () => {
    expect(totalOf(crit({ category: 'contracts' }))).toBeCloseTo(1500 - 700, 8);
  });

  it('an expense-only selection totals negative', () => {
    expect(totalOf(crit({ type: 'expense' }))).toBeCloseTo(-(200 + 700 + 300), 8);
  });

  it('an income-only selection totals positive', () => {
    expect(totalOf(crit({ type: 'income' }))).toBeCloseTo(500 + 1500 + 250, 8);
  });

  it('a sort alone totals the whole listed window', () => {
    expect(totalOf(crit({ sort: 'amount' }))).toBeCloseTo(500 - 200 + 1500 - 700 - 300 + 250, 8);
  });

  it('a sort alone totals only the last `limit` rows', () => {
    // last 2: tick 50 expense 300, tick 60 income 250
    expect(totalOf(crit({ sort: 'date' }), 2)).toBeCloseTo(-300 + 250, 8);
  });

  it('a filter totals every match, not just the last `limit`', () => {
    const many = Array.from({ length: 30 }, (_, i) => tx(i, 'income', 'sales', 10));
    expect(totalOf(crit({ category: 'sales' }), 15, many)).toBeCloseTo(300, 8);
  });
});
