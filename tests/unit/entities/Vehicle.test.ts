import { describe, it, expect } from 'vitest';
import {
  type VehicleRole,
  type VehicleTier,
  createVehicleState,
  purchaseVehicle,
  destroyVehicle,
  getVehicleCostsPerTick,
  getAllVehicleRoles,
  getVehicleDefByTier,
  computeScrapResidualValue,
  canReleaseDriver,
  getVehicleReservation,
  findVehicleReservedForAction,
  resolveVehicleDriver,
  vehicleRequiredClearanceCells,
} from '../../../src/core/entities/Vehicle.js';
import {
  findBestEvacuationDriver,
  type EvacuationDriverReachabilityCheck,
} from '../../../src/core/entities/VehicleDriverAssignment.js';
import { VEHICLE_TIER_MULTIPLIERS, NAV_CLEARANCE_VEHICLE_CELLS } from '../../../src/core/config/balance.js';
import { board, alight } from '../../../src/core/engine/Mount.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { createGame, type GameState } from '../../../src/core/state/GameState.js';
import { t } from '../../../src/core/i18n/I18n.js';
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
    expect(getVehicleDefByTier('debris_hauler', 1).purchaseCost).toBeGreaterThan(0);
  });

  it('rock_digger has a purchaseCost > 0', () => {
    expect(getVehicleDefByTier('rock_digger', 1).purchaseCost).toBeGreaterThan(0);
  });

  it('drill_rig has a purchaseCost > 0', () => {
    expect(getVehicleDefByTier('drill_rig', 1).purchaseCost).toBeGreaterThan(0);
  });

  it('building_destroyer has a purchaseCost > 0', () => {
    expect(getVehicleDefByTier('building_destroyer', 1).purchaseCost).toBeGreaterThan(0);
  });

  it('rock_fragmenter has a purchaseCost > 0', () => {
    expect(getVehicleDefByTier('rock_fragmenter', 1).purchaseCost).toBeGreaterThan(0);
  });

  it('each VehicleDef carries the matching role in its type field', () => {
    const roles: VehicleRole[] = getAllVehicleRoles();
    for (const role of roles) {
      expect(getVehicleDefByTier(role, 1).type).toBe(role);
    }
  });
});

// ── Purchase ──────────────────────────────────────────────────────────────────

