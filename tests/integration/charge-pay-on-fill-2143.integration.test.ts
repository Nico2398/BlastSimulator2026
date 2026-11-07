// BlastSimulator2026 — Integration: explosives are paid when a hole is loaded, not when it is ordered (#2143)
//
// Ordering a charge books no cash, no expense and waits for no delivery. When the
// crew finishes loading a hole, it is paid in cash at list price (x event factor), once per hole.
// A hole whose cost exceeds cash waits, flagged explosives_unaffordable, until cash covers it.
// Uses the console layer so the whole order -> claim -> walk -> load pipeline runs
// as a player's `tick` commands drive it.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { getFinancialReport } from '../../src/core/economy/Finance.js';
import { tickResolvingEvents } from './helpers.js';

type Run = (cmd: string) => { success: boolean; output: string };

const HOLE_COST = 60;          // boomite $12/kg list price x 5 kg
const ORDER = 'charge hole:* explosive:boomite amount:5 stemming:2';

function setup(cash = 5_000_000): { run: Run; state: GameState } {
  const { runner, ctx } = createRunner();
  const run: Run = cmd => runner.run(cmd) as { success: boolean; output: string };
  expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0;
  expect(run('drill_plan grid rows:3 cols:3 spacing:4 depth:8 start:12,12').success).toBe(true);
  for (let i = 0; i < 4000 && state.plannedDrillHoles.length > 0; i++) tickResolvingEvents(run);
  expect(state.plannedDrillHoles).toHaveLength(0);
  expect(state.drillHoles).toHaveLength(9);
  setCash(state, cash);
  return { run, state };
}

function setCash(state: GameState, cash: number): void {
  state.cash = cash;
  state.finances.cash = cash;
}

function explosivesExpenses(state: GameState) {
  return state.finances.transactions.filter(t => t.category === 'explosives');
}

function explosivesTotal(state: GameState): number {
  const report = getFinancialReport(state.finances, state.tickCount);
  return report.expensesByCategory.find(c => c.category === 'explosives')?.total ?? 0;
}

const loadedCount = (state: GameState) => Object.keys(state.chargesByHole).length;
const chargeOrders = (state: GameState) => state.pendingActions.filter(a => a.type === 'charge_hole');

describe('ordering a 3x3 pattern books nothing (#2143)', () => {
  it('orders all nine holes with cash and expense ledger untouched', () => {
    const { run, state } = setup();
    const cash = state.cash;
    const expenses = explosivesExpenses(state).length;

    expect(run(ORDER).success).toBe(true);

    expect(chargeOrders(state)).toHaveLength(9);
    expect(state.cash).toBe(cash);
    expect(state.finances.cash).toBe(cash);
    expect(explosivesExpenses(state)).toHaveLength(expenses);
  });

  it('is accepted at zero cash', () => {
    const { run, state } = setup(0);
    const result = run(ORDER);
    expect(result.success, result.output).toBe(true);
    expect(chargeOrders(state)).toHaveLength(9);
    expect(state.cash).toBe(0);
  });

  it('cancelling every order with drill_plan clear leaves cash where it was', () => {
    const { run, state } = setup();
    expect(run(ORDER).success).toBe(true);
    const cash = state.cash;
    const expenses = explosivesExpenses(state).length;

    expect(run('drill_plan clear').success).toBe(true);

    expect(chargeOrders(state)).toHaveLength(0);
    expect(state.cash).toBe(cash);
    expect(explosivesExpenses(state)).toHaveLength(expenses);
  });
});

describe('no delivery wait (#2143)', () => {
  it('the first hole is loaded well inside the old 400-tick delivery wait', () => {
    const { run, state } = setup();
    expect(run(ORDER).success).toBe(true);
    const ordered = state.tickCount;

    for (let i = 0; i < 395 && loadedCount(state) === 0; i++) tickResolvingEvents(run);

    expect(loadedCount(state)).toBeGreaterThanOrEqual(1);
    expect(state.tickCount - ordered).toBeLessThan(395);
  });

  it('no order is ever flagged explosives_in_transit and every hole ends up loaded', () => {
    const { run, state } = setup();
    expect(run(ORDER).success).toBe(true);

    for (let i = 0; i < 6000 && loadedCount(state) < 9; i++) {
      tickResolvingEvents(run);
      for (const a of chargeOrders(state)) expect(a.blockedReason as string | null).not.toBe('explosives_in_transit');
    }

    expect(loadedCount(state)).toBe(9);
    expect(chargeOrders(state)).toHaveLength(0);
    expect(Object.keys(state.plannedChargesByHole)).toHaveLength(0);
  }, 120_000);
});

