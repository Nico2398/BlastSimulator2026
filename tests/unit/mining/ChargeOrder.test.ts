// BlastSimulator2026 — Unit tests: charge ordering, fund check and pattern auto-charge (#1345)

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import {
  dispatchChargeAction, findOutstandingChargeAction, cancelOutstandingChargeAction,
  chargeFundsFailureAmount, isHoleChargeCovered, autoChargeHole, settleAwaitingFundsCharges,
  chargePatternHoles,
} from '../../../src/core/mining/ChargeOrder.js';

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

  it('replaces an outstanding order rather than stacking, netting the refund', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    dispatchChargeAction(state, hole(1), { ...BOOMITE_5KG, amountKg: 8 });

    expect(chargeActions(state)).toHaveLength(1);
    expect(state.cash).toBe(10_000 - 96);
  });
});

describe('findOutstandingChargeAction / cancelOutstandingChargeAction', () => {
  it('finds the order of a hole and nothing for an unordered hole', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(findOutstandingChargeAction(state, 'H1')).toBeDefined();
    expect(findOutstandingChargeAction(state, 'H2')).toBeUndefined();
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
    for (const n of [1, 2, 3]) autoChargeHole(state, hole(n));
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
    autoChargeHole(state, hole(1));
    state.cash = COST_5KG;
    settleAwaitingFundsCharges(state);
    expect(state.chargeAwaitingFunds).toEqual([]);
    expect(state.cash).toBe(0);
  });

  it('does nothing while still broke', () => {
    const state = makeState(0);
    state.patternCharge = { ...BOOMITE_5KG };
    autoChargeHole(state, hole(1));
    settleAwaitingFundsCharges(state);
    expect(state.chargeAwaitingFunds).toEqual(['H1']);
    expect(chargeActions(state)).toHaveLength(0);
  });

  it('drops waiting holes whose pattern charge was cleared', () => {
    const state = makeState(0);
    state.patternCharge = { ...BOOMITE_5KG };
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
