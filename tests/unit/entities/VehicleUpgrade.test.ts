// BlastSimulator2026 — vehicle tier upgrade unit tests (#1401)

import { describe, it, expect } from 'vitest';
import {
  nextVehicleTier,
  computeVehicleUpgradeCost,
  upgradeVehicle,
  rosterCanDriveVehicleTier,
  isLicensedForVehicleTier,
  canAffordVehicleUpgrade,
} from '../../../src/core/entities/VehicleUpgrade.js';
import { purchaseVehicle, createVehicleState, getVehicleDefByTier, getAllVehicleRoles } from '../../../src/core/entities/Vehicle.js';
import type { Employee } from '../../../src/core/entities/Employee.js';
import { VEHICLE_MAX_TIER } from '../../../src/core/config/balance.js';

function makeEmployee(over: Partial<Employee> = {}): Employee {
  return {
    id: 1, name: 'E', role: 'driver', salary: 1000, morale: 60, unionized: false,
    injured: false, alive: true, x: 0, z: 0, qualifications: [], trainingState: null,
    locomotion: { kind: 'on_foot' }, activeActionId: null, fatigue: 100, collapsing: false,
    interruptedActionPayload: null, ticksWorked: 0, restTicksRemaining: null,
    taskTicksRemaining: null, activeTaskSkill: null, restNeedKey: null,
    destinationX: null, destinationZ: null, moveConsecutiveFailures: 0, isMoveStuck: false,
    pendingRestDuration: null, pendingRestNeedKey: null, pendingTaskDuration: null,
    pendingActionType: null, pendingActionPayload: null, pendingDriverVehicleId: null,
    taskQueue: [], itinerary: null, vehicleWaitingTicks: 0,
    ...over,
  } as Employee;
}

describe('VEHICLE_MAX_TIER', () => {
  it('is 3', () => {
    expect(VEHICLE_MAX_TIER).toBe(3);
  });
});

describe('nextVehicleTier', () => {
  it('returns 2 from tier 1', () => expect(nextVehicleTier(1)).toBe(2));
  it('returns 3 from tier 2', () => expect(nextVehicleTier(2)).toBe(3));
  it('returns null at max tier', () => expect(nextVehicleTier(3)).toBeNull());
});

describe('computeVehicleUpgradeCost', () => {
  it('is the purchase-cost difference tier 1 -> 2', () => {
    expect(computeVehicleUpgradeCost('debris_hauler', 1)).toBe(25_000);
  });

  it('is the purchase-cost difference tier 2 -> 3', () => {
    expect(computeVehicleUpgradeCost('debris_hauler', 2)).toBe(50_000);
  });

  it('matches the catalog difference for every role and non-max tier', () => {
    for (const role of getAllVehicleRoles()) {
      for (const tier of [1, 2] as const) {
        const expected = getVehicleDefByTier(role, (tier + 1) as 2 | 3).purchaseCost
          - getVehicleDefByTier(role, tier).purchaseCost;
        expect(computeVehicleUpgradeCost(role, tier)).toBe(expected);
        expect(expected).toBeGreaterThan(0);
      }
    }
  });

  it('returns null at max tier for every role', () => {
    for (const role of getAllVehicleRoles()) {
      expect(computeVehicleUpgradeCost(role, VEHICLE_MAX_TIER)).toBeNull();
    }
  });
});

