// #1408 — smuggling income is booked under its own 'smuggling' ledger
// category, not disguised as 'contracts' income.
import { describe, it, expect, beforeEach } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { runTick } from '../../../src/core/engine/TickPipeline.js';
import { clearEvents } from '../../../src/core/events/EventPool.js';
import { getFinancialReport } from '../../../src/core/economy/Finance.js';

const MAX_TICKS = 20;

function tickUntilIncome(seed: number, income: number) {
  const state = createGame({ seed });
  state.mafia.smugglingActive = true;
  state.mafia.smugglingIncome = income;
  const emitter = new EventEmitter();
  const cashBefore = state.cash;
  const hasIncome = () => state.finances.transactions.some(tx => tx.type === 'income');
  for (let ticks = 0; ticks < MAX_TICKS && !hasIncome(); ticks++) {
    runTick(state, null, new Random(state.seed + state.tickCount), emitter, { checkInvariants: false });
  }
  if (!hasIncome()) throw new Error(`no income booked within ${MAX_TICKS} ticks`);
  return { state, cashBefore };
}

describe('runTick smuggling income category (#1408)', () => {
  beforeEach(() => clearEvents());

  it('books smuggling income under the smuggling category', () => {
    const { state } = tickUntilIncome(42, 8000);
    const report = getFinancialReport(state.finances, state.tickCount);
    const entry = report.incomeByCategory.find(c => c.category === 'smuggling');
    expect(entry).toBeDefined();
    expect(entry!.total).toBeGreaterThan(0);
  });

  it('does not credit smuggling income to contracts', () => {
    const { state } = tickUntilIncome(42, 8000);
    const report = getFinancialReport(state.finances, state.tickCount);
    expect(report.incomeByCategory.find(c => c.category === 'contracts')).toBeUndefined();
  });

  it('still adds the smuggling income to cash', () => {
    const { state, cashBefore } = tickUntilIncome(42, 8000);
    const booked = state.finances.transactions
      .filter(tx => tx.type === 'income' && tx.category === 'smuggling')
      .reduce((s, tx) => s + tx.amount, 0);
    expect(booked).toBeGreaterThanOrEqual(8000);
    const expenses = state.finances.transactions
      .filter(tx => tx.type === 'expense')
      .reduce((sum, tx) => sum + tx.amount, 0);
    // cash delta = income - expenses, so delta + expenses must cover smuggling income
    expect(state.cash - cashBefore + expenses).toBeGreaterThanOrEqual(booked);
  });
});
