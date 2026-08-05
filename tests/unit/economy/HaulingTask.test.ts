// BlastSimulator2026 — Tests for HaulingTask (issue #437)
//
// requestHaulFragment dispatches a debris_hauler toward a ground fragment
// without loading it immediately; tickHaulingProgress advances the vehicle
// through to_fragment -> pickup -> to_depot -> deliver -> idle, only acting
// on arrival (never mid-transit).

import { describe, it, expect } from 'vitest';
import { createGame } from '../../../src/core/state/GameState.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import { placeBuilding } from '../../../src/core/entities/Building.js';
import { addBlastFragments } from '../../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../../src/core/mining/BlastExecution.js';
import { requestHaulFragment, tickHaulingProgress, findReachableGroundFragment } from '../../../src/core/economy/HaulingTask.js';
import { NavGrid, type NavCell, type NavCellType } from '../../../src/core/nav/NavGrid.js';
import { requestBreakBoulder } from '../../../src/core/economy/BoulderBreaking.js';
import { fragmentApproachCell } from '../../../src/core/economy/FragmentApproach.js';
import { OVERSIZED_FRAGMENT_THRESHOLD } from '../../../src/core/mining/BlastCalc.js';

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
  };
}

/** A driverless debris_hauler with no active haul. */
function makeIdleHauler(state: ReturnType<typeof createGame>, x = 0, z = 0) {
  return purchaseVehicle(state.vehicles, 'debris_hauler', x, z).vehicle;
}

/** A debris_hauler with a licensed driver already boarded (driverId set). */
function makeDrivenHauler(state: ReturnType<typeof createGame>, x = 0, z = 0) {
  const vehicle = makeIdleHauler(state, x, z);
  const rng = new Random(SEED);
  const { employee } = hireEmployee(state.employees, 'driver', rng);
  assignSkill(state.employees, employee.id, 'driving.truck', 1);
  vehicle.driverId = employee.id;
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

// ── requestHaulFragment — precondition failures ─────────────────────────────

describe('requestHaulFragment — precondition failures', () => {
  it('rejects a non-debris_hauler vehicle', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng);
    assignSkill(state.employees, employee.id, 'driving.excavator', 1);
    const { vehicle } = purchaseVehicle(state.vehicles, 'rock_digger', 0, 0);
    vehicle.driverId = employee.id;
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

  it('rejects a vehicle that is already hauling', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state);
    vehicle.haulingFragmentId = 999;
    vehicle.haulingPhase = 'to_fragment';
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

// ── requestHaulFragment — happy path defers movement/loading ───────────────

describe('requestHaulFragment — happy path', () => {
  it('sets the vehicle destination toward the fragment and marks the haul pending', () => {
    const state = createGame({ seed: SEED });
    const warehouse = placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 7)]);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(vehicle.targetX).toBe(5);
    expect(vehicle.targetZ).toBe(7);
    expect(vehicle.haulingFragmentId).toBe(1);
    expect(vehicle.haulingPhase).toBe('to_fragment');
    expect(vehicle.haulingDepotBuildingId).toBe(warehouse.id);
    // The core contract under test: no synchronous pickup.
    expect(state.logistics.fragments[0]!.state).toBe('on_ground');
  });

  it('routes to the nearest active freight_warehouse when several exist', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 40, 40); // far
    const near = placeWarehouse(state, 6, 6); // near
    const vehicle = makeDrivenHauler(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(true);
    expect(vehicle.haulingDepotBuildingId).toBe(near.id);
  });
});

// ── tickHaulingProgress — no-op while travelling ────────────────────────────

describe('tickHaulingProgress — travelling', () => {
  it('does nothing while the vehicle has not yet arrived at the fragment', () => {
    const state = createGame({ seed: SEED });
    placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);
    requestHaulFragment(state, vehicle.id, 1);

    // Still en route: task is 'moving' and position has not reached the fragment.
    vehicle.task = 'moving';
    vehicle.x = 1;
    vehicle.z = 1;

    tickHaulingProgress(state, vehicle);

    expect(state.logistics.fragments[0]!.state).toBe('on_ground');
    expect(vehicle.haulingPhase).toBe('to_fragment');
  });
});

// ── tickHaulingProgress — arrival at the fragment ───────────────────────────