describe('upgradeVehicle', () => {
  it('raises tier by one and reports cost and tiers', () => {
    const { vehicle } = purchaseVehicle(createVehicleState(), 'debris_hauler', 3, 4);
    const result = upgradeVehicle(vehicle);
    expect(result).toEqual({ success: true, cost: 25_000, fromTier: 1, toTier: 2 });
    expect(vehicle.tier).toBe(2);
  });

  it('sets hp to the new tier maxHp', () => {
    const { vehicle } = purchaseVehicle(createVehicleState(), 'debris_hauler', 0, 0);
    upgradeVehicle(vehicle);
    expect(vehicle.hp).toBe(getVehicleDefByTier('debris_hauler', 2).maxHp);
  });

  it('fully repairs a damaged vehicle to the new tier maxHp', () => {
    const { vehicle } = purchaseVehicle(createVehicleState(), 'rock_digger', 0, 0);
    vehicle.hp = 1;
    upgradeVehicle(vehicle);
    expect(vehicle.hp).toBe(getVehicleDefByTier('rock_digger', 2).maxHp);
  });

  it('leaves id, position, cargo and occupants untouched', () => {
    const { vehicle } = purchaseVehicle(createVehicleState(), 'debris_hauler', 7, 9);
    vehicle.occupantIds = [42];
    const cargo = vehicle.cargo;
    const before = { id: vehicle.id, x: vehicle.x, z: vehicle.z, type: vehicle.type };
    upgradeVehicle(vehicle);
    expect({ id: vehicle.id, x: vehicle.x, z: vehicle.z, type: vehicle.type }).toEqual(before);
    expect(vehicle.cargo).toBe(cargo);
    expect(vehicle.occupantIds).toEqual([42]);
  });

  it('can chain from tier 1 to max tier', () => {
    const { vehicle } = purchaseVehicle(createVehicleState(), 'drill_rig', 0, 0);
    expect(upgradeVehicle(vehicle).success).toBe(true);
    expect(upgradeVehicle(vehicle).success).toBe(true);
    expect(vehicle.tier).toBe(VEHICLE_MAX_TIER);
    expect(vehicle.hp).toBe(getVehicleDefByTier('drill_rig', 3).maxHp);
  });

  it('refuses at max tier and changes nothing', () => {
    const { vehicle } = purchaseVehicle(createVehicleState(), 'debris_hauler', 0, 0, 3);
    vehicle.hp = 10;
    const snapshot = JSON.stringify(vehicle);
    expect(upgradeVehicle(vehicle)).toEqual({ success: false, reason: 'max_tier' });
    expect(JSON.stringify(vehicle)).toBe(snapshot);
  });
});

describe('rosterCanDriveVehicleTier', () => {
  const licensed = (id = 1, over: Partial<Employee> = {}) =>
    makeEmployee({ id, qualifications: [{ category: 'driving.truck', proficiencyLevel: 1, xp: 0, licenceLevel: 3 }], ...over });

  it('is true when an alive employee holds the licence', () => {
    expect(rosterCanDriveVehicleTier([licensed()], 'debris_hauler', 2)).toBe(true);
  });

  it('is false for an empty roster', () => {
    expect(rosterCanDriveVehicleTier([], 'debris_hauler', 2)).toBe(false);
  });

  it('is false when nobody holds the licence', () => {
    expect(rosterCanDriveVehicleTier([makeEmployee()], 'debris_hauler', 2)).toBe(false);
  });

  it('is false when the licence is for another role', () => {
    const drillOnly = makeEmployee({ qualifications: [{ category: 'driving.drill_rig', proficiencyLevel: 1, xp: 0 }] });
    expect(rosterCanDriveVehicleTier([drillOnly], 'debris_hauler', 2)).toBe(false);
  });

  it('ignores dead employees', () => {
    expect(rosterCanDriveVehicleTier([licensed(1, { alive: false })], 'debris_hauler', 2)).toBe(false);
  });

  it('is true if any one of several employees is licensed', () => {
    expect(rosterCanDriveVehicleTier([makeEmployee({ id: 5 }), licensed(6)], 'debris_hauler', 3)).toBe(true);
  });
});

describe('isLicensedForVehicleTier', () => {
  it('is true for a holder of the role licence', () => {
    const e = makeEmployee({ qualifications: [{ category: 'driving.truck', proficiencyLevel: 1, xp: 0 }] });
    expect(isLicensedForVehicleTier(e, 'debris_hauler', 1)).toBe(true);
  });

  it('is false without the licence', () => {
    expect(isLicensedForVehicleTier(makeEmployee(), 'debris_hauler', 1)).toBe(false);
  });
});

describe('canAffordVehicleUpgrade', () => {
  const cost = computeVehicleUpgradeCost('debris_hauler', 1)!;

  it('is true when cash equals the price difference', () => {
    expect(canAffordVehicleUpgrade({ type: 'debris_hauler', tier: 1 }, cost)).toBe(true);
  });

  it('is false when cash is one short', () => {
    expect(canAffordVehicleUpgrade({ type: 'debris_hauler', tier: 1 }, cost - 1)).toBe(false);
  });

  it('is false at max tier however much cash', () => {
    expect(canAffordVehicleUpgrade({ type: 'debris_hauler', tier: VEHICLE_MAX_TIER as 3 }, 1e12)).toBe(false);
  });
});
