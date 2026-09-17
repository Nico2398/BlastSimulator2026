// BlastSimulator2026 — Tests for HaulingTask (issue #437, itinerary-driven #1091)
//
// requestHaulFragment validates eligibility and installs the itinerary
// machinery (a PendingAction claimed/reserved for the vehicle, and an
// itinerary on the driver whose legs drive to the fragment then the depot,
// each ending in an ArrivalEffects.ts effect) rather than starting a
// per-tick phase machine — ArrivalEffects.test.ts covers what happens once
// each leg actually arrives. findHaulDepotApproach resolves the itinerary's
// depot leg target at plan time, replacing the old per-tick
// resolveDepotApproach re-target.

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { purchaseVehicle, vehicleDriverId } from '../../../src/core/entities/Vehicle.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import {
  requestHaulFragment,
  findReachableGroundFragment,
  findHaulDepotApproach,
  isHaulEligibleVehicle,
} from '../../../src/core/economy/HaulingTask.js';
import { NavGrid, type NavCell, type NavCellType } from '../../../src/core/nav/NavGrid.js';
import { getVehicleReservation } from '../../../src/core/entities/Vehicle.js';
import { reserveVehicle } from '../../../src/core/engine/VehicleReservation.js';
import { requestBreakBoulder } from '../../../src/core/economy/BoulderBreaking.js';
import { fragmentApproachCell } from '../../../src/core/economy/FragmentApproach.js';
import { OVERSIZED_FRAGMENT_THRESHOLD } from '../../../src/core/mining/BlastCalc.js';
import type { Itinerary, ArrivalStep } from '../../../src/core/engine/Itinerary.js';
import { syncHaulDispatch } from '../../../src/core/economy/HaulDispatch.js';

const SEED = 42;
const GRID = 64;

// Default volume sits under OVERSIZED_FRAGMENT_THRESHOLD (0.5 m³, see
// BoulderFragmentation.ts) so plain haul-path fixtures stay haulable by
// default; tests that specifically exercise the oversized gate (#484)
// override `.volume` explicitly against the real constant.
function makeFragment(id: number, x: number, z: number, mass = 1000): FragmentData {
  return {
    id,
    position: { x, y: 0, z },
    volume: 0.3,
    mass,
    rockId: 'cruite',
    oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
  };
}

/** A driverless debris_hauler with no active haul. */
function makeIdleHauler(state: ReturnType<typeof createGame>, x = 0, z = 0) {
  return purchaseVehicle(state.vehicles, 'debris_hauler', x, z).vehicle;
}

/** A debris_hauler with a licensed driver already boarded (driverId set, occupied, mounted). */
function makeDrivenHauler(state: ReturnType<typeof createGame>, x = 0, z = 0) {
  const vehicle = makeIdleHauler(state, x, z);
  const rng = new Random(SEED);
  const { employee } = hireEmployee(state.employees, 'driver', rng, x, z);
  assignSkill(state.employees, employee.id, 'driving.truck', 1);
  // #1089/#1091: planItinerary/driving reads the driver off
  // vehicle.occupantIds[0]/employee.locomotion, not the driverId mirror alone.
  vehicle.occupantIds = [employee.id];
  employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
  return vehicle;
}

function placeWarehouse(state: ReturnType<typeof createGame>, x: number, z: number) {
  const result = placeBuilding(state.buildings, 'freight_warehouse', x, z, GRID, GRID);
  if (!result.success) throw new Error(`Setup: placeBuilding failed — ${result.error}`);
  return result.building!;
}

/**
 * Hand-crafted NavGrid built directly from a type grid, rows[z][x]. Mirrors
 * the helper in tests/unit/nav/NavGrid.test.ts — GameState.navGrid is null
 * until a world is built via `new_game`, so unit tests that exercise
 * findReachableGroundFragment (which reads state.navGrid) need to construct
 * one by hand.
 */
function makeNavGridFromTypes(rows: NavCellType[][]): NavGrid {
  const height = rows.length;
  const width = rows[0]!.length;
  const cells = rows.map(row => row.map((type): NavCell => {
    const moveCost = type === 'walkable' ? 1.0 : type === 'ramp' ? 1.8 : type === 'drill_hole' ? 5.0 : Infinity;
    return { type, moveCost, benchLevel: 0, vehicleOccupied: false };
  }));
  return new NavGrid(width, height, cells, 0);
}

