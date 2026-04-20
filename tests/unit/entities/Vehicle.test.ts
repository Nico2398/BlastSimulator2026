import { describe, it, expect } from 'vitest';
import {
  type VehicleRole,
  createVehicleState,
  purchaseVehicle,
  assignVehicle,
  destroyVehicle,
  getVehicleCostsPerTick,
  getExcavatorLoadingRate,
  getVehicleDef,
  getAllVehicleRoles,
} from '../../../src/core/entities/Vehicle.js';

// ── Role catalogue ────────────────────────────────────────────────────────────

describe('VehicleRole catalogue', () => {
  it('getAllVehicleRoles() returns all 5 defined roles', () => {
    const roles = getAllVehicleRoles();
    expect(roles).toHaveLength(5);
  });

  it('getAllVehicleRoles() contains debris_hauler', () => {
    const roles = getAllVehicleRoles();
    expect(roles).toContain('debris_hauler' satisfies VehicleRole);
  });

  it('getAllVehicleRoles() contains rock_digger', () => {
    const roles = getAllVehicleRoles();
    expect(roles).toContain('rock_digger' satisfies VehicleRole);
  });

  it('getAllVehicleRoles() contains drill_rig', () => {
    const roles = getAllVehicleRoles();
    expect(roles).toContain('drill_rig' satisfies VehicleRole);
  });

  it('getAllVehicleRoles() contains building_destroyer', () => {
    const roles = getAllVehicleRoles();
    expect(roles).toContain('building_destroyer' satisfies VehicleRole);
  });

  it('getAllVehicleRoles() contains rock_fragmenter', () => {
    const roles = getAllVehicleRoles();
    expect(roles).toContain('rock_fragmenter' satisfies VehicleRole);
  });
});

// ── VehicleDef presence for every role ───────────────────────────────────────

describe('VehicleDef definitions', () => {
  it('debris_hauler has a purchaseCost > 0', () => {
    expect(getVehicleDef('debris_hauler').purchaseCost).toBeGreaterThan(0);
  });

  it('rock_digger has a purchaseCost > 0', () => {
    expect(getVehicleDef('rock_digger').purchaseCost).toBeGreaterThan(0);
  });

  it('drill_rig has a purchaseCost > 0', () => {
    expect(getVehicleDef('drill_rig').purchaseCost).toBeGreaterThan(0);
  });

  it('building_destroyer has a purchaseCost > 0', () => {
    expect(getVehicleDef('building_destroyer').purchaseCost).toBeGreaterThan(0);
  });

  it('rock_fragmenter has a purchaseCost > 0', () => {
    expect(getVehicleDef('rock_fragmenter').purchaseCost).toBeGreaterThan(0);
  });

  it('each VehicleDef carries the matching role in its type field', () => {
    const roles: VehicleRole[] = getAllVehicleRoles();
    for (const role of roles) {
      expect(getVehicleDef(role).type).toBe(role);
    }
  });
});

// ── Purchase ──────────────────────────────────────────────────────────────────

describe('purchaseVehicle', () => {
  it('purchasing a debris_hauler deducts the correct cost and adds it to fleet', () => {
    const state = createVehicleState();
    const { vehicle, cost } = purchaseVehicle(state, 'debris_hauler');

    expect(cost).toBe(getVehicleDef('debris_hauler').purchaseCost);
    expect(state.vehicles).toHaveLength(1);
    expect(vehicle.type).toBe('debris_hauler' satisfies VehicleRole);
    expect(vehicle.task).toBe('idle');
  });

  it('purchasing a rock_digger adds it with correct role', () => {
    const state = createVehicleState();
    const { vehicle, cost } = purchaseVehicle(state, 'rock_digger');

    expect(cost).toBe(getVehicleDef('rock_digger').purchaseCost);
    expect(vehicle.type).toBe('rock_digger' satisfies VehicleRole);
  });

  it('purchasing a building_destroyer adds it with correct role', () => {
    const state = createVehicleState();
    const { vehicle } = purchaseVehicle(state, 'building_destroyer');
    expect(vehicle.type).toBe('building_destroyer' satisfies VehicleRole);
  });

  it('purchasing a rock_fragmenter adds it with correct role', () => {
    const state = createVehicleState();
    const { vehicle } = purchaseVehicle(state, 'rock_fragmenter');
    expect(vehicle.type).toBe('rock_fragmenter' satisfies VehicleRole);
  });

  it('purchased vehicle starts idle at the given coordinates', () => {
    const state = createVehicleState();
    const { vehicle } = purchaseVehicle(state, 'debris_hauler', 5, 9);

    expect(vehicle.task).toBe('idle');
    expect(vehicle.x).toBe(5);
    expect(vehicle.z).toBe(9);
  });

  it('vehicle IDs increment across multiple purchases', () => {
    const state = createVehicleState();
    const { vehicle: v1 } = purchaseVehicle(state, 'debris_hauler');
    const { vehicle: v2 } = purchaseVehicle(state, 'rock_digger');
    const { vehicle: v3 } = purchaseVehicle(state, 'drill_rig');

    expect(v2.id).toBeGreaterThan(v1.id);
    expect(v3.id).toBeGreaterThan(v2.id);
  });

  it('purchased vehicle hp equals the def maxHp', () => {
    const state = createVehicleState();
    const { vehicle } = purchaseVehicle(state, 'rock_digger');
    expect(vehicle.hp).toBe(getVehicleDef('rock_digger').maxHp);
  });
});

