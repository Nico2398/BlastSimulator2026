// BlastSimulator2026 — Unit tests: charge ordering, fund check and pattern auto-charge (#1345)

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { EXPLOSIVE_DELIVERY_TICKS } from '../../../src/core/config/balance.js';
import { buyExplosiveStock } from '../../../src/core/mining/ExplosiveStock.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import {
  dispatchChargeAction, cancelOutstandingChargeAction,
  chargeFundsFailureAmount, isHoleChargeCovered, autoChargeHole, settleAwaitingFundsCharges,
  chargePatternHoles, outstandingChargeBlockedReason,
} from '../../../src/core/mining/ChargeOrder.js';
import { earliestChargeDeliveryTick } from '../../../src/core/mining/ExplosiveStock.js';

const BOOMITE_5KG = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
const COST_5KG = 60; // boomite $12/kg x 5 kg

function hole(n: number, depth = 8): DrillHole {
  return { id: `H${n}`, x: 10 + n * 3, z: 10, depth, diameter: 0.15 };
}

function makeState(cash = 10_000): GameState {
  const state = createGame({ seed: 42, startingCash: cash });
  state.cash = cash;
  state.finances.cash = cash;
  return state;
}

function chargeActions(state: GameState) {
  return state.pendingActions.filter(a => a.type === 'charge_hole');
}

describe('dispatchChargeAction', () => {
  it('queues one charge_hole action, records the planned charge and pays the cost', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);

    const actions = chargeActions(state);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.payload['holeId']).toBe('H1');
    expect(actions[0]!.payload['orderCost']).toBe(COST_5KG);
    expect(state.plannedChargesByHole['H1']).toEqual(BOOMITE_5KG);
    expect(state.cash).toBe(10_000 - COST_5KG);
  });

  it('queues the order for a blasting-skilled charging truck crew (#1649)', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);

    const action = chargeActions(state)[0]!;
    expect(action.requiredSkill).toBe('blasting');
    expect(action.requiredVehicleRole).toBe('charging_truck');
  });

  it('stays queued, not rejected, when the fleet has no charging truck (#1649)', () => {
    const state = makeState();
    expect(state.vehicles.vehicles).toHaveLength(0);

    dispatchChargeAction(state, hole(1), BOOMITE_5KG);

    const actions = chargeActions(state);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.status).toBe('queued');
    expect(state.plannedChargesByHole['H1']).toEqual(BOOMITE_5KG);
    expect(state.cash).toBe(10_000 - COST_5KG);
  });

  it('replaces an outstanding order rather than stacking, netting the refund', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    dispatchChargeAction(state, hole(1), { ...BOOMITE_5KG, amountKg: 8 });

    expect(chargeActions(state)).toHaveLength(1);
    expect(state.cash).toBe(10_000 - 96);
  });
});

describe('cancelOutstandingChargeAction', () => {
  it('covers the ordered hole and no other hole', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(isHoleChargeCovered(state, 'H1')).toBe(true);
    expect(isHoleChargeCovered(state, 'H2')).toBe(false);
  });

  it('cancel refunds the order cost and drops the planned charge', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    cancelOutstandingChargeAction(state, 'H1');

    expect(state.cash).toBe(10_000);
    expect(chargeActions(state)).toHaveLength(0);
    expect(state.plannedChargesByHole['H1']).toBeUndefined();
  });

  it('cancel on a hole without an order changes nothing', () => {
    const state = makeState();
    cancelOutstandingChargeAction(state, 'H9');
    expect(state.cash).toBe(10_000);
  });
});

describe('chargeFundsFailureAmount', () => {
  const orders = [
    { holeId: 'H1', explosiveId: 'boomite', amountKg: 5 },
    { holeId: 'H2', explosiveId: 'boomite', amountKg: 5 },
  ];

  it('returns null when cash covers the total', () => {
    expect(chargeFundsFailureAmount(makeState(1000), orders)).toBeNull();
  });

  it('cash exactly equal to the total is affordable (boundary)', () => {
    expect(chargeFundsFailureAmount(makeState(2 * COST_5KG), orders)).toBeNull();
  });

  it('reports the total need when cash falls short', () => {
    expect(chargeFundsFailureAmount(makeState(2 * COST_5KG - 1), orders)).toEqual({ need: 2 * COST_5KG });
  });

  it('nets the refund of an outstanding order for the same hole', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    state.cash = 0;
    expect(chargeFundsFailureAmount(state, [orders[0]!])).toBeNull();
  });
});

