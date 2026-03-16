// BlastSimulator2026 — Finance system
// Tracks cash balance, income/expense history with categories.
// All values in game dollars ($).

// ── Categories ──

export type IncomeCategory = 'sales' | 'contracts' | 'bonus';
export type ExpenseCategory = 'salaries' | 'equipment' | 'fines' | 'maintenance' | 'fuel' | 'materials' | 'construction' | 'corruption' | 'mafia';

// ── Transaction records ──

export interface Transaction {
  tick: number;
  amount: number;
  type: 'income' | 'expense';
  category: IncomeCategory | ExpenseCategory;
  description: string;
}

// ── Finance state ──

export interface FinanceState {
  cash: number;
  transactions: Transaction[];
  isBankrupt: boolean;
}

/** Create finance state from initial cash. */
export function createFinanceState(initialCash: number): FinanceState {
  return {
    cash: initialCash,
    transactions: [],
    isBankrupt: false,
  };
}

// ── Operations ──

/** Add income to the balance. */
export function addIncome(
  state: FinanceState,
  amount: number,
  category: IncomeCategory,
  description: string,
  tick: number,
): void {
  if (amount <= 0) return;
  state.cash += amount;
  state.transactions.push({ tick, amount, type: 'income', category, description });
}

/** Add expense. Deducts from balance. Triggers bankruptcy if cash < 0. */
export function addExpense(
  state: FinanceState,
  amount: number,
  category: ExpenseCategory,
  description: string,
  tick: number,
): void {
  if (amount <= 0) return;
  state.cash -= amount;
  state.transactions.push({ tick, amount, type: 'expense', category, description });
  if (state.cash < 0) {
    state.isBankrupt = true;
  }
}

/** Get current balance. */
export function getBalance(state: FinanceState): number {
  return state.cash;
}

// ── Reporting ──

export interface CategoryTotal {
  category: string;
  total: number;
}

export interface FinancialReport {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  incomeByCategory: CategoryTotal[];
  expensesByCategory: CategoryTotal[];
  transactionCount: number;
}

/**
 * Generate a financial report for a period.
 * If periodTicks > 0, only includes transactions from (currentTick - periodTicks) to currentTick.
 * If periodTicks = 0, includes all transactions.
 */
export function getFinancialReport(
  state: FinanceState,
  currentTick: number,
  periodTicks: number = 0,
): FinancialReport {
  const minTick = periodTicks > 0 ? currentTick - periodTicks : 0;
  const filtered = state.transactions.filter(t => t.tick >= minTick);

  const incomeMap = new Map<string, number>();
  const expenseMap = new Map<string, number>();
  let totalIncome = 0;
  let totalExpenses = 0;

  for (const t of filtered) {
    if (t.type === 'income') {
      totalIncome += t.amount;
      incomeMap.set(t.category, (incomeMap.get(t.category) ?? 0) + t.amount);
    } else {
      totalExpenses += t.amount;
      expenseMap.set(t.category, (expenseMap.get(t.category) ?? 0) + t.amount);
    }
  }

  return {
    totalIncome,
    totalExpenses,
    netProfit: totalIncome - totalExpenses,
    incomeByCategory: [...incomeMap.entries()].map(([category, total]) => ({ category, total })),
    expensesByCategory: [...expenseMap.entries()].map(([category, total]) => ({ category, total })),
    transactionCount: filtered.length,
  };
}
