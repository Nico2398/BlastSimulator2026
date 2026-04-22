import { describe, it, expect } from 'vitest';
import {
  type VehicleRole,
  type VehicleTier,
  type VehicleOperationalState,
  createVehicleState,
  purchaseVehicle,
  assignVehicle,
  destroyVehicle,
  getVehicleCostsPerTick,
  getExcavatorLoadingRate,
  getVehicleDef,
  getAllVehicleRoles,
  getVehicleDefByTier,
  // ── Task 2.6 — not yet implemented in Vehicle.ts (Red phase) ────────────────
  assignDriver,
} from '../../../src/core/entities/Vehicle.js';
import { Random } from '../../../src/core/math/Random.js';
import {
  createEmployeeState,
  hireEmployee,
  assignSkill,
  killEmployee,
} from '../../../src/core/entities/Employee.js';
import type { SkillCategory } from '../../../src/core/entities/Employee.js';

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

// ── VehicleTier type ──────────────────────────────────────────────────────────

describe('VehicleTier', () => {
  it('tier value 1 is a valid VehicleTier (compile-time satisfies check)', () => {
    const tier = (1 satisfies VehicleTier);
    expect(tier).toBe(1);
  });

  it('tier value 2 is a valid VehicleTier (compile-time satisfies check)', () => {
    const tier = (2 satisfies VehicleTier);
    expect(tier).toBe(2);
  });

  it('tier value 3 is a valid VehicleTier (compile-time satisfies check)', () => {
    const tier = (3 satisfies VehicleTier);
    expect(tier).toBe(3);
  });
});

// ── VehicleOperationalState type ──────────────────────────────────────────────

describe('VehicleOperationalState', () => {
  it('"idle" is a valid VehicleOperationalState (compile-time satisfies check)', () => {
    const state = ('idle' satisfies VehicleOperationalState);
    expect(state).toBe('idle');
  });

  it('"moving" is a valid VehicleOperationalState (compile-time satisfies check)', () => {
    const state = ('moving' satisfies VehicleOperationalState);
    expect(state).toBe('moving');
  });

  it('"working" is a valid VehicleOperationalState (compile-time satisfies check)', () => {
    const state = ('working' satisfies VehicleOperationalState);
    expect(state).toBe('working');
  });

  it('"waiting" is a valid VehicleOperationalState (compile-time satisfies check)', () => {
    const state = ('waiting' satisfies VehicleOperationalState);
    expect(state).toBe('waiting');
  });

  it('"broken" is a valid VehicleOperationalState (compile-time satisfies check)', () => {
    const state = ('broken' satisfies VehicleOperationalState);
    expect(state).toBe('broken');
  });
});

// ── VehicleDef.tier ───────────────────────────────────────────────────────────

describe('VehicleDef.tier', () => {
  it('debris_hauler def has a tier field that is 1, 2, or 3', () => {
    const { tier } = getVehicleDef('debris_hauler');
    expect([1, 2, 3]).toContain(tier);
  });

  it('rock_digger def has a tier field that is 1, 2, or 3', () => {
    const { tier } = getVehicleDef('rock_digger');
    expect([1, 2, 3]).toContain(tier);
  });

  it('drill_rig def has a tier field that is 1, 2, or 3', () => {
    const { tier } = getVehicleDef('drill_rig');
    expect([1, 2, 3]).toContain(tier);
  });

  it('building_destroyer def has a tier field that is 1, 2, or 3', () => {
    const { tier } = getVehicleDef('building_destroyer');
    expect([1, 2, 3]).toContain(tier);
  });

  it('rock_fragmenter def has a tier field that is 1, 2, or 3', () => {
    const { tier } = getVehicleDef('rock_fragmenter');
    expect([1, 2, 3]).toContain(tier);
  });

  it('every role def has a tier field satisfying VehicleTier', () => {
    const roles: VehicleRole[] = getAllVehicleRoles();
    for (const role of roles) {
      const tier: VehicleTier = getVehicleDef(role).tier;
      expect([1, 2, 3]).toContain(tier);
    }
  });
});

// ── VehicleDef.nameKey ────────────────────────────────────────────────────────

describe('VehicleDef.nameKey', () => {
  it('debris_hauler def has a non-empty nameKey string', () => {
    expect(getVehicleDef('debris_hauler').nameKey).toBeTypeOf('string');
    expect(getVehicleDef('debris_hauler').nameKey.length).toBeGreaterThan(0);
  });

  it('rock_digger def has a non-empty nameKey string', () => {
    expect(getVehicleDef('rock_digger').nameKey).toBeTypeOf('string');
    expect(getVehicleDef('rock_digger').nameKey.length).toBeGreaterThan(0);
  });

  it('drill_rig def has a non-empty nameKey string', () => {
    expect(getVehicleDef('drill_rig').nameKey).toBeTypeOf('string');
    expect(getVehicleDef('drill_rig').nameKey.length).toBeGreaterThan(0);
  });

  it('building_destroyer def has a non-empty nameKey string', () => {
    expect(getVehicleDef('building_destroyer').nameKey).toBeTypeOf('string');
    expect(getVehicleDef('building_destroyer').nameKey.length).toBeGreaterThan(0);
  });

  it('rock_fragmenter def has a non-empty nameKey string', () => {
    expect(getVehicleDef('rock_fragmenter').nameKey).toBeTypeOf('string');
    expect(getVehicleDef('rock_fragmenter').nameKey.length).toBeGreaterThan(0);
  });

  it('every role def nameKey starts with "vehicle."', () => {
    const roles: VehicleRole[] = getAllVehicleRoles();
    for (const role of roles) {
      expect(getVehicleDef(role).nameKey).toMatch(/^vehicle\./);
    }
  });
});

// ── VehicleDef.workRate ───────────────────────────────────────────────────────

