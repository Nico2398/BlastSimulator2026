// BlastSimulator2026 — Integration tests: Economy system (Phase 4)
// Covers finance, contracts, negotiation, and logistics subsystems.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { financesCommand, contractCommand } from '../../src/console/commands/economy.js';
import { buildCommand } from '../../src/console/commands/entities.js';
import { employeeCommand } from '../../src/console/commands/employees.js';
import { vehicleCommand } from '../../src/console/commands/vehicle.js';
import { tickCommand } from '../../src/console/commands/events.js';
import {
  drillPlanCommand,
  chargeCommand,
  sequenceCommand,
  blastCommand,
} from '../../src/console/commands/mining.js';
import { findReachableGroundFragment } from '../../src/core/economy/HaulingTask.js';
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
import type { FragmentData } from '../../src/core/mining/BlastExecution.js';

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

/**
 * Push a fragment directly into warehouse storage (bypassing pickup/deliver)
 * for `contract deliver` fixture setup — mirrors the unit-level `putInStorage`
 * helper in tests/unit/economy/Logistics.test.ts.
 */
function pushStoredFragment(
  ctx: GameContext,
  id: number,
  mass: number,
  volume: number,
  oreDensities: Record<string, number>,
): void {
  const fragment: FragmentData = {
    id,
    position: { x: 0, y: 0, z: 0 },
    volume,
    mass,
    rockId: 'sandite',
    oreDensities,
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
  };
  ctx.state!.logistics.fragments.push({ fragment, state: 'stored', vehicleId: null });
  ctx.state!.logistics.storedMassKg += mass;
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

  // ── 11. Maintenance/fuel costs drain cash every tick (#456) ────────────────

  it('ticking with owned buildings and vehicles and no active tasks strictly drains cash tick over tick', () => {
    const buildResult = buildCommand(ctx, ['freight_warehouse'], { at: '5,5' });
    expect(buildResult.success).toBe(true);

    const buyResult = vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    expect(buyResult.success).toBe(true);

    const cashHistory: number[] = [ctx.state!.cash];
    for (let i = 0; i < 5; i++) {
      tickCommand(ctx, ['1'], {});
      cashHistory.push(ctx.state!.cash);
    }

    // Cash must strictly decrease every single tick — building operating
    // cost + vehicle maintenance cost, with nothing offsetting it (no active
    // tasks, no sales).
    for (let i = 1; i < cashHistory.length; i++) {
      expect(cashHistory[i]).toBeLessThan(cashHistory[i - 1]!);
    }

    // The drain must be booked as categorized expense transactions.
    const report = getFinancialReport(ctx.state!.finances, ctx.state!.tickCount);
    const maintenanceCat = report.expensesByCategory.find(c => c.category === 'maintenance');
    const fuelCat = report.expensesByCategory.find(c => c.category === 'fuel');
    expect(maintenanceCat).toBeDefined();
    expect(maintenanceCat!.total).toBeGreaterThan(0);
    // Vehicle "fuel" expense category should also exist per issue #456's spec
    // (getVehicleCostsPerTick routed through addExpense(..., 'fuel', ...)).
    expect(fuelCat).toBeDefined();
  });

  // ── 12. No buildings/vehicles → no maintenance-category expenses ──────────

  it('ticking with no buildings and no vehicles produces no new maintenance-category expense transactions', () => {
    expect(ctx.state!.buildings.buildings.length).toBe(0);
    expect(ctx.state!.vehicles.vehicles.length).toBe(0);

    const transactionsBefore = ctx.state!.finances.transactions.length;

    for (let i = 0; i < 5; i++) {
      tickCommand(ctx, ['1'], {});
    }

    const newTransactions = ctx.state!.finances.transactions.slice(transactionsBefore);
    const maintenanceOrFuel = newTransactions.filter(
      t => t.category === 'maintenance' || t.category === 'fuel',
    );
    expect(maintenanceOrFuel).toHaveLength(0);
  });

  // ── 13. contract deliver amount validation & capping (#456) ────────────────

  it('contract deliver rejects a non-finite amount and leaves cash unchanged', () => {
    const c = insertOreSaleContract(ctx.state!.contracts, 100, 10);
    const acceptResult = contractCommand(ctx, ['accept', String(c.id)], {});
    expect(acceptResult.success).toBe(true);

    const cashBefore = ctx.state!.cash;

    const deliverResult = contractCommand(ctx, ['deliver', String(c.id)], { amount: 'garbage' });

    expect(deliverResult.success).toBe(false);
    expect(ctx.state!.cash).toBe(cashBefore);
    expect(Number.isFinite(ctx.state!.cash)).toBe(true);
  });

  it('contract deliver caps an over-request to the contract\'s outstanding quantity, leaving surplus stock untouched', () => {
    // Contract needs only 100kg of blingite.
    const c = insertOreSaleContract(ctx.state!.contracts, 100, 10);
    const acceptResult = contractCommand(ctx, ['accept', String(c.id)], {});
    expect(acceptResult.success).toBe(true);

    // Storage holds 300kg of blingite across three fragments (100kg each).
    pushStoredFragment(ctx, 1, 500, 0.04, { blingite: 1.0 });
    pushStoredFragment(ctx, 2, 500, 0.04, { blingite: 1.0 });
    pushStoredFragment(ctx, 3, 500, 0.04, { blingite: 1.0 });
    ctx.state!.collectedOre.blingite = 300;
    const storedMassBefore = ctx.state!.logistics.storedMassKg;
    expect(storedMassBefore).toBe(1500);
    const cashBefore = ctx.state!.cash;

    // Request far more than the contract needs.
    const deliverResult = contractCommand(ctx, ['deliver', String(c.id)], { amount: '300' });

    expect(deliverResult.success).toBe(true);
    expect(deliverResult.output).toContain('Payment: $');

    // Only the contract's real need (100kg) was consumed — one 100kg-of-blingite
    // fragment removed, not all three.
    expect(ctx.state!.collectedOre.blingite).toBe(200);
    expect(ctx.state!.logistics.storedMassKg).toBe(1000);

    // Payment matches the contract's actual need (100kg × $10/kg = $1000,
    // plus the fixture's early-completion bonus of $150), not a payout sized
    // to the requested 300kg.
    expect(ctx.state!.cash).toBe(cashBefore + 1000 + 150);

    // Contract is now fully delivered and completed.
    expect(ctx.state!.contracts.active).toHaveLength(0);
    const completed = ctx.state!.contracts.completedHistory.find(cc => cc.id === c.id);
    expect(completed).toBeDefined();
    expect(completed!.deliveredKg).toBe(100);
    expect(completed!.completed).toBe(true);
  });

  // ── 14. Full round trip: blast -> reachable-fragment haul -> store -> ─────
  //         contract deliver (#466 — playtest could not reach this because no
  //         UI control could ever issue `vehicle haul`, and naive
  //         nearest-fragment selection could hand the player an unreachable
  //         fragment after a full-clear blast).
  //
  // Fails against the stubbed findReachableGroundFragment (throws). Once
  // implemented, still exercises the real pipeline end to end — a
  // reachability-unaware implementation that happens to return *some*
  // fragment id would only diverge from this test if that id is not actually
  // haulable, which the subsequent haul/tick/deliver steps would surface as a
  // failed assertion rather than a thrown stub error.

  it('completes the full economy loop: blast, findReachableGroundFragment, haul, store, and deliver against a contract', () => {
    // 1. Blast a small grid so fragments land on the ground.
    const drillResult = drillPlanCommand(ctx as any, ['grid'], {
      origin: '10,10',
      rows: '2',
      cols: '2',
      spacing: '4',
      depth: '8',
    });
    expect(drillResult.success).toBe(true);

    const chargeResult = chargeCommand(ctx as any, [], {
      hole: '*',
      explosive: 'boomite',
      amount: '5kg',
      stemming: '2m',
    });
    expect(chargeResult.success).toBe(true);

    const seqResult = sequenceCommand(ctx as any, ['auto'], {});
    expect(seqResult.success).toBe(true);

    const blastResult = blastCommand(ctx as any, [], {});
    expect(blastResult.success).toBe(true);
    expect(ctx.state!.logistics.fragments.length).toBeGreaterThan(0);
    expect(ctx.state!.logistics.storedMassKg).toBe(0);

    // 2. Purchase and crew a debris_hauler.
    const hireDriver = employeeCommand(ctx, ['hire'], { role: 'driver' });
    expect(hireDriver.success).toBe(true);
    const driverId = ctx.state!.employees.employees.find(e => e.role === 'driver')!.id;
    employeeCommand(ctx, ['assign_skill', String(driverId)], {
      skill: 'driving.truck',
      level: '5',
    });

    const buyResult = vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    expect(buyResult.success).toBe(true);
    const vehicleId = ctx.state!.vehicles.vehicles[0]!.id;

    const assignResult = vehicleCommand(ctx, ['driver', String(vehicleId), String(driverId)], {});
    expect(assignResult.success).toBe(true);

    // 3. Build an active Freight Warehouse.
    const buildResult = buildCommand(ctx, ['freight_warehouse'], { at: '5,5' });
    expect(buildResult.success).toBe(true);

    // Let the driver walk to and board the vehicle.
    for (let i = 0; i < 10; i++) tickCommand(ctx, ['1'], {});

    // 4. Reachability-aware fragment selection — the fix under test.
    const fragmentId = findReachableGroundFragment(ctx.state!, vehicleId);
    expect(fragmentId).not.toBeNull();

    // 5. Issue the haul.
    const haulResult = vehicleCommand(ctx, ['haul', String(vehicleId)], {
      fragment: String(fragmentId),
    });
    expect(haulResult.success).toBe(true);

    // 6. Tick until the fragment is picked up, driven to the depot, and
    // stored.
    let ticks = 0;
    while (ctx.state!.logistics.storedMassKg === 0 && ticks < 60) {
      tickCommand(ctx, ['1'], {});
      ticks++;
    }
    expect(ctx.state!.logistics.storedMassKg).toBeGreaterThan(0);

    // 7. Deliver against an active contract.
    const contract = insertOreSaleContract(ctx.state!.contracts, 50, 10);
    const acceptResult = contractCommand(ctx, ['accept', String(contract.id)], {});
    expect(acceptResult.success).toBe(true);

    const completedBefore = ctx.state!.contracts.completedHistory.length;
    const deliverAmount = Math.min(50, ctx.state!.logistics.storedMassKg);
    const deliverResult = contractCommand(ctx, ['deliver', String(contract.id)], {
      amount: String(deliverAmount),
    });

    expect(deliverResult.success).toBe(true);
    expect(ctx.state!.contracts.completedHistory.length).toBeGreaterThan(completedBefore);
  });
});
