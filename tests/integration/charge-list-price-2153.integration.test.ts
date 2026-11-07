// BlastSimulator2026 — Integration: every charge is bought at load time at list price (#2153)
//
// Explosive stock is gone. Ordering books nothing; as the crew loads each hole it pays costPerKg x kg x the
// live explosive_price factor from cash and books one 'explosives' expense.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { getFinancialReport } from '../../src/core/economy/Finance.js';
import { tickResolvingEvents } from './helpers.js';

type Run = (cmd: string) => { success: boolean; output: string };

const HOLES = 3;
const HOLE_COST = 60; // boomite $12/kg list price x 5 kg
const ORDER = 'charge hole:* explosive:boomite amount:5 stemming:2';
const STARVED_TICKS = 20;

interface SetupOptions { cash?: number }

function setup({ cash = 5_000_000 }: SetupOptions = {}): { run: Run; state: GameState } {
  const { runner, ctx } = createRunner();
  const run: Run = cmd => runner.run(cmd) as { success: boolean; output: string };
  expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
  const state = ctx.state!;
  state.events.eventFreqMultiplier = 0;
  expect(run(`drill_plan grid rows:1 cols:${HOLES} spacing:4 depth:8 start:12,12`).success).toBe(true);
  for (let i = 0; i < 4000 && state.plannedDrillHoles.length > 0; i++) tickResolvingEvents(run);
  expect(state.plannedDrillHoles).toHaveLength(0);
  expect(state.drillHoles).toHaveLength(HOLES);
  setCash(state, cash);
  return { run, state };
}

function setCash(state: GameState, cash: number): void {
  state.cash = cash;
  state.finances.cash = cash;
}

const explosivesExpenses = (state: GameState) => state.finances.transactions.filter(t => t.category === 'explosives');

function explosivesTotal(state: GameState): number {
  const report = getFinancialReport(state.finances, state.tickCount);
  return report.expensesByCategory.find(c => c.category === 'explosives')?.total ?? 0;
}

const loadedCount = (state: GameState) => Object.keys(state.chargesByHole).length;
const chargeOrders = (state: GameState) => state.pendingActions.filter(a => a.type === 'charge_hole');

function loadAll(run: Run, state: GameState): void {
  for (let i = 0; i < 6000 && loadedCount(state) < HOLES; i++) tickResolvingEvents(run);
  expect(loadedCount(state)).toBe(HOLES);
}

describe('ordering books nothing, loading pays list price (#2153)', () => {
  it('ordering leaves cash and the expense ledger untouched', () => {
    const { run, state } = setup();
    const cash = state.cash;
    expect(run(ORDER).success).toBe(true);
    expect(chargeOrders(state)).toHaveLength(HOLES);
    expect(state.cash).toBe(cash);
    expect(explosivesExpenses(state)).toHaveLength(0);
  });

  it('each loaded hole books one explosives expense of list price x kg', () => {
    const { run, state } = setup();
    expect(run(ORDER).success).toBe(true);
    loadAll(run, state);
    expect(explosivesExpenses(state)).toHaveLength(HOLES);
    for (const t of explosivesExpenses(state)) expect(t.amount).toBeCloseTo(HOLE_COST, 6);
    expect(explosivesTotal(state)).toBeCloseTo(HOLES * HOLE_COST, 6);
  });

  it('cash falls by at least the whole pattern cost once loaded', () => {
    const { run, state } = setup();
    const start = state.cash;
    expect(run(ORDER).success).toBe(true);
    loadAll(run, state);
    expect(start - state.cash).toBeGreaterThanOrEqual(HOLES * HOLE_COST - 1e-6);
  });

  it('no loaded charge records a stock draw', () => {
    const { run, state } = setup();
    expect(run(ORDER).success).toBe(true);
    loadAll(run, state);
    for (const c of Object.values(state.chargesByHole)) {
      expect(Object.keys(c).sort()).toEqual(['amountKg', 'explosiveId', 'stemmingM']);
    }
  });

  it('firing books no further explosives cost; the report spent equals the list-price total', () => {
    const { run, state } = setup();
    expect(run(ORDER).success).toBe(true);
    loadAll(run, state);
    const total = explosivesTotal(state);
    const blast = run('blast');
    expect(blast.success, blast.output).toBe(true);
    expect(explosivesTotal(state)).toBeCloseTo(total, 6);
    expect(state.lastBlastReport!.spent).toBeCloseTo(HOLES * HOLE_COST, 6);
  }, 120_000);
});

describe('an order cash cannot pay waits, flagged (#2153)', () => {
  it('with no cash nothing loads, nothing is booked, and every order is flagged', () => {
    const { run, state } = setup({ cash: 0 });
    expect(run(ORDER).success).toBe(true);
    for (let i = 0; i < STARVED_TICKS; i++) tickResolvingEvents(run);
    expect(loadedCount(state)).toBe(0);
    expect(explosivesExpenses(state)).toHaveLength(0);
    expect(chargeOrders(state)).toHaveLength(HOLES);
    expect(chargeOrders(state).every(a => a.blockedReason === 'explosives_unaffordable')).toBe(true);
  });

  it('with cash for one hole at most one load happens', () => {
    const { run, state } = setup({ cash: HOLE_COST + 1 });
    expect(run(ORDER).success).toBe(true);
    for (let i = 0; i < STARVED_TICKS; i++) tickResolvingEvents(run);
    expect(loadedCount(state)).toBeLessThanOrEqual(1);
    expect(explosivesTotal(state)).toBeLessThanOrEqual(HOLE_COST + 1);
  });

  it('once cash is restored every hole loads and pays list price', () => {
    const { run, state } = setup({ cash: 0 });
    expect(run(ORDER).success).toBe(true);
    for (let i = 0; i < STARVED_TICKS; i++) tickResolvingEvents(run);
    expect(loadedCount(state)).toBe(0);
    setCash(state, 5_000_000);
    loadAll(run, state);
    expect(explosivesTotal(state)).toBeCloseTo(HOLES * HOLE_COST, 6);
    expect(chargeOrders(state)).toHaveLength(0);
  }, 120_000);
});

describe('the explosive_price event factor reaches the load (#2153)', () => {
  it('a live +50% modifier makes each hole cost 1.5x list price', () => {
    const { run, state } = setup();
    state.events.activeModifiers.push({
      id: 1, kind: 'explosive_price', sourceEventId: 'test', role: null, targetId: null,
      category: null, magnitude: 1.5, startTick: 0, endTick: null,
    });
    expect(run(ORDER).success).toBe(true);
    loadAll(run, state);
    for (const t of explosivesExpenses(state)) expect(t.amount).toBeCloseTo(HOLE_COST * 1.5, 6);
    expect(explosivesTotal(state)).toBeCloseTo(HOLES * HOLE_COST * 1.5, 6);
  }, 120_000);
});
