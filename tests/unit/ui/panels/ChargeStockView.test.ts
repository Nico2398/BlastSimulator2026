// @vitest-environment jsdom
// BlastSimulator2026 — Charge step stock view: delivery fields (#1895)

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../../src/core/state/GameState.js';
import { placeBuilding } from '../../../../src/core/entities/Building.js';
import { buyExplosiveStock } from '../../../../src/core/mining/ExplosiveStock.js';
import { dispatchChargeAction } from '../../../../src/core/mining/ChargeOrder.js';
import { EXPLOSIVE_DELIVERY_TICKS } from '../../../../src/core/config/balance.js';
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

describe('buildStockView delivery fields (#1895)', () => {
  it('reports the uncovered kg and delivery wait when stock is short', () => {
    const view = buildStockView(makeState(), ['boomite'], 'boomite', 10, 4, 5);
    expect(view.uncoveredKg).toBe(20);
    expect(view.deliveryTicks).toBe(EXPLOSIVE_DELIVERY_TICKS);
  });

  it('has no uncovered kg and no wait when stock covers the pattern', () => {
    const state = makeState();
    withWarehouse(state, 100);
    const view = buildStockView(state, ['boomite'], 'boomite', 10, 4, 5);
    expect(view.uncoveredKg).toBe(0);
    expect(view.deliveryTicks).toBe(0);
  });

  it('counts only the shortfall as uncovered', () => {
    const state = makeState();
    withWarehouse(state, 12);
    const view = buildStockView(state, ['boomite'], 'boomite', 10, 4, 5);
    expect(view.uncoveredKg).toBe(8);
    expect(view.deliveryTicks).toBe(EXPLOSIVE_DELIVERY_TICKS);
  });

  it('reports hasWarehouse', () => {
    const none = buildStockView(makeState(), ['boomite'], 'boomite', 10, 1, 5);
    expect(none.hasWarehouse).toBe(false);
    const state = makeState();
    withWarehouse(state, 10);
    expect(buildStockView(state, ['boomite'], 'boomite', 10, 1, 5).hasWarehouse).toBe(true);
  });

  it('inTransitUntilTick is null with no order in transit', () => {
    expect(buildStockView(makeState(), ['boomite'], 'boomite', 10, 1, 5).inTransitUntilTick).toBeNull();
  });

  it('inTransitUntilTick is the earliest arrival of a waiting order', () => {
    const state = makeState();
    state.tickCount = 30;
    dispatchChargeAction(state, { id: 'H1', x: 10, z: 10 }, { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 });
    const view = buildStockView(state, ['boomite'], 'boomite', 10, 1, 5);
    expect(view.inTransitUntilTick).toBe(30 + EXPLOSIVE_DELIVERY_TICKS);
  });
});
