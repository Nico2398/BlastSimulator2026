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
    halfExtents: { x: 0.3, y: 0.3, z: 0.3 },
    shapeSeed: id,
  };
  ctx.state!.logistics.fragments.push({ fragment, state: 'stored', vehicleId: null });
  ctx.state!.logistics.storedMassKg += mass;
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, landscape: null, playableArea: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

/**
 * Hires one driller (qualified 'blasting' by default, ROLE_STARTING_QUALIFICATION)
 * and buys one drill_rig vehicle, so drill_plan grid's queued drill_hole
 * actions (#553) can actually land.
 */
function hireDrillerAndRig(ctx: GameContext): void {
  const hireResult = employeeCommand(ctx, ['hire'], { role: 'driller' });
  expect(hireResult.success).toBe(true);
  const drillerId = ctx.state!.employees.employees.find(e => e.role === 'driller')!.id;
  employeeCommand(ctx, ['assign_skill', String(drillerId)], { skill: 'driving.drill_rig', level: '5' });
  const buyRig = vehicleCommand(ctx, ['buy', 'drill_rig'], {});
  expect(buyRig.success).toBe(true);
}

/**
 * Ticks until every hole ordered by the last drill_plan grid has landed in
 * state.drillHoles (#553). Tops up employee need gauges each tick — a solo
 * drill_rig/driller multi-hole drive can otherwise run long enough for
 * hunger/fatigue/breakNeed to cross a collapse threshold mid-drive, an
 * unrelated needs mechanic this test isn't exercising.
 */
function driveDrillPlanToCompletion(ctx: GameContext, maxTicks = 400): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedDrillHoles.length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.hunger = 100;
      emp.fatigue = 100;
      emp.breakNeed = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
}

/**
 * Ticks until every charge ordered by the last `charge hole:*` has landed in
 * state.chargesByHole (#554), mirroring driveDrillPlanToCompletion above.
 */
