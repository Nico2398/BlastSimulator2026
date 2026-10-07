// #1375 — vehicle upkeep is booked as separate 'vehicle_maintenance' and 'fuel' transactions.
import { describe, it, expect, beforeEach } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { Random } from '../../../src/core/math/Random.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { runTick } from '../../../src/core/engine/TickPipeline.js';
import { clearEvents } from '../../../src/core/events/EventPool.js';
import { purchaseVehicle, getVehicleDefByTier, getVehicleCostsPerTick } from '../../../src/core/entities/Vehicle.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';

function tick(state: ReturnType<typeof createGame>) {
  runTick(state, null, new Random(state.seed + state.tickCount), new EventEmitter(), { checkInvariants: false });
}

function sum(state: ReturnType<typeof createGame>, category: string): number {
  return state.finances.transactions
    .filter(tx => tx.type === 'expense' && tx.category === category)
    .reduce((s, tx) => s + tx.amount, 0);
}

describe('runTick vehicle cost booking (#1375)', () => {
  beforeEach(() => clearEvents());

  it('books an idle vehicle under vehicle_maintenance and nothing under fuel', () => {
    const state = createGame({ seed: 42 });
    purchaseVehicle(state.vehicles, 'debris_hauler');
    tick(state);
    expect(sum(state, 'vehicle_maintenance')).toBeCloseTo(getVehicleDefByTier('debris_hauler', 1).maintenanceCostPerTick, 8);
    expect(sum(state, 'fuel')).toBe(0);
  });

  it('books a reserved vehicle fuel separately from maintenance, totals unchanged', () => {
    const state = createGame({ seed: 42 });
    const v = purchaseVehicle(state.vehicles, 'debris_hauler').vehicle;
    reserveVehicle(state.vehicles, v.id, 77);
    const total = getVehicleCostsPerTick(state.vehicles);
    const def = getVehicleDefByTier('debris_hauler', 1);
    tick(state);
    expect(sum(state, 'vehicle_maintenance')).toBeCloseTo(def.maintenanceCostPerTick, 8);
    expect(sum(state, 'fuel')).toBeCloseTo(def.fuelCostPerTick, 8);
    expect(sum(state, 'vehicle_maintenance') + sum(state, 'fuel')).toBeCloseTo(total, 8);
  });
});