/** A flat, fully walkable size×size NavGrid. */
function makeFlatNavGrid(size: number): NavGrid {
  return makeNavGridFromTypes(
    Array.from({ length: size }, () => Array.from({ length: size }, (): NavCellType => 'walkable')),
  );
}

/** Every leg across `itinerary` whose arrival step is the named effect. */
function legsWithEffect(itinerary: Itinerary, effectId: string) {
  return itinerary.legs.filter(leg => (leg.onArrive as ArrivalStep).kind === 'effect' && (leg.onArrive as { effectId: string }).effectId === effectId);
}

// ── isHaulEligibleVehicle ────────────────────────────────────────────────────

describe('isHaulEligibleVehicle', () => {
  it('true for a debris_hauler with a driver and no reserved action', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenHauler(state);
    expect(isHaulEligibleVehicle(vehicle, state.vehicles)).toBe(true);
  });

  it('false for a non-debris_hauler vehicle', () => {
    const state = createGame({ seed: SEED });
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    expect(isHaulEligibleVehicle(vehicle, state.vehicles)).toBe(false);
  });

  it('false for a debris_hauler with no driver assigned', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeIdleHauler(state);
    expect(isHaulEligibleVehicle(vehicle, state.vehicles)).toBe(false);
  });

  it('false for a debris_hauler already reserved for another action', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenHauler(state);
    reserveVehicle(state.vehicles, vehicle.id, 42);
    expect(isHaulEligibleVehicle(vehicle, state.vehicles)).toBe(false);
  });

  it('false for undefined', () => {
    const state = createGame({ seed: SEED });
    expect(isHaulEligibleVehicle(undefined, state.vehicles)).toBe(false);
  });
});

// ── findHaulDepotApproach ────────────────────────────────────────────────────

describe('findHaulDepotApproach', () => {
  it('returns the nearest active freight_warehouse\'s approach cell when several exist', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(GRID);
    placeWarehouse(state, 40, 40); // far
    const near = placeWarehouse(state, 6, 6); // near

    const approach = findHaulDepotApproach(state, 0, 0);

    expect(approach).not.toBeNull();
    // Must sit adjacent to the NEAR warehouse, not the far one.
    expect(Math.abs(approach!.x - near.x) + Math.abs(approach!.z - near.z)).toBeLessThan(10);
  });

  it('returns null when no active freight_warehouse exists', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(GRID);

    expect(findHaulDepotApproach(state, 0, 0)).toBeNull();
  });

  it('falls back to the warehouse\'s raw coordinates when no NavGrid is built yet', () => {
    const state = createGame({ seed: SEED });
    const warehouse = placeWarehouse(state, 10, 10);

    const approach = findHaulDepotApproach(state, 0, 0);

    expect(approach).toEqual({ x: warehouse.x, z: warehouse.z });
  });
});

// ── requestHaulFragment — precondition failures ─────────────────────────────

