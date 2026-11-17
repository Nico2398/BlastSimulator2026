// BlastSimulator2026 — seats per vehicle (#2290): the shuttle carries a driver and five passengers, the race car and
// every work vehicle only a driver.

import { describe, it, expect } from 'vitest';
import { vehicleSeatCount, vehiclePassengerIds, getAllVehicleRoles, type Vehicle } from '../../../src/core/entities/Vehicle.js';
import { TRAVEL_VEHICLE_SEATS, VEHICLE_SEAT_COUNT } from '../../../src/core/config/balance.js';

function makeVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  return { id: 1, type: 'travel_vehicle', tier: 1, x: 0, z: 0, hp: 100, cargo: [], occupantIds: [], ...overrides };
}

describe('vehicleSeatCount (#2290 C1)', () => {
  it('the shuttle (travel vehicle tier 1) has six seats: a driver and five passengers', () => {
    expect(vehicleSeatCount({ type: 'travel_vehicle', tier: 1 })).toBe(6);
    expect(TRAVEL_VEHICLE_SEATS[1]).toBe(6);
  });

  it('the race car (tier 2) has one seat', () => {
    expect(vehicleSeatCount({ type: 'travel_vehicle', tier: 2 })).toBe(1);
    expect(TRAVEL_VEHICLE_SEATS[2]).toBe(1);
  });

  it('every other role keeps its role seat count at every tier', () => {
    for (const role of getAllVehicleRoles()) {
      if (role === 'travel_vehicle') continue;
      for (const tier of [1, 2, 3] as const) {
        expect(vehicleSeatCount({ type: role, tier }), `${role} tier ${tier}`).toBe(VEHICLE_SEAT_COUNT[role]);
        expect(vehicleSeatCount({ type: role, tier })).toBe(1);
      }
    }
  });

  it('reads the vehicle it is given, not the role alone', () => {
    expect(vehicleSeatCount(makeVehicle({ tier: 1 }))).toBeGreaterThan(vehicleSeatCount(makeVehicle({ tier: 2 })));
  });
});

describe('vehiclePassengerIds (#2290)', () => {
  it('is empty for an empty vehicle', () => {
    expect(vehiclePassengerIds(makeVehicle())).toEqual([]);
  });

  it('is empty when only the driver is aboard', () => {
    expect(vehiclePassengerIds(makeVehicle({ occupantIds: [4] }))).toEqual([]);
  });

  it('lists every occupant after the driver, in seating order', () => {
    expect(vehiclePassengerIds(makeVehicle({ occupantIds: [4, 7, 5, 9] }))).toEqual([7, 5, 9]);
  });

  it('does not alias or mutate the occupant list', () => {
    const v = makeVehicle({ occupantIds: [4, 7] });
    const passengers = vehiclePassengerIds(v);
    passengers.push(99);
    expect(v.occupantIds).toEqual([4, 7]);
  });
});