describe('isHoleChargeCovered', () => {
  it('is false for a bare hole', () => {
    expect(isHoleChargeCovered(makeState(), 'H1')).toBe(false);
  });

  it('is true with an outstanding order', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(isHoleChargeCovered(state, 'H1')).toBe(true);
  });

  it('is true once the charge is loaded', () => {
    const state = makeState();
    state.chargesByHole['H1'] = { ...BOOMITE_5KG };
    expect(isHoleChargeCovered(state, 'H1')).toBe(true);
  });
});

describe('autoChargeHole', () => {
  it('skips when no pattern charge is set', () => {
    const state = makeState();
    expect(autoChargeHole(state, hole(1))).toBe('skipped');
    expect(chargeActions(state)).toHaveLength(0);
  });

  it('orders the pattern charge and pays for it', () => {
    const state = makeState();
    state.patternCharge = { ...BOOMITE_5KG };
    expect(autoChargeHole(state, hole(1))).toBe('ordered');
    expect(state.plannedChargesByHole['H1']).toEqual(BOOMITE_5KG);
    expect(state.cash).toBe(10_000 - COST_5KG);
  });

  it('skips a hole that is already covered', () => {
    const state = makeState();
    state.patternCharge = { ...BOOMITE_5KG };
    autoChargeHole(state, hole(1));
    expect(autoChargeHole(state, hole(1))).toBe('skipped');
    expect(chargeActions(state)).toHaveLength(1);
  });

  it('parks an unaffordable hole in chargeAwaitingFunds without deducting cash', () => {
    const state = makeState(COST_5KG - 1);
    state.patternCharge = { ...BOOMITE_5KG };
    expect(autoChargeHole(state, hole(1))).toBe('awaiting_funds');
    expect(state.chargeAwaitingFunds).toEqual(['H1']);
    expect(state.cash).toBe(COST_5KG - 1);
    expect(chargeActions(state)).toHaveLength(0);
  });

  it('is invalid when the column does not fit the hole, ordering nothing', () => {
    const state = makeState();
    state.patternCharge = { ...BOOMITE_5KG };
    expect(autoChargeHole(state, hole(1, 3))).toBe('invalid');
    expect(chargeActions(state)).toHaveLength(0);
    expect(state.cash).toBe(10_000);
  });
});

describe('settleAwaitingFundsCharges', () => {
  it('orders waiting holes in id order once cash allows, leaving the rest waiting', () => {
    const state = makeState(0);
    state.patternCharge = { ...BOOMITE_5KG };
    for (const n of [1, 2, 3]) { state.drillHoles.push(hole(n)); autoChargeHole(state, hole(n)); }
    expect(state.chargeAwaitingFunds).toEqual(['H1', 'H2', 'H3']);

    state.cash = 2 * COST_5KG;
    state.finances.cash = state.cash;
    settleAwaitingFundsCharges(state);

    expect(chargeActions(state).map(a => a.payload['holeId'])).toEqual(['H1', 'H2']);
    expect(state.chargeAwaitingFunds).toEqual(['H3']);
    expect(state.cash).toBe(0);
  });

  it('cash exactly equal to one hole cost orders that hole', () => {
    const state = makeState(0);
    state.patternCharge = { ...BOOMITE_5KG };
    state.drillHoles.push(hole(1));
    autoChargeHole(state, hole(1));
    state.cash = COST_5KG;
    settleAwaitingFundsCharges(state);
    expect(state.chargeAwaitingFunds).toEqual([]);
    expect(state.cash).toBe(0);
  });

  it('does nothing while still broke', () => {
    const state = makeState(0);
    state.patternCharge = { ...BOOMITE_5KG };
    state.drillHoles.push(hole(1));
    autoChargeHole(state, hole(1));
    settleAwaitingFundsCharges(state);
    expect(state.chargeAwaitingFunds).toEqual(['H1']);
    expect(chargeActions(state)).toHaveLength(0);
  });

  it('drops waiting holes whose pattern charge was cleared', () => {
    const state = makeState(0);
    state.patternCharge = { ...BOOMITE_5KG };
    state.drillHoles.push(hole(1));
    autoChargeHole(state, hole(1));
    state.patternCharge = null;
    state.cash = 1000;
    settleAwaitingFundsCharges(state);
    expect(chargeActions(state)).toHaveLength(0);
    expect(state.chargeAwaitingFunds).toEqual([]);
  });
});