// ── Assign ────────────────────────────────────────────────────────────────────

describe('assignVehicle', () => {
  it('assigning a debris_hauler to transport updates task and target coordinates', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'debris_hauler');
    const id = state.vehicles[0]!.id;

    assignVehicle(state, id, 'transport', 10, 20);

    expect(state.vehicles[0]!.task).toBe('transport');
    expect(state.vehicles[0]!.targetX).toBe(10);
    expect(state.vehicles[0]!.targetZ).toBe(20);
  });

  it('assigning an unknown vehicle id returns false', () => {
    const state = createVehicleState();
    const result = assignVehicle(state, 9999, 'moving');
    expect(result).toBe(false);
  });

  it('assigning a drill_rig to drilling changes its task to drilling', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'drill_rig');
    const id = state.vehicles[0]!.id;

    assignVehicle(state, id, 'drilling');
    expect(state.vehicles[0]!.task).toBe('drilling');
  });

  it('assigning a building_destroyer to clearing changes its task', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'building_destroyer');
    const id = state.vehicles[0]!.id;

    assignVehicle(state, id, 'clearing');
    expect(state.vehicles[0]!.task).toBe('clearing');
  });
});

// ── Costs per tick ────────────────────────────────────────────────────────────

describe('getVehicleCostsPerTick', () => {
  it('idle vehicles incur only maintenance cost (no fuel)', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'debris_hauler');
    purchaseVehicle(state, 'rock_digger');

    const idleCost = getVehicleCostsPerTick(state);
    const expected =
      getVehicleDef('debris_hauler').maintenanceCostPerTick +
      getVehicleDef('rock_digger').maintenanceCostPerTick;

    expect(idleCost).toBe(expected);
  });

  it('active vehicle adds fuel cost on top of maintenance', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'debris_hauler');
    purchaseVehicle(state, 'rock_digger');

    const baseCost =
      getVehicleDef('debris_hauler').maintenanceCostPerTick +
      getVehicleDef('rock_digger').maintenanceCostPerTick;

    // Activate the debris_hauler
    assignVehicle(state, state.vehicles[0]!.id, 'transport');

    const activeCost = getVehicleCostsPerTick(state);
    expect(activeCost).toBe(baseCost + getVehicleDef('debris_hauler').fuelCostPerTick);
  });

  it('empty fleet has zero cost per tick', () => {
    const state = createVehicleState();
    expect(getVehicleCostsPerTick(state)).toBe(0);
  });
});

// ── Destroy ───────────────────────────────────────────────────────────────────

describe('destroyVehicle', () => {
  it('destroyed vehicle is removed from the fleet', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'debris_hauler');
    purchaseVehicle(state, 'rock_digger');
    const haulerId = state.vehicles[0]!.id;

    expect(state.vehicles).toHaveLength(2);
    destroyVehicle(state, haulerId);
    expect(state.vehicles).toHaveLength(1);
    expect(state.vehicles[0]!.type).toBe('rock_digger');
  });

  it('destroying an unknown vehicle id returns false', () => {
    const state = createVehicleState();
    expect(destroyVehicle(state, 9999)).toBe(false);
  });

  it('destroying a vehicle returns true on success', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'building_destroyer');
    const id = state.vehicles[0]!.id;
    expect(destroyVehicle(state, id)).toBe(true);
  });
});

// ── Loading rate ──────────────────────────────────────────────────────────────

describe('getExcavatorLoadingRate', () => {
  it('rock_digger loading rate matches its capacity stat', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'rock_digger');
    const vehicle = state.vehicles[0]!;

    const rate = getExcavatorLoadingRate(vehicle);
    expect(rate).toBe(getVehicleDef('rock_digger').capacity);
  });

  it('non-rock_digger vehicle returns a loading rate of 0', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'debris_hauler');
    const vehicle = state.vehicles[0]!;

    expect(getExcavatorLoadingRate(vehicle)).toBe(0);
  });
});