describe('purchaseVehicle', () => {
  it('purchasing a debris_hauler deducts the correct cost and adds it to fleet', () => {
    const state = createVehicleState();
    const { vehicle, cost } = purchaseVehicle(state, 'debris_hauler');

    expect(cost).toBe(getVehicleDefByTier('debris_hauler', 1).purchaseCost);
    expect(state.vehicles).toHaveLength(1);
    expect(vehicle.type).toBe('debris_hauler' satisfies VehicleRole);
  });

  it('purchasing a rock_digger adds it with correct role', () => {
    const state = createVehicleState();
    const { vehicle, cost } = purchaseVehicle(state, 'rock_digger');

    expect(cost).toBe(getVehicleDefByTier('rock_digger', 1).purchaseCost);
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

  it('purchased vehicle starts at the given coordinates', () => {
    const state = createVehicleState();
    const { vehicle } = purchaseVehicle(state, 'debris_hauler', 5, 9);

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
    expect(vehicle.hp).toBe(getVehicleDefByTier('rock_digger', 1).maxHp);
  });
});

// ── assignVehicle (#1138 — deleted) ───────────────────────────────────────────
// assignVehicle() and the VehicleTask/VehicleOperationalState display fields
// it wrote (task, targetX, targetZ, state) are gone from Vehicle entirely —
// see the "Vehicle interface fields (#1138)" describe block below for the
// negative-space assertion that they no longer exist.

// ── Costs per tick ────────────────────────────────────────────────────────────
//
// #1138: "active" (fuel-billing) used to read `v.task !== 'idle'`, written by
// the now-deleted assignVehicle/Locomotion display fields. The skeleton's
// placeholder reads `v.occupantIds.length > 0` instead (flagged
// TODO(#1138) in src) — that over-bills fuel for a vehicle that merely has a
// driver aboard but nothing assigned to do, which the old semantics never
// billed (task stayed 'idle' until actually driven/working). `reserveVehicle`
// writing into `VehicleState.reservations` is the one signal already
// available on `VehicleState` alone (no `employees` needed) that reliably
// means "this vehicle has committed, fuel-consuming work" — every
// vehicle-gated action reserves before it ever starts driving and holds the
// reservation for the whole itinerary (VehicleReservation.ts) — so the tests
// below pin billing to reservation state instead of raw occupancy.

describe('getVehicleCostsPerTick', () => {
  it('idle vehicles incur only maintenance cost (no fuel)', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'debris_hauler');
    purchaseVehicle(state, 'rock_digger');

    const idleCost = getVehicleCostsPerTick(state);
    const expected =
      getVehicleDefByTier('debris_hauler', 1).maintenanceCostPerTick +
      getVehicleDefByTier('rock_digger', 1).maintenanceCostPerTick;

    expect(idleCost).toBe(expected);
  });

  it('a vehicle with a driver aboard but no reservation bills no fuel — occupancy alone is not "active"', () => {
    const state = createVehicleState();
    const { vehicle } = purchaseVehicle(state, 'debris_hauler');
    vehicle.occupantIds = [1]; // driver boarded, nothing assigned to do

    const cost = getVehicleCostsPerTick(state);
    expect(cost).toBe(getVehicleDefByTier('debris_hauler', 1).maintenanceCostPerTick);
  });

  it('a reserved vehicle bills fuel on top of maintenance, even before a driver boards', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'debris_hauler');
    purchaseVehicle(state, 'rock_digger');

    const baseCost =
      getVehicleDefByTier('debris_hauler', 1).maintenanceCostPerTick +
      getVehicleDefByTier('rock_digger', 1).maintenanceCostPerTick;

    reserveVehicle(state, state.vehicles[0]!.id, 42);

    const activeCost = getVehicleCostsPerTick(state);
    expect(activeCost).toBe(baseCost + getVehicleDefByTier('debris_hauler', 1).fuelCostPerTick);
  });

  it('empty fleet has zero cost per tick', () => {
    const state = createVehicleState();
    expect(getVehicleCostsPerTick(state)).toBe(0);
  });

  // ── Tier-correct billing (#1092) ──────────────────────────────────────────
  // getVehicleCostsPerTick used to read the untiered getVehicleDef(v.type),
  // always billing tier-1 rates regardless of the vehicle's own tier. A
  // tier-2/tier-3 vehicle's maintenance and fuel must scale by the same
  // VEHICLE_TIER_MULTIPLIERS the rest of the catalog (speed, capacity, ...)
  // already applies via getVehicleDefByTier.

  it('an idle tier-2 vehicle bills maintenance at the tier-2 multiplier, not the tier-1 rate', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'rock_digger', 0, 0, 2);

    const cost = getVehicleCostsPerTick(state);
    const tier1Maintenance = getVehicleDefByTier('rock_digger', 1).maintenanceCostPerTick;
    const expected = tier1Maintenance * VEHICLE_TIER_MULTIPLIERS[2].maintenanceCostPerTick;

    expect(cost).toBe(expected);
    expect(cost).toBe(getVehicleDefByTier('rock_digger', 2).maintenanceCostPerTick);
    expect(cost).not.toBe(tier1Maintenance);
  });

  it('an idle tier-3 vehicle bills maintenance at the tier-3 multiplier, not the tier-1 rate', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'drill_rig', 0, 0, 3);

    const cost = getVehicleCostsPerTick(state);
    const tier1Maintenance = getVehicleDefByTier('drill_rig', 1).maintenanceCostPerTick;
    const expected = tier1Maintenance * VEHICLE_TIER_MULTIPLIERS[3].maintenanceCostPerTick;

    expect(cost).toBe(expected);
    expect(cost).toBe(getVehicleDefByTier('drill_rig', 3).maintenanceCostPerTick);
    expect(cost).not.toBe(tier1Maintenance);
  });

  it('an active (reserved) tier-2 vehicle bills tier-2 maintenance plus tier-2 fuel, not tier-1 rates', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'debris_hauler', 0, 0, 2);
    reserveVehicle(state, state.vehicles[0]!.id, 1);

    const cost = getVehicleCostsPerTick(state);
    const def2 = getVehicleDefByTier('debris_hauler', 2);
    const def1 = getVehicleDefByTier('debris_hauler', 1);
    const expected = def2.maintenanceCostPerTick + def2.fuelCostPerTick;

    expect(cost).toBe(expected);
    expect(cost).not.toBe(def1.maintenanceCostPerTick + def1.fuelCostPerTick);
  });

  it('an active (reserved) tier-3 vehicle bills tier-3 maintenance plus tier-3 fuel, not tier-1 rates', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'building_destroyer', 0, 0, 3);
    reserveVehicle(state, state.vehicles[0]!.id, 1);

    const cost = getVehicleCostsPerTick(state);
    const def3 = getVehicleDefByTier('building_destroyer', 3);
    const def1 = getVehicleDefByTier('building_destroyer', 1);
    const expected = def3.maintenanceCostPerTick + def3.fuelCostPerTick;

    expect(cost).toBe(expected);
    expect(cost).not.toBe(def1.maintenanceCostPerTick + def1.fuelCostPerTick);
  });

  it('a mixed fleet sums each vehicle at its own tier\'s rate', () => {
    const state = createVehicleState();
    purchaseVehicle(state, 'debris_hauler', 0, 0, 1);
    purchaseVehicle(state, 'rock_digger', 0, 0, 2);
    purchaseVehicle(state, 'drill_rig', 0, 0, 3);
    // Activate the tier-3 drill rig so both maintenance and fuel are exercised.
    reserveVehicle(state, state.vehicles[2]!.id, 1);

    const cost = getVehicleCostsPerTick(state);
    const expected =
      getVehicleDefByTier('debris_hauler', 1).maintenanceCostPerTick +
      getVehicleDefByTier('rock_digger', 2).maintenanceCostPerTick +
      getVehicleDefByTier('drill_rig', 3).maintenanceCostPerTick +
      getVehicleDefByTier('drill_rig', 3).fuelCostPerTick;

    expect(cost).toBe(expected);
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

  // ── #1138 regression: destroying a reserved vehicle must not orphan its
  // reservations entry ────────────────────────────────────────────────────
  // Pre-#1138, `reservedForActionId` lived on the Vehicle object itself —
  // destroying the vehicle removed the field along with it, nothing left to
  // go stale. Now that the claim lives in the separate
  // `VehicleState.reservations` array, destroyVehicle splicing only
  // `state.vehicles` leaves a dangling `{ vehicleId, actionId }` entry
  // behind: findVehicleReservedForAction(actionId) then correctly reports
  // "no vehicle" (the id lookup fails), but a LATER, legitimate
  // `reserveVehicle(vehicleState, otherVehicleId, actionId)` for the same
  // actionId — reserveVehicle's own `clearVehicleReservation` is keyed by
  // vehicleId, not actionId — never removes it, leaving two reservations
  // entries for one actionId and breaking the "at most one entry per
  // actionId" invariant VehicleState's own doc comment promises. Reproduced
  // end-to-end (not just this direct unit shape) in
  // vehicles.integration.test.ts's "destroying the reserved vehicle
  // mid-drive returns the action to queued, re-claimable by a different
  // qualified employee/vehicle pair", which fails assertWorldInvariants'
  // I5 check because of exactly this leftover entry.
  it('destroying a reserved vehicle removes its reservations entry too, not just the vehicle itself', () => {
    const state = createVehicleState();
    const { vehicle } = purchaseVehicle(state, 'drill_rig');
    reserveVehicle(state, vehicle.id, 42);
    expect(getVehicleReservation(state, vehicle.id)).toBe(42);

    destroyVehicle(state, vehicle.id);

    expect(state.reservations.some(r => r.vehicleId === vehicle.id)).toBe(false);
    expect(findVehicleReservedForAction(state, 42)).toBeNull();
  });

  it('a later, different vehicle legitimately reserved for the same actionId a destroyed vehicle once held ends up as the ONLY entry for that actionId', () => {
    const state = createVehicleState();
    const { vehicle: gone } = purchaseVehicle(state, 'drill_rig');
    reserveVehicle(state, gone.id, 7);
    destroyVehicle(state, gone.id);

    const { vehicle: replacement } = purchaseVehicle(state, 'drill_rig');
    reserveVehicle(state, replacement.id, 7);

    expect(state.reservations.filter(r => r.actionId === 7)).toHaveLength(1);
    expect(findVehicleReservedForAction(state, 7)?.id).toBe(replacement.id);
  });
});

// Loading rate: getExcavatorLoadingRate was removed (#1092) — no remaining
// callers once the itinerary model's haul/dig effects read capacity directly
// via getVehicleDefByTier.

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

// ── VehicleOperationalState type (#1138 — deleted, replaced by VehicleStatusKind) ──
// VehicleOperationalState lived on Vehicle itself and could disagree with
// reality; VehicleStatusKind (src/core/entities/VehicleStatus.ts) is the
// derived replacement — see VehicleStatus.test.ts for its own dedicated
// coverage. This module no longer exports an operational-state type at all
// (a type has no runtime footprint, so the only place that can pin its
// removal is the compiler itself: this file's own import list no longer
// names it, and would fail to typecheck again the moment it did).

// ── VehicleDef.tier ───────────────────────────────────────────────────────────

