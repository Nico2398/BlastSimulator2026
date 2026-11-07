// BlastSimulator2026 — Unit tests: a charge_hole completion re-checks affordability at fill time (#2155)
//
// The claim-time gate (isHoleOrderClaimable) can pass and cash can still drop before the
// crew finishes loading. Completion must then leave cash and the planned charge
// alone and put a fresh queued order back for the hole, instead of going into debt.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import type { DrillHole } from '../../../src/core/mining/DrillPlan.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { applyTaskCompletion } from '../../../src/core/engine/TaskCompletionEffects.js';
import type { TaskProgressResult } from '../../../src/core/engine/TaskProgress.js';
import { dispatchChargeAction } from '../../../src/core/mining/ChargeOrder.js';

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

function chargeActionsFor(state: GameState, holeId: string): PendingAction[] {
  return state.pendingActions.filter(a => a.type === 'charge_hole' && a.payload['holeId'] === holeId);
}

const explosivesExpenses = (state: GameState) => state.finances.transactions.filter(t => t.category === 'explosives');

/** Order H1, mark its action claimed by a blaster, then land it the way the engine does when the crew finishes. */
function orderAndComplete(state: GameState, cashAtCompletion: number) {
  dispatchChargeAction(state, hole(1), BOOMITE_5KG);
  return completeOrdered(state, cashAtCompletion);
}

function completeOrdered(state: GameState, cashAtCompletion: number) {
  const original = chargeActionsFor(state, 'H1')[0]!;
  const { employee } = hireEmployee(state.employees, 'blaster', new Random(42), 0, 0);
  original.status = 'in_progress';
  original.holderId = employee.id;
  employee.activeActionId = original.id;
  setCash(state, cashAtCompletion);
  const progress: TaskProgressResult = {
    completed: true, leveledUp: false, skill: null, levelUps: [],
    actionType: 'charge_hole', actionId: original.id, actionPayload: { ...original.payload },
  };
  const report = applyTaskCompletion(state, null, employee, progress, new EventEmitter());
  return { report, originalId: original.id };
}

describe('applyTaskCompletion — charge_hole when cash no longer covers the load (#2155 C4)', () => {
  it('leaves cash and finances untouched', () => {
    const state = makeState();
    const before = explosivesExpenses(state).length;
    orderAndComplete(state, COST_5KG - 1);
    expect(state.cash).toBe(COST_5KG - 1);
    expect(state.finances.cash).toBe(COST_5KG - 1);
    expect(explosivesExpenses(state)).toHaveLength(before);
  });

  it('adds nothing to chargesByHole and reports no chargeLoaded', () => {
    const state = makeState();
    const { report } = orderAndComplete(state, COST_5KG - 1);
    expect(state.chargesByHole['H1']).toBeUndefined();
    expect(report.chargeLoaded).toBeUndefined();
  });

  it('keeps the planned charge for the hole', () => {
    const state = makeState();
    orderAndComplete(state, COST_5KG - 1);
    expect(state.plannedChargesByHole['H1']).toMatchObject(BOOMITE_5KG);
  });

  it('puts one fresh queued charge_hole order back for the hole, same explosive, amount and stemming', () => {
    const state = makeState();
    const { originalId } = orderAndComplete(state, COST_5KG - 1);
    const orders = chargeActionsFor(state, 'H1');
    expect(orders).toHaveLength(1);
    const fresh = orders[0]!;
    expect(fresh.id).not.toBe(originalId);
    expect(fresh.status).toBe('queued');
    expect(fresh.holderId).toBeNull();
    expect(fresh.payload).toMatchObject(BOOMITE_5KG);
  });

  it('refuses at zero cash', () => {
    const state = makeState();
    const { report } = orderAndComplete(state, 0);
    expect(report.chargeLoaded).toBeUndefined();
    expect(state.chargesByHole['H1']).toBeUndefined();
    expect(state.cash).toBe(0);
  });

  it('refuses again on a second completion while cash is still short, never stacking orders', () => {
    const state = makeState();
    orderAndComplete(state, 10);
    completeOrdered(state, 10);
    expect(state.chargesByHole['H1']).toBeUndefined();
    expect(chargeActionsFor(state, 'H1')).toHaveLength(1);
    expect(state.plannedChargesByHole['H1']).toMatchObject(BOOMITE_5KG);
  });

  it('loads and pays exactly once when the re-queued order completes with cash restored', () => {
    const state = makeState();
    orderAndComplete(state, 10);
    const { report } = completeOrdered(state, 1_000);
    expect(report.chargeLoaded?.holeId).toBe('H1');
    expect(state.chargesByHole['H1']).toMatchObject(BOOMITE_5KG);
    expect(state.plannedChargesByHole['H1']).toBeUndefined();
    expect(state.cash).toBeCloseTo(1_000 - COST_5KG, 10);
    expect(explosivesExpenses(state)).toHaveLength(1);
    expect(chargeActionsFor(state, 'H1')).toHaveLength(0);
  });
});

describe('applyTaskCompletion — charge_hole when the load is affordable (#2155 C4 unchanged path)', () => {
  it('loads when cash equals the cash part exactly (boundary)', () => {
    const state = makeState();
    const { report } = orderAndComplete(state, COST_5KG);
    expect(report.chargeLoaded?.holeId).toBe('H1');
    expect(state.chargesByHole['H1']).toMatchObject(BOOMITE_5KG);
    expect(state.plannedChargesByHole['H1']).toBeUndefined();
    expect(state.cash).toBeCloseTo(0, 10);
    expect(chargeActionsFor(state, 'H1')).toHaveLength(0);
  });
});