describe('requestHaulFragment — precondition failures', () => {
  it('rejects a non-debris_hauler vehicle', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    assignSkill(state.employees, employee.id, 'driving.excavator', 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.occupantIds = [employee.id];
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a vehicle with no driver', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    const vehicle = makeIdleHauler(state);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a vehicle already reserved for another action', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state);
    reserveVehicle(state.vehicles, vehicle.id, 42);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a vehicle currently carrying a payload (mid-haul)', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state);
    vehicle.payload = { fragmentId: 999, massKg: 500 };
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a fragment that is not on_ground (already in_transit)', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);
    state.logistics.fragments[0]!.state = 'in_transit';

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects a fragment ID that does not exist', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state);

    const result = requestHaulFragment(state, vehicle.id, 9999);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects when no active freight_warehouse exists', () => {
    const state = createGame({ seed: SEED });
    const vehicle = makeDrivenHauler(state);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('rejects an unknown vehicle ID', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

    const result = requestHaulFragment(state, 9999, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

// ── requestHaulFragment — happy path installs the itinerary machinery ──────

describe('requestHaulFragment — happy path', () => {
  it('claims the vehicle for a haul_debris action and installs an itinerary driving to the fragment then the depot', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(GRID);
    const warehouse = placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state, 0, 0);
    const fragment = makeFragment(1, 5, 7);
    const actionsBefore = state.pendingActions.length;
    addBlastFragments(state.logistics, [fragment], state.navGrid);
    // requestHaulFragment claims an already-self-dispatched haul_debris
    // action (#1091 — see HaulDispatch.ts's syncHaulDispatch) rather than
    // creating one itself; in real gameplay TickPipeline.ts runs this every
    // tick well before a player could issue a manual haul request.
    syncHaulDispatch(state);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    // The core contract under test: no synchronous pickup — loading only
    // happens once the itinerary's own drive leg actually arrives.
    expect(state.logistics.fragments[0]!.state).toBe('on_ground');

    // Claims the vehicle so no other request/dispatch can double-book it.
    expect(getVehicleReservation(state.vehicles, vehicle.id)).not.toBeNull();
    const action = state.pendingActions.find(a => a.id === getVehicleReservation(state.vehicles, vehicle.id));
    expect(action).toBeDefined();
    expect(action!.type).toBe('haul_debris');
    expect(action!.payload['fragmentId']).toBe(1);
    // Exactly one new action overall — syncHaulDispatch created it, and
    // requestHaulFragment only claims it rather than creating a duplicate.
    expect(state.pendingActions.length).toBe(actionsBefore + 1);

    // Installs a driving itinerary on the driver ending in the two hauling
    // arrival effects, per gameplay-vehicle-fleet's own
    // "[drive -> fragment, effect 'load'] [drive -> depot, effect 'unload']"
    // shape.
    const driver = state.employees.employees.find(e => e.id === vehicleDriverId(vehicle))!;
    expect(driver.itinerary).not.toBeNull();
    const itinerary = driver.itinerary!;

    const loadLegs = legsWithEffect(itinerary, 'haul_load');
    const unloadLegs = legsWithEffect(itinerary, 'haul_unload');
    expect(loadLegs).toHaveLength(1);
    expect(unloadLegs).toHaveLength(1);

    const fragmentApproach = fragmentApproachCell(fragment, state, vehicle.id);
    expect(loadLegs[0]!.destX).toBe(fragmentApproach.x);
    expect(loadLegs[0]!.destZ).toBe(fragmentApproach.z);

    const depotApproach = findHaulDepotApproach(state, fragmentApproach.x, fragmentApproach.z)!;
    expect(unloadLegs[0]!.destX).toBe(depotApproach.x);
    expect(unloadLegs[0]!.destZ).toBe(depotApproach.z);

    // The load leg is planned before the unload leg.
    expect(itinerary.legs.indexOf(loadLegs[0]!)).toBeLessThan(itinerary.legs.indexOf(unloadLegs[0]!));
    void warehouse;
  });

  it('routes to the nearest active freight_warehouse when several exist', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(GRID);
    placeWarehouse(state, 40, 40); // far
    const near = placeWarehouse(state, 6, 6); // near
    const vehicle = makeDrivenHauler(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)], state.navGrid);
    syncHaulDispatch(state);

    const result = requestHaulFragment(state, vehicle.id, 1);
    expect(result.success).toBe(true);

    const driver = state.employees.employees.find(e => e.id === vehicleDriverId(vehicle))!;
    const unloadLeg = legsWithEffect(driver.itinerary!, 'haul_unload')[0]!;
    expect(Math.abs(unloadLeg.destX - near.x) + Math.abs(unloadLeg.destZ - near.z)).toBeLessThan(10);
  });
});

// ── findReachableGroundFragment (#466) ──────────────────────────────────────
//
// Picks the nearest 'on_ground' fragment that is actually path-connected to
// the vehicle's position (via NavGrid.computeReachableSet) rather than plain
// nearest-distance — after a full-clear blast most fragments land in 'void'
// NavGrid cells no vehicle can reach. Unchanged by #1091.

describe('findReachableGroundFragment — precondition failures', () => {
  it('returns null when there are zero on-ground fragments', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(20);
    const vehicle = makeDrivenHauler(state, 0, 0);

    expect(findReachableGroundFragment(state, vehicle.id)).toBeNull();
  });

  it('returns null for a non-debris_hauler vehicle', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(20);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    assignSkill(state.employees, employee.id, 'driving.excavator', 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.occupantIds = [employee.id];
    addBlastFragments(state.logistics, [makeFragment(1, 2, 2)]);

    expect(findReachableGroundFragment(state, vehicle.id)).toBeNull();
  });

  it('returns null for a debris_hauler with no driver assigned', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(20);
    const vehicle = makeIdleHauler(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 2, 2)]);

    expect(findReachableGroundFragment(state, vehicle.id)).toBeNull();
  });
});