function driveChargePlanToCompletion(ctx: GameContext, maxTicks = 400): void {
  for (let i = 0; i < maxTicks && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.hunger = 100;
      emp.fatigue = 100;
      emp.breakNeed = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
}

/**
 * Ticks until every construction site ordered so far has landed in
 * state.buildings.buildings (#556), mirroring driveDrillPlanToCompletion
 * above. A `place_building` order needs an idle employee to claim and finish
 * it — callers of this helper are expected to have hired one first.
 */
function driveConstructionToCompletion(ctx: GameContext, maxTicks = 300): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedBuildings.length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.hunger = 100;
      emp.fatigue = 100;
      emp.breakNeed = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
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
    // #556: confirming the order only queues a construction site — an idle
    // employee has to actually finish it before the building's operating
    // cost applies. Hire one and drive the order to completion first.
    const hireResult = employeeCommand(ctx, ['hire'], { role: 'driller' });
    expect(hireResult.success).toBe(true);

    const buildResult = buildCommand(ctx, ['freight_warehouse'], { at: '5,5' });
    expect(buildResult.success).toBe(true);
    driveConstructionToCompletion(ctx);
    expect(ctx.state!.buildings.buildings).toHaveLength(1);

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

  // ── contract accept/decline/deliver/negotiate by material/type selector (#597) ──
  // A scenario naming a contract by id assumes exactly which one generation
  // handed it this run — the id shifts (or the contract rotates out of the
  // pool entirely) the moment upstream pacing changes. `material:`/`type:`
  // names it by what it actually is instead.

  it('contract accept resolves a contract by material: selector, no id needed', () => {
    const c = insertOreSaleContract(ctx.state!.contracts, 100, 10);
    const result = contractCommand(ctx, ['accept'], { material: c.materialId });
    expect(result.success).toBe(true);
    expect(result.output).toContain(`#${c.id}`);
    expect(ctx.state!.contracts.active.find(a => a.id === c.id)).toBeDefined();
  });

  it('contract accept resolves a contract by material: + type: selector together', () => {
    const c = insertOreSaleContract(ctx.state!.contracts, 100, 10);
    const result = contractCommand(ctx, ['accept'], { material: c.materialId, type: c.type });
    expect(result.success).toBe(true);
    expect(ctx.state!.contracts.active.find(a => a.id === c.id)).toBeDefined();
  });

  it('contract accept by material: selector is refused when nothing matches, naming what was searched for', () => {
    const result = contractCommand(ctx, ['accept'], { material: 'no_such_material' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('no_such_material');
  });

  it('contract accept with neither an id nor a material/type selector returns the usage message', () => {
    const result = contractCommand(ctx, ['accept'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage');
  });

  it('contract decline resolves a contract by material: selector', () => {
    const c = insertOreSaleContract(ctx.state!.contracts, 100, 10);
    const before = ctx.state!.contracts.available.length;
    const result = contractCommand(ctx, ['decline'], { material: c.materialId });
    expect(result.success).toBe(true);
    expect(ctx.state!.contracts.available.length).toBe(before - 1);
    expect(ctx.state!.contracts.available.find(a => a.id === c.id)).toBeUndefined();
  });

  it('contract deliver resolves an active contract by material: selector', () => {
    const c = insertOreSaleContract(ctx.state!.contracts, 100, 10);
    expect(contractCommand(ctx, ['accept'], { material: c.materialId }).success).toBe(true);
    pushStoredFragment(ctx, 1, 500, 0.04, { [c.materialId]: 1.0 });
    ctx.state!.collectedOre[c.materialId] = 100;

    const result = contractCommand(ctx, ['deliver'], { material: c.materialId, amount: '100' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('COMPLETED');
  });

  it('contract negotiate resolves an available contract by material: selector', () => {
    const c = insertOreSaleContract(ctx.state!.contracts, 100, 10);
    const result = contractCommand(ctx, ['negotiate'], { material: c.materialId });
    expect(result.success).toBe(true);
    expect(ctx.state!.contracts.lastNegotiation?.contractId).toBe(c.id);
  });

  it('contract accept by material: selector still finds a same-kind contract after the numeric id it started as has rotated out of the pool', () => {
    const rng = new Random(7);
    generateContracts(ctx.state!.contracts, rng, ctx.state!.tickCount);
    const target = ctx.state!.contracts.available[0]!;
    const evictedId = target.id;

    // Force enough refresh cycles that the original entry is evicted from
    // `available` — the exact scenario #586 hit by hand-editing ids.
    let tick = ctx.state!.tickCount;
    while (ctx.state!.contracts.available.some(c => c.id === evictedId)) {
      tick += 20;
      generateContracts(ctx.state!.contracts, new Random(7 + tick), tick);
    }
    expect(contractCommand(ctx, ['accept', String(evictedId)], {}).success).toBe(false);

    // If a same-kind contract is still on offer, the selector finds it —
    // no id renumbering required.
    const stillOffered = ctx.state!.contracts.available.find(
      c => c.type === target.type && c.materialId === target.materialId,
    );
    if (stillOffered) {
      const result = contractCommand(ctx, ['accept'], { material: target.materialId, type: target.type });
      expect(result.success).toBe(true);
    }
  });

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
    // Raised above the $50,000 default (#553): this test now crews a
    // drill_rig ($35,000) on top of the debris_hauler ($25,000) it already
    // crewed — the default balance cannot cover both once the driller's
    // hiring cost is deducted too. Nothing here asserts anything about money.
    ctx.state!.cash = 200_000;

    // 1. Blast a small grid so fragments land on the ground.
    //
    // Origin (18,19) rather than (10,10): the fragments have to land on ground
    // the hauler can actually drive to. (10,10) sits up the slope from where a
    // vehicle spawns, on a different NavGrid bench with no ramp between, so
    // findReachableGroundFragment correctly returns null there and the test
    // would be asserting against a fixture the game cannot satisfy. (18,19) is
    // on the same flat bench as the vehicle spawn and the warehouse.
    hireDrillerAndRig(ctx);

    const drillResult = drillPlanCommand(ctx as any, ['grid'], {
      origin: '18,19',
      rows: '2',
      cols: '2',
      spacing: '4',
      depth: '8',
    });
    expect(drillResult.success).toBe(true);
    driveDrillPlanToCompletion(ctx);

    const chargeResult = chargeCommand(ctx as any, [], {
      hole: '*',
      explosive: 'boomite',
      amount: '5kg',
      stemming: '2m',
    });
    expect(chargeResult.success).toBe(true);
    driveChargePlanToCompletion(ctx);

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
    // find (not [0]) — hireDrillerAndRig already purchased a drill_rig above.
    const vehicleId = ctx.state!.vehicles.vehicles.find(v => v.type === 'debris_hauler')!.id;

    const assignResult = vehicleCommand(ctx, ['driver', String(vehicleId), String(driverId)], {});
    expect(assignResult.success).toBe(true);

    // Let the driver walk to and board the vehicle. No Freight Warehouse
    // exists yet at this point — deliberately: self-dispatch (#552) can only
    // ever start a haul_debris workflow once an active depot exists
    // (requestHaulFragment's own depot check), so with no depot the hauler
    // simply stays idle/seated across this wait instead of racing the manual
    // haul below with an automatic one.
    for (let i = 0; i < 10; i++) tickCommand(ctx, ['1'], {});

    // 3. Build an active Freight Warehouse now. (13,13), near the drill site
    // rather than (5,5): bigger levels (#458 T6.1/D13) carry far more
    // natural terrain relief than the old ones, fragmenting NavGrid bench
    // levels into small pockets more often — (5,5) sat on a different bench
    // than the drill/fragment area with no nearby ramp connecting them, so a
    // loaded hauler could never findPath there (confirmed via direct
    // reproduction). Keeping pickup and drop-off on the same bench sidesteps
    // that pathfinding gap; a deeper general fix belongs to T6.2.
    //
    // #556: confirming the order only queues a construction site — a fresh
    // employee (not the driller, whose needs already ran down through the
    // whole drill+charge grind above with nobody topping them off during the
    // 10-tick board wait just above; not the boarded debris_hauler driver
    // either) finishes it via driveConstructionToCompletion. That drives
    // real ticks, but no tick runs BETWEEN completion and the manual
    // reachability probe/haul below: tickTaskCompletion's place_building
    // branch (which flips the site real) runs after that same tick's own
    // syncHaulDispatch, so self-dispatch never sees the depot active in time
    // to race the manual haul — the guarantee the old "no tick in between"
    // comment described still holds, just spread across the site's whole
    // build duration instead of a single instant call.
    const hireBuilder = employeeCommand(ctx, ['hire'], { role: 'manager' });
    expect(hireBuilder.success).toBe(true);

    const buildResult = buildCommand(ctx, ['freight_warehouse'], { at: '13,13' });
    expect(buildResult.success).toBe(true);
    driveConstructionToCompletion(ctx);
    expect(ctx.state!.buildings.buildings.some(b => b.type === 'freight_warehouse')).toBe(true);

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

    // 7. Deliver against an active contract. The blast is a real, RNG-driven
    // pipeline — unlike the fixture-injected-fragment tests above, there is
    // no guarantee this particular grid's fragments carry any given ore
    // (blingite is a probabilistic vein, not a certainty per voxel). A
    // rubble_disposal contract (materialId: '') is the one contract type
    // that consumeStoredOre accepts against raw stored mass regardless of
    // ore content, so it is the deterministic way to round-trip this leg.
    const contract = insertOreSaleContract(ctx.state!.contracts, 50, 10, {
      type: 'rubble_disposal',
      materialId: '',
      description: '[test fixture] dispose of 50 kg rubble @ $10/kg',
    });
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

  // #671's own stated verification criterion: an ore_sale contract with a
  // realistic deadline is fulfillable from automatic dispatch alone — no
  // manual `vehicle haul` (or any other dispatch-bypassing command) needed
  // to get the ore into storage. Only `contract deliver` is called by hand
  // below, and that's the economy step (turning already-stored ore into
  // payment), not the logistics step the #671 fix covers.
  it('ore_sale contract with a realistic deadline is fulfilled by self-dispatch alone, no manual haul', () => {
    ctx.state!.cash = 200_000;

    // 1. Active depot, on the same bench as the vehicle spawn (#458/#586
    // reachability notes above apply equally here — (13,13) is proven
    // reachable from this exact seed/size fixture). Built first, before any
    // debris_hauler is crewed: no capable dispatcher exists yet, so there is
    // nothing for self-dispatch to race regardless of how many ticks
    // construction itself takes (#556 — confirming the order only queues a
    // construction site; a dedicated fresh "manager" employee, not the
    // eventual debris_hauler driver, finishes it below).
    const hireBuilder = employeeCommand(ctx, ['hire'], { role: 'manager' });
    expect(hireBuilder.success).toBe(true);

    const buildResult = buildCommand(ctx, ['freight_warehouse'], { at: '13,13' });
    expect(buildResult.success).toBe(true);
    driveConstructionToCompletion(ctx);
    expect(ctx.state!.buildings.buildings.some(b => b.type === 'freight_warehouse')).toBe(true);

    // 2. Crew a debris_hauler.
    const hireDriver = employeeCommand(ctx, ['hire'], { role: 'driver' });
    expect(hireDriver.success).toBe(true);
    const driverId = ctx.state!.employees.employees.find(e => e.role === 'driver')!.id;
    employeeCommand(ctx, ['assign_skill', String(driverId)], {
      skill: 'driving.truck',
      level: '5',
    });

    const buyResult = vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    expect(buyResult.success).toBe(true);
    const vehicleId = ctx.state!.vehicles.vehicles.find(v => v.type === 'debris_hauler')!.id;

    const assignResult = vehicleCommand(ctx, ['driver', String(vehicleId), String(driverId)], {});
    expect(assignResult.success).toBe(true);

    // Let the driver walk to and board the vehicle before any haul_debris
    // action exists to claim — the depot is already active at this point,
    // but with no ground fragment yet syncHaulDispatch has nothing to queue
    // regardless, so self-dispatch still can't race the setup below.
    for (let i = 0; i < 10; i++) tickCommand(ctx, ['1'], {});

    // 3. A real, ore-bearing on_ground fragment — 430 kg of gloomium,
    // matching #671's own reproduction numbers (~33 ticks observed) —
    // injected directly rather than driven off a real blast: the blast is
    // RNG-driven and doesn't guarantee any given ore lands in a given hole,
    // which is exactly why the full-economy-loop test above had to fall
    // back to a rubble_disposal contract instead. (18,19) matches that same
    // test's proven-reachable landing column for this seed/size fixture.
    const fragment: FragmentData = {
      id: 9001,
      position: { x: 18, y: 0, z: 19 },
      volume: 0.43,
      mass: 1075,
      rockId: 'sandite',
      oreDensities: { gloomium: 0.4 },
      initialVelocity: { x: 0, y: 0, z: 0 },
      isProjection: false,
      halfExtents: { x: 0.3, y: 0.3, z: 0.3 },
      shapeSeed: 9001,
    };
    ctx.state!.logistics.fragments.push({ fragment, state: 'on_ground', vehicleId: null });

    // 4. Accept an ore_sale contract for exactly what the fragment yields
    // (volume × density × ORE_DENSITY_KG_M3 = 0.43 × 0.4 × 2500 = 430 kg),
    // with a realistic deadline comfortably above the issue's own ~33-tick
    // repro number.
    const contract = insertOreSaleContract(ctx.state!.contracts, 430, 80, {
      materialId: 'gloomium',
      deadlineTicks: 45,
      description: '[test fixture] deliver 430 kg gloomium @ $80/kg',
    });
    const acceptResult = contractCommand(ctx, ['accept', String(contract.id)], {});
    expect(acceptResult.success).toBe(true);

    // 5. Tick forward with NO manual `vehicle haul` call anywhere — only
    // self-dispatch (syncHaulDispatch, run every tick inside tickCommand)
    // claims, drives, loads, and delivers the fragment.
    let ticks = 0;
    while (ctx.state!.logistics.storedMassKg === 0 && ticks < contract.deadlineTicks) {
      tickCommand(ctx, ['1'], {});
      ticks++;
    }
    expect(ctx.state!.logistics.storedMassKg).toBeGreaterThan(0);
    expect(ticks).toBeLessThan(contract.deadlineTicks);
    expect(ctx.state!.collectedOre['gloomium'] ?? 0).toBeGreaterThanOrEqual(430);

    // 6. Deliver — the economy step, not the logistics step: turns ore
    // already sitting in the warehouse (put there by automatic dispatch
    // alone, above) into contract fulfillment.
    const deliverResult = contractCommand(ctx, ['deliver', String(contract.id)], {
      amount: '430',
    });
    expect(deliverResult.success).toBe(true);
    expect(contract.completed).toBe(true);
    expect(ctx.state!.tickCount - contract.acceptedAtTick).toBeLessThanOrEqual(contract.deadlineTicks);
    expect(ctx.state!.contracts.completedHistory).toContain(contract);
  });

  // ── 15. Ore-priority haul dispatch on a warehouse smaller than the blast ──
  //         (#671) — regression: collectedOre.<material> never rose via
  //         automatic haul dispatch because estimateActionCost/
  //         selectBestActionForEmployee (ActionSelection.ts) ranked
  //         haul_debris candidates purely by travel-time cost. A small Tier 1
  //         freight_warehouse (2000kg, BuildingDefs.ts) fills from the
  //         first cheapest (nearest, ore-agnostic) fragments and permanently
  //         excludes remaining ones — including ore-bearing ones, since
  //         nothing frees warehouse room except a player's own contract sale.
  //
  // Seed 20's 3x3 grid at (18,19) deterministically exposes ~355 ore-bearing
  // fragments alongside plenty of plain rock (sandbox-confirmed against the
  // real terrain/blast pipeline, no fixture injection needed, driven through
  // this file's own driveDrillPlanToCompletion/driveChargePlanToCompletion
  // helpers): under today's pure-travel-time ranking, the warehouse fills
  // solid from plain spoil alone within the 200-tick window below and
  // collectedOre stays permanently {} — still {} 300+ ticks past that.
  // Once ActionSelection.ts's estimateActionCost subtracts
  // ORE_HAUL_PRIORITY_BONUS_TICKS for ore-bearing candidates
  // (haulActionCarriesOre, HaulDispatch.ts), an ore fragment should outrank
  // at least some nearby plain ones and get delivered before the warehouse
  // fills solid.
  //
  // Fails against today's code (haulActionCarriesOre/ORE_HAUL_PRIORITY_BONUS_TICKS
  // stubs — see src/core/economy/HaulDispatch.ts and src/core/config/balance.ts):
  // collectedOre stays {} for the whole tick window below.

  it('collects ore automatically once ore-priority ranking lets ore-bearing fragments jump a full warehouse queue (#671)', () => {
    newGameCommand(ctx, [], { mine_type: 'desert', seed: '20', size: '64', staffed: 'true', cash: '200000' });

    const drillResult = drillPlanCommand(ctx as any, ['grid'], {
      origin: '18,19', rows: '3', cols: '3', spacing: '3', depth: '8',
    });
    expect(drillResult.success).toBe(true);
    driveDrillPlanToCompletion(ctx);

    const chargeResult = chargeCommand(ctx as any, [], {
      hole: '*', explosive: 'boomite', amount: '5kg', stemming: '2m',
    });
    expect(chargeResult.success).toBe(true);
    driveChargePlanToCompletion(ctx);

    const seqResult = sequenceCommand(ctx as any, ['auto'], {});
    expect(seqResult.success).toBe(true);

    const blastResult = blastCommand(ctx as any, [], {});
    expect(blastResult.success).toBe(true);

    // Sanity: the blast genuinely exposed ore-bearing ground fragments — a
    // regression that later lost this natural exposure would invalidate the
    // whole test, not just this fix.
    const oreBearingFragments = ctx.state!.logistics.fragments.filter(
      f => Object.values(f.fragment.oreDensities).some(density => density > 0),
    );
    expect(oreBearingFragments.length).toBeGreaterThan(0);

    // Staff a fresh driver/debris_hauler pair. Explicit ids (6/5), not
    // `.find(...)`, because staffed:true's own composition
    // (STARTING_SITE_STAFFED_COMPOSITION, balance.ts) already seeds three
    // drivers (one already driving.truck-licensed) and one debris_hauler
    // (ids 1-5) — `.find(e => e.role === 'driver')` would silently resolve
    // to one of those pre-existing entities instead of the one this test
    // means to staff.
    const hireDriver = employeeCommand(ctx, ['hire'], { role: 'driver' });
    expect(hireDriver.success).toBe(true);
    const driverId = 6;
    employeeCommand(ctx, ['assign_skill', String(driverId)], {
      skill: 'driving.truck',
      level: '5',
    });
    const buyResult = vehicleCommand(ctx, ['buy', 'debris_hauler'], {});
    expect(buyResult.success).toBe(true);
    const vehicleId = 5;
    const assignResult = vehicleCommand(ctx, ['driver', String(vehicleId), String(driverId)], {});
    expect(assignResult.success).toBe(true);

    // Default Tier 1 freight_warehouse capacity (BuildingDefs.ts) — small
    // relative to the blast's total haulable mass, which is the whole point.
    // #556: confirming the order only queues a construction site —
    // refreshLogisticsCapacity isn't called again until the site actually
    // completes, so storageCapacityKg stays at LogisticsState's pre-building
    // 5000 default (createLogisticsState) until an idle staffed employee
    // finishes the work.
    const buildResult = buildCommand(ctx, ['freight_warehouse'], { at: '13,13' });
    expect(buildResult.success).toBe(true);
    driveConstructionToCompletion(ctx);
    expect(ctx.state!.buildings.buildings.some(b => b.type === 'freight_warehouse')).toBe(true);
    expect(ctx.state!.logistics.storageCapacityKg).toBe(2000);

    // Bounded window: sandbox-measured convergence (warehouse permanently
    // full at storedMassKg 1861/2000, no more deliveries possible, still
    // unchanged 300+ ticks past this point) well inside 200 ticks on today's
    // code.
    for (let i = 0; i < 200; i++) tickCommand(ctx, ['1'], {});

    const collectedOreTotal = Object.values(ctx.state!.collectedOre).reduce((sum, kg) => sum + kg, 0);
    expect(collectedOreTotal).toBeGreaterThan(0);

    // Regression check: the new ore-priority ranking must not starve out
    // generic spoil delivery entirely — some non-ore mass should still make
    // it into storage.
    expect(ctx.state!.logistics.storedMassKg).toBeGreaterThan(0);
  });
});
