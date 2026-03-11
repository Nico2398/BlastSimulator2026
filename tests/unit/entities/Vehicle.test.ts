import { describe, it, expect } from 'vitest';
import {
  createVehicleState,
  purchaseVehicle,
  assignVehicle,
  destroyVehicle,
  getVehicleCostsPerTick,
  getExcavatorLoadingRate,
  getVehicleDef,
} from '../../../src/core/entities/Vehicle.js';

describe('Vehicle system', () => {
  it('purchasing a vehicle deducts cost and adds it to fleet', () => {
    const state = createVehicleState();
    const { vehicle, cost } = purchaseVehicle(state, 'truck');

    expect(cost).toBe(getVehicleDef('truck').purchaseCost);
    expect(state.vehicles.length).toBe(1);
    expect(vehicle.type).toBe('truck');
    expect(vehicle.task).toBe('idle');
  });

  it('vehicle maintenance/fuel costs accumulate per tick', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'truck');
    purchaseVehicle(state, 'excavator');

    // Both idle — maintenance only
    const idleCost = getVehicleCostsPerTick(state);
    const expectedIdle =
      getVehicleDef('truck').maintenanceCostPerTick +
      getVehicleDef('excavator').maintenanceCostPerTick;
    expect(idleCost).toBe(expectedIdle);

    // Assign truck to transport — adds fuel
    assignVehicle(state, state.vehicles[0]!.id, 'transport');
    const activeCost = getVehicleCostsPerTick(state);
    expect(activeCost).toBe(expectedIdle + getVehicleDef('truck').fuelCostPerTick);
  });

  it('assigning a truck to transport changes its state', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'truck');
    const id = state.vehicles[0]!.id;

    assignVehicle(state, id, 'transport', 10, 20);
    expect(state.vehicles[0]!.task).toBe('transport');
    expect(state.vehicles[0]!.targetX).toBe(10);
    expect(state.vehicles[0]!.targetZ).toBe(20);
  });

  it('excavator loading rate matches its capacity stat', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'excavator');
    const vehicle = state.vehicles[0]!;

    const rate = getExcavatorLoadingRate(vehicle);
    expect(rate).toBe(getVehicleDef('excavator').capacity);
  });

  it('destroyed vehicle is removed from fleet', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'truck');
    purchaseVehicle(state, 'excavator');
    const truckId = state.vehicles[0]!.id;

    expect(state.vehicles.length).toBe(2);
    destroyVehicle(state, truckId);
    expect(state.vehicles.length).toBe(1);
    expect(state.vehicles[0]!.type).toBe('excavator');
  });
});