describe('findReachableGroundFragment — selection', () => {
  it('picks the nearest fragment when every candidate is reachable', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(20);
    const vehicle = makeDrivenHauler(state, 0, 0);
    addBlastFragments(state.logistics, [
      makeFragment(1, 10, 10), // far
      makeFragment(2, 2, 2),   // nearest
      makeFragment(3, 5, 5),   // mid
    ]);

    expect(findReachableGroundFragment(state, vehicle.id)).toBe(2);
  });

  it('skips a nearer fragment stuck in an unreachable void pocket, picking the farther-but-reachable one instead', () => {
    // 7×7 grid: an open field, with a walkable pocket at (3,3) walled off on
    // all 8 sides by 'void' — exactly what a full-clear blast leaves behind.
    // The vehicle sits at the anchor (0,0). Fragment A sits in the pocket, at
    // raw distance²=18 from the vehicle. Fragment B sits in the open field,
    // farther away by raw distance (distance²=36) but actually reachable.
    // Naive nearest-distance selection picks A; reachability-aware selection
    // must pick B.
    const rows: NavCellType[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 7 }, (): NavCellType => 'walkable'));
    for (const [x, z] of [[2, 2], [3, 2], [4, 2], [2, 3], [4, 3], [2, 4], [3, 4], [4, 4]] as const) {
      rows[z]![x] = 'void';
    }
    const state = createGame({ seed: SEED });
    state.navGrid = makeNavGridFromTypes(rows);
    const vehicle = makeDrivenHauler(state, 0, 0);
    addBlastFragments(state.logistics, [
      makeFragment(1, 3, 3), // unreachable pocket fragment — closer by raw distance
      makeFragment(2, 6, 0), // reachable — farther by raw distance
    ]);

    expect(findReachableGroundFragment(state, vehicle.id)).toBe(2);
  });

  it('ignores fragments that are in_transit or stored, considering only on_ground ones', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(20);
    const vehicle = makeDrivenHauler(state, 0, 0);
    addBlastFragments(state.logistics, [
      makeFragment(1, 2, 2),  // will be marked in_transit — nearest by distance
      makeFragment(2, 3, 3),  // will be marked stored — next nearest
      makeFragment(3, 8, 8),  // the only on_ground candidate — farthest
    ]);
    state.logistics.fragments.find(f => f.fragment.id === 1)!.state = 'in_transit';
    state.logistics.fragments.find(f => f.fragment.id === 2)!.state = 'stored';

    expect(findReachableGroundFragment(state, vehicle.id)).toBe(3);
  });

  it('returns null when only in_transit/stored fragments exist (no on_ground candidates)', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(20);
    const vehicle = makeDrivenHauler(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 2, 2)]);
    state.logistics.fragments[0]!.state = 'in_transit';

    expect(findReachableGroundFragment(state, vehicle.id)).toBeNull();
  });
});

// ── requestHaulFragment — oversized fragment rejection (#484) ──────────────
//
// An oversized boulder must be broken by a Rock Fragmenter before it can be
// hauled — a debris_hauler must refuse it outright. isOversized is strictly
// `>` the threshold (BoulderFragmentation.ts), so a fragment exactly at the
// threshold must still be haulable — an inverted `>=` comparison here would
// silently strand every threshold-sized fragment.

describe('requestHaulFragment — oversized fragment rejection (#484)', () => {
  it('rejects an on_ground fragment whose volume exceeds the oversized threshold', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state, 0, 0);
    const oversized = makeFragment(1, 5, 5);
    oversized.volume = OVERSIZED_FRAGMENT_THRESHOLD + 0.01;
    addBlastFragments(state.logistics, [oversized]);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(state.logistics.fragments[0]!.state).toBe('on_ground');
  });

  it('accepts a fragment exactly at the oversized threshold (isOversized must be strictly >, not >=)', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(GRID);
    placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state, 0, 0);
    const atThreshold = makeFragment(1, 5, 5);
    atThreshold.volume = OVERSIZED_FRAGMENT_THRESHOLD;
    addBlastFragments(state.logistics, [atThreshold], state.navGrid);
    syncHaulDispatch(state);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(getVehicleReservation(state.vehicles, vehicle.id)).not.toBeNull();
  });
});

