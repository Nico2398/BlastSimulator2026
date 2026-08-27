// BlastSimulator2026 — Tests for deductRestCost (relocated from
// GameLoop.test.ts, #759).

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { deductRestCost } from '../../../src/core/engine/RestActionHelpers.js';
import { NEED_REST_COSTS } from '../../../src/core/config/balance.js';

const DEDUCT_SEED = 42;

describe('deductRestCost', () => {
  // ── Test 1: Positive: hunger visit deducts NEED_REST_COSTS.hunger from cash ──
  it('deducts NEED_REST_COSTS.hunger from cash for hunger', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 5000;

    const deducted = deductRestCost(state, 'hunger');

    expect(state.cash).toBe(4950);
    expect(deducted).toBe(NEED_REST_COSTS.hunger);
  });

  // ── Test 2: Positive: breakNeed visit deducts NEED_REST_COSTS.breakNeed from cash ──
  it('deducts NEED_REST_COSTS.breakNeed from cash for breakNeed', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 5000;

    const deducted = deductRestCost(state, 'breakNeed');

    expect(state.cash).toBe(4980);
    expect(deducted).toBe(NEED_REST_COSTS.breakNeed);
  });

  // ── Test 3: Boundary: fatigue visit deducts 0 from cash ──
  it('deducts 0 from cash for fatigue (no cost)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 5000;

    const deducted = deductRestCost(state, 'fatigue');

    expect(state.cash).toBe(5000);
    expect(deducted).toBe(0);
  });

  // ── Test 4: Boundary: cash never goes below 0 ──
  it('does not let cash go below 0', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 10;

    const deducted = deductRestCost(state, 'hunger');

    expect(state.cash).toBe(0);
    expect(deducted).toBe(NEED_REST_COSTS.hunger);
  });

  // ── Test 5: Edge: multiple visits accumulate correctly ──
  it('accumulates costs correctly across multiple visits', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 500;

    const deducted1 = deductRestCost(state, 'hunger');
    const deducted2 = deductRestCost(state, 'hunger');
    const deducted3 = deductRestCost(state, 'breakNeed');

    const expectedCash = 500 - 2 * NEED_REST_COSTS.hunger - NEED_REST_COSTS.breakNeed;
    expect(state.cash).toBe(expectedCash);
    expect(deducted1).toBe(NEED_REST_COSTS.hunger);
    expect(deducted2).toBe(NEED_REST_COSTS.hunger);
    expect(deducted3).toBe(NEED_REST_COSTS.breakNeed);
  });

  // ── Test 6: Edge: cash at exactly 0 is unchanged ──
  it('leaves cash at 0 when it is already 0', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 0;

    const deducted = deductRestCost(state, 'hunger');

    expect(state.cash).toBe(0);
    expect(deducted).toBe(NEED_REST_COSTS.hunger);
  });

  // ── Test 6b: Edge: cash already negative is left untouched, not reset to 0 ──
  it('does not reset already-negative cash back up to 0 (a prior bankruptcy-territory balance is not erased)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = -48870;

    const deducted = deductRestCost(state, 'hunger');

    expect(state.cash).toBe(-48870);
    expect(deducted).toBe(NEED_REST_COSTS.hunger);
    expect(state.finances.transactions.find(t => t.category === 'needs')).toBeUndefined();
  });

  // ── Test 7: Positive: records a 'needs'-category expense in state.finances ──
  it('records a needs-category expense transaction in state.finances', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 5000;

    deductRestCost(state, 'hunger');

    const entry = state.finances.transactions.find(t => t.category === 'needs');
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('expense');
    expect(entry!.amount).toBe(NEED_REST_COSTS.hunger);
    expect(entry!.description).toBe('Rest: hunger');
  });

  // ── Test 8: Boundary: fatigue (0 cost) records no expense (addExpense no-ops on amount <= 0) ──
  it('records no finance transaction for fatigue (zero-cost visit)', () => {
    const state = createGame({ seed: DEDUCT_SEED });
    state.cash = 5000;

    deductRestCost(state, 'fatigue');

    expect(state.finances.transactions.find(t => t.category === 'needs')).toBeUndefined();
  });
});
