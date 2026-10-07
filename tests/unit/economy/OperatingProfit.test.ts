// BlastSimulator2026 — Operating profit (#1363)
// The level win target counts running income minus running costs: one-off
// capital outlay (equipment, construction) and refunds do not move it.

import { describe, it, expect } from 'vitest';
import {
  createFinanceState,
  addIncome,
  addExpense,
  chargeFine,
  getFinancialReport,
  getOperatingProfit,
  CAPITAL_EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type IncomeCategory,
} from '../../../src/core/economy/Finance.js';

const RUNNING_EXPENSES: ExpenseCategory[] = [
  'salaries', 'maintenance', 'vehicle_maintenance', 'fuel', 'explosives',
  'materials', 'fines', 'needs', 'corruption', 'mafia',
];
const COUNTED_INCOME: IncomeCategory[] = ['sales', 'contracts', 'bonus', 'smuggling'];

describe('getOperatingProfit (#1363)', () => {
  it('is 0 on a fresh ledger', () => {
    expect(getOperatingProfit(createFinanceState(50000))).toBe(0);
  });

  it('does not count starting cash', () => {
    expect(getOperatingProfit(createFinanceState(1_000_000))).toBe(0);
  });

  it.each(COUNTED_INCOME)('counts %s income', (category) => {
    const s = createFinanceState(0);
    addIncome(s, 1000, category, 'x', 1);
    expect(getOperatingProfit(s)).toBe(1000);
  });

  it('excludes refund income', () => {
    const s = createFinanceState(0);
    addIncome(s, 4000, 'refund', 'x', 1);
    expect(getOperatingProfit(s)).toBe(0);
  });

  it.each(RUNNING_EXPENSES)('subtracts %s expense', (category) => {
    const s = createFinanceState(0);
    addExpense(s, 300, category, 'x', 1);
    expect(getOperatingProfit(s)).toBe(-300);
  });

  it.each(['equipment', 'construction'] as ExpenseCategory[])('ignores %s expense', (category) => {
    const s = createFinanceState(100000);
    addExpense(s, 25000, category, 'x', 1);
    expect(getOperatingProfit(s)).toBe(0);
  });

  it('declares exactly equipment and construction as capital categories', () => {
    expect([...CAPITAL_EXPENSE_CATEGORIES].sort()).toEqual(['construction', 'equipment']);
  });

  it('a $50k vehicle purchase leaves operating profit unchanged but lowers net profit', () => {
    const s = createFinanceState(100000);
    addIncome(s, 2000, 'contracts', 'sale', 1);
    const before = getFinancialReport(s, 1);
    addExpense(s, 50000, 'equipment', 'vehicle purchase', 2);
    const after = getFinancialReport(s, 2);
    expect(after.operatingProfit).toBe(before.operatingProfit);
    expect(after.operatingProfit).toBe(2000);
    expect(after.netProfit).toBe(before.netProfit - 50000);
  });

  it('a fine lowers operating profit', () => {
    const s = createFinanceState(10000);
    addIncome(s, 2000, 'sales', 'sale', 1);
    const state = { cash: s.cash, finances: s };
    chargeFine(state, 500, 'fine', 2);
    expect(getOperatingProfit(s)).toBe(1500);
  });

  it('combines running income and costs while skipping capital and refunds', () => {
    const s = createFinanceState(0);
    addIncome(s, 10000, 'contracts', 'c', 1);
    addIncome(s, 2000, 'sales', 's', 2);
    addIncome(s, 9000, 'refund', 'r', 3);
    addExpense(s, 1500, 'salaries', 'w', 4);
    addExpense(s, 500, 'fuel', 'f', 5);
    addExpense(s, 30000, 'construction', 'b', 6);
    addExpense(s, 25000, 'equipment', 'v', 7);
    expect(getOperatingProfit(s)).toBe(10000);
  });

  it('is unaffected by a capital outlay larger than all income (capital alone never blocks)', () => {
    const s = createFinanceState(0);
    addExpense(s, 92800, 'equipment', 'fleet', 1);
    addIncome(s, 80000, 'contracts', 'c', 2);
    expect(getOperatingProfit(s)).toBe(80000);
    expect(getFinancialReport(s, 2).netProfit).toBeLessThan(80000);
  });
});

describe('getFinancialReport().operatingProfit (#1363)', () => {
  it('equals getOperatingProfit over the whole ledger', () => {
    const s = createFinanceState(5000);
    addIncome(s, 7000, 'contracts', 'c', 1);
    addIncome(s, 100, 'refund', 'r', 1);
    addExpense(s, 900, 'maintenance', 'm', 2);
    addExpense(s, 20000, 'equipment', 'e', 3);
    const report = getFinancialReport(s, 3);
    expect(report.operatingProfit).toBe(getOperatingProfit(s));
    expect(report.operatingProfit).toBe(6100);
  });

  it('keeps net profit as plain income minus all expenses', () => {
    const s = createFinanceState(0);
    addIncome(s, 3000, 'sales', 's', 1);
    addExpense(s, 1000, 'equipment', 'e', 1);
    const report = getFinancialReport(s, 1);
    expect(report.netProfit).toBe(2000);
    expect(report.operatingProfit).toBe(3000);
  });
});