// ── findReachableGroundFragment — oversized exclusion (#484) ───────────────

describe('findReachableGroundFragment — oversized exclusion (#484)', () => {
  it('never returns an oversized fragment even when it is nearest and reachable, picking the next reachable non-oversized one instead', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(20);
    const vehicle = makeDrivenHauler(state, 0, 0);
    const oversizedNear = makeFragment(1, 2, 2); // nearest by distance
    oversizedNear.volume = OVERSIZED_FRAGMENT_THRESHOLD + 0.5;
    const haulableFar = makeFragment(2, 5, 5); // farther, but haulable
    haulableFar.volume = OVERSIZED_FRAGMENT_THRESHOLD;
    addBlastFragments(state.logistics, [oversizedNear, haulableFar]);

    expect(findReachableGroundFragment(state, vehicle.id)).toBe(2);
  });

  it('returns null when the only reachable on-ground fragment is oversized', () => {
    const state = createGame({ seed: SEED });
    state.navGrid = makeFlatNavGrid(20);
    const vehicle = makeDrivenHauler(state, 0, 0);
    const oversized = makeFragment(1, 3, 3);
    oversized.volume = OVERSIZED_FRAGMENT_THRESHOLD + 1;
    addBlastFragments(state.logistics, [oversized]);

    expect(findReachableGroundFragment(state, vehicle.id)).toBeNull();
  });
});

// ── fragmentApproachCell — shared between hauling and breaking (#484) ──────
//
// Hauling and breaking dispatch different vehicle roles at the same fragment
// position, but both must resolve to the identical NavGrid approach cell —
// otherwise a hauler and a fragmenter sent to the same boulder would park in
// different places. #1091: that shared target now shows up as the
// itinerary's own first drive leg destination rather than vehicle.targetX/Z.

describe('fragmentApproachCell — shared between hauling and breaking (#484)', () => {
  it('haul and break plan their first drive leg onto the same approach cell for equivalent fragments at the same position', () => {
    const haulState = createGame({ seed: SEED });
    haulState.navGrid = makeFlatNavGrid(GRID);
    placeWarehouse(haulState, 10, 10);
    const haulVehicle = makeDrivenHauler(haulState, 0, 0);
    const haulFragment = makeFragment(1, 6, 9);
    haulFragment.volume = OVERSIZED_FRAGMENT_THRESHOLD; // at threshold: haulable
    addBlastFragments(haulState.logistics, [haulFragment], haulState.navGrid);
    syncHaulDispatch(haulState);
    requestHaulFragment(haulState, haulVehicle.id, 1);
    const haulDriver = haulState.employees.employees.find(e => e.id === vehicleDriverId(haulVehicle))!;
    const haulLoadLeg = legsWithEffect(haulDriver.itinerary!, 'haul_load')[0]!;

    const breakState = createGame({ seed: SEED });
    breakState.navGrid = makeFlatNavGrid(GRID);
    const rng = new Random(SEED);
    const { vehicle: breakVehicle } = purchaseVehicle(breakState.vehicles, 'rock_fragmenter', 0, 0);
    const { employee } = hireEmployee(breakState.employees, 'driver', rng);
    assignSkill(breakState.employees, employee.id, 'driving.excavator', 1);
    breakVehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: breakVehicle.id };
    const breakFragment = makeFragment(1, 6, 9);
    breakFragment.volume = OVERSIZED_FRAGMENT_THRESHOLD + 0.5; // oversized: breakable
    addBlastFragments(breakState.logistics, [breakFragment], breakState.navGrid);
    syncHaulDispatch(breakState);
    requestBreakBoulder(breakState, breakVehicle.id, 1);
    const breakSplitLeg = legsWithEffect(employee.itinerary!, 'boulder_split')[0]!;

    const expected = fragmentApproachCell(haulFragment);
    expect(haulLoadLeg.destX).toBe(expected.x);
    expect(haulLoadLeg.destZ).toBe(expected.z);
    expect(breakSplitLeg.destX).toBe(expected.x);
    expect(breakSplitLeg.destZ).toBe(expected.z);
  });
});
