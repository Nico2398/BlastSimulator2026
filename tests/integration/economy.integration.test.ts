// BlastSimulator2026 — Integration tests: Economy system (Phase 4)
// Covers finance, contracts, negotiation, and logistics subsystems.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { financesCommand, contractCommand } from '../../src/console/commands/economy.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import {
  createFinanceState,
  addIncome,
  addExpense,
  getBalance,
  getFinancialReport,
  type FinanceState,
  type IncomeCategory,
  type ExpenseCategory,
} from '../../src/core/economy/Finance.js';
import {
  createContractState,
  generateContracts,
  acceptContract,
  deliverMaterials,
  checkDeadlines,
  type ContractState,
  type Contract,
} from '../../src/core/economy/Contract.js';
import { negotiateContract } from '../../src/core/economy/Negotiation.js';
import { Random } from '../../src/core/math/Random.js';

// ── Contract fixture helpers ─────────────────────────────────────────────────

/**
 * Insert a fixed ore_sale contract directly into the available list for deterministic tests.
 */
function insertOreSaleContract(
  state: ContractState,
  quantityKg: number,
  pricePerKg: number,
  overrides?: Partial<Contract>,
): Contract {
  const id = state.nextId++;
  const contract: Contract = {
    id,
    type: 'ore_sale',
    materialId: 'blingite',
    description: `[test fixture] deliver ${quantityKg} kg blingite @ $${pricePerKg}/kg`,
    quantityKg,
    deliveredKg: 0,
    pricePerKg,
    deadlineTicks: 500,
    acceptedAtTick: 0,
    penaltyAmount: Math.round(quantityKg * pricePerKg * 0.3),
    earlyBonus: Math.round(quantityKg * pricePerKg * 0.15),
    completed: false,
    expired: false,
    ...overrides,
  };
  state.available.push(contract);
  return contract;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

// ── Economy ──────────────────────────────────────────────────────────────────

describe('Economy', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  // ── 1. Basic income/expense ──────────────────────────────────────────────────

  it('addIncome and addExpense update balance correctly', () => {
    const fin: FinanceState = createFinanceState(5000);

    expect(getBalance(fin)).toBe(5000);

    addIncome(fin, 1000, 'sales', 'Sold blingite', 5);
    expect(getBalance(fin)).toBe(6000);

    addExpense(fin, 300, 'equipment', 'Drill bits', 5);
    expect(getBalance(fin)).toBe(5700);

    addIncome(fin, 250, 'contracts', 'Contract #12 payment', 10);
    expect(getBalance(fin)).toBe(5950);

    // Verify transactions were recorded
    expect(fin.transactions).toHaveLength(3);
    expect(fin.transactions[0]!.type).toBe('income');
    expect(fin.transactions[0]!.amount).toBe(1000);
    expect(fin.transactions[0]!.category).toBe('sales');
    expect(fin.transactions[1]!.type).toBe('expense');
    expect(fin.transactions[1]!.amount).toBe(300);
    expect(fin.transactions[1]!.category).toBe('equipment');
    expect(fin.transactions[2]!.type).toBe('income');
    expect(fin.transactions[2]!.amount).toBe(250);

    // Zero/negative amounts should be ignored
    addIncome(fin, 0, 'sales', 'Zero income', 10);
    expect(fin.transactions).toHaveLength(3);

    addExpense(fin, -50, 'fuel', 'Negative expense', 10);
    expect(fin.transactions).toHaveLength(3);
  });

  // ── 2. Financial report ─────────────────────────────────────────────────────

  it('getFinancialReport categorizes by type', () => {
    const fin: FinanceState = createFinanceState(10000);

    // Multiple incomes in different categories
    addIncome(fin, 2000, 'sales', 'Blingite sale', 1);
    addIncome(fin, 5000, 'contracts', 'Contract #5 payment', 3);
    addIncome(fin, 800, 'bonus', 'Early completion bonus', 4);
    addIncome(fin, 1500, 'sales', 'Dirtite sale', 6);

    // Multiple expenses in different categories
    addExpense(fin, 1200, 'salaries', 'Employee pay', 2);
    addExpense(fin, 400, 'fuel', 'Diesel refill', 3);
    addExpense(fin, 3000, 'equipment', 'New drill', 5);
    addExpense(fin, 600, 'maintenance', 'Truck repair', 7);

    const report = getFinancialReport(fin, 10);

    expect(report.totalIncome).toBe(9300);
    expect(report.totalExpenses).toBe(5200);
    expect(report.netProfit).toBe(4100);
    expect(report.transactionCount).toBe(8);

    // Income breakdown
    expect(report.incomeByCategory).toHaveLength(3);
    const salesCat = report.incomeByCategory.find(c => c.category === 'sales');
    expect(salesCat).toBeDefined();
    expect(salesCat!.total).toBe(3500); // 2000 + 1500

    const contractsCat = report.incomeByCategory.find(c => c.category === 'contracts');
    expect(contractsCat).toBeDefined();
    expect(contractsCat!.total).toBe(5000);

    const bonusCat = report.incomeByCategory.find(c => c.category === 'bonus');
    expect(bonusCat).toBeDefined();
    expect(bonusCat!.total).toBe(800);

    // Expense breakdown
    expect(report.expensesByCategory).toHaveLength(4);
    const salariesCat = report.expensesByCategory.find(c => c.category === 'salaries');
    expect(salariesCat).toBeDefined();
    expect(salariesCat!.total).toBe(1200);

    const fuelCat = report.expensesByCategory.find(c => c.category === 'fuel');
    expect(fuelCat).toBeDefined();
    expect(fuelCat!.total).toBe(400);

    // Period filtering
    const recentReport = getFinancialReport(fin, 10, 3); // last 3 ticks (tick 7-10)
    expect(recentReport.transactionCount).toBe(1); // only the maintenance expense at tick 7
    expect(recentReport.totalExpenses).toBe(600);
    expect(recentReport.totalIncome).toBe(0);
  });

  // ── 3. Generate contracts ───────────────────────────────────────────────────

  it('generateContracts creates available contracts', () => {
    const cs: ContractState = createContractState();
    const rng = new Random(42);

    // Initially empty
    expect(cs.available).toHaveLength(0);

    generateContracts(cs, rng, 0);
    expect(cs.available.length).toBeGreaterThan(0);
    expect(cs.lastRefreshTick).toBe(0);

    // Each generated contract should have valid properties
    for (const c of cs.available) {
      expect(c.id).toBeGreaterThan(0);
      expect(c.quantityKg).toBeGreaterThan(0);
      expect(c.pricePerKg).toBeGreaterThan(0);
      expect(c.deadlineTicks).toBeGreaterThan(0);
      expect(c.penaltyAmount).toBeGreaterThan(0);
      expect(c.completed).toBe(false);
      expect(c.expired).toBe(false);
      expect(['ore_sale', 'rubble_disposal', 'supply']).toContain(c.type);
    }

    // Consecutive calls within refresh interval should not generate more
    const countBefore = cs.available.length;
    generateContracts(cs, rng, 5); // tick 5, still within interval
    expect(cs.available).toHaveLength(countBefore);
  });

  // ── 4. Accept contract ──────────────────────────────────────────────────────

  it('acceptContract moves contract from available to active', () => {
    const cs: ContractState = createContractState();
    const c1 = insertOreSaleContract(cs, 200, 35);
    const c2 = insertOreSaleContract(cs, 100, 50);

    expect(cs.available).toHaveLength(2);
    expect(cs.active).toHaveLength(0);

    // Accept the first contract
    const accepted = acceptContract(cs, c1.id, 10);
    expect(accepted).not.toBeNull();
    expect(accepted!.id).toBe(c1.id);
    expect(accepted!.acceptedAtTick).toBe(10);

    // Verify it moved
    expect(cs.available).toHaveLength(1);
    expect(cs.available[0]!.id).toBe(c2.id);
    expect(cs.active).toHaveLength(1);
    expect(cs.active[0]!.id).toBe(c1.id);

    // Accepting a non-existent contract returns null
    const missing = acceptContract(cs, 999, 15);
    expect(missing).toBeNull();
    expect(cs.available).toHaveLength(1);
    expect(cs.active).toHaveLength(1);
  });

  // ── 5. Partial delivery ─────────────────────────────────────────────────────

  it('deliverMaterials partial delivery returns partial payment', () => {
    const cs: ContractState = createContractState();
    const c = insertOreSaleContract(cs, 100, 50); // 100kg @ $50/kg = $5000 full value
    acceptContract(cs, c.id, 0);

    // Deliver 40kg out of 100kg
    const result = deliverMaterials(cs, c.id, 40, 10);
    expect(result.payment).toBe(2000); // 40 × $50
    expect(result.bonus).toBe(0);
    expect(result.completed).toBe(false);

    // Contract should not be completed yet
    const activeContract = cs.active[0]!;
    expect(activeContract.deliveredKg).toBe(40);
    expect(activeContract.completed).toBe(false);

    // Deliver another 35kg
    const result2 = deliverMaterials(cs, c.id, 35, 15);
    expect(result2.payment).toBe(1750); // 35 × $50
    expect(result2.completed).toBe(false);

    expect(activeContract.deliveredKg).toBe(75);
  });

  // ── 6. Full delivery completes contract ──────────────────────────────────────

  it('deliverMaterials full delivery completes contract', () => {
    const cs: ContractState = createContractState();
    const c = insertOreSaleContract(cs, 100, 50);
    acceptContract(cs, c.id, 0);

    // Deliver full 100kg
    const result = deliverMaterials(cs, c.id, 100, 10);
    expect(result.payment).toBe(5000); // 100 × $50
    expect(result.completed).toBe(true);

    // Contract should be in completed history, removed from active
    expect(cs.active).toHaveLength(0);
    expect(cs.completedHistory).toHaveLength(1);
    expect(cs.completedHistory[0]!.id).toBe(c.id);
    expect(cs.completedHistory[0]!.completed).toBe(true);
    expect(cs.completedHistory[0]!.deliveredKg).toBe(100);
  });

  // ── 7. Deliver on already-completed contract returns 0 ──────────────────────

  it('deliverMaterials on already-completed contract returns 0', () => {
    const cs: ContractState = createContractState();
    const c = insertOreSaleContract(cs, 100, 50);
    acceptContract(cs, c.id, 0);

    // Complete the contract
    deliverMaterials(cs, c.id, 100, 10);

    // Try delivering again
    const result = deliverMaterials(cs, c.id, 50, 20);
    expect(result.payment).toBe(0);
    expect(result.bonus).toBe(0);
    expect(result.completed).toBe(false);

    // Delivering to a non-existent contract also returns 0
    const missing = deliverMaterials(cs, 999, 10, 20);
    expect(missing.payment).toBe(0);
    expect(missing.bonus).toBe(0);
    expect(missing.completed).toBe(false);
  });

  // ── 8. checkDeadlines applies penalty for expired contracts ──────────────────

  it('checkDeadlines applies penalty for expired contracts', () => {
    const cs: ContractState = createContractState();

    // Contract with very short deadline (10 ticks), accepted at tick 0
    const c = insertOreSaleContract(cs, 100, 35, {
      deadlineTicks: 10,
      acceptedAtTick: 0,
    });
    acceptContract(cs, c.id, 0);

    // Before deadline, no penalties
    const beforeDeadline = checkDeadlines(cs, 5);
    expect(beforeDeadline).toHaveLength(0);
    expect(cs.active).toHaveLength(1);
    expect(c.expired).toBe(false);

    // After deadline (tick 11 > 10 deadlineTicks)
    const afterDeadline = checkDeadlines(cs, 11);
    expect(afterDeadline).toHaveLength(1);
    expect(afterDeadline[0]!.contractId).toBe(c.id);
    expect(afterDeadline[0]!.penalty).toBe(c.penaltyAmount);
    expect(c.expired).toBe(true);

    // Contract moved to completedHistory
    expect(cs.active).toHaveLength(0);
    expect(cs.completedHistory).toHaveLength(1);
    expect(cs.completedHistory[0]!.expired).toBe(true);

    // Calling again on expired contract does nothing
    const again = checkDeadlines(cs, 20);
    expect(again).toHaveLength(0);
  });

  // ── 9. finances command output ──────────────────────────────────────────────

  it('finances command output contains balance and report', () => {
    const result = financesCommand(ctx, [], {});

    expect(result.success).toBe(true);
    expect(result.output).toContain('Balance:');
    expect(result.output).toContain('Total income:');
    expect(result.output).toContain('Total expenses:');
    expect(result.output).toContain('Net profit:');

    // Fresh game: $50,000 starting cash, no transactions
    expect(result.output).toContain('$50000.00');
    expect(result.output).toContain('$0.00');
  });

  // ── 10. negotiateContract changes terms ────────────────────────────────────

  it('negotiateContract changes terms on success', () => {
    const cs: ContractState = createContractState();
    const rng = new Random(42);

    // Insert a contract with known baseline terms
    const c = insertOreSaleContract(cs, 200, 35);
    const originalPrice = c.pricePerKg;
    const originalDeadline = c.deadlineTicks;
    const originalPenalty = c.penaltyAmount;

    // Negotiate with very high reputation (ensures >95% success rate)
    const result = negotiateContract(cs, c.id, 100, rng);

    expect(result).not.toBeNull();
    expect(result!.contract.id).toBe(c.id);

    // The negotiation always changes the contract (success improves, failure worsens)
    const changed =
      result!.contract.pricePerKg !== originalPrice ||
      result!.contract.deadlineTicks !== originalDeadline ||
      result!.contract.penaltyAmount !== originalPenalty;
    expect(changed).toBe(true);

    // changes array should contain descriptions of what happened
    expect(result!.changes.length).toBeGreaterThan(0);

    // With reputation=100, successRate = min(0.95, max(0.05, 0.5 + 100*0.01))
    // = min(0.95, 1.5) = 0.95, so very likely to succeed
    if (result!.success) {
      // On success, price should be >= original (improved)
      // Actually price improves: pricePerKg *= (1 + factor), so it increases
      // But could also have improved deadline or penalty
      const improvedSomething =
        result!.contract.pricePerKg >= originalPrice ||
        result!.contract.deadlineTicks >= originalDeadline ||
        result!.contract.penaltyAmount <= originalPenalty;
      expect(improvedSomething).toBe(true);
    }

    // Non-existent contract returns null
    const missing = negotiateContract(cs, 999, 100, rng);
    expect(missing).toBeNull();
  });
});