describe('chargePatternHoles', () => {
  it('orders every uncovered hole', () => {
    const state = makeState();
    state.patternCharge = { ...BOOMITE_5KG };
    const result = chargePatternHoles(state, [hole(1), hole(2), hole(3)]);
    expect(result).toEqual({ ordered: ['H1', 'H2', 'H3'], awaiting: [], invalid: [] });
    expect(state.cash).toBe(10_000 - 3 * COST_5KG);
  });

  it('skips covered holes', () => {
    const state = makeState();
    state.patternCharge = { ...BOOMITE_5KG };
    state.chargesByHole['H1'] = { ...BOOMITE_5KG };
    const result = chargePatternHoles(state, [hole(1), hole(2)]);
    expect(result.ordered).toEqual(['H2']);
  });

  it('splits by funds, hole by hole', () => {
    const state = makeState(2 * COST_5KG);
    state.patternCharge = { ...BOOMITE_5KG };
    const result = chargePatternHoles(state, [hole(1), hole(2), hole(3), hole(4)]);
    expect(result.ordered).toEqual(['H1', 'H2']);
    expect(result.awaiting).toEqual(['H3', 'H4']);
    expect(state.chargeAwaitingFunds).toEqual(['H3', 'H4']);
    expect(state.cash).toBe(0);
  });

  it('reports a hole the column does not fit as invalid', () => {
    const state = makeState();
    state.patternCharge = { ...BOOMITE_5KG };
    const result = chargePatternHoles(state, [hole(1), hole(2, 3)]);
    expect(result.ordered).toEqual(['H1']);
    expect(result.invalid.map(e => e.holeId)).toEqual(['H2']);
  });

  it('returns nothing for an empty hole list', () => {
    const state = makeState();
    state.patternCharge = { ...BOOMITE_5KG };
    expect(chargePatternHoles(state, [])).toEqual({ ordered: [], awaiting: [], invalid: [] });
  });
});

describe('outstandingChargeBlockedReason (#1660)', () => {
  const order = (type: string, blockedReason: string | null) => ({ type, blockedReason } as GameState['pendingActions'][number]);

  it('reads the first charge order that has a reason, skipping claimed ones', () => {
    const pendingActions = [order('drill_hole', 'x'), order('charge_hole', null), order('charge_hole', 'no_vehicle_in_fleet')];
    expect(outstandingChargeBlockedReason({ pendingActions })).toBe('no_vehicle_in_fleet');
  });

  it('is null with no charge orders or none blocked', () => {
    expect(outstandingChargeBlockedReason({ pendingActions: [] })).toBeNull();
    expect(outstandingChargeBlockedReason({ pendingActions: [order('charge_hole', null)] })).toBeNull();
  });
});

// ── fromStockKg is recorded at order time (#1685) ───────────────────────────

describe('dispatchChargeAction records the stock draw on the planned charge (#1685)', () => {
  function stockedState(kg: number): GameState {
    const state = makeState();
    placeBuilding(state.buildings, 'explosive_warehouse', 5, 5, 64, 64, 1);
    expect(buyExplosiveStock(state, 'boomite', kg).success).toBe(true);
    return state;
  }

  it('records fromStockKg for a fully stock-covered order and spends no cash', () => {
    const state = stockedState(100);
    const cash = state.cash;
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(state.plannedChargesByHole['H1']).toEqual({ ...BOOMITE_5KG, fromStockKg: 5 });
    expect(state.cash).toBe(cash);
  });

  it('records only the stocked part when stock covers part of the order', () => {
    const state = stockedState(3);
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(state.plannedChargesByHole['H1']!.fromStockKg).toBe(3);
  });

  it('omits fromStockKg when no stock is drawn', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(state.plannedChargesByHole['H1']).toEqual(BOOMITE_5KG);
    expect('fromStockKg' in state.plannedChargesByHole['H1']!).toBe(false);
  });

  it('omits fromStockKg when only another explosive is stocked', () => {
    const state = stockedState(100);
    dispatchChargeAction(state, hole(1), { explosiveId: 'krackle', amountKg: 5, stemmingM: 2 });
    expect(state.plannedChargesByHole['H1']!.fromStockKg).toBeUndefined();
  });

  it('a re-charge replaces the record: restocked kg are redrawn, not double counted', () => {
    const state = stockedState(5);
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(state.plannedChargesByHole['H1']!.fromStockKg).toBe(5);
  });
});

