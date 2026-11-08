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
export function ledgerCriteriaFromSelection(_selection: FilterBarSelection): LedgerCriteria {
  throw new Error('not implemented');
}

/** Rows to list in display order, and the signed net (income +, expense −) of those rows. */
export function filterLedger(
  _transactions: readonly Transaction[],
  _criteria: LedgerCriteria,
  _limit: number,
): { rows: Transaction[]; total: number } {
  throw new Error('not implemented');
}
