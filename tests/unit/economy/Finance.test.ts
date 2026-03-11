import { describe, it, expect } from 'vitest';
import {
  createFinanceState,
  addIncome,
  addExpense,
  getBalance,
  getFinancialReport,
} from '../../../src/core/economy/Finance.js';

describe('Finance system', () => {
  it('initial balance is set from game config', () => {
    const state = createFinanceState(50000);
    expect(getBalance(state)).toBe(50000);
  });

  it('addIncome increases balance', () => {
    const state = createFinanceState(1000);
    addIncome(state, 500, 'sales', 'Sold ore', 1);
    expect(getBalance(state)).toBe(1500);
  });

  it('addExpense decreases balance', () => {
    const state = createFinanceState(1000);
    addExpense(state, 300, 'equipment', 'Bought drill', 1);
    expect(getBalance(state)).toBe(700);
  });

  it('financial report correctly sums by category', () => {
    const state = createFinanceState(10000);
    addIncome(state, 500, 'sales', 'Ore sale 1', 1);
    addIncome(state, 800, 'sales', 'Ore sale 2', 2);
    addIncome(state, 200, 'contracts', 'Contract bonus', 3);
    addExpense(state, 100, 'salaries', 'Worker wages', 1);
    addExpense(state, 50, 'fuel', 'Diesel', 2);
    addExpense(state, 100, 'salaries', 'Worker wages', 3);

    const report = getFinancialReport(state, 10);

    expect(report.totalIncome).toBe(1500);
    expect(report.totalExpenses).toBe(250);
    expect(report.netProfit).toBe(1250);

    const salesTotal = report.incomeByCategory.find(c => c.category === 'sales');
    expect(salesTotal?.total).toBe(1300);

    const salaryTotal = report.expensesByCategory.find(c => c.category === 'salaries');
    expect(salaryTotal?.total).toBe(200);
  });

  it('balance going below 0 triggers bankruptcy flag', () => {
    const state = createFinanceState(100);
    expect(state.isBankrupt).toBe(false);
    addExpense(state, 200, 'fines', 'Massive fine', 1);
    expect(getBalance(state)).toBe(-100);
    expect(state.isBankrupt).toBe(true);
  });

  it('financial report respects period filter', () => {
    const state = createFinanceState(10000);
    addIncome(state, 100, 'sales', 'Old sale', 1);
    addIncome(state, 200, 'sales', 'Recent sale', 8);
    addExpense(state, 50, 'fuel', 'Old fuel', 2);
    addExpense(state, 75, 'fuel', 'Recent fuel', 9);

    // Report for last 5 ticks (tick 5-10)
    const report = getFinancialReport(state, 10, 5);
    expect(report.totalIncome).toBe(200);
    expect(report.totalExpenses).toBe(75);
    expect(report.transactionCount).toBe(2);
  });
});