describe('cash falls by each hole\'s explosive cost as it is loaded (#2143)', () => {
  it('books exactly one explosives expense per loaded hole, at the moment it loads', () => {
    const { run, state } = setup();
    expect(run(ORDER).success).toBe(true);
    expect(explosivesExpenses(state)).toHaveLength(0);

    let previous = 0;
    for (let i = 0; i < 6000 && loadedCount(state) < 9; i++) {
      tickResolvingEvents(run);
      const loaded = loadedCount(state);
      expect(explosivesExpenses(state), `after ${loaded} holes`).toHaveLength(loaded);
      expect(explosivesTotal(state)).toBeCloseTo(loaded * HOLE_COST, 6);
      previous = loaded;
    }

    expect(previous).toBe(9);
    for (const t of explosivesExpenses(state)) expect(t.amount).toBeCloseTo(HOLE_COST, 6);
  }, 120_000);

  it('cash drops by at least the cost of every hole that loads during a tick', () => {
    const { run, state } = setup();
    expect(run(ORDER).success).toBe(true);
    const start = state.cash;

    let before = state.cash;
    let loaded = loadedCount(state);
    for (let i = 0; i < 6000 && loaded < 9; i++) {
      tickResolvingEvents(run);
      const now = loadedCount(state);
      if (now > loaded) expect(before - state.cash).toBeGreaterThanOrEqual((now - loaded) * HOLE_COST - 1e-6);
      before = state.cash;
      loaded = now;
    }

    expect(loaded).toBe(9);
    expect(start - state.cash).toBeGreaterThanOrEqual(9 * HOLE_COST - 1e-6);
  }, 120_000);

  it('firing the loaded pattern books no further explosives cost', () => {
    const { run, state } = setup();
    expect(run(ORDER).success).toBe(true);
    for (let i = 0; i < 6000 && loadedCount(state) < 9; i++) tickResolvingEvents(run);
    expect(loadedCount(state)).toBe(9);
    const total = explosivesTotal(state);
    expect(total).toBeCloseTo(9 * HOLE_COST, 6);

    const blast = run('blast');
    expect(blast.success, blast.output).toBe(true);

    expect(explosivesTotal(state)).toBeCloseTo(total, 6);
    expect(state.lastBlastReport!.spent).toBeCloseTo(9 * HOLE_COST, 6);
  }, 120_000);
});

// The staffed crew's payroll drains cash every tick, so the cash-starved cases watch a short window only.
describe('an order the cash cannot pay waits, flagged, until cash covers it (#2143)', () => {
  const STARVED_TICKS = 20;

  it('with cash for one hole at most one load happens; the rest wait flagged explosives_unaffordable', () => {
    const { run, state } = setup(100);
    expect(run(ORDER).success).toBe(true);

    for (let i = 0; i < STARVED_TICKS; i++) tickResolvingEvents(run);

    expect(loadedCount(state)).toBeLessThanOrEqual(1);
    expect(explosivesTotal(state)).toBeLessThanOrEqual(100);
    const waiting = chargeOrders(state);
    expect(waiting.length).toBeGreaterThanOrEqual(8);
    expect(waiting.some(a => a.blockedReason === 'explosives_unaffordable')).toBe(true);
  });

  it('with no cash nothing loads, nothing is booked, and every order is flagged', () => {
    const { run, state } = setup(0);
    expect(run(ORDER).success).toBe(true);

    for (let i = 0; i < STARVED_TICKS; i++) tickResolvingEvents(run);

    expect(loadedCount(state)).toBe(0);
    expect(explosivesExpenses(state)).toHaveLength(0);
    expect(chargeOrders(state)).toHaveLength(9);
    expect(chargeOrders(state).every(a => a.blockedReason === 'explosives_unaffordable')).toBe(true);
  });

  it('once cash is restored the flag clears and every hole loads and pays', () => {
    const { run, state } = setup(0);
    expect(run(ORDER).success).toBe(true);
    for (let i = 0; i < STARVED_TICKS; i++) tickResolvingEvents(run);
    expect(loadedCount(state)).toBe(0);

    setCash(state, 5_000_000);
    for (let i = 0; i < 6000 && loadedCount(state) < 9; i++) tickResolvingEvents(run);

    expect(loadedCount(state)).toBe(9);
    expect(explosivesTotal(state)).toBeCloseTo(9 * HOLE_COST, 6);
    expect(chargeOrders(state)).toHaveLength(0);
  }, 120_000);

  it('never loads on credit: no expense is booked while cash is short', () => {
    const { run, state } = setup(0);
    expect(run(ORDER).success).toBe(true);
    for (let i = 0; i < STARVED_TICKS; i++) tickResolvingEvents(run);
    expect(loadedCount(state)).toBe(0);
    expect(explosivesExpenses(state)).toHaveLength(0);
  });
});