describe('tickHaulingProgress — arrival at fragment', () => {
  it('loads the fragment on arrival and re-targets the vehicle toward the depot', () => {
    const state = createGame({ seed: SEED });
    const warehouse = placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5)]);
    requestHaulFragment(state, vehicle.id, 1);

    // Arrived: task idle, position matches the fragment.
    vehicle.task = 'idle';
    vehicle.x = 5;
    vehicle.z = 5;

    tickHaulingProgress(state, vehicle);

    expect(state.logistics.fragments[0]!.state).toBe('in_transit');
    expect(vehicle.haulingPhase).toBe('to_depot');
    expect(vehicle.targetX).toBe(warehouse.x);
    expect(vehicle.targetZ).toBe(warehouse.z);
  });
});

// ── tickHaulingProgress — arrival at the depot ──────────────────────────────

describe('tickHaulingProgress — arrival at depot', () => {
  it('delivers the fragment on arrival, increases stored mass, and clears hauling fields', () => {
    const state = createGame({ seed: SEED });
    const warehouse = placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state, 0, 0);
    addBlastFragments(state.logistics, [makeFragment(1, 5, 5, 1200)]);
    requestHaulFragment(state, vehicle.id, 1);

    // First leg: arrive at fragment, load it.
    vehicle.task = 'idle';
    vehicle.x = 5;
    vehicle.z = 5;
    tickHaulingProgress(state, vehicle);
    expect(state.logistics.fragments[0]!.state).toBe('in_transit');

    const storedBefore = state.logistics.storedMassKg;

    // Second leg: arrive at the depot.
    vehicle.task = 'idle';
    vehicle.x = warehouse.x;
    vehicle.z = warehouse.z;
    tickHaulingProgress(state, vehicle);

    expect(state.logistics.fragments[0]!.state).toBe('stored');
    expect(state.logistics.storedMassKg).toBe(storedBefore + 1200);
    expect(vehicle.haulingFragmentId).toBeNull();
    expect(vehicle.haulingPhase).toBeNull();
    expect(vehicle.haulingDepotBuildingId).toBeNull();
    expect(vehicle.task).toBe('idle');
  });
});

// ── findReachableGroundFragment (#466) ──────────────────────────────────────
//
// Picks the nearest 'on_ground' fragment that is actually path-connected to
// the vehicle's position (via NavGrid.computeReachableSet) rather than plain
// nearest-distance — after a full-clear blast most fragments land in 'void'
// NavGrid cells no vehicle can reach.

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
    vehicle.driverId = employee.id;
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
    const warehouse = placeWarehouse(state, 10, 10);
    const vehicle = makeDrivenHauler(state, 0, 0);
    const atThreshold = makeFragment(1, 5, 5);
    atThreshold.volume = OVERSIZED_FRAGMENT_THRESHOLD;
    addBlastFragments(state.logistics, [atThreshold]);

    const result = requestHaulFragment(state, vehicle.id, 1);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(vehicle.haulingDepotBuildingId).toBe(warehouse.id);
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

// ── fragmentApproachCell — shared approach resolution (#484) ───────────────
//
// Hauling and breaking dispatch different vehicle roles at the same fragment
// position, but both must resolve to the identical NavGrid approach cell —
// otherwise a hauler and a fragmenter sent to the same boulder would park in
// different places.

describe('fragmentApproachCell — shared between hauling and breaking (#484)', () => {
  it('haul and break resolve the same approach cell for equivalent fragments at the same position', () => {
    const haulState = createGame({ seed: SEED });
    placeWarehouse(haulState, 10, 10);
    const haulVehicle = makeDrivenHauler(haulState, 0, 0);
    const haulFragment = makeFragment(1, 6, 9);
    haulFragment.volume = OVERSIZED_FRAGMENT_THRESHOLD; // at threshold: haulable
    addBlastFragments(haulState.logistics, [haulFragment]);
    requestHaulFragment(haulState, haulVehicle.id, 1);

    const breakState = createGame({ seed: SEED });
    const rng = new Random(SEED);
    const { vehicle: breakVehicle } = purchaseVehicle(breakState.vehicles, 'rock_fragmenter', 0, 0);
    const { employee } = hireEmployee(breakState.employees, 'driver', rng);
    assignSkill(breakState.employees, employee.id, 'driving.excavator', 1);
    breakVehicle.driverId = employee.id;
    const breakFragment = makeFragment(1, 6, 9);
    breakFragment.volume = OVERSIZED_FRAGMENT_THRESHOLD + 0.5; // oversized: breakable
    addBlastFragments(breakState.logistics, [breakFragment]);
    requestBreakBoulder(breakState, breakVehicle.id, 1);

    const expected = fragmentApproachCell(haulFragment);
    expect(haulVehicle.targetX).toBe(expected.x);
    expect(haulVehicle.targetZ).toBe(expected.z);
    expect(breakVehicle.targetX).toBe(expected.x);
    expect(breakVehicle.targetZ).toBe(expected.z);
  });
});
