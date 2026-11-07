// BlastSimulator2026 — Unit tests: charge ordering is free, the explosive is paid when the hole is loaded (#1345, #2143)

import { describe, it, expect } from 'vitest';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { applyTaskCompletion } from '../../../src/core/engine/TaskCompletionEffects.js';
import { isHoleOrderClaimable } from '../../../src/core/engine/ActionSelection.js';
import type { TaskProgressResult } from '../../../src/core/engine/TaskProgress.js';
import {
  dispatchChargeAction, cancelOutstandingChargeAction,
  isHoleChargeCovered, autoChargeHole,
  chargePatternHoles, outstandingChargeBlockedReason,
} from '../../../src/core/mining/ChargeOrder.js';

const BOOMITE_5KG = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
const COST_5KG = 60; // boomite $12/kg list price x 5 kg

function hole(n: number, depth = 8): DrillHole {
  return { id: `H${n}`, x: 10 + n * 3, z: 10, depth, diameter: 0.089 };
}

function makeState(cash = 10_000): GameState {
  const state = createGame({ seed: 42, startingCash: cash });
  state.cash = cash;
  state.finances.cash = cash;
  return state;
}

function setCash(state: GameState, cash: number): void {
  state.cash = cash;
  state.finances.cash = cash;
}

function chargeActions(state: GameState) {
  return state.pendingActions.filter(a => a.type === 'charge_hole');
}

const explosivesExpenses = (state: GameState) => state.finances.transactions.filter(t => t.category === 'explosives');

/** Land the charge_hole task of `holeId` the way the engine does when the crew finishes it. */
function completeCharge(state: GameState, holeId: string) {
  const { employee } = hireEmployee(state.employees, 'blaster', new Random(42), 0, 0);
  const progress: TaskProgressResult = { completed: true, leveledUp: false, skill: null, levelUps: [], actionType: 'charge_hole', actionPayload: { holeId } };
  return applyTaskCompletion(state, null, employee, progress, new EventEmitter());
}

describe('dispatchChargeAction books nothing at order time (#2143)', () => {
  it('queues one charge_hole action and records the planned charge without spending cash', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);

    const actions = chargeActions(state);
    expect(actions).toHaveLength(1);
    expect(actions[0]!.payload['holeId']).toBe('H1');
    expect(state.plannedChargesByHole['H1']).toEqual(BOOMITE_5KG);
    expect(state.cash).toBe(10_000);
    expect(state.finances.cash).toBe(10_000);
  });

  it('books no explosives expense', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(explosivesExpenses(state)).toHaveLength(0);
    expect(state.finances.transactions).toHaveLength(0);
  });

  it('accepts the order at zero cash', () => {
    const state = makeState(0);
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(chargeActions(state)).toHaveLength(1);
    expect(state.plannedChargesByHole['H1']).toEqual(BOOMITE_5KG);
    expect(state.cash).toBe(0);
  });

  it('accepts the order with negative cash and leaves the balance alone', () => {
    const state = makeState(-500);
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(chargeActions(state)).toHaveLength(1);
    expect(state.cash).toBe(-500);
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
  });

  it('stamps no delivery arrival on the order', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(chargeActions(state)[0]!.payload['deliveryArrivalTick']).toBeUndefined();
  });

  it('replaces an outstanding order rather than stacking, with no cash movement', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    dispatchChargeAction(state, hole(1), { ...BOOMITE_5KG, amountKg: 8 });

    expect(chargeActions(state)).toHaveLength(1);
    expect(state.plannedChargesByHole['H1']!.amountKg).toBe(8);
    expect(state.cash).toBe(10_000);
    expect(explosivesExpenses(state)).toHaveLength(0);
  });
});

describe('cancelOutstandingChargeAction (#2143)', () => {
  it('drops the order and the planned charge', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    cancelOutstandingChargeAction(state, 'H1');

    expect(chargeActions(state)).toHaveLength(0);
    expect(state.plannedChargesByHole['H1']).toBeUndefined();
  });

  it('changes neither cash nor finances for a never-loaded order', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    cancelOutstandingChargeAction(state, 'H1');

    expect(state.cash).toBe(10_000);
    expect(state.finances.cash).toBe(10_000);
    expect(state.finances.transactions).toHaveLength(0);
  });

  it('leaves other holes\' orders alone', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    dispatchChargeAction(state, hole(2), BOOMITE_5KG);
    cancelOutstandingChargeAction(state, 'H1');
    expect(chargeActions(state).map(a => a.payload['holeId'])).toEqual(['H2']);
  });

  it('on a hole without an order changes nothing', () => {
    const state = makeState();
    cancelOutstandingChargeAction(state, 'H9');
    expect(state.cash).toBe(10_000);
    expect(state.finances.transactions).toHaveLength(0);
  });
});