describe('VehicleDef.workRate', () => {
  it('debris_hauler def has a workRate greater than 0', () => {
    expect(getVehicleDef('debris_hauler').workRate).toBeGreaterThan(0);
  });

  it('rock_digger def has a workRate greater than 0', () => {
    expect(getVehicleDef('rock_digger').workRate).toBeGreaterThan(0);
  });

  it('drill_rig def has a workRate greater than 0', () => {
    expect(getVehicleDef('drill_rig').workRate).toBeGreaterThan(0);
  });

  it('building_destroyer def has a workRate greater than 0', () => {
    expect(getVehicleDef('building_destroyer').workRate).toBeGreaterThan(0);
  });

  it('rock_fragmenter def has a workRate greater than 0', () => {
    expect(getVehicleDef('rock_fragmenter').workRate).toBeGreaterThan(0);
  });

  it('every role def has a workRate that is a finite positive number', () => {
    const roles: VehicleRole[] = getAllVehicleRoles();
    for (const role of roles) {
      const { workRate } = getVehicleDef(role);
      expect(Number.isFinite(workRate)).toBe(true);
      expect(workRate).toBeGreaterThan(0);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TASK 2.3 — getVehicleDefByTier: 15-entry catalog (5 roles × 3 tiers)
// ═════════════════════════════════════════════════════════════════════════════

// Helper constant used across all task-2.3 suites
const ALL_ROLES: VehicleRole[] = [
  'building_destroyer',
  'debris_hauler',
  'drill_rig',
  'rock_digger',
  'rock_fragmenter',
];
const ALL_TIERS: VehicleTier[] = [1, 2, 3];

// ── Catalog completeness ──────────────────────────────────────────────────────

describe('getVehicleDefByTier — catalog completeness (5 roles × 3 tiers = 15 entries)', () => {
  it('all 15 role×tier combinations return a defined, non-null VehicleDef', () => {
    for (const role of ALL_ROLES) {
      for (const tier of ALL_TIERS) {
        expect(getVehicleDefByTier(role, tier)).toBeDefined();
      }
    }
  });

  it('getVehicleDefByTier(role, 1) returns a def with tier field equal to 1 for every role', () => {
    for (const role of ALL_ROLES) {
      expect(getVehicleDefByTier(role, 1).tier).toBe(1);
    }
  });

  it('getVehicleDefByTier(role, 2) returns a def with tier field equal to 2 for every role', () => {
    for (const role of ALL_ROLES) {
      expect(getVehicleDefByTier(role, 2).tier).toBe(2);
    }
  });

  it('getVehicleDefByTier(role, 3) returns a def with tier field equal to 3 for every role', () => {
    for (const role of ALL_ROLES) {
      expect(getVehicleDefByTier(role, 3).tier).toBe(3);
    }
  });

  it('getVehicleDefByTier(role, tier) type field equals the requested role for every combination', () => {
    for (const role of ALL_ROLES) {
      for (const tier of ALL_TIERS) {
        expect(getVehicleDefByTier(role, tier).type).toBe(role);
      }
    }
  });
});

// ── Tier 1 backward compatibility ─────────────────────────────────────────────

describe('getVehicleDefByTier — tier 1 is consistent with getVehicleDef (backward compat)', () => {
  it('building_destroyer tier 1 stats match getVehicleDef("building_destroyer")', () => {
    const byTier = getVehicleDefByTier('building_destroyer', 1);
    const legacy = getVehicleDef('building_destroyer');
    expect(byTier.speed).toBe(legacy.speed);
    expect(byTier.capacity).toBe(legacy.capacity);
    expect(byTier.workRate).toBe(legacy.workRate);
    expect(byTier.maxHp).toBe(legacy.maxHp);
    expect(byTier.purchaseCost).toBe(legacy.purchaseCost);
    expect(byTier.maintenanceCostPerTick).toBe(legacy.maintenanceCostPerTick);
  });

  it('debris_hauler tier 1 stats match getVehicleDef("debris_hauler")', () => {
    const byTier = getVehicleDefByTier('debris_hauler', 1);
    const legacy = getVehicleDef('debris_hauler');
    expect(byTier.speed).toBe(legacy.speed);
    expect(byTier.capacity).toBe(legacy.capacity);
    expect(byTier.workRate).toBe(legacy.workRate);
    expect(byTier.maxHp).toBe(legacy.maxHp);
    expect(byTier.purchaseCost).toBe(legacy.purchaseCost);
    expect(byTier.maintenanceCostPerTick).toBe(legacy.maintenanceCostPerTick);
  });

  it('drill_rig tier 1 stats match getVehicleDef("drill_rig")', () => {
    const byTier = getVehicleDefByTier('drill_rig', 1);
    const legacy = getVehicleDef('drill_rig');
    expect(byTier.speed).toBe(legacy.speed);
    expect(byTier.capacity).toBe(legacy.capacity);
    expect(byTier.workRate).toBe(legacy.workRate);
    expect(byTier.maxHp).toBe(legacy.maxHp);
    expect(byTier.purchaseCost).toBe(legacy.purchaseCost);
    expect(byTier.maintenanceCostPerTick).toBe(legacy.maintenanceCostPerTick);
  });

  it('rock_digger tier 1 stats match getVehicleDef("rock_digger")', () => {
    const byTier = getVehicleDefByTier('rock_digger', 1);
    const legacy = getVehicleDef('rock_digger');
    expect(byTier.speed).toBe(legacy.speed);
    expect(byTier.capacity).toBe(legacy.capacity);
    expect(byTier.workRate).toBe(legacy.workRate);
    expect(byTier.maxHp).toBe(legacy.maxHp);
    expect(byTier.purchaseCost).toBe(legacy.purchaseCost);
    expect(byTier.maintenanceCostPerTick).toBe(legacy.maintenanceCostPerTick);
  });

  it('rock_fragmenter tier 1 stats match getVehicleDef("rock_fragmenter")', () => {
    const byTier = getVehicleDefByTier('rock_fragmenter', 1);
    const legacy = getVehicleDef('rock_fragmenter');
    expect(byTier.speed).toBe(legacy.speed);
    expect(byTier.capacity).toBe(legacy.capacity);
    expect(byTier.workRate).toBe(legacy.workRate);
    expect(byTier.maxHp).toBe(legacy.maxHp);
    expect(byTier.purchaseCost).toBe(legacy.purchaseCost);
    expect(byTier.maintenanceCostPerTick).toBe(legacy.maintenanceCostPerTick);
  });
});

// ── nameKey pattern: vehicle.<role>.tier<N> ───────────────────────────────────

describe('getVehicleDefByTier — nameKey follows "vehicle.<role>.tier<N>" pattern', () => {
  it('all 15 defs have a nameKey matching /^vehicle\\.[a-z_]+\\.tier[123]$/', () => {
    for (const role of ALL_ROLES) {
      for (const tier of ALL_TIERS) {
        expect(getVehicleDefByTier(role, tier).nameKey).toMatch(
          /^vehicle\.[a-z_]+\.tier[123]$/,
        );
      }
    }
  });

  it('debris_hauler tier 1 nameKey is exactly "vehicle.debris_hauler.tier1"', () => {
    expect(getVehicleDefByTier('debris_hauler', 1).nameKey).toBe('vehicle.debris_hauler.tier1');
  });

  it('debris_hauler tier 2 nameKey is exactly "vehicle.debris_hauler.tier2"', () => {
    expect(getVehicleDefByTier('debris_hauler', 2).nameKey).toBe('vehicle.debris_hauler.tier2');
  });

  it('debris_hauler tier 3 nameKey is exactly "vehicle.debris_hauler.tier3"', () => {
    expect(getVehicleDefByTier('debris_hauler', 3).nameKey).toBe('vehicle.debris_hauler.tier3');
  });

  it('rock_digger tier 2 nameKey is exactly "vehicle.rock_digger.tier2"', () => {
    expect(getVehicleDefByTier('rock_digger', 2).nameKey).toBe('vehicle.rock_digger.tier2');
  });

  it('rock_digger tier 3 nameKey is exactly "vehicle.rock_digger.tier3"', () => {
    expect(getVehicleDefByTier('rock_digger', 3).nameKey).toBe('vehicle.rock_digger.tier3');
  });

  it('drill_rig tier 2 nameKey is exactly "vehicle.drill_rig.tier2"', () => {
    expect(getVehicleDefByTier('drill_rig', 2).nameKey).toBe('vehicle.drill_rig.tier2');
  });

  it('drill_rig tier 3 nameKey is exactly "vehicle.drill_rig.tier3"', () => {
    expect(getVehicleDefByTier('drill_rig', 3).nameKey).toBe('vehicle.drill_rig.tier3');
  });

  it('building_destroyer tier 2 nameKey is exactly "vehicle.building_destroyer.tier2"', () => {
    expect(getVehicleDefByTier('building_destroyer', 2).nameKey).toBe(
      'vehicle.building_destroyer.tier2',
    );
  });

  it('building_destroyer tier 3 nameKey is exactly "vehicle.building_destroyer.tier3"', () => {
    expect(getVehicleDefByTier('building_destroyer', 3).nameKey).toBe(
      'vehicle.building_destroyer.tier3',
    );
  });

  it('rock_fragmenter tier 2 nameKey is exactly "vehicle.rock_fragmenter.tier2"', () => {
    expect(getVehicleDefByTier('rock_fragmenter', 2).nameKey).toBe(
      'vehicle.rock_fragmenter.tier2',
    );
  });

  it('rock_fragmenter tier 3 nameKey is exactly "vehicle.rock_fragmenter.tier3"', () => {
    expect(getVehicleDefByTier('rock_fragmenter', 3).nameKey).toBe(
      'vehicle.rock_fragmenter.tier3',
    );
  });
});

// ── Tier 2 stat multipliers ───────────────────────────────────────────────────

describe('getVehicleDefByTier — tier 2 applies ×1.3 speed multiplier', () => {
  it('tier 2 speed is approximately tier 1 speed × 1.3 for every role', () => {
    for (const role of ALL_ROLES) {
      const t1 = getVehicleDefByTier(role, 1);
      const t2 = getVehicleDefByTier(role, 2);
      expect(t2.speed).toBeCloseTo(t1.speed * 1.3, 5);
    }
  });
});

describe('getVehicleDefByTier — tier 2 applies ×1.6 capacity multiplier', () => {
  it('tier 2 capacity is approximately tier 1 capacity × 1.6 for every role', () => {
    for (const role of ALL_ROLES) {
      const t1 = getVehicleDefByTier(role, 1);
      const t2 = getVehicleDefByTier(role, 2);
      expect(t2.capacity).toBeCloseTo(t1.capacity * 1.6, 5);
    }
  });
});

describe('getVehicleDefByTier — tier 2 applies ×1.4 workRate multiplier', () => {
  it('tier 2 workRate is approximately tier 1 workRate × 1.4 for every role', () => {
    for (const role of ALL_ROLES) {
      const t1 = getVehicleDefByTier(role, 1);
      const t2 = getVehicleDefByTier(role, 2);
      expect(t2.workRate).toBeCloseTo(t1.workRate * 1.4, 5);
    }
  });
});

describe('getVehicleDefByTier — tier 2 applies ×1.5 maxHp multiplier', () => {
  it('tier 2 maxHp is approximately tier 1 maxHp × 1.5 for every role', () => {
    for (const role of ALL_ROLES) {
      const t1 = getVehicleDefByTier(role, 1);
      const t2 = getVehicleDefByTier(role, 2);
      expect(t2.maxHp).toBeCloseTo(t1.maxHp * 1.5, 5);
    }
  });
});

describe('getVehicleDefByTier — tier 2 applies ×1.4 maintenanceCostPerTick multiplier', () => {
  it('tier 2 maintenanceCostPerTick is approximately tier 1 × 1.4 for every role', () => {
    for (const role of ALL_ROLES) {
      const t1 = getVehicleDefByTier(role, 1);
      const t2 = getVehicleDefByTier(role, 2);
      expect(t2.maintenanceCostPerTick).toBeCloseTo(t1.maintenanceCostPerTick * 1.4, 5);
    }
  });
});

// ── Tier 3 stat multipliers ───────────────────────────────────────────────────

describe('getVehicleDefByTier — tier 3 applies ×1.8 speed multiplier', () => {
  it('tier 3 speed is approximately tier 1 speed × 1.8 for every role', () => {
    for (const role of ALL_ROLES) {
      const t1 = getVehicleDefByTier(role, 1);
      const t3 = getVehicleDefByTier(role, 3);
      expect(t3.speed).toBeCloseTo(t1.speed * 1.8, 5);
    }
  });
});

describe('getVehicleDefByTier — tier 3 applies ×2.5 capacity multiplier', () => {
  it('tier 3 capacity is approximately tier 1 capacity × 2.5 for every role', () => {
    for (const role of ALL_ROLES) {
      const t1 = getVehicleDefByTier(role, 1);
      const t3 = getVehicleDefByTier(role, 3);
      expect(t3.capacity).toBeCloseTo(t1.capacity * 2.5, 5);
    }
  });
});

describe('getVehicleDefByTier — tier 3 applies ×2.0 workRate multiplier', () => {
  it('tier 3 workRate is approximately tier 1 workRate × 2.0 for every role', () => {
    for (const role of ALL_ROLES) {
      const t1 = getVehicleDefByTier(role, 1);
      const t3 = getVehicleDefByTier(role, 3);
      expect(t3.workRate).toBeCloseTo(t1.workRate * 2.0, 5);
    }
  });
});

describe('getVehicleDefByTier — tier 3 applies ×2.2 maxHp multiplier', () => {
  it('tier 3 maxHp is approximately tier 1 maxHp × 2.2 for every role', () => {
    for (const role of ALL_ROLES) {
      const t1 = getVehicleDefByTier(role, 1);
      const t3 = getVehicleDefByTier(role, 3);
      expect(t3.maxHp).toBeCloseTo(t1.maxHp * 2.2, 5);
    }
  });
});

describe('getVehicleDefByTier — tier 3 applies ×2.0 maintenanceCostPerTick multiplier', () => {
  it('tier 3 maintenanceCostPerTick is approximately tier 1 × 2.0 for every role', () => {
    for (const role of ALL_ROLES) {
      const t1 = getVehicleDefByTier(role, 1);
      const t3 = getVehicleDefByTier(role, 3);
      expect(t3.maintenanceCostPerTick).toBeCloseTo(t1.maintenanceCostPerTick * 2.0, 5);
    }
  });
});

// ── purchaseCost multipliers — per role (constraints 8 & 9) ──────────────────

describe('getVehicleDefByTier — tier 2 purchaseCost = tier 1 purchaseCost × 2.0 (per role)', () => {
  it('debris_hauler tier 2 purchaseCost equals tier 1 purchaseCost × 2.0', () => {
    const t1 = getVehicleDefByTier('debris_hauler', 1);
    const t2 = getVehicleDefByTier('debris_hauler', 2);
    expect(t2.purchaseCost).toBeCloseTo(t1.purchaseCost * 2.0, 5);
  });

  it('rock_digger tier 2 purchaseCost equals tier 1 purchaseCost × 2.0', () => {
    const t1 = getVehicleDefByTier('rock_digger', 1);
    const t2 = getVehicleDefByTier('rock_digger', 2);
    expect(t2.purchaseCost).toBeCloseTo(t1.purchaseCost * 2.0, 5);
  });

  it('drill_rig tier 2 purchaseCost equals tier 1 purchaseCost × 2.0', () => {
    const t1 = getVehicleDefByTier('drill_rig', 1);
    const t2 = getVehicleDefByTier('drill_rig', 2);
    expect(t2.purchaseCost).toBeCloseTo(t1.purchaseCost * 2.0, 5);
  });

  it('building_destroyer tier 2 purchaseCost equals tier 1 purchaseCost × 2.0', () => {
    const t1 = getVehicleDefByTier('building_destroyer', 1);
    const t2 = getVehicleDefByTier('building_destroyer', 2);
    expect(t2.purchaseCost).toBeCloseTo(t1.purchaseCost * 2.0, 5);
  });

  it('rock_fragmenter tier 2 purchaseCost equals tier 1 purchaseCost × 2.0', () => {
    const t1 = getVehicleDefByTier('rock_fragmenter', 1);
    const t2 = getVehicleDefByTier('rock_fragmenter', 2);
    expect(t2.purchaseCost).toBeCloseTo(t1.purchaseCost * 2.0, 5);
  });
});

describe('getVehicleDefByTier — tier 3 purchaseCost = tier 1 purchaseCost × 4.0 (per role)', () => {
  it('debris_hauler tier 3 purchaseCost equals tier 1 purchaseCost × 4.0', () => {
    const t1 = getVehicleDefByTier('debris_hauler', 1);
    const t3 = getVehicleDefByTier('debris_hauler', 3);
    expect(t3.purchaseCost).toBeCloseTo(t1.purchaseCost * 4.0, 5);
  });

  it('rock_digger tier 3 purchaseCost equals tier 1 purchaseCost × 4.0', () => {
    const t1 = getVehicleDefByTier('rock_digger', 1);
    const t3 = getVehicleDefByTier('rock_digger', 3);
    expect(t3.purchaseCost).toBeCloseTo(t1.purchaseCost * 4.0, 5);
  });

  it('drill_rig tier 3 purchaseCost equals tier 1 purchaseCost × 4.0', () => {
    const t1 = getVehicleDefByTier('drill_rig', 1);
    const t3 = getVehicleDefByTier('drill_rig', 3);
    expect(t3.purchaseCost).toBeCloseTo(t1.purchaseCost * 4.0, 5);
  });

  it('building_destroyer tier 3 purchaseCost equals tier 1 purchaseCost × 4.0', () => {
    const t1 = getVehicleDefByTier('building_destroyer', 1);
    const t3 = getVehicleDefByTier('building_destroyer', 3);
    expect(t3.purchaseCost).toBeCloseTo(t1.purchaseCost * 4.0, 5);
  });

  it('rock_fragmenter tier 3 purchaseCost equals tier 1 purchaseCost × 4.0', () => {
    const t1 = getVehicleDefByTier('rock_fragmenter', 1);
    const t3 = getVehicleDefByTier('rock_fragmenter', 3);
    expect(t3.purchaseCost).toBeCloseTo(t1.purchaseCost * 4.0, 5);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TASK 2.5 — Vehicle interface fields: driverId, state, payloadKg, targetX/Z
// ═════════════════════════════════════════════════════════════════════════════

// ── Vehicle interface fields ──────────────────────────────────────────────────

describe('Vehicle interface fields', () => {
  it('newly purchased vehicle has driverId initialised to null (unassigned)', () => {
    // driverId: number | null — null means no driver is currently assigned.
    // Fails (Red) until Vehicle interface adds driverId and purchaseVehicle() sets it to null.
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    expect(vehicle.driverId).toBeNull();
  });

  it('driverId is null for every vehicle role immediately after purchase', () => {
    // Exhaustively checks every role so no role-specific initialisation path is missed.
    const vs = createVehicleState();
    for (const role of ALL_ROLES) {
      const { vehicle } = purchaseVehicle(vs, role);
      expect(vehicle.driverId).toBeNull();
    }
  });

  it('newly purchased vehicle has state initialised to "idle"', () => {
    // state: VehicleOperationalState — must be 'idle' on a fresh vehicle with no assigned work.
    // Fails (Red) until Vehicle interface adds state and purchaseVehicle() sets it to 'idle'.
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'rock_digger');
    expect(vehicle.state).toBe('idle');
  });

  it('state is "idle" for every vehicle role immediately after purchase', () => {
    // Exhaustively checks every role so no role-specific initialisation path is missed.
    const vs = createVehicleState();
    for (const role of ALL_ROLES) {
      const { vehicle } = purchaseVehicle(vs, role);
      expect(vehicle.state).toBe('idle');
    }
  });

  it('newly purchased vehicle has payloadKg initialised to 0', () => {
    // payloadKg: number — 0 means the vehicle is carrying nothing when first purchased.
    // Fails (Red) until Vehicle interface adds payloadKg and purchaseVehicle() sets it to 0.
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    expect(vehicle.payloadKg).toBe(0);
  });

  it('payloadKg is 0 for every vehicle role immediately after purchase', () => {
    // Exhaustively checks every role so no role-specific initialisation path is missed.
    const vs = createVehicleState();
    for (const role of ALL_ROLES) {
      const { vehicle } = purchaseVehicle(vs, role);
      expect(vehicle.payloadKg).toBe(0);
    }
  });

  it('newly purchased vehicle has payloadKg that is a non-negative finite number', () => {
    // Guards against -0, NaN, Infinity being used as the zero payload sentinel.
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'rock_fragmenter');
    expect(vehicle.payloadKg).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(vehicle.payloadKg)).toBe(true);
  });

  it('targetX equals the x coordinate passed to purchaseVehicle (confirmatory)', () => {
    // targetX already exists on Vehicle; confirms it is initialised to the spawn position.
    // This test passes today and must continue to pass after task-2.5 changes land.
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'drill_rig', 7, 3);
    expect(vehicle.targetX).toBe(7);
  });

  it('targetZ equals the z coordinate passed to purchaseVehicle (confirmatory)', () => {
    // targetZ already exists on Vehicle; confirms it is initialised to the spawn position.
    // This test passes today and must continue to pass after task-2.5 changes land.
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'building_destroyer', 2, 11);
    expect(vehicle.targetZ).toBe(11);
  });

  it('targetX and targetZ both equal the spawn coordinates when x and z differ (confirmatory)', () => {
    // Ensures neither axis is accidentally cross-assigned (x→targetZ or z→targetX).
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'rock_digger', 4, 9);
    expect(vehicle.targetX).toBe(4);
    expect(vehicle.targetZ).toBe(9);
  });
});

// ── Vehicle.state field ───────────────────────────────────────────────────────

describe('Vehicle.state field', () => {
  // Each test uses the `satisfies` operator to express a compile-time constraint:
  // vehicle.state must be typed as VehicleOperationalState on the Vehicle interface.
  // At runtime these also fail (Red) because purchaseVehicle() does not yet initialise
  // vehicle.state, leaving it undefined — which does not satisfy any of the checks below.

  it('Vehicle.state field holds "idle" after purchase — satisfies VehicleOperationalState', () => {
    // Both a runtime assertion (state === 'idle') and a type-level annotation.
    // Fails (Red) until Vehicle.state is added to the interface and set to 'idle' in purchaseVehicle().
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    const s = (vehicle.state satisfies VehicleOperationalState);
    expect(s).toBe('idle' satisfies VehicleOperationalState);
  });

  it('Vehicle.state field is defined immediately after purchase', () => {
    // A field that is not initialised by purchaseVehicle() will be undefined.
    // Fails (Red) until purchaseVehicle() sets vehicle.state to a VehicleOperationalState value.
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'rock_digger');
    expect(vehicle.state).toBeDefined();
  });

  it('"moving" is a valid Vehicle.state value — satisfies VehicleOperationalState', () => {
    // Compile-time: vehicle.state must accept 'moving' without a type error.
    // Runtime: confirms the field exists on a freshly purchased vehicle, then verifies a
    // 'moving' assignment round-trips correctly once the field is present on the interface.
    // Fails (Red) because vehicle.state is undefined until purchaseVehicle() initialises it.
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    expect(vehicle.state).toBeDefined(); // fails red — field not yet initialised
    vehicle.state = ('moving' satisfies VehicleOperationalState);
    expect(vehicle.state satisfies VehicleOperationalState).toBe('moving');
  });

  it('"working" is a valid Vehicle.state value — satisfies VehicleOperationalState', () => {
    // Same pattern as "moving": verifies the field is defined before mutating it.
    // Fails (Red) because vehicle.state is undefined until purchaseVehicle() initialises it.
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'drill_rig');
    expect(vehicle.state).toBeDefined(); // fails red — field not yet initialised
    vehicle.state = ('working' satisfies VehicleOperationalState);
    expect(vehicle.state satisfies VehicleOperationalState).toBe('working');
  });

  it('"waiting" is a valid Vehicle.state value — satisfies VehicleOperationalState', () => {
    // Same pattern as "moving": verifies the field is defined before mutating it.
    // Fails (Red) because vehicle.state is undefined until purchaseVehicle() initialises it.
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'rock_fragmenter');
    expect(vehicle.state).toBeDefined(); // fails red — field not yet initialised
    vehicle.state = ('waiting' satisfies VehicleOperationalState);
    expect(vehicle.state satisfies VehicleOperationalState).toBe('waiting');
  });

  it('"broken" is a valid Vehicle.state value — satisfies VehicleOperationalState', () => {
    // Same pattern as "moving": verifies the field is defined before mutating it.
    // Fails (Red) because vehicle.state is undefined until purchaseVehicle() initialises it.
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'building_destroyer');
    expect(vehicle.state).toBeDefined(); // fails red — field not yet initialised
    vehicle.state = ('broken' satisfies VehicleOperationalState);
    expect(vehicle.state satisfies VehicleOperationalState).toBe('broken');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TASK 2.6 — assignDriver(): validate employee licence for vehicle role
// ═════════════════════════════════════════════════════════════════════════════
//
// WHY THESE TESTS FAIL (Red phase):
//   `assignDriver` is not yet exported from Vehicle.ts.  When the module is
//   imported the named export resolves to `undefined`.  Every test that calls
//   `assignDriver(...)` therefore throws "TypeError: assignDriver is not a
//   function".  No implementation changes should be made here — all changes go
//   in src/core/entities/Vehicle.ts.
//
// Licence mapping under test (VehicleRole → required SkillCategory):
//   debris_hauler      → driving.truck
//   building_destroyer → driving.truck
//   rock_digger        → driving.excavator
//   rock_fragmenter    → driving.excavator
//   drill_rig          → driving.drill_rig

// ── Fixture helpers ───────────────────────────────────────────────────────────

/** Deterministic seed used for all task-2.6 RNG calls. */
const ASSIGN_DRIVER_SEED = 42;

/**
 * Creates a minimal, self-consistent test fixture:
 *   - One VehicleState containing exactly one purchased vehicle of `vehicleRole`.
 *   - One EmployeeState containing exactly one alive 'driver' employee.
 *   - If `licenceCategory` is provided, the employee is given that skill at
 *     proficiency level 1 via assignSkill().  If omitted, the employee has no
 *     qualifications at all.
 *
 * Returns the states plus the IDs needed by assignDriver().
 */
function makeDriverFixture(
  vehicleRole: VehicleRole,
  licenceCategory?: string,
): { vs: ReturnType<typeof createVehicleState>; es: ReturnType<typeof createEmployeeState>; vehicleId: number; empId: number } {
  const vs = createVehicleState();
  const { vehicle } = purchaseVehicle(vs, vehicleRole);

  const es = createEmployeeState();
  const rng = new Random(ASSIGN_DRIVER_SEED);
  const { employee } = hireEmployee(es, 'driver', rng);

  if (licenceCategory !== undefined) {
    assignSkill(es, employee.id, licenceCategory as SkillCategory, 1);
  }

  return { vs, es, vehicleId: vehicle.id, empId: employee.id };
}

/**
 * Same as makeDriverFixture but places the employee as `driverId` on a
 * *second* vehicle in the fleet, simulating an existing driver assignment
 * without calling assignDriver() itself.  The first vehicle (the target) has
 * no driver so only the "already driving" rule fires.
 */
function makeAlreadyDrivingFixture(
  targetRole: VehicleRole,
  licenceCategory: string,
): { vs: ReturnType<typeof createVehicleState>; es: ReturnType<typeof createEmployeeState>; vehicleId: number; empId: number } {
  const { vs, es, vehicleId, empId } = makeDriverFixture(targetRole, licenceCategory);

  // Purchase a second vehicle of any role and directly assign our employee
  // as its driver — bypassing assignDriver() to set up the precondition.
  const { vehicle: otherVehicle } = purchaseVehicle(vs, 'debris_hauler');
  otherVehicle.driverId = empId;

  return { vs, es, vehicleId, empId };
}

/**
 * Same as makeDriverFixture but the target vehicle already has a driver
 * (driverId set to a placeholder id 999), simulating a pre-occupied vehicle.
 * The incoming employee is fully qualified so only the "vehicle taken" rule fires.
 */
function makeVehicleTakenFixture(
  vehicleRole: VehicleRole,
  licenceCategory: string,
): { vs: ReturnType<typeof createVehicleState>; es: ReturnType<typeof createEmployeeState>; vehicleId: number; empId: number; originalDriverId: number } {
  const { vs, es, vehicleId, empId } = makeDriverFixture(vehicleRole, licenceCategory);

  // Directly set a pre-existing driver on the vehicle.
  const vehicle = vs.vehicles.find(v => v.id === vehicleId)!;
  const originalDriverId = 999;
  vehicle.driverId = originalDriverId;

  return { vs, es, vehicleId, empId, originalDriverId };
}

// ── Happy path — qualified driver successfully assigned ───────────────────────

describe('assignDriver — happy path: debris_hauler requires driving.truck', () => {
  it('returns { success: true } when employee holds driving.truck licence', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(true);
  });

  it('sets vehicle.driverId to the employee id on success', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    assignDriver(vs, es, vehicleId, empId);
    const vehicle = vs.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.driverId).toBe(empId);
  });

  it('returns no error property on success (error is undefined)', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.error).toBeUndefined();
  });
});

