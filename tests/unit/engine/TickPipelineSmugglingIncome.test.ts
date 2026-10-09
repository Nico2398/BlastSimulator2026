// #1408 — smuggling income is booked under its own 'smuggling' ledger category.
// #1409 — it is a chosen multiple of the mine's trailing operating income, so a mine
// that does no mining earns nothing from smuggling, and it goes onto the tax-audit books.
import { describe, it, expect, beforeEach } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { runTick } from '../../../src/core/engine/TickPipeline.js';
import { clearEvents } from '../../../src/core/events/EventPool.js';
import { getFinancialReport, addIncome } from '../../../src/core/economy/Finance.js';
import { setSmugglingVolume } from '../../../src/core/events/MafiaActions.js';
import { OPERATING_INCOME_WINDOW_TICKS } from '../../../src/core/config/balance.js';

const START_TICK = 500;
const SALES = 7_200; // booked inside the trailing window => OPERATING_INCOME_WINDOW_TICKS-averaged rate
const OPERATING_RATE = SALES / OPERATING_INCOME_WINDOW_TICKS;

function tick(state: GameState, emitter: EventEmitter): void {
  runTick(state, null, new Random(state.seed + state.tickCount), emitter, { checkInvariants: false });
}

/** A game that earned `SALES` from selling ore just before `START_TICK`, smuggling at `volume`. */
function stateWithOperatingIncome(volume: number, seed = 42): GameState {
  const state = createGame({ seed });
  state.tickCount = START_TICK;
  addIncome(state.finances, SALES, 'sales', 'Ore sale', START_TICK);
  expect(setSmugglingVolume(state.mafia, volume).success).toBe(true);
  return state;
}

function smugglingTransactions(state: GameState) {
  return state.finances.transactions.filter(tx => tx.type === 'income' && tx.category === 'smuggling');
}

describe('runTick smuggling income (#1408, #1409)', () => {
  beforeEach(() => clearEvents());

  it('books volume x trailing operating income under the smuggling category', () => {
    const state = stateWithOperatingIncome(0.25);
    tick(state, new EventEmitter());
    const txs = smugglingTransactions(state);
    expect(txs).toHaveLength(1);
    expect(txs[0]!.amount).toBeCloseTo(0.25 * OPERATING_RATE, 4);
    const report = getFinancialReport(state.finances, state.tickCount);
    const entry = report.incomeByCategory.find(c => c.category === 'smuggling');
    expect(entry!.total).toBeCloseTo(0.25 * OPERATING_RATE, 4);
  });

  it('scales with the chosen volume', () => {
    for (const volume of [0.1, 0.5, 1]) {
      const state = stateWithOperatingIncome(volume);
      tick(state, new EventEmitter());
      expect(smugglingTransactions(state)[0]!.amount).toBeCloseTo(volume * OPERATING_RATE, 4);
    }
  });

  it('does not credit smuggling income to contracts', () => {
    const state = stateWithOperatingIncome(0.5);
    tick(state, new EventEmitter());
    const report = getFinancialReport(state.finances, state.tickCount);
    expect(report.incomeByCategory.find(c => c.category === 'contracts')).toBeUndefined();
  });

  it('adds the smuggling income to cash', () => {
    const state = stateWithOperatingIncome(0.5);
    const cashBefore = state.cash;
    tick(state, new EventEmitter());
    const booked = smugglingTransactions(state).reduce((s, tx) => s + tx.amount, 0);
    const expenses = state.finances.transactions
      .filter(tx => tx.type === 'expense')
      .reduce((sum, tx) => sum + tx.amount, 0);
    expect(booked).toBeGreaterThan(0);
    expect(state.cash - cashBefore + expenses).toBeCloseTo(booked, 4);
  });

  it('earns nothing when the mine has no operating income', () => {
    const state = createGame({ seed: 42 });
    state.tickCount = START_TICK;
    setSmugglingVolume(state.mafia, 1);
    const emitter = new EventEmitter();
    for (let i = 0; i < 60; i++) tick(state, emitter);
    expect(smugglingTransactions(state)).toHaveLength(0);
  });

  it('earns nothing at volume 0 even with operating income', () => {
    const state = stateWithOperatingIncome(0);
    const emitter = new EventEmitter();
    for (let i = 0; i < 10; i++) tick(state, emitter);
    expect(smugglingTransactions(state)).toHaveLength(0);
  });

  it('does not count its own income as operating income (no feedback loop)', () => {
    const state = createGame({ seed: 42 });
    state.tickCount = START_TICK;
    setSmugglingVolume(state.mafia, 1);
    addIncome(state.finances, 1, 'smuggling', 'seed money', START_TICK - 1);
    const emitter = new EventEmitter();
    for (let i = 0; i < 20; i++) tick(state, emitter);
    expect(smugglingTransactions(state).filter(tx => tx.tick > START_TICK - 1)).toHaveLength(0);
  });

  it('books the smuggled income onto the tax-audit books', () => {
    const state = stateWithOperatingIncome(0.25);
    tick(state, new EventEmitter());
    const smuggled = state.taxAudit.buckets.reduce((s, b) => s + b.smuggled, 0);
    expect(smuggled).toBeCloseTo(0.25 * OPERATING_RATE, 4);
  });

  it('keeps smuggling off the books when volume is 0', () => {
    const state = stateWithOperatingIncome(0);
    tick(state, new EventEmitter());
    expect(state.taxAudit.buckets.reduce((s, b) => s + b.smuggled, 0)).toBe(0);
  });

  it('smuggling alone adds no mafia exposure', () => {
    const state = stateWithOperatingIncome(1);
    const emitter = new EventEmitter();
    for (let i = 0; i < 60; i++) tick(state, emitter);
    expect(smugglingTransactions(state).length).toBeGreaterThan(0);
    expect(state.mafia.exposureRisk).toBe(0);
    expect(state.arrest.arrested).toBe(false);
  });
});
