// BlastSimulator2026 — Finance system
// Tracks cash balance, income/expense history with categories.
// All values in game dollars ($).

// ── Categories ──

export type IncomeCategory = 'sales' | 'contracts' | 'bonus' | 'refund' | 'smuggling';
export type ExpenseCategory = 'salaries' | 'equipment' | 'fines' | 'maintenance' | 'fuel' | 'materials' | 'construction' | 'corruption' | 'mafia' | 'needs' | 'explosives' | 'vehicle_maintenance';

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
}

/** Create finance state from initial cash. */
export function createFinanceState(initialCash: number): FinanceState {
  return {
    cash: initialCash,
    transactions: [],
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

/** Add expense. Deducts from balance. Bankruptcy is tracked by `state.bankruptcy` (Bankruptcy.ts), not here. */
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
}

/** Charge a fine: debits the flat `cash` and logs a 'fines' expense. No-op for amounts <= 0. */
export function chargeFine(
  state: { cash: number; finances: FinanceState },
  amount: number,
  description: string,
  tick: number,
): void {
  if (amount <= 0) return;
  state.cash -= amount;
  addExpense(state.finances, amount, 'fines', description, tick);
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

/** Expense categories that buy assets rather than run the mine. */
export const CAPITAL_EXPENSE_CATEGORIES: ReadonlySet<ExpenseCategory> = new Set<ExpenseCategory>(['equipment', 'construction']);

export interface FinancialReport {
  /** Income excluding refunds, minus expenses outside CAPITAL_EXPENSE_CATEGORIES. */
  operatingProfit: number;
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
    operatingProfit: 0, // TODO: implement
    incomeByCategory: [...incomeMap.entries()].map(([category, total]) => ({ category, total })),
    expensesByCategory: [...expenseMap.entries()].map(([category, total]) => ({ category, total })),
    transactionCount: filtered.length,
  };
}

/** Operating profit over all transactions: income excluding 'refund' minus non-capital expenses. */
export function getOperatingProfit(_state: FinanceState): number {
  return 0; // TODO: implement
}