describe('isHoleChargeCovered', () => {
  it('is false for a bare hole', () => {
    expect(isHoleChargeCovered(makeState(), 'H1')).toBe(false);
  });

  it('covers the ordered hole and no other hole', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(isHoleChargeCovered(state, 'H1')).toBe(true);
    expect(isHoleChargeCovered(state, 'H2')).toBe(false);
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

  it('orders the pattern charge and spends no cash (#2143)', () => {
    const state = makeState();
    state.patternCharge = { ...BOOMITE_5KG };
    expect(autoChargeHole(state, hole(1))).toBe('ordered');
    expect(state.plannedChargesByHole['H1']).toEqual(BOOMITE_5KG);
    expect(state.cash).toBe(10_000);
    expect(explosivesExpenses(state)).toHaveLength(0);
  });

  it('orders at zero cash instead of parking the hole (#2143)', () => {
    const state = makeState(0);
    state.patternCharge = { ...BOOMITE_5KG };
    expect(autoChargeHole(state, hole(1))).toBe('ordered');
    expect(chargeActions(state)).toHaveLength(1);
    expect(state.cash).toBe(0);
  });

  it('orders one dollar below the cost too (#2143)', () => {
    const state = makeState(COST_5KG - 1);
    state.patternCharge = { ...BOOMITE_5KG };
    expect(autoChargeHole(state, hole(1))).toBe('ordered');
    expect(state.cash).toBe(COST_5KG - 1);
  });

  it('skips a hole that is already covered', () => {
    const state = makeState();
    state.patternCharge = { ...BOOMITE_5KG };
    autoChargeHole(state, hole(1));
    expect(autoChargeHole(state, hole(1))).toBe('skipped');
    expect(chargeActions(state)).toHaveLength(1);
  });

  it('is invalid when the column does not fit the hole, ordering nothing', () => {
    const state = makeState();
    state.patternCharge = { ...BOOMITE_5KG };
    expect(autoChargeHole(state, hole(1, 3))).toBe('invalid');
    expect(chargeActions(state)).toHaveLength(0);
    expect(state.cash).toBe(10_000);
  });
});

describe('chargePatternHoles', () => {
  it('orders every uncovered hole and spends no cash (#2143)', () => {
    const state = makeState();
    state.patternCharge = { ...BOOMITE_5KG };
    const result = chargePatternHoles(state, [hole(1), hole(2), hole(3)]);
    expect(result.ordered).toEqual(['H1', 'H2', 'H3']);
    expect(result.invalid).toEqual([]);
    expect(state.cash).toBe(10_000);
    expect(explosivesExpenses(state)).toHaveLength(0);
  });

  it('orders every hole at zero cash (#2143)', () => {
    const state = makeState(0);
    state.patternCharge = { ...BOOMITE_5KG };
    const result = chargePatternHoles(state, [hole(1), hole(2), hole(3), hole(4)]);
    expect(result.ordered).toEqual(['H1', 'H2', 'H3', 'H4']);
    expect(chargeActions(state)).toHaveLength(4);
  });

  it('skips covered holes', () => {
    const state = makeState();
    state.patternCharge = { ...BOOMITE_5KG };
    state.chargesByHole['H1'] = { ...BOOMITE_5KG };
    const result = chargePatternHoles(state, [hole(1), hole(2)]);
    expect(result.ordered).toEqual(['H2']);
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
    const result = chargePatternHoles(state, []);
    expect(result.ordered).toEqual([]);
    expect(result.invalid).toEqual([]);
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

describe('loading a charge pays for the explosive (#2143)', () => {
  it('cash falls by the list price and one explosives expense is booked', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(state.cash).toBe(10_000);

    const report = completeCharge(state, 'H1');

    expect(report.chargeLoaded?.holeId).toBe('H1');
    expect(state.cash).toBeCloseTo(10_000 - COST_5KG, 10);
    expect(state.finances.cash).toBeCloseTo(10_000 - COST_5KG, 10);
    const expenses = explosivesExpenses(state);
    expect(expenses).toHaveLength(1);
    expect(expenses[0]!.type).toBe('expense');
    expect(expenses[0]!.amount).toBeCloseTo(COST_5KG, 10);
  });

  it('moves the planned charge into chargesByHole', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    completeCharge(state, 'H1');

    expect(state.plannedChargesByHole['H1']).toBeUndefined();
    expect(state.chargesByHole['H1']).toMatchObject(BOOMITE_5KG);
  });

  it('pays once per hole: two holes cost two loads', () => {
    const state = makeState();
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    dispatchChargeAction(state, hole(2), BOOMITE_5KG);
    completeCharge(state, 'H1');
    expect(state.cash).toBeCloseTo(10_000 - COST_5KG, 10);
    completeCharge(state, 'H2');
    expect(state.cash).toBeCloseTo(10_000 - 2 * COST_5KG, 10);
    expect(explosivesExpenses(state)).toHaveLength(2);
  });

});

describe('charge order claimability and affordability (#2143)', () => {
  function claimable(state: GameState, n = 1): boolean {
    const action = chargeActions(state).find(a => a.payload['holeId'] === `H${n}`) as PendingAction;
    return isHoleOrderClaimable(state, action);
  }

  it('is claimable at once with cash to pay (no delivery wait)', () => {
    const state = makeState();
    state.tickCount = 0;
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(claimable(state)).toBe(true);
  });

  it('is not claimable when the cash part exceeds cash', () => {
    const state = makeState(COST_5KG - 1);
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(claimable(state)).toBe(false);
  });

  it('is claimable when cash equals the cash part exactly (boundary)', () => {
    const state = makeState(COST_5KG);
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(claimable(state)).toBe(true);
  });

  it('becomes claimable once cash covers the cost', () => {
    const state = makeState(0);
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(claimable(state)).toBe(false);
    setCash(state, 10_000);
    expect(claimable(state)).toBe(true);
  });

  it('a hole still waiting to be drilled stays unclaimable even when affordable', () => {
    const state = makeState();
    state.plannedDrillHoles.push(hole(1));
    dispatchChargeAction(state, hole(1), BOOMITE_5KG);
    expect(claimable(state)).toBe(false);
  });
});
