// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createGame } from '../../../../src/core/state/GameState.js';
import { placeBuilding } from '../../../../src/core/entities/Building.js';
import { buyExplosiveStock } from '../../../../src/core/mining/ExplosiveStock.js';
import { buildStockView, ChargeStockBlock } from '../../../../src/ui/panels/blastSteps/ChargeStock.js';
describe('charge stock preview without delivery', () => {
  it('shows the cash shortfall and renders no delivery hints', () => {
    const state = createGame({ seed: 42, startingCash: 100_000 });
    const view = buildStockView(state, ['boomite'], 'boomite', 10, 4, 5);
    expect(view.paidCash).toBeGreaterThan(0);
    expect(view.paidFromStockKg).toBe(0);
    const block = new ChargeStockBlock(() => {}, () => {});
    block.render(view);
    expect(block.root.querySelector('[data-info="paid-from"]')).not.toBeNull();
    expect(block.root.querySelector('[data-info="delivery-hint"]')).toBeNull();
  });
  it('uses prepaid warehouse stock without an additional explosive bill', () => {
    const state = createGame({ seed: 42, startingCash: 100_000 });
    placeBuilding(state.buildings, 'explosive_warehouse', 5, 5, 64, 64, 1);
    expect(buyExplosiveStock(state, 'boomite', 100).success).toBe(true);
    const view = buildStockView(state, ['boomite'], 'boomite', 10, 4, 5);
    expect(view.paidCash).toBe(0);
    expect(view.paidFromStockKg).toBe(20);
  });
});
