// BlastSimulator2026 — Unit tests: outstandingChargeBlockedReason over mixed queues (#1660)
//
// Symptom 2 of #1660: a blast destroys the charging truck and kills its driver,
// and the remaining charge orders sit forever with a null blocked reason. The
// reason must reflect the whole outstanding queue, not the first charge_hole.

import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { hireEmployee, assignSkill, killEmployee } from '../../../src/core/entities/Employee.js';
import { purchaseVehicle, destroyVehicle, ROLE_LICENCE_REQUIRED } from '../../../src/core/entities/Vehicle.js';
import { dispatchChargeAction, outstandingChargeBlockedReason } from '../../../src/core/mining/ChargeOrder.js';
import { classifyQueuedOrders } from '../../../src/core/engine/OrderReachability.js';

const LICENCE = ROLE_LICENCE_REQUIRED.charging_truck;
const BOOMITE = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };

function makeState(): GameState {
  const state = createGame({ seed: 42, startingCash: 100_000 });
  return state;
}

function hireDual(state: GameState) {
  const { employee } = hireEmployee(state.employees, 'driver', new Random(42 + state.employees.nextId), 10, 10);
  assignSkill(state.employees, employee.id, 'blasting', 1);
  assignSkill(state.employees, employee.id, LICENCE as never, 1);
  return employee;
}

function order(state: GameState, n: number): void {
  dispatchChargeAction(state, { id: `H${n}`, x: 10 + n * 3, z: 10 }, BOOMITE);
}

const chargeActions = (state: GameState) => state.pendingActions.filter(a => a.type === 'charge_hole');

describe('outstandingChargeBlockedReason (#1660)', () => {
  it('is null with no outstanding charge order', () => {
    expect(outstandingChargeBlockedReason(makeState())).toBeNull();
  });

  it('returns the blocked order reason when a claimed null-reason order precedes a queued blocked one', () => {
    const state = makeState();
    order(state, 1);
    order(state, 2);
    const [first, second] = chargeActions(state);
    first!.status = 'assigned';
    first!.holderId = 1;
    first!.blockedReason = null;
    second!.status = 'queued';
    second!.blockedReason = 'no_vehicle_in_fleet';

    expect(outstandingChargeBlockedReason(state)).toBe('no_vehicle_in_fleet');
  });

  it('returns the blocked order reason when a queued null-reason order precedes a blocked one', () => {
    const state = makeState();
    order(state, 1);
    order(state, 2);
    const [first, second] = chargeActions(state);
    first!.blockedReason = null;
    second!.blockedReason = 'no_dual_qualified_employee';

    expect(outstandingChargeBlockedReason(state)).toBe('no_dual_qualified_employee');
  });

  it('is null when every outstanding order is unblocked', () => {
    const state = makeState();
    order(state, 1);
    order(state, 2);
    for (const a of chargeActions(state)) a.blockedReason = null;
    expect(outstandingChargeBlockedReason(state)).toBeNull();
  });

  it('reads no_vehicle_in_fleet once the truck is destroyed with an order still queued', () => {
    const state = makeState();
    hireDual(state);
    const truckId = purchaseVehicle(state.vehicles, 'charging_truck', 10, 10).vehicle.id;
    order(state, 1);
    classifyQueuedOrders(state);
    expect(outstandingChargeBlockedReason(state)).toBeNull();

    expect(destroyVehicle(state.vehicles, truckId)).toBe(true);
    classifyQueuedOrders(state);

    expect(outstandingChargeBlockedReason(state)).toBe('no_vehicle_in_fleet');
  });

  it('reads no_dual_qualified_employee when the truck lives but its dual-qualified driver died', () => {
    const state = makeState();
    const dual = hireDual(state);
    // Blaster and licence holder survive on separate people, neither holds both.
    // A driller holds blasting but no truck licence (a blaster does since #1667).
    const { employee: blaster } = hireEmployee(state.employees, 'driller', new Random(7), 10, 10);
    const { employee: driver } = hireEmployee(state.employees, 'driver', new Random(8), 10, 10);
    assignSkill(state.employees, driver.id, LICENCE as never, 1);
    purchaseVehicle(state.vehicles, 'charging_truck', 10, 10);
    order(state, 1);
    classifyQueuedOrders(state);
    expect(outstandingChargeBlockedReason(state)).toBeNull();

    killEmployee(state.employees, dual.id);
    classifyQueuedOrders(state);

    expect(outstandingChargeBlockedReason(state)).toBe('no_dual_qualified_employee');
  });

  it('returns to null once a replacement charging truck is bought', () => {
    const state = makeState();
    hireDual(state);
    order(state, 1);
    classifyQueuedOrders(state);
    expect(outstandingChargeBlockedReason(state)).toBe('no_vehicle_in_fleet');

    purchaseVehicle(state.vehicles, 'charging_truck', 10, 10);
    classifyQueuedOrders(state);

    expect(outstandingChargeBlockedReason(state)).toBeNull();
  });
});