describe('assignDriver — happy path: building_destroyer requires driving.truck', () => {
  it('returns { success: true } when employee holds driving.truck licence', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('building_destroyer', 'driving.truck');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(true);
  });

  it('sets vehicle.driverId to the employee id on success', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('building_destroyer', 'driving.truck');
    assignDriver(vs, es, vehicleId, empId);
    const vehicle = vs.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.driverId).toBe(empId);
  });
});

describe('assignDriver — happy path: rock_digger requires driving.excavator', () => {
  it('returns { success: true } when employee holds driving.excavator licence', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('rock_digger', 'driving.excavator');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(true);
  });

  it('sets vehicle.driverId to the employee id on success', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('rock_digger', 'driving.excavator');
    assignDriver(vs, es, vehicleId, empId);
    const vehicle = vs.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.driverId).toBe(empId);
  });
});

describe('assignDriver — happy path: rock_fragmenter requires driving.excavator', () => {
  it('returns { success: true } when employee holds driving.excavator licence', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('rock_fragmenter', 'driving.excavator');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(true);
  });

  it('sets vehicle.driverId to the employee id on success', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('rock_fragmenter', 'driving.excavator');
    assignDriver(vs, es, vehicleId, empId);
    const vehicle = vs.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.driverId).toBe(empId);
  });
});

