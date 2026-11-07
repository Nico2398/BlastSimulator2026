// BlastSimulator2026 — Loading a save from before pay-on-fill charging (#2155)
//
// v36 and older saves hold prepaid charge orders: the order's cash (orderCost) and the stock
// value drawn at order time (orderStock) were taken up front. v37 refunds both once, strips
// the prepaid bookkeeping, and charges at fill time like any new order.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { serialize, deserialize } from '../../../src/core/state/SaveLoad.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { getExplosivesInStock } from '../../../src/core/entities/BuildingWarehouse.js';
import { buyExplosiveStock } from '../../../src/core/mining/ExplosiveStock.js';
import { chargeOrderCost } from '../../../src/core/mining/ChargePlan.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { applyTaskCompletion } from '../../../src/core/engine/TaskCompletionEffects.js';
import { cancelAction } from '../../../src/core/engine/TaskDispatch.js';
import type { TaskProgressResult } from '../../../src/core/engine/TaskProgress.js';
import en from '../../../src/core/i18n/locales/en.json';
import fr from '../../../src/core/i18n/locales/fr.json';

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const BOOMITE_5KG = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
const STOCK_KG = 3;
const CASH_PART = chargeOrderCost('boomite', 5 - STOCK_KG);
const STOCK_VALUE = chargeOrderCost('boomite', STOCK_KG);
const FULL_PRICE = chargeOrderCost('boomite', 5);

function legacyAction(id: number, holeId: string, payloadExtra: Json): Json {
  return {
    id, type: 'charge_hole', requiredSkill: 'blasting', requiredVehicleRole: 'charging_truck',
    targetX: 10, targetZ: 10, targetY: 0, targetEmployeeId: null,
    status: 'queued', holderId: null, queuedAtTick: 0,
    payload: { holeId, ...BOOMITE_5KG, durationTicks: 20, ...payloadExtra },
  };
}

/** A legacy payload: prepaid cash part, stock drawn at order time, delivery wait. */
const PREPAID = { orderCost: CASH_PART, orderStock: { explosiveId: 'boomite', kg: STOCK_KG }, deliveryArrivalTick: 50 };

function baseState(): GameState {
  const state = createGame({ seed: 42, startingCash: 10_000 });
  state.cash = 10_000;
  state.finances.cash = 10_000;
  state.drillHoles.push({ id: 'H1', x: 10, z: 10, depth: 8, diameter: 0.089 });
  return state;
}

/** serialize(createGame(...)) mutated into a v36 payload; `mutate` edits the parsed JSON. */
function v36Save(mutate: (json: Json) => void, state: GameState = baseState()): string {
  const json = JSON.parse(serialize(state)) as Json;
  json['version'] = 36;
  mutate(json);
  return JSON.stringify(json);
}

function legacyOrderSave(state: GameState = baseState()): string {
  return v36Save(json => {
    json['pendingActions'].push(legacyAction(900, 'H1', PREPAID));
    json['plannedChargesByHole']['H1'] = { ...BOOMITE_5KG, fromStockKg: STOCK_KG };
    json['nextPendingActionId'] = 901;
  }, state);
}

const refundIncome = (state: GameState) =>
  state.finances.transactions.filter(t => t.type === 'income' && t.category === 'refund').reduce((s, t) => s + t.amount, 0);
const explosivesExpenses = (state: GameState) => state.finances.transactions.filter(t => t.category === 'explosives');
const chargeAction = (state: GameState, holeId = 'H1') =>
  state.pendingActions.find(a => a.type === 'charge_hole' && a.payload['holeId'] === holeId);

function completeCharge(state: GameState, holeId = 'H1') {
  const action = chargeAction(state, holeId);
  const { employee } = hireEmployee(state.employees, 'blaster', new Random(42), 0, 0);
  const progress: TaskProgressResult = {
    completed: true, leveledUp: false, skill: null, levelUps: [],
    actionType: 'charge_hole', ...(action && { actionId: action.id }), actionPayload: { holeId },
  };
  return applyTaskCompletion(state, null, employee, progress, new EventEmitter());
}