describe('VehicleDef.tier', () => {
  it('debris_hauler def has a tier field that is 1, 2, or 3', () => {
    const { tier } = getVehicleDefByTier('debris_hauler', 1);
    expect([1, 2, 3]).toContain(tier);
  });

  it('rock_digger def has a tier field that is 1, 2, or 3', () => {
    const { tier } = getVehicleDefByTier('rock_digger', 1);
    expect([1, 2, 3]).toContain(tier);
  });

  it('drill_rig def has a tier field that is 1, 2, or 3', () => {
    const { tier } = getVehicleDefByTier('drill_rig', 1);
    expect([1, 2, 3]).toContain(tier);
  });

  it('building_destroyer def has a tier field that is 1, 2, or 3', () => {
    const { tier } = getVehicleDefByTier('building_destroyer', 1);
    expect([1, 2, 3]).toContain(tier);
  });

  it('rock_fragmenter def has a tier field that is 1, 2, or 3', () => {
    const { tier } = getVehicleDefByTier('rock_fragmenter', 1);
    expect([1, 2, 3]).toContain(tier);
  });

  it('every role def has a tier field satisfying VehicleTier', () => {
    const roles: VehicleRole[] = getAllVehicleRoles();
    for (const role of roles) {
      const tier: VehicleTier = getVehicleDefByTier(role, 1).tier;
      expect([1, 2, 3]).toContain(tier);
    }
  });
});

// ── VehicleDef.nameKey ────────────────────────────────────────────────────────

describe('VehicleDef.nameKey', () => {
  it('debris_hauler def has a non-empty nameKey string', () => {
    expect(getVehicleDefByTier('debris_hauler', 1).nameKey).toBeTypeOf('string');
    expect(getVehicleDefByTier('debris_hauler', 1).nameKey.length).toBeGreaterThan(0);
  });

  it('rock_digger def has a non-empty nameKey string', () => {
    expect(getVehicleDefByTier('rock_digger', 1).nameKey).toBeTypeOf('string');
    expect(getVehicleDefByTier('rock_digger', 1).nameKey.length).toBeGreaterThan(0);
  });

  it('drill_rig def has a non-empty nameKey string', () => {
    expect(getVehicleDefByTier('drill_rig', 1).nameKey).toBeTypeOf('string');
    expect(getVehicleDefByTier('drill_rig', 1).nameKey.length).toBeGreaterThan(0);
  });

  it('building_destroyer def has a non-empty nameKey string', () => {
    expect(getVehicleDefByTier('building_destroyer', 1).nameKey).toBeTypeOf('string');
    expect(getVehicleDefByTier('building_destroyer', 1).nameKey.length).toBeGreaterThan(0);
  });

  it('rock_fragmenter def has a non-empty nameKey string', () => {
    expect(getVehicleDefByTier('rock_fragmenter', 1).nameKey).toBeTypeOf('string');
    expect(getVehicleDefByTier('rock_fragmenter', 1).nameKey.length).toBeGreaterThan(0);
  });

  it('every role def nameKey starts with "vehicle."', () => {
    const roles: VehicleRole[] = getAllVehicleRoles();
    for (const role of roles) {
      expect(getVehicleDefByTier(role, 1).nameKey).toMatch(/^vehicle\./);
    }
  });
});

// ── VehicleDef.workRate ───────────────────────────────────────────────────────