// ── Delivery wait for cash-bought explosives (#1895) ────────────────────────

describe('dispatchChargeAction delivery wait (#1895)', () => {
  function stockedState(kg: number): GameState {
    const state = makeState();
    placeBuilding(state.buildings, 'explosive_warehouse', 5, 5, 64, 64, 1);
    expect(buyExplosiveStock(state, 'boomite', kg).success).toBe(true);
    return state;
  }
  const arrival = (state: GameState, n = 0) => chargeActions(state)[n]!.payload['deliveryArrivalTick'];

  it('stamps no arrival when stock fully covers the order', () => {
    const state = stockedState(100);
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(arrival(state)).toBeUndefined();
    expect(earliestChargeDeliveryTick(state)).toBeNull();
  });

  it('stamps tickCount + delivery ticks when nothing is stocked', () => {
    const state = makeState();
    state.tickCount = 120;
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(arrival(state)).toBe(120 + EXPLOSIVE_DELIVERY_TICKS);
  });

  it('stamps an arrival when stock falls short by 1 kg', () => {
    const state = stockedState(4);
    state.tickCount = 10;
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(arrival(state)).toBe(10 + EXPLOSIVE_DELIVERY_TICKS);
  });

  it('stamps no arrival when stock matches the order exactly', () => {
    const state = stockedState(5);
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(arrival(state)).toBeUndefined();
  });

  it('is flat per order, not additive per hole', () => {
    const state = makeState();
    state.tickCount = 50;
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    dispatchChargeAction(state, hole(2), BOOMITE_5KG);
    dispatchChargeAction(state, hole(3), BOOMITE_5KG);
    for (let i = 0; i < 3; i++) expect(arrival(state, i)).toBe(50 + EXPLOSIVE_DELIVERY_TICKS);
  });

  it('still draws stock at order time for the stocked part', () => {
    const state = stockedState(3);
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(state.plannedChargesByHole['H1']!.fromStockKg).toBe(3);
    expect(arrival(state)).toBeDefined();
  });

  it('cancel refunds the order as before', () => {
    const state = makeState();
    const cash = state.cash;
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(state.cash).toBe(cash - COST_5KG);
    cancelOutstandingChargeAction(state, 'H1');
    expect(state.cash).toBe(cash);
    expect(chargeActions(state)).toHaveLength(0);
  });

  it('a re-charge recomputes the arrival from the new tick', () => {
    const state = makeState();
    state.tickCount = 0;
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    state.tickCount = 200;
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(chargeActions(state)).toHaveLength(1);
    expect(arrival(state)).toBe(200 + EXPLOSIVE_DELIVERY_TICKS);
  });
});

describe('earliestChargeDeliveryTick (#1895)', () => {
  it('is null with no charge orders', () => {
    expect(earliestChargeDeliveryTick(makeState())).toBeNull();
  });

  it('is the smallest arrival among waiting orders', () => {
    const state = makeState();
    state.tickCount = 100;
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    state.tickCount = 300;
    dispatchChargeAction(state, hole(2), BOOMITE_5KG);
    state.tickCount = 150;
    expect(earliestChargeDeliveryTick(state)).toBe(100 + EXPLOSIVE_DELIVERY_TICKS);
  });

  it('ignores orders whose arrival has already passed', () => {
    const state = makeState();
    state.tickCount = 0;
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    state.tickCount = EXPLOSIVE_DELIVERY_TICKS + 1;
    expect(earliestChargeDeliveryTick(state)).toBeNull();
  });
});