describe('deserialize — v36 -> v37 refund of prepaid charge orders (#2155 C1)', () => {
  it('refunds the order cash and the stock value drawn at order time to cash', () => {
    const restored = deserialize(legacyOrderSave());
    expect(restored.cash).toBeCloseTo(10_000 + CASH_PART + STOCK_VALUE, 8);
    expect(restored.cash).toBeCloseTo(10_000 + FULL_PRICE, 8);
  });

  it('books the refund as income in the finance ledger', () => {
    const restored = deserialize(legacyOrderSave());
    expect(refundIncome(restored)).toBeCloseTo(CASH_PART + STOCK_VALUE, 8);
    expect(restored.finances.cash).toBeCloseTo(restored.cash, 8);
  });

  it('removes orderCost, orderStock and deliveryArrivalTick from the order payload', () => {
    const restored = deserialize(legacyOrderSave());
    const action = chargeAction(restored)!;
    expect(action).toBeDefined();
    expect(action.payload).not.toHaveProperty('orderCost');
    expect(action.payload).not.toHaveProperty('orderStock');
    expect(action.payload).not.toHaveProperty('deliveryArrivalTick');
  });

  it('keeps the order itself: hole, explosive, amount, stemming and queue state', () => {
    const restored = deserialize(legacyOrderSave());
    const action = chargeAction(restored)!;
    expect(action.status).toBe('queued');
    expect(action.payload).toMatchObject({ holeId: 'H1', ...BOOMITE_5KG });
  });

  it('strips fromStockKg from the planned charge and keeps the rest', () => {
    const restored = deserialize(legacyOrderSave());
    const planned = restored.plannedChargesByHole['H1']!;
    expect(planned).toMatchObject(BOOMITE_5KG);
    expect(planned).not.toHaveProperty('fromStockKg');
  });

  it('leaves the fromStockKg of an already loaded charge alone', () => {
    const restored = deserialize(v36Save(json => {
      json['chargesByHole']['H2'] = { ...BOOMITE_5KG, fromStockKg: STOCK_KG };
    }));
    expect(restored.chargesByHole['H2']!.fromStockKg).toBe(STOCK_KG);
  });

  it('refunds only the order cash when the order drew no stock', () => {
    const restored = deserialize(v36Save(json => {
      json['pendingActions'].push(legacyAction(900, 'H1', { orderCost: FULL_PRICE, deliveryArrivalTick: 0 }));
      json['plannedChargesByHole']['H1'] = { ...BOOMITE_5KG };
    }));
    expect(restored.cash).toBeCloseTo(10_000 + FULL_PRICE, 8);
    expect(chargeAction(restored)!.payload).not.toHaveProperty('orderCost');
  });

  it('refunds only the stock value when the order paid no cash', () => {
    const restored = deserialize(v36Save(json => {
      json['pendingActions'].push(legacyAction(900, 'H1', { orderCost: 0, orderStock: { explosiveId: 'boomite', kg: 5 } }));
      json['plannedChargesByHole']['H1'] = { ...BOOMITE_5KG, fromStockKg: 5 };
    }));
    expect(restored.cash).toBeCloseTo(10_000 + FULL_PRICE, 8);
    expect(chargeAction(restored)!.payload).not.toHaveProperty('orderStock');
  });

  it('sums the refunds of several prepaid orders', () => {
    const restored = deserialize(v36Save(json => {
      json['pendingActions'].push(legacyAction(900, 'H1', PREPAID), legacyAction(901, 'H2', PREPAID));
      json['plannedChargesByHole']['H1'] = { ...BOOMITE_5KG, fromStockKg: STOCK_KG };
      json['plannedChargesByHole']['H2'] = { ...BOOMITE_5KG, fromStockKg: STOCK_KG };
    }));
    expect(restored.cash).toBeCloseTo(10_000 + 2 * FULL_PRICE, 8);
  });

  it('prices the stock value at the explosive list price for a different explosive', () => {
    const restored = deserialize(v36Save(json => {
      json['pendingActions'].push(legacyAction(900, 'H1', {
        explosiveId: 'krackle', amountKg: 4, orderCost: 0, orderStock: { explosiveId: 'krackle', kg: 4 },
      }));
    }));
    expect(restored.cash).toBeCloseTo(10_000 + chargeOrderCost('krackle', 4), 8);
  });

  it('refunds nothing for a charge order that carries no prepaid keys', () => {
    const restored = deserialize(v36Save(json => {
      json['pendingActions'].push(legacyAction(900, 'H1', {}));
    }));
    expect(restored.cash).toBe(10_000);
    expect(refundIncome(restored)).toBe(0);
  });

  it('does not touch orderCost on other action types', () => {
    const restored = deserialize(v36Save(json => {
      json['pendingActions'].push({
        id: 910, type: 'survey', requiredSkill: 'survey', requiredVehicleRole: null,
        targetX: 5, targetZ: 5, targetY: 0, targetEmployeeId: null,
        status: 'queued', holderId: null, queuedAtTick: 0,
        payload: { method: 'seismic', centerX: 5, centerZ: 5, durationTicks: 10, orderCost: 700 },
      });
    }));
    const survey = restored.pendingActions.find(a => a.id === 910)!;
    expect(survey.payload['orderCost']).toBe(700);
    expect(restored.cash).toBe(10_000);
  });

  it('refunds nothing for a save with no pending charge order', () => {
    const restored = deserialize(v36Save(() => {}));
    expect(restored.cash).toBe(10_000);
    expect(refundIncome(restored)).toBe(0);
  });

  it('loads at the current save version', () => {
    expect(deserialize(legacyOrderSave()).version).toBe(37);
  });
});

