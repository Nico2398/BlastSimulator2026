// @vitest-environment jsdom
// BlastSimulator2026 — Charge step stock view (#1685, #2143)

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../../src/core/state/GameState.js';
import { placeBuilding } from '../../../../src/core/entities/Building.js';
import { buyExplosiveStock } from '../../../../src/core/mining/ExplosiveStock.js';
import { dispatchChargeAction } from '../../../../src/core/mining/ChargeOrder.js';
import { buildStockView } from '../../../../src/ui/panels/blastSteps/ChargeStock.js';

function makeState(): GameState {
  const state = createGame({ seed: 42, startingCash: 100_000 });
  state.cash = 100_000;
  state.finances.cash = 100_000;
  return state;
}

function withWarehouse(state: GameState, kg: number): void {
  placeBuilding(state.buildings, 'explosive_warehouse', 5, 5, 64, 64, 1);
  expect(buyExplosiveStock(state, 'boomite', kg).success).toBe(true);
}

describe('buildStockView carries no delivery state (#2143)', () => {
  it('has no delivery wait, whatever stock is short', () => {
    const view = buildStockView(makeState(), ['boomite'], 'boomite', 10, 4, 5);
    expect(view).not.toHaveProperty('deliveryTicks');
  });

  it('has no in-transit fields with an order outstanding on an empty warehouse', () => {
    const state = makeState();
    state.tickCount = 30;
    dispatchChargeAction(state, { id: 'H1', x: 10, z: 10 }, { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 });
    const view = buildStockView(state, ['boomite'], 'boomite', 10, 1, 5);
    expect(view).not.toHaveProperty('inTransitUntilTick');
    expect(view).not.toHaveProperty('nowTick');
  });
});

describe('buildStockView paid-from split (#1685)', () => {
  it('pays the whole pattern in cash at list price when nothing is stocked', () => {
    const view = buildStockView(makeState(), ['boomite'], 'boomite', 10, 4, 5);
    expect(view.paidFromStockKg).toBe(0);
    expect(view.paidCash).toBeCloseTo(4 * 5 * 12, 6);
  });

  it('pays nothing in cash when stock covers the pattern', () => {
    const state = makeState();
    withWarehouse(state, 100);
    const view = buildStockView(state, ['boomite'], 'boomite', 10, 4, 5);
    expect(view.paidFromStockKg).toBe(20);
    expect(view.paidCash).toBe(0);
  });

  it('pays only the shortfall in cash', () => {
    const state = makeState();
    withWarehouse(state, 12);
    const view = buildStockView(state, ['boomite'], 'boomite', 10, 4, 5);
    expect(view.paidFromStockKg).toBe(12);
    expect(view.paidCash).toBeCloseTo(8 * 12, 6);
  });
});