describe('assignDriver — happy path: drill_rig requires driving.drill_rig', () => {
  it('returns { success: true } when employee holds driving.drill_rig licence', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('drill_rig', 'driving.drill_rig');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(true);
  });

  it('sets vehicle.driverId to the employee id on success', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('drill_rig', 'driving.drill_rig');
    assignDriver(vs, es, vehicleId, empId);
    const vehicle = vs.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.driverId).toBe(empId);
  });
});

describe('assignDriver — happy path: higher proficiency level still qualifies', () => {
  it('employee with proficiencyLevel 3 for driving.truck can drive a debris_hauler', () => {
    // Any proficiency level in the right category grants the licence — level does not gate access.
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    const es = createEmployeeState();
    const rng = new Random(ASSIGN_DRIVER_SEED);
    const { employee } = hireEmployee(es, 'driver', rng);
    assignSkill(es, employee.id, 'driving.truck' as SkillCategory, 3);

    const result = assignDriver(vs, es, vehicle.id, employee.id);
    expect(result.success).toBe(true);
    expect(vs.vehicles.find(v => v.id === vehicle.id)!.driverId).toBe(employee.id);
  });

  it('employee with proficiencyLevel 5 for driving.drill_rig can drive a drill_rig', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'drill_rig');
    const es = createEmployeeState();
    const rng = new Random(ASSIGN_DRIVER_SEED + 1);
    const { employee } = hireEmployee(es, 'driver', rng);
    assignSkill(es, employee.id, 'driving.drill_rig' as SkillCategory, 5);

    const result = assignDriver(vs, es, vehicle.id, employee.id);
    expect(result.success).toBe(true);
  });
});

