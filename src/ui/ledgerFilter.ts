// BlastSimulator2026 — finances ledger filter/sort criteria (#2162).

import type { Transaction } from '../core/economy/Finance.js';
import type { FilterBarSelection } from './filterBar.js';

export const LEDGER_SORT_KEYS = ['amount', 'date'] as const;
type LedgerSortKey = typeof LEDGER_SORT_KEYS[number];

export interface LedgerCriteria {
  category: string | null;
  type: 'income' | 'expense' | null;
  sort: LedgerSortKey | null;
}

/** Read the bar selection: filter = category, group `type`, sort. */
export function ledgerCriteriaFromSelection(selection: FilterBarSelection): LedgerCriteria {
  const type = selection.groups['type'];
  return {
    category: selection.filter,
    type: type === 'income' || type === 'expense' ? type : null,
    sort: (LEDGER_SORT_KEYS as readonly string[]).includes(selection.sort ?? '') ? selection.sort as LedgerSortKey : null,
  };
}

/** Rows to list in display order, and the signed net (income +, expense −) of those rows. */
export function filterLedger(
  transactions: readonly Transaction[],
  criteria: LedgerCriteria,
  limit: number,
): { rows: Transaction[]; total: number } {
  const filtered = criteria.category !== null || criteria.type !== null;
  const newestFirst = [...transactions].reverse();
  const kept = filtered
    ? newestFirst.filter(tx =>
      (criteria.category === null || tx.category === criteria.category)
      && (criteria.type === null || tx.type === criteria.type))
    : newestFirst.slice(0, limit);
  if (criteria.sort === 'amount') kept.sort((a, b) => b.amount - a.amount);
  else if (criteria.sort === 'date') kept.reverse();
  const total = kept.reduce((sum, tx) => sum + (tx.type === 'income' ? tx.amount : -tx.amount), 0);
  return { rows: kept, total };
}