describe('VehicleDef.workRate', () => {
  it('debris_hauler def has a workRate greater than 0', () => {
    expect(getVehicleDefByTier('debris_hauler', 1).workRate).toBeGreaterThan(0);
  });

  it('rock_digger def has a workRate greater than 0', () => {
    expect(getVehicleDefByTier('rock_digger', 1).workRate).toBeGreaterThan(0);
  });

  it('drill_rig def has a workRate greater than 0', () => {
    expect(getVehicleDefByTier('drill_rig', 1).workRate).toBeGreaterThan(0);
  });

  it('building_destroyer def has a workRate greater than 0', () => {
    expect(getVehicleDefByTier('building_destroyer', 1).workRate).toBeGreaterThan(0);
  });

  it('rock_fragmenter def has a workRate greater than 0', () => {
    expect(getVehicleDefByTier('rock_fragmenter', 1).workRate).toBeGreaterThan(0);
  });

  it('every role def has a workRate that is a finite positive number', () => {
    const roles: VehicleRole[] = getAllVehicleRoles();
    for (const role of roles) {
      const { workRate } = getVehicleDefByTier(role, 1);
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

// Tier 1 backward compatibility: getVehicleDef (untiered) was removed
// (#1092) — getVehicleDefByTier(role, 1) is now the only source, exercised
// by the catalog-completeness suite above.

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
// TASK 2.5 — Vehicle interface fields: occupantIds, payload
// ═════════════════════════════════════════════════════════════════════════════

// ── Vehicle interface fields ──────────────────────────────────────────────────

describe('Vehicle interface fields', () => {
  it('newly purchased vehicle has occupantIds initialised empty (no driver aboard)', () => {
    // occupantIds[0] is the driver; an empty array means no driver is currently assigned.
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    expect(vehicle.occupantIds).toHaveLength(0);
  });

  it('occupantIds is empty for every vehicle role immediately after purchase', () => {
    // Exhaustively checks every role so no role-specific initialisation path is missed.
    const vs = createVehicleState();
    for (const role of ALL_ROLES) {
      const { vehicle } = purchaseVehicle(vs, role);
      expect(vehicle.occupantIds).toHaveLength(0);
    }
  });

  it('newly purchased vehicle has payload initialised to null', () => {
    // payload: { fragmentId; massKg } | null — null means the vehicle is carrying
    // nothing when first purchased (#1091: replaces the old payloadKg number).
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    expect(vehicle.payload).toBeNull();
  });

  it('payload is null for every vehicle role immediately after purchase', () => {
    // Exhaustively checks every role so no role-specific initialisation path is missed.
    const vs = createVehicleState();
    for (const role of ALL_ROLES) {
      const { vehicle } = purchaseVehicle(vs, role);
      expect(vehicle.payload).toBeNull();
    }
  });

  it('purchaseVehicle never sets payload to a truthy sentinel (e.g. an empty object)', () => {
    // Guards against a stray `{}` or zero-mass placeholder standing in for "empty" —
    // the contract is strictly `null`, never a payload object with sentinel fields.
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'rock_fragmenter');
    expect(vehicle.payload).toBe(null);
  });

  // ── Dead-field removal (#1138) ────────────────────────────────────────────
  // task, state, targetX, targetZ, waitingTicks, moveConsecutiveFailures,
  // isMoveStuck and reservedForActionId are gone from Vehicle entirely — every
  // one of them is either derived display state (VehicleStatus.computeVehicleStatus)
  // or moved onto the driving Employee/VehicleState.reservations. A structural
  // check (`in`) plus a JSON round-trip pins their absence at both the
  // TypeScript and the runtime-serialisation level.

  it('a freshly purchased vehicle carries none of the eight removed display/movement fields', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    for (const deadField of [
      'task', 'state', 'targetX', 'targetZ', 'waitingTicks',
      'moveConsecutiveFailures', 'isMoveStuck', 'reservedForActionId',
    ]) {
      expect(deadField in vehicle).toBe(false);
    }
  });

  it('serialising a vehicle to JSON produces none of the eight removed keys', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'rock_fragmenter');
    const keys = Object.keys(JSON.parse(JSON.stringify(vehicle)));
    for (const deadField of [
      'task', 'state', 'targetX', 'targetZ', 'waitingTicks',
      'moveConsecutiveFailures', 'isMoveStuck', 'reservedForActionId',
    ]) {
      expect(keys).not.toContain(deadField);
    }
  });
});

// ── Reservation accessors (#1138) ─────────────────────────────────────────────

describe('getVehicleReservation / findVehicleReservedForAction / resolveVehicleDriver', () => {
  it('getVehicleReservation returns null for an unreserved vehicle', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    expect(getVehicleReservation(vs, vehicle.id)).toBeNull();
  });

  it('reserveVehicle + getVehicleReservation round-trip the actionId', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    reserveVehicle(vs, vehicle.id, 42);
    expect(getVehicleReservation(vs, vehicle.id)).toBe(42);
  });

  it('reserveVehicle replaces an existing reservation for the same vehicle rather than appending', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    reserveVehicle(vs, vehicle.id, 1);
    reserveVehicle(vs, vehicle.id, 2);
    expect(getVehicleReservation(vs, vehicle.id)).toBe(2);
    expect(vs.reservations.filter(r => r.vehicleId === vehicle.id)).toHaveLength(1);
  });

  it('getVehicleReservation for an unknown vehicleId returns null', () => {
    const vs = createVehicleState();
    purchaseVehicle(vs, 'debris_hauler');
    expect(getVehicleReservation(vs, 9999)).toBeNull();
  });

  it('findVehicleReservedForAction returns null when nothing is reserved for that action', () => {
    const vs = createVehicleState();
    purchaseVehicle(vs, 'debris_hauler');
    expect(findVehicleReservedForAction(vs, 1)).toBeNull();
  });

  it('findVehicleReservedForAction finds the vehicle reserved for an actionId', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    reserveVehicle(vs, vehicle.id, 7);
    expect(findVehicleReservedForAction(vs, 7)?.id).toBe(vehicle.id);
  });

  it('findVehicleReservedForAction returns null for an actionId whose vehicle has since been destroyed', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    reserveVehicle(vs, vehicle.id, 7);
    destroyVehicle(vs, vehicle.id);
    expect(findVehicleReservedForAction(vs, 7)).toBeNull();
  });

  it('resolveVehicleDriver returns undefined when occupantIds is empty', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    expect(resolveVehicleDriver(vehicle, [])).toBeUndefined();
  });

  it('resolveVehicleDriver resolves the Employee matching occupantIds[0]', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    vehicle.occupantIds = [6];
    const employees = createEmployeeState();
    const { employee } = hireEmployee(employees, 'driller', new Random(42));
    employee.id = 6;
    expect(resolveVehicleDriver(vehicle, employees.employees)?.id).toBe(6);
  });

  it('resolveVehicleDriver returns undefined when occupantIds[0] names an employee not in the list', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    vehicle.occupantIds = [999];
    expect(resolveVehicleDriver(vehicle, [])).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// TASK 2.6 — Mount.board(): validate employee licence for vehicle role
// ═════════════════════════════════════════════════════════════════════════════
//
// assignDriver() was deleted (#1101) — dead in production since Mount.board
// superseded it (see gameplay-vehicle-fleet). Every test below drives the
// same canAssignDriver checks through Mount.board instead, against a real
// GameState so board() has something to operate on. Vehicle and employee stay
// co-located (both default to (0,0)) so board()'s own boarding-range check
// never interferes with what each test actually means to prove.
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
 *   - A real GameState containing exactly one purchased vehicle of `vehicleRole`.
 *   - Exactly one alive 'driver' employee, co-located with the vehicle.
 *   - If `licenceCategory` is provided, the employee is given that skill at
 *     proficiency level 1 via assignSkill().  If omitted, the employee has no
 *     qualifications at all.
 *
 * Returns the state plus the IDs needed by Mount.board().
 */
function makeDriverFixture(
  vehicleRole: VehicleRole,
  licenceCategory?: string,
): { state: GameState; vehicleId: number; empId: number } {
  const state = createGame({ seed: ASSIGN_DRIVER_SEED });
  const { vehicle } = purchaseVehicle(state.vehicles, vehicleRole);

  const rng = new Random(ASSIGN_DRIVER_SEED);
  const { employee } = hireEmployee(state.employees, 'driver', rng);

  // These tests are about the licence check itself, so state the employee's
  // licences outright: exactly the one asked for, or none at all. Hiring grants
  // the truck licence by default, which would otherwise mask the rejection.
  employee.qualifications = [];
  if (licenceCategory !== undefined) {
    assignSkill(state.employees, employee.id, licenceCategory as SkillCategory, 1);
  }

  return { state, vehicleId: vehicle.id, empId: employee.id };
}

/**
 * Same as makeDriverFixture but places the employee in `occupantIds` on a
 * *second* vehicle in the fleet, simulating an existing driver assignment
 * without calling Mount.board() itself.  The first vehicle (the target) has
 * no driver so only the "already driving" rule fires.
 */
function makeAlreadyDrivingFixture(
  targetRole: VehicleRole,
  licenceCategory: string,
): { state: GameState; vehicleId: number; empId: number } {
  const { state, vehicleId, empId } = makeDriverFixture(targetRole, licenceCategory);

  // Purchase a second vehicle of any role and directly assign our employee
  // as its driver — bypassing Mount.board() to set up the precondition.
  const { vehicle: otherVehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
  otherVehicle.occupantIds = [empId];

  return { state, vehicleId, empId };
}

/**
 * Same as makeDriverFixture but the target vehicle already has a driver
 * (occupantIds[0] set to a placeholder id 999), simulating a pre-occupied
 * vehicle. The incoming employee is fully qualified so only the
 * "vehicle taken" rule fires.
 */
function makeVehicleTakenFixture(
  vehicleRole: VehicleRole,
  licenceCategory: string,
): { state: GameState; vehicleId: number; empId: number; originalDriverId: number } {
  const { state, vehicleId, empId } = makeDriverFixture(vehicleRole, licenceCategory);

  // Directly set a pre-existing driver on the vehicle.
  const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
  const originalDriverId = 999;
  vehicle.occupantIds = [originalDriverId];

  return { state, vehicleId, empId, originalDriverId };
}

// ── Happy path — qualified driver successfully assigned ───────────────────────

describe('Mount.board — happy path: debris_hauler requires driving.truck', () => {
  it('returns { success: true } when employee holds driving.truck licence', () => {
    const { state, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(true);
  });

  it('sets vehicle.occupantIds[0] to the employee id on success', () => {
    const { state, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    board(state, vehicleId, empId);
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.occupantIds[0]).toBe(empId);
  });

  it('returns no error property on success (error is undefined)', () => {
    const { state, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    const result = board(state, vehicleId, empId);
    expect('error' in result).toBe(false);
  });
});

describe('Mount.board — happy path: building_destroyer requires driving.truck', () => {
  it('returns { success: true } when employee holds driving.truck licence', () => {
    const { state, vehicleId, empId } = makeDriverFixture('building_destroyer', 'driving.truck');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(true);
  });

  it('sets vehicle.occupantIds[0] to the employee id on success', () => {
    const { state, vehicleId, empId } = makeDriverFixture('building_destroyer', 'driving.truck');
    board(state, vehicleId, empId);
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.occupantIds[0]).toBe(empId);
  });
});

describe('Mount.board — happy path: rock_digger requires driving.excavator', () => {
  it('returns { success: true } when employee holds driving.excavator licence', () => {
    const { state, vehicleId, empId } = makeDriverFixture('rock_digger', 'driving.excavator');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(true);
  });

  it('sets vehicle.occupantIds[0] to the employee id on success', () => {
    const { state, vehicleId, empId } = makeDriverFixture('rock_digger', 'driving.excavator');
    board(state, vehicleId, empId);
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.occupantIds[0]).toBe(empId);
  });
});

describe('Mount.board — happy path: rock_fragmenter requires driving.excavator', () => {
  it('returns { success: true } when employee holds driving.excavator licence', () => {
    const { state, vehicleId, empId } = makeDriverFixture('rock_fragmenter', 'driving.excavator');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(true);
  });

  it('sets vehicle.occupantIds[0] to the employee id on success', () => {
    const { state, vehicleId, empId } = makeDriverFixture('rock_fragmenter', 'driving.excavator');
    board(state, vehicleId, empId);
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.occupantIds[0]).toBe(empId);
  });
});

describe('Mount.board — happy path: drill_rig requires driving.drill_rig', () => {
  it('returns { success: true } when employee holds driving.drill_rig licence', () => {
    const { state, vehicleId, empId } = makeDriverFixture('drill_rig', 'driving.drill_rig');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(true);
  });

  it('sets vehicle.occupantIds[0] to the employee id on success', () => {
    const { state, vehicleId, empId } = makeDriverFixture('drill_rig', 'driving.drill_rig');
    board(state, vehicleId, empId);
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.occupantIds[0]).toBe(empId);
  });
});