// ── Error: vehicle not found ──────────────────────────────────────────────────

describe('assignDriver — error: vehicle not found', () => {
  it('returns { success: false } when vehicleId does not exist in the fleet', () => {
    const vs = createVehicleState();
    const es = createEmployeeState();
    const rng = new Random(ASSIGN_DRIVER_SEED);
    const { employee } = hireEmployee(es, 'driver', rng);
    assignSkill(es, employee.id, 'driving.truck' as SkillCategory, 1);

    const result = assignDriver(vs, es, 9999, employee.id);
    expect(result.success).toBe(false);
  });

  it('error message is exactly "Vehicle not found" when vehicleId is absent', () => {
    const vs = createVehicleState();
    const es = createEmployeeState();
    const rng = new Random(ASSIGN_DRIVER_SEED);
    const { employee } = hireEmployee(es, 'driver', rng);

    const result = assignDriver(vs, es, 9999, employee.id);
    expect(result.error).toBe('Vehicle not found');
  });

  it('fleet vehicles array is unchanged after a vehicle-not-found failure', () => {
    // No vehicles purchased — fleet stays empty.
    const vs = createVehicleState();
    const es = createEmployeeState();
    const rng = new Random(ASSIGN_DRIVER_SEED);
    const { employee } = hireEmployee(es, 'driver', rng);

    assignDriver(vs, es, 9999, employee.id);
    expect(vs.vehicles).toHaveLength(0);
  });
});

