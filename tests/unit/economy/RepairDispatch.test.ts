// BlastSimulator2026 — Tests for RepairDispatch.ts (issue #1393)
//
// syncRepairDispatch self-dispatches one `repair_vehicle` PendingAction per
// idle damaged vehicle, idempotently, pruning stale orders. Orders skip the
// qualification check, so with nobody trained in 'repair' they sit queued with
// blockedReason 'no_qualified_employee'. Red phase: the module is a stub.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState, type PendingAction } from '../../../src/core/state/GameState.js';
import { syncRepairDispatch } from '../../../src/core/economy/RepairDispatch.js';
import { purchaseVehicle, getVehicleDefByTier } from '../../../src/core/entities/Vehicle.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';

const SEED = 42;

function repairOrders(state: GameState): PendingAction[] {
  return state.pendingActions.filter(a => a.type === 'repair_vehicle');
}

function damagedVehicle(state: GameState, x = 5, z = 7, hpLost = 20) {
  const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', x, z);
  vehicle.hp = getVehicleDefByTier('debris_hauler', 1).maxHp - hpLost;
  return vehicle;
}

describe('syncRepairDispatch — creation', () => {
  it('creates one repair_vehicle order for an idle damaged vehicle', () => {
    const state = createGame({ seed: SEED });
    const v = damagedVehicle(state, 5, 7);

    syncRepairDispatch(state);

    const orders = repairOrders(state);
    expect(orders).toHaveLength(1);
    const o = orders[0]!;
    expect(o.payload['vehicleId']).toBe(v.id);
    expect(o.requiredSkill).toBe('repair');
    expect(o.requiredVehicleRole).toBeNull();
    expect(o.targetX).toBe(5);
    expect(o.targetZ).toBe(7);
    expect(o.status).toBe('queued');
    expect(state.ghostPreviews.some(g => g.id === o.id)).toBe(true);
  });

  it('creates one order per damaged vehicle', () => {
    const state = createGame({ seed: SEED });
    const a = damagedVehicle(state, 1, 1);
    const b = damagedVehicle(state, 9, 9, 5);
    syncRepairDispatch(state);
    const ids = repairOrders(state).map(o => o.payload['vehicleId']);
    expect(ids.sort()).toEqual([a.id, b.id].sort());
  });

  it('is idempotent: a second call adds nothing', () => {
    const state = createGame({ seed: SEED });
    damagedVehicle(state);
    syncRepairDispatch(state);
    const first = repairOrders(state).map(o => o.id);
    syncRepairDispatch(state);
    syncRepairDispatch(state);
    expect(repairOrders(state).map(o => o.id)).toEqual(first);
    expect(state.ghostPreviews.filter(g => g.type === 'repair_vehicle')).toHaveLength(1);
  });
});

describe('syncRepairDispatch — vehicles that get no order', () => {
  it('none for a healthy vehicle', () => {
    const state = createGame({ seed: SEED });
    purchaseVehicle(state.vehicles, 'debris_hauler', 3, 3);
    syncRepairDispatch(state);
    expect(repairOrders(state)).toHaveLength(0);
  });

  it('none for a wrecked vehicle (hp 0)', () => {
    const state = createGame({ seed: SEED });
    const v = damagedVehicle(state);
    v.hp = 0;
    syncRepairDispatch(state);
    expect(repairOrders(state)).toHaveLength(0);
  });

  it('none for an occupied vehicle', () => {
    const state = createGame({ seed: SEED });
    const v = damagedVehicle(state);
    v.occupantIds.push(99);
    syncRepairDispatch(state);
    expect(repairOrders(state)).toHaveLength(0);
  });

  it('none for a vehicle reserved for another action', () => {
    const state = createGame({ seed: SEED });
    const v = damagedVehicle(state);
    reserveVehicle(state.vehicles, v.id, 12345);
    syncRepairDispatch(state);
    expect(repairOrders(state)).toHaveLength(0);
  });
});

describe('syncRepairDispatch — pruning', () => {
  it('removes the order (and ghost) once the vehicle is back at full hp', () => {
    const state = createGame({ seed: SEED });
    const v = damagedVehicle(state);
    syncRepairDispatch(state);
    const id = repairOrders(state)[0]!.id;

    v.hp = getVehicleDefByTier('debris_hauler', 1).maxHp;
    syncRepairDispatch(state);

    expect(repairOrders(state)).toHaveLength(0);
    expect(state.ghostPreviews.find(g => g.id === id)).toBeUndefined();
  });

  it('removes the order when the vehicle no longer exists', () => {
    const state = createGame({ seed: SEED });
    const v = damagedVehicle(state);
    syncRepairDispatch(state);
    state.vehicles.vehicles = state.vehicles.vehicles.filter(x => x.id !== v.id);
    syncRepairDispatch(state);
    expect(repairOrders(state)).toHaveLength(0);
  });

  it('removes a still-queued order when the vehicle gets occupied', () => {
    const state = createGame({ seed: SEED });
    const v = damagedVehicle(state);
    syncRepairDispatch(state);
    v.occupantIds.push(99);
    syncRepairDispatch(state);
    expect(repairOrders(state)).toHaveLength(0);
  });

  it('keeps an order an employee already holds, even if the vehicle is still damaged', () => {
    const state = createGame({ seed: SEED });
    damagedVehicle(state);
    syncRepairDispatch(state);
    const order = repairOrders(state)[0]!;
    order.status = 'in_progress';
    order.holderId = 77;
    syncRepairDispatch(state);
    expect(repairOrders(state).map(o => o.id)).toEqual([order.id]);
  });
});

describe('syncRepairDispatch — unqualified roster', () => {
  it('with nobody trained in repair the order stays queued, blocked as no_qualified_employee', () => {
    const state = createGame({ seed: SEED });
    damagedVehicle(state);
    syncRepairDispatch(state);
    const order = repairOrders(state)[0]!;
    expect(order.status).toBe('queued');
    expect(order.blockedReason).toBe('no_qualified_employee');
  });
});
