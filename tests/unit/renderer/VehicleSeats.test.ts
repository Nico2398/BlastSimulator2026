// VehicleSeats — unit tests (#2319)

import { describe, it, expect } from 'vitest';
import { getAllVehicleRoles, vehicleSeatCount, type VehicleRole, type VehicleTier } from '../../../src/core/entities/Vehicle.js';
import { vehicleSeatAnchors } from '../../../src/renderer/VehicleSeats.js';

const TIERS: VehicleTier[] = [1, 2, 3];

describe('vehicleSeatAnchors', () => {
  it('shuttle (travel vehicle tier 1) has six seats: driver plus five passengers', () => {
    expect(vehicleSeatAnchors('travel_vehicle', 1)).toHaveLength(6);
  });

  it('race car (travel vehicle tier 2) has a single driver seat', () => {
    expect(vehicleSeatAnchors('travel_vehicle', 2)).toHaveLength(1);
  });

  it('anchor count equals vehicleSeatCount for every travel tier', () => {
    for (const tier of [1, 2] as VehicleTier[]) {
      expect(vehicleSeatAnchors('travel_vehicle', tier)).toHaveLength(vehicleSeatCount({ type: 'travel_vehicle', tier }));
    }
  });

  it('every other role has no anchors at any tier', () => {
    const others = getAllVehicleRoles().filter((r: VehicleRole) => r !== 'travel_vehicle');
    expect(others.length).toBeGreaterThan(0);
    for (const role of others) {
      for (const tier of TIERS) expect(vehicleSeatAnchors(role, tier)).toEqual([]);
    }
  });

  it('shuttle anchors are pairwise distinct', () => {
    const anchors = vehicleSeatAnchors('travel_vehicle', 1);
    const keys = new Set(anchors.map(a => `${a.x},${a.y},${a.z}`));
    expect(keys.size).toBe(anchors.length);
  });

  it('anchors are finite numbers with x, y and z', () => {
    for (const tier of [1, 2] as VehicleTier[]) {
      for (const a of vehicleSeatAnchors('travel_vehicle', tier)) {
        expect(Number.isFinite(a.x)).toBe(true);
        expect(Number.isFinite(a.y)).toBe(true);
        expect(Number.isFinite(a.z)).toBe(true);
      }
    }
  });

  it('returns the same anchors on every call', () => {
    expect(vehicleSeatAnchors('travel_vehicle', 1)).toEqual(vehicleSeatAnchors('travel_vehicle', 1));
  });
});