// ── Error: employee not found ─────────────────────────────────────────────────

describe('assignDriver — error: employee not found', () => {
  it('returns { success: false } when employeeId does not exist in employee state', () => {
    const { vs, es, vehicleId } = makeDriverFixture('debris_hauler', 'driving.truck');
    const result = assignDriver(vs, es, vehicleId, 9999);
    expect(result.success).toBe(false);
  });

  it('error message is exactly "Employee not found" when employeeId is absent', () => {
    const { vs, es, vehicleId } = makeDriverFixture('debris_hauler', 'driving.truck');
    const result = assignDriver(vs, es, vehicleId, 9999);
    expect(result.error).toBe('Employee not found');
  });

  it('vehicle.driverId stays null after an employee-not-found failure', () => {
    const { vs, es, vehicleId } = makeDriverFixture('debris_hauler', 'driving.truck');
    assignDriver(vs, es, vehicleId, 9999);
    const vehicle = vs.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.driverId).toBeNull();
  });
});

// ── Error: employee not alive (killed) ────────────────────────────────────────

describe('assignDriver — error: employee not alive', () => {
  it('returns { success: false } when the employee exists but alive is false', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    killEmployee(es, empId); // sets alive: false
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('error message is "Employee not found" for a dead employee (not alive ≡ not found)', () => {
    // Rule 2 collapses "not found" and "not alive" into a single error string.
    const { vs, es, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    killEmployee(es, empId);
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.error).toBe('Employee not found');
  });

  it('vehicle.driverId stays null after a dead-employee failure', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('rock_digger', 'driving.excavator');
    killEmployee(es, empId);
    assignDriver(vs, es, vehicleId, empId);
    const vehicle = vs.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.driverId).toBeNull();
  });
});