describe('deserialize — refund happens once (#2155 C2)', () => {
  it('does not refund a save already at version 37 that still carries the legacy keys', () => {
    const json = JSON.parse(legacyOrderSave()) as Json;
    json['version'] = 37;
    const restored = deserialize(JSON.stringify(json));
    expect(restored.cash).toBe(10_000);
    expect(refundIncome(restored)).toBe(0);
  });

  it('does not refund again when the migrated state is saved and loaded again', () => {
    const first = deserialize(legacyOrderSave());
    const second = deserialize(serialize(first));
    expect(second.cash).toBeCloseTo(first.cash, 8);
    expect(refundIncome(second)).toBeCloseTo(refundIncome(first), 8);
  });

  it('loads a v36 save carrying chargeAwaitingFunds with the field absent from state', () => {
    const restored = deserialize(v36Save(json => { json['chargeAwaitingFunds'] = ['H1', 'H2']; }));
    expect(restored).not.toHaveProperty('chargeAwaitingFunds');
  });

  it('loads a v36 save with an empty chargeAwaitingFunds without the field', () => {
    const restored = deserialize(v36Save(json => { json['chargeAwaitingFunds'] = []; }));
    expect(restored).not.toHaveProperty('chargeAwaitingFunds');
  });

  it('serializes a migrated state without chargeAwaitingFunds', () => {
    const restored = deserialize(v36Save(json => { json['chargeAwaitingFunds'] = ['H1']; }));
    expect(JSON.parse(serialize(restored))).not.toHaveProperty('chargeAwaitingFunds');
  });
});

describe('a migrated charge order is charged at fill time, once (#2155 C1)', () => {
  it('pays the full list price on fill when the warehouse holds no stock', () => {
    const restored = deserialize(legacyOrderSave());
    const afterRefund = restored.cash;
    const report = completeCharge(restored);
    expect(report.chargeLoaded?.holeId).toBe('H1');
    expect(restored.cash).toBeCloseTo(afterRefund - FULL_PRICE, 8);
    expect(explosivesExpenses(restored)).toHaveLength(1);
    expect(restored.chargesByHole['H1']).toMatchObject(BOOMITE_5KG);
    expect(restored.chargesByHole['H1']!.fromStockKg ?? 0).toBe(0);
    expect(restored.plannedChargesByHole['H1']).toBeUndefined();
  });

  it('nets cash back to its pre-order value once the hole is filled', () => {
    const restored = deserialize(legacyOrderSave());
    completeCharge(restored);
    expect(restored.cash).toBeCloseTo(10_000, 8);
  });

  it('draws warehouse stock first on fill and pays nothing when it covers the order', () => {
    const state = baseState();
    placeBuilding(state.buildings, 'explosive_warehouse', 5, 5, 64, 64, 1);
    expect(buyExplosiveStock(state, 'boomite', 100).success).toBe(true);
    const cashWithStock = state.cash;
    const restored = deserialize(legacyOrderSave(state));
    expect(restored.cash).toBeCloseTo(cashWithStock + FULL_PRICE, 8);
    const afterRefund = restored.cash;
    completeCharge(restored);
    expect(getExplosivesInStock(restored.buildings, 'boomite')).toBe(95);
    expect(restored.cash).toBeCloseTo(afterRefund, 8);
    expect(restored.chargesByHole['H1']!.fromStockKg).toBe(5);
  });

  it('does not charge a second time if the loaded save is completed twice', () => {
    const restored = deserialize(legacyOrderSave());
    completeCharge(restored);
    const afterFill = restored.cash;
    completeCharge(restored);
    expect(restored.cash).toBeCloseTo(afterFill, 8);
    expect(explosivesExpenses(restored)).toHaveLength(1);
  });
});

describe('cancelling a migrated order (#2155 C3)', () => {
  it('refunds nothing further', () => {
    const restored = deserialize(legacyOrderSave());
    const afterRefund = restored.cash;
    const income = refundIncome(restored);
    const result = cancelAction(restored, chargeAction(restored)!.id);
    expect(result.success).toBe(true);
    expect(result.refunded ?? 0).toBe(0);
    expect(restored.cash).toBeCloseTo(afterRefund, 8);
    expect(refundIncome(restored)).toBeCloseTo(income, 8);
    expect(chargeAction(restored)).toBeUndefined();
    expect(restored.plannedChargesByHole['H1']).toBeUndefined();
  });
});

describe('GameState no longer tracks holes awaiting funds (#2155 C5)', () => {
  it('createGame state has no chargeAwaitingFunds key', () => {
    const state = createGame({ seed: 42 });
    expect(state).not.toHaveProperty('chargeAwaitingFunds');
    expect(Object.keys(state)).not.toContain('chargeAwaitingFunds');
  });

  it.each(['notification.charge_awaiting_funds', 'mining.charge.awaiting_funds'])('%s is gone from en.json and fr.json', (key) => {
    expect(Object.keys(en)).not.toContain(key);
    expect(Object.keys(fr)).not.toContain(key);
  });
});