describe('Mount.board — happy path: higher proficiency level still qualifies', () => {
  it('employee with proficiencyLevel 3 for driving.truck can drive a debris_hauler', () => {
    // Any proficiency level in the right category grants the licence — level does not gate access.
    const state = createGame({ seed: ASSIGN_DRIVER_SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    const rng = new Random(ASSIGN_DRIVER_SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    assignSkill(state.employees, employee.id, 'driving.truck' as SkillCategory, 3);

    const result = board(state, vehicle.id, employee.id);
    expect(result.success).toBe(true);
    expect(state.vehicles.vehicles.find(v => v.id === vehicle.id)!.occupantIds[0]).toBe(employee.id);
  });

  it('employee with proficiencyLevel 5 for driving.drill_rig can drive a drill_rig', () => {
    const state = createGame({ seed: ASSIGN_DRIVER_SEED + 1 });
    const { vehicle } = purchaseVehicle(state.vehicles, 'drill_rig');
    const rng = new Random(ASSIGN_DRIVER_SEED + 1);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    assignSkill(state.employees, employee.id, 'driving.drill_rig' as SkillCategory, 5);

    const result = board(state, vehicle.id, employee.id);
    expect(result.success).toBe(true);
  });
});

// ── Error: vehicle not found ──────────────────────────────────────────────────

describe('Mount.board — error: vehicle not found', () => {
  it('returns { success: false } when vehicleId does not exist in the fleet', () => {
    const state = createGame({ seed: ASSIGN_DRIVER_SEED });
    const rng = new Random(ASSIGN_DRIVER_SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    assignSkill(state.employees, employee.id, 'driving.truck' as SkillCategory, 1);

    const result = board(state, 9999, employee.id);
    expect(result.success).toBe(false);
  });

  it('error message is exactly "Vehicle not found" when vehicleId is absent', () => {
    const state = createGame({ seed: ASSIGN_DRIVER_SEED });
    const rng = new Random(ASSIGN_DRIVER_SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);

    const result = board(state, 9999, employee.id);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(t('mount.vehicle_not_found'));
    }
  });

  it('fleet vehicles array is unchanged after a vehicle-not-found failure', () => {
    // No vehicles purchased — fleet stays empty.
    const state = createGame({ seed: ASSIGN_DRIVER_SEED });
    const rng = new Random(ASSIGN_DRIVER_SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);

    board(state, 9999, employee.id);
    expect(state.vehicles.vehicles).toHaveLength(0);
  });
});

// ── Error: employee not found ─────────────────────────────────────────────────

describe('Mount.board — error: employee not found', () => {
  it('returns { success: false } when employeeId does not exist in employee state', () => {
    const { state, vehicleId } = makeDriverFixture('debris_hauler', 'driving.truck');
    const result = board(state, vehicleId, 9999);
    expect(result.success).toBe(false);
  });

  it('error message is exactly "Employee not found" when employeeId is absent', () => {
    const { state, vehicleId } = makeDriverFixture('debris_hauler', 'driving.truck');
    const result = board(state, vehicleId, 9999);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(t('mount.employee_not_found'));
    }
  });

  it('vehicle.occupantIds stays empty after an employee-not-found failure', () => {
    const { state, vehicleId } = makeDriverFixture('debris_hauler', 'driving.truck');
    board(state, vehicleId, 9999);
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.occupantIds).toHaveLength(0);
  });
});

// ── Error: employee not alive (killed) ────────────────────────────────────────

describe('Mount.board — error: employee not alive', () => {
  it('returns { success: false } when the employee exists but alive is false', () => {
    const { state, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    killEmployee(state.employees, empId); // sets alive: false
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('error message is "Employee not found" for a dead employee (not alive ≡ not found)', () => {
    // Rule 2 collapses "not found" and "not alive" into a single error string.
    const { state, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    killEmployee(state.employees, empId);
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe(t('mount.employee_not_found'));
    }
  });

  it('vehicle.occupantIds stays empty after a dead-employee failure', () => {
    const { state, vehicleId, empId } = makeDriverFixture('rock_digger', 'driving.excavator');
    killEmployee(state.employees, empId);
    board(state, vehicleId, empId);
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.occupantIds).toHaveLength(0);
  });
});

// ── Error: employee lacks licence — no qualifications ─────────────────────────

describe('Mount.board — error: employee lacks licence (no qualifications at all)', () => {
  it('debris_hauler: employee with zero qualifications → { success: false }', () => {
    const { state, vehicleId, empId } = makeDriverFixture('debris_hauler');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('building_destroyer: employee with zero qualifications → { success: false }', () => {
    const { state, vehicleId, empId } = makeDriverFixture('building_destroyer');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('rock_digger: employee with zero qualifications → { success: false }', () => {
    const { state, vehicleId, empId } = makeDriverFixture('rock_digger');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('rock_fragmenter: employee with zero qualifications → { success: false }', () => {
    const { state, vehicleId, empId } = makeDriverFixture('rock_fragmenter');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('drill_rig: employee with zero qualifications → { success: false }', () => {
    const { state, vehicleId, empId } = makeDriverFixture('drill_rig');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('error message is exactly "Employee lacks licence for this role"', () => {
    // Use drill_rig as a representative case.
    const { state, vehicleId, empId } = makeDriverFixture('drill_rig');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Employee lacks licence for this role');
    }
  });

  it('vehicle.occupantIds stays empty after a no-licence failure', () => {
    const { state, vehicleId, empId } = makeDriverFixture('debris_hauler');
    board(state, vehicleId, empId);
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.occupantIds).toHaveLength(0);
  });
});

// ── Error: wrong licence (cross-role mismatch) ────────────────────────────────
//
// Each test ensures a driving licence for one category is *not* accepted as a
// substitute for a different required category.  All five licence slots are
// exercised so that every mapping edge is independently confirmed.

describe('Mount.board — error: wrong licence (cross-role mismatch)', () => {
  it('debris_hauler needs driving.truck; employee with only driving.excavator is rejected', () => {
    // debris_hauler requires driving.truck — driving.excavator must not count.
    const { state, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.excavator');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Employee lacks licence for this role');
    }
  });

  it('building_destroyer needs driving.truck; employee with only driving.drill_rig is rejected', () => {
    // building_destroyer requires driving.truck — driving.drill_rig must not count.
    const { state, vehicleId, empId } = makeDriverFixture('building_destroyer', 'driving.drill_rig');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Employee lacks licence for this role');
    }
  });

  it('rock_digger needs driving.excavator; employee with only driving.truck is rejected', () => {
    // rock_digger requires driving.excavator — driving.truck must not count.
    const { state, vehicleId, empId } = makeDriverFixture('rock_digger', 'driving.truck');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Employee lacks licence for this role');
    }
  });

  it('rock_fragmenter needs driving.excavator; employee with only driving.drill_rig is rejected', () => {
    // rock_fragmenter requires driving.excavator — driving.drill_rig must not count.
    const { state, vehicleId, empId } = makeDriverFixture('rock_fragmenter', 'driving.drill_rig');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Employee lacks licence for this role');
    }
  });

  it('drill_rig needs driving.drill_rig; employee with only driving.truck is rejected', () => {
    // drill_rig requires driving.drill_rig — driving.truck must not count.
    const { state, vehicleId, empId } = makeDriverFixture('drill_rig', 'driving.truck');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Employee lacks licence for this role');
    }
  });

  it('drill_rig needs driving.drill_rig; employee with only driving.excavator is rejected', () => {
    // Covers the remaining excavator → drill_rig mismatch direction.
    const { state, vehicleId, empId } = makeDriverFixture('drill_rig', 'driving.excavator');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Employee lacks licence for this role');
    }
  });

  it('vehicle.occupantIds stays empty after a wrong-licence failure', () => {
    const { state, vehicleId, empId } = makeDriverFixture('rock_digger', 'driving.truck');
    board(state, vehicleId, empId);
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.occupantIds).toHaveLength(0);
  });
});

// ── Error: employee already driving another vehicle ───────────────────────────

describe('Mount.board — error: employee already driving another vehicle', () => {
  it('returns { success: false } when the employee already occupies (is occupantIds[0] of) a different vehicle', () => {
    // The employee is fully qualified and the target vehicle has no driver.
    // The only failing condition is that the employee is already assigned elsewhere.
    const { state, vehicleId, empId } = makeAlreadyDrivingFixture(
      'debris_hauler',
      'driving.truck',
    );
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('error message is exactly "Employee already driving another vehicle"', () => {
    const { state, vehicleId, empId } = makeAlreadyDrivingFixture(
      'rock_digger',
      'driving.excavator',
    );
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Employee already driving another vehicle');
    }
  });

  it('target vehicle.occupantIds remains empty after an already-driving failure', () => {
    // The target vehicle must not receive the driver when the call fails.
    const { state, vehicleId, empId } = makeAlreadyDrivingFixture(
      'drill_rig',
      'driving.drill_rig',
    );
    board(state, vehicleId, empId);
    const targetVehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    expect(targetVehicle.occupantIds).toHaveLength(0);
  });
});

// ── Error: vehicle already has a driver ──────────────────────────────────────

describe('Mount.board — error: vehicle already has a driver', () => {
  it('returns { success: false } when vehicle.occupantIds is already non-empty', () => {
    // The incoming employee is fully qualified and not already driving.
    // The only failing condition is that the target vehicle is already occupied.
    const { state, vehicleId, empId } = makeVehicleTakenFixture(
      'debris_hauler',
      'driving.truck',
    );
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('error message is exactly "Vehicle already has a driver"', () => {
    const { state, vehicleId, empId } = makeVehicleTakenFixture(
      'rock_fragmenter',
      'driving.excavator',
    );
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Vehicle already has a driver');
    }
  });

  it('original occupantIds[0] is preserved and not overwritten after a vehicle-taken failure', () => {
    // The pre-existing driver (999) must survive the failed call intact.
    const { state, vehicleId, empId, originalDriverId } = makeVehicleTakenFixture(
      'drill_rig',
      'driving.drill_rig',
    );
    board(state, vehicleId, empId);
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.occupantIds[0]).toBe(originalDriverId);
    // And must definitely not be overwritten with the incoming empId.
    expect(vehicle.occupantIds[0]).not.toBe(empId);
  });
});

// ── Mount.board — reservation exclusivity (#550) ─────────────────────────────
// A vehicle-gated action's reservation is exclusive: only the employee it was
// reserved for may board it. A different employee (or a manual `vehicle
// driver` re-target) must be rejected; the reservation's own holder must not
// be blocked from boarding their own reserved vehicle.

describe('Mount.board — error: vehicle reserved for a different action', () => {
  it('returns { success: false } when vehicle.reservedForActionId does not match employee.activeActionId', () => {
    const { state, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    const employee = state.employees.employees.find(e => e.id === empId)!;

    reserveVehicle(state.vehicles, vehicle.id, 7);
    employee.activeActionId = null; // a different party — not the reservation's holder

    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
  });

  it('error message is exactly "Vehicle is reserved for another task"', () => {
    const { state, vehicleId, empId } = makeDriverFixture('rock_digger', 'driving.excavator');
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    const employee = state.employees.employees.find(e => e.id === empId)!;

    reserveVehicle(state.vehicles, vehicle.id, 7);
    employee.activeActionId = 8; // holds a DIFFERENT action than the reservation

    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Vehicle is reserved for another task');
    }
  });

  it('vehicle.occupantIds stays empty after a reservation-mismatch failure', () => {
    const { state, vehicleId, empId } = makeDriverFixture('drill_rig', 'driving.drill_rig');
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    const employee = state.employees.employees.find(e => e.id === empId)!;

    reserveVehicle(state.vehicles, vehicle.id, 7);
    employee.activeActionId = null;

    board(state, vehicleId, empId);
    expect(vehicle.occupantIds).toHaveLength(0);
  });
});

describe('Mount.board — success: reservation holder boards their own reserved vehicle', () => {
  it('returns { success: true } when vehicle.reservedForActionId equals employee.activeActionId', () => {
    const { state, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    const employee = state.employees.employees.find(e => e.id === empId)!;

    reserveVehicle(state.vehicles, vehicle.id, 7);
    employee.activeActionId = 7; // the reservation's own holder

    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(true);
  });

  it('sets vehicle.occupantIds[0] to the employee id when the reservation matches', () => {
    const { state, vehicleId, empId } = makeDriverFixture('rock_fragmenter', 'driving.excavator');
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    const employee = state.employees.employees.find(e => e.id === empId)!;

    reserveVehicle(state.vehicles, vehicle.id, 12);
    employee.activeActionId = 12;

    board(state, vehicleId, empId);
    expect(vehicle.occupantIds[0]).toBe(empId);
  });

  it('an unreserved vehicle (reservedForActionId null) is unaffected by the guard', () => {
    // Regression guard: the exclusivity check must not fire at all for the
    // common case of an ordinary, unreserved vehicle.
    const { state, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    const result = board(state, vehicleId, empId);
    expect(result.success).toBe(true);
  });
});

// ── canReleaseDriver — may the driver seat be emptied right now? ─────────────
// #1092: a question, not an operation. `Mount.alight` is the one writer of
// occupantIds (the `vehicles` rule), and it calls this first — so what these
// cover is the answer, and `alight`'s own tests (Mount.test.ts) cover the
// seat actually emptying on the back of it.

describe('canReleaseDriver — happy path', () => {
  it('says yes for a driven vehicle carrying nothing, without touching occupantIds itself', () => {
    const { state, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    board(state, vehicleId, empId);
    const result = canReleaseDriver(state.vehicles, vehicleId);
    expect(result.success).toBe(true);
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.occupantIds).toEqual([empId]);
  });

  it('alight, which gates on it, frees the employee to board a different vehicle afterward', () => {
    const { state, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    board(state, vehicleId, empId);
    expect(canReleaseDriver(state.vehicles, vehicleId).success).toBe(true);
    expect(alight(state, vehicleId).success).toBe(true);
    const { vehicle: otherVehicle } = purchaseVehicle(state.vehicles, 'debris_hauler');
    const result = board(state, otherVehicle.id, empId);
    expect(result.success).toBe(true);
  });
});

describe('canReleaseDriver — error: vehicle not found', () => {
  it('returns a failure result', () => {
    const vs = createVehicleState();
    const result = canReleaseDriver(vs, 9999);
    expect(result.success).toBe(false);
  });

  it('error message names the reason', () => {
    const vs = createVehicleState();
    const result = canReleaseDriver(vs, 9999);
    expect(result.error).toBe('Vehicle not found');
  });
});

describe('canReleaseDriver — boundary: vehicle has no driver at all', () => {
  it('says yes — an empty seat is trivially releasable, and alight owns refusing that case', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    const result = canReleaseDriver(vs, vehicle.id);
    expect(result.success).toBe(true);
    expect(vehicle.occupantIds).toHaveLength(0);
  });
});

describe('canReleaseDriver — error: vehicle is mid-haul', () => {
  // #1091: the mid-haul guard reads `vehicle.payload !== null` now that
  // haulingPhase/haulingFragmentId are gone — payload is only set once
  // haul_load's arrival effect fires, so this guard only ever catches the
  // loaded, driving-to-depot leg.
  it('says no, and alight then refuses too, once a fragment is loaded (driving to the depot)', () => {
    const { state, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    board(state, vehicleId, empId);
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    vehicle.payload = { fragmentId: 1, massKg: 500 };

    const result = canReleaseDriver(state.vehicles, vehicleId);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Vehicle is mid-haul');
    expect(alight(state, vehicleId).success).toBe(false);
    expect(vehicle.occupantIds[0]).toBe(empId);
  });

  // TODO(#1091): the to-fragment leg (before haul_load fires) has no signal
  // on Vehicle any more — this guard can't distinguish "driving toward a
  // fragment" from "idle", so it allows the release.
  it('says yes before the fragment is loaded — driving-to-fragment leg has no payload signal yet', () => {
    const { state, vehicleId, empId } = makeDriverFixture('debris_hauler', 'driving.truck');
    board(state, vehicleId, empId);
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;
    expect(vehicle.payload).toBeNull();

    expect(canReleaseDriver(state.vehicles, vehicleId).success).toBe(true);
    expect(alight(state, vehicleId).success).toBe(true);
    expect(vehicle.occupantIds).toHaveLength(0);
  });
});

// ── computeScrapResidualValue ────────────────────────────────────────────────

describe('computeScrapResidualValue', () => {
  it('credits 40% of purchase cost for a vehicle at full HP', () => {
    const def = getVehicleDefByTier('debris_hauler', 1);
    expect(computeScrapResidualValue('debris_hauler', 1, def.maxHp)).toBe(Math.round(def.purchaseCost * 0.4));
  });

  it('scales down with current HP — half HP nets half the full-HP credit', () => {
    const def = getVehicleDefByTier('debris_hauler', 1);
    const full = computeScrapResidualValue('debris_hauler', 1, def.maxHp);
    const half = computeScrapResidualValue('debris_hauler', 1, def.maxHp / 2);
    expect(half).toBe(Math.round(full / 2));
  });

  it('returns 0 for a vehicle at 0 HP', () => {
    expect(computeScrapResidualValue('rock_digger', 1, 0)).toBe(0);
  });

  it('never exceeds the full-HP credit even if hp is passed above maxHp', () => {
    const def = getVehicleDefByTier('drill_rig', 2);
    const atMax = computeScrapResidualValue('drill_rig', 2, def.maxHp);
    const aboveMax = computeScrapResidualValue('drill_rig', 2, def.maxHp * 2);
    expect(aboveMax).toBe(atMax);
  });

  it('scales with tier — a higher tier vehicle scraps for more at the same HP fraction', () => {
    const tier1 = computeScrapResidualValue('rock_fragmenter', 1, getVehicleDefByTier('rock_fragmenter', 1).maxHp);
    const tier3 = computeScrapResidualValue('rock_fragmenter', 3, getVehicleDefByTier('rock_fragmenter', 3).maxHp);
    expect(tier3).toBeGreaterThan(tier1);
  });
});

// ── findBestEvacuationDriver (#1042) ────────────────────────────────────────

const alwaysReach: EvacuationDriverReachabilityCheck = () => true;
const neverReach: EvacuationDriverReachabilityCheck = () => false;

function makeEvacuationFixture(seed: number) {
  const vs = createVehicleState();
  const es = createEmployeeState();
  const { vehicle } = purchaseVehicle(vs, 'rock_digger', 20, 20); // requires driving.excavator
  // driverless — occupantIds defaults to [] on purchase
  const rng = new Random(seed);
  return { vs, es, vehicle, rng };
}

describe('findBestEvacuationDriver', () => {
  it('picks the nearest qualified, reachable candidate among several', () => {
    const { vs, es, vehicle, rng } = makeEvacuationFixture(100);
    const { employee: far } = hireEmployee(es, 'driller', rng, 0, 0);
    assignSkill(es, far.id, 'driving.excavator', 1);
    const { employee: near } = hireEmployee(es, 'driller', rng, 21, 21);
    assignSkill(es, near.id, 'driving.excavator', 1);
    const { employee: mid } = hireEmployee(es, 'driller', rng, 10, 10);
    assignSkill(es, mid.id, 'driving.excavator', 1);

    const best = findBestEvacuationDriver(vehicle, vs, es, [far.id, near.id, mid.id], alwaysReach);

    expect(best?.id).toBe(near.id);
  });

  it('excludes an unlicensed candidate, reusing the same licence check as canAssignDriver', () => {
    const { vs, es, vehicle, rng } = makeEvacuationFixture(101);
    // driller's starting qualification is 'blasting', not driving.excavator.
    const { employee: unqualified } = hireEmployee(es, 'driller', rng, 20, 20);
    const { employee: qualified } = hireEmployee(es, 'driller', rng, 25, 25);
    assignSkill(es, qualified.id, 'driving.excavator', 1);

    const best = findBestEvacuationDriver(vehicle, vs, es, [unqualified.id, qualified.id], alwaysReach);

    expect(best?.id).toBe(qualified.id);
  });

  it('skips a candidate canReach rejects, falling through to the next-nearest', () => {
    const { vs, es, vehicle, rng } = makeEvacuationFixture(102);
    const { employee: nearButUnreachable } = hireEmployee(es, 'driller', rng, 21, 21);
    assignSkill(es, nearButUnreachable.id, 'driving.excavator', 1);
    const { employee: fartherButReachable } = hireEmployee(es, 'driller', rng, 10, 10);
    assignSkill(es, fartherButReachable.id, 'driving.excavator', 1);

    const canReach: EvacuationDriverReachabilityCheck = (employee) => employee.id !== nearButUnreachable.id;

    const best = findBestEvacuationDriver(
      vehicle, vs, es, [nearButUnreachable.id, fartherButReachable.id], canReach,
    );

    expect(best?.id).toBe(fartherButReachable.id);
  });

  it('returns null when the candidate list is empty (boundary)', () => {
    const { vs, es, vehicle } = makeEvacuationFixture(103);

    expect(findBestEvacuationDriver(vehicle, vs, es, [], alwaysReach)).toBeNull();
  });

  it('returns null when nobody in the candidate list qualifies or is reachable (rejection)', () => {
    const { vs, es, vehicle, rng } = makeEvacuationFixture(104);
    const { employee: unqualified } = hireEmployee(es, 'driller', rng, 20, 20);
    const { employee: unreachable } = hireEmployee(es, 'driller', rng, 20, 20);
    assignSkill(es, unreachable.id, 'driving.excavator', 1);

    const best = findBestEvacuationDriver(vehicle, vs, es, [unqualified.id, unreachable.id], neverReach);

    expect(best).toBeNull();
  });

  it('breaks a tie at equal distance by ascending employee id', () => {
    const { vs, es, vehicle, rng } = makeEvacuationFixture(105);
    const { employee: first } = hireEmployee(es, 'driller', rng, 15, 20); // distance 5 from (20,20)
    assignSkill(es, first.id, 'driving.excavator', 1);
    const { employee: second } = hireEmployee(es, 'driller', rng, 25, 20); // distance 5 too
    assignSkill(es, second.id, 'driving.excavator', 1);

    // second.id > first.id (hired after) — ascending-id tiebreak must pick first.
    const best = findBestEvacuationDriver(vehicle, vs, es, [second.id, first.id], alwaysReach);

    expect(best?.id).toBe(first.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// vehicleRequiredClearanceCells (#1154)
// ═══════════════════════════════════════════════════════════════════════════════

describe('vehicleRequiredClearanceCells (#1154)', () => {
  it('returns NAV_CLEARANCE_VEHICLE_CELLS for a debris_hauler', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'debris_hauler');
    expect(vehicleRequiredClearanceCells(vehicle)).toBe(NAV_CLEARANCE_VEHICLE_CELLS);
  });

  it('returns NAV_CLEARANCE_VEHICLE_CELLS for a rock_digger', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'rock_digger');
    expect(vehicleRequiredClearanceCells(vehicle)).toBe(NAV_CLEARANCE_VEHICLE_CELLS);
  });

  it('returns NAV_CLEARANCE_VEHICLE_CELLS for a drill_rig', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'drill_rig');
    expect(vehicleRequiredClearanceCells(vehicle)).toBe(NAV_CLEARANCE_VEHICLE_CELLS);
  });

  it('returns NAV_CLEARANCE_VEHICLE_CELLS for a building_destroyer', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'building_destroyer');
    expect(vehicleRequiredClearanceCells(vehicle)).toBe(NAV_CLEARANCE_VEHICLE_CELLS);
  });

  it('returns NAV_CLEARANCE_VEHICLE_CELLS for a rock_fragmenter', () => {
    const vs = createVehicleState();
    const { vehicle } = purchaseVehicle(vs, 'rock_fragmenter');
    expect(vehicleRequiredClearanceCells(vehicle)).toBe(NAV_CLEARANCE_VEHICLE_CELLS);
  });

  it('returns NAV_CLEARANCE_VEHICLE_CELLS for every registered role, exhaustively, regardless of tier', () => {
    const vs = createVehicleState();
    for (const role of ALL_ROLES) {
      const { vehicle } = purchaseVehicle(vs, role, 0, 0, 3);
      expect(vehicleRequiredClearanceCells(vehicle)).toBe(NAV_CLEARANCE_VEHICLE_CELLS);
    }
  });
});