// ── Error: employee lacks licence — no qualifications ─────────────────────────

describe('assignDriver — error: employee lacks licence (no qualifications at all)', () => {
  it('debris_hauler: employee with zero qualifications → { success: false }', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('debris_hauler');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('building_destroyer: employee with zero qualifications → { success: false }', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('building_destroyer');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('rock_digger: employee with zero qualifications → { success: false }', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('rock_digger');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('rock_fragmenter: employee with zero qualifications → { success: false }', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('rock_fragmenter');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('drill_rig: employee with zero qualifications → { success: false }', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('drill_rig');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('error message is exactly "Employee lacks licence for this role"', () => {
    // Use drill_rig as a representative case.
    const { vs, es, vehicleId, empId } = makeDriverFixture('drill_rig');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.error).toBe('Employee lacks licence for this role');
  });

  it('vehicle.driverId stays null after a no-licence failure', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('debris_hauler');
    assignDriver(vs, es, vehicleId, empId);
    const vehicle = vs.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.driverId).toBeNull();
  });
});

// ── Error: wrong licence (cross-role mismatch) ────────────────────────────────
//
// Each test ensures a driving licence for one category is *not* accepted as a
// substitute for a different required category.  All five licence slots are
// exercised so that every mapping edge is independently confirmed.

describe('assignDriver — error: wrong licence (cross-role mismatch)', () => {
  it('debris_hauler needs driving.truck; employee with only driving.excavator is rejected', () => {
    // debris_hauler requires driving.truck — driving.excavator must not count.
    const { vs, es, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.excavator');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Employee lacks licence for this role');
  });

  it('building_destroyer needs driving.truck; employee with only driving.drill_rig is rejected', () => {
    // building_destroyer requires driving.truck — driving.drill_rig must not count.
    const { vs, es, vehicleId, empId } = makeDriverFixture('building_destroyer', 'driving.drill_rig');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Employee lacks licence for this role');
  });

  it('rock_digger needs driving.excavator; employee with only driving.truck is rejected', () => {
    // rock_digger requires driving.excavator — driving.truck must not count.
    const { vs, es, vehicleId, empId } = makeDriverFixture('rock_digger', 'driving.truck');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Employee lacks licence for this role');
  });

  it('rock_fragmenter needs driving.excavator; employee with only driving.drill_rig is rejected', () => {
    // rock_fragmenter requires driving.excavator — driving.drill_rig must not count.
    const { vs, es, vehicleId, empId } = makeDriverFixture('rock_fragmenter', 'driving.drill_rig');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Employee lacks licence for this role');
  });

  it('drill_rig needs driving.drill_rig; employee with only driving.truck is rejected', () => {
    // drill_rig requires driving.drill_rig — driving.truck must not count.
    const { vs, es, vehicleId, empId } = makeDriverFixture('drill_rig', 'driving.truck');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Employee lacks licence for this role');
  });

  it('drill_rig needs driving.drill_rig; employee with only driving.excavator is rejected', () => {
    // Covers the remaining excavator → drill_rig mismatch direction.
    const { vs, es, vehicleId, empId } = makeDriverFixture('drill_rig', 'driving.excavator');
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Employee lacks licence for this role');
  });

  it('vehicle.driverId stays null after a wrong-licence failure', () => {
    const { vs, es, vehicleId, empId } = makeDriverFixture('rock_digger', 'driving.truck');
    assignDriver(vs, es, vehicleId, empId);
    const vehicle = vs.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.driverId).toBeNull();
  });
});

// ── Error: employee already driving another vehicle ───────────────────────────

describe('assignDriver — error: employee already driving another vehicle', () => {
  it('returns { success: false } when the employee is driverId on a different vehicle', () => {
    // The employee is fully qualified and the target vehicle has no driver.
    // The only failing condition is that the employee is already assigned elsewhere.
    const { vs, es, vehicleId, empId } = makeAlreadyDrivingFixture(
      'debris_hauler',
      'driving.truck',
    );
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('error message is exactly "Employee already driving another vehicle"', () => {
    const { vs, es, vehicleId, empId } = makeAlreadyDrivingFixture(
      'rock_digger',
      'driving.excavator',
    );
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.error).toBe('Employee already driving another vehicle');
  });

  it('target vehicle.driverId remains null after an already-driving failure', () => {
    // The target vehicle must not receive the driverId when the call fails.
    const { vs, es, vehicleId, empId } = makeAlreadyDrivingFixture(
      'drill_rig',
      'driving.drill_rig',
    );
    assignDriver(vs, es, vehicleId, empId);
    const targetVehicle = vs.vehicles.find(v => v.id === vehicleId)!;
    expect(targetVehicle.driverId).toBeNull();
  });
});

// ── Error: vehicle already has a driver ──────────────────────────────────────

describe('assignDriver — error: vehicle already has a driver', () => {
  it('returns { success: false } when vehicle.driverId is already non-null', () => {
    // The incoming employee is fully qualified and not already driving.
    // The only failing condition is that the target vehicle is already occupied.
    const { vs, es, vehicleId, empId } = makeVehicleTakenFixture(
      'debris_hauler',
      'driving.truck',
    );
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('error message is exactly "Vehicle already has a driver"', () => {
    const { vs, es, vehicleId, empId } = makeVehicleTakenFixture(
      'rock_fragmenter',
      'driving.excavator',
    );
    const result = assignDriver(vs, es, vehicleId, empId);
    expect(result.error).toBe('Vehicle already has a driver');
  });

  it('original driverId is preserved and not overwritten after a vehicle-taken failure', () => {
    // The pre-existing driverId (999) must survive the failed call intact.
    const { vs, es, vehicleId, empId, originalDriverId } = makeVehicleTakenFixture(
      'drill_rig',
      'driving.drill_rig',
    );
    assignDriver(vs, es, vehicleId, empId);
    const vehicle = vs.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.driverId).toBe(originalDriverId);
    // And must definitely not be overwritten with the incoming empId.
    expect(vehicle.driverId).not.toBe(empId);
  });
});
