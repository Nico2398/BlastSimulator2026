// BlastSimulator2026 — Unit tests: BuildingTaskHelpers (#1086)
//
// Core-owned relocation of src/console/commands/buildingHelpers.ts's pure
// building/footprint/nav-patch helpers. TaskCompletionEffects.ts's own tests
// already exercise these indirectly through applyTaskCompletion's
// place_building branch; these tests call each function directly per
// core-purity.md's "adding an exported function here means adding its unit
// test in the mirrored tests/unit/ path" convention.

import { describe, it, expect, vi } from 'vitest';
import {
  makeFootprintRegion, siteBoundsForGrid, refreshLogisticsCapacity,
  levelBuildingFootprint, relocateFootprintOccupants,
} from '../../../src/core/engine/BuildingTaskHelpers.js';
import { createGame } from '../../../src/core/state/GameState.js';
import { VoxelGrid, setVoxelColumnSurfaceHeight, computeVoxelColumnSurfaceHeight } from '../../../src/core/world/VoxelGrid.js';
import { placeBuilding, getBuildingDef, getDefSize } from '../../../src/core/entities/Building.js';
import { DEFAULT_GRID_SIZE } from '../../../src/core/config/balance.js';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { createGradeState } from '../../../src/core/economy/MineGrade.js';
import { siteVehicleReach } from '../../../src/core/engine/OrderReachability.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import type { BlastRegion } from '../../../src/core/mining/BlastExecution.js';
import type { GameState } from '../../../src/core/state/GameState.js';
import { stockWarehouse, storedFragment } from '../../helpers/freightWarehouse.js';

const SEED = 42;

describe('makeFootprintRegion', () => {
  it('returns the rectangular region a sizeX x sizeZ footprint occupies, anchored at (x, z)', () => {
    expect(makeFootprintRegion(5, 10, 3, 2)).toEqual({ minX: 5, maxX: 7, minZ: 10, maxZ: 11 });
  });

  it('a 1x1 footprint is a single-cell region', () => {
    expect(makeFootprintRegion(0, 0, 1, 1)).toEqual({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 });
  });
});

describe('siteBoundsForGrid', () => {
  it('returns the grid own bounding box when a grid exists', () => {
    const grid = new VoxelGrid(12, 20);
    expect(siteBoundsForGrid(grid)).toEqual({ width: 12, depth: 20, originX: 0, originZ: 0 });
  });

  it('falls back to a DEFAULT_GRID_SIZE square at the origin when grid is null', () => {
    expect(siteBoundsForGrid(null)).toEqual({
      width: DEFAULT_GRID_SIZE, depth: DEFAULT_GRID_SIZE, originX: 0, originZ: 0,
    });
  });
});

describe('refreshLogisticsCapacity', () => {
  it('re-derives logistics storage capacity from the current warehouse total', () => {
    const state = createGame({ seed: SEED });

    const result = placeBuilding(state.buildings, 'freight_warehouse', 0, 0, DEFAULT_GRID_SIZE, DEFAULT_GRID_SIZE, 1, 0, 0);
    expect(result.success).toBe(true);

    refreshLogisticsCapacity(state);

    const expectedCapacity = getBuildingDef('freight_warehouse', 1).capacity;
    expect(state.logistics.storageCapacityKg).toBe(expectedCapacity);
  });
});

// #1813: a closed (outOfService) or switched-off warehouse is still standing, so
// its stock survives; only a warehouse that no longer exists loses it.
describe('refreshLogisticsCapacity stock survival (#1813)', () => {
  const MASS = 5000;
  const ORE_KG = 1500;

  function addWarehouse(state: GameState, x: number): number {
    const r = placeBuilding(state.buildings, 'freight_warehouse', x, 0, DEFAULT_GRID_SIZE, DEFAULT_GRID_SIZE, 1, 0, 0);
    expect(r.success).toBe(true);
    return r.building!.id;
  }

  function stock(state: GameState, fragId: number, warehouseId: number): void {
    stockWarehouse(state, warehouseId, storedFragment(fragId, MASS, { iron: ORE_KG / MASS }));
  }

  function setup() {
    const state = createGame({ seed: SEED });
    const id = addWarehouse(state, 0);
    refreshLogisticsCapacity(state);
    stock(state, 1, id);
    return { state, id };
  }

  const building = (state: GameState, id: number) => state.buildings.buildings.find(b => b.id === id)!;

  it('a closed (outOfService) warehouse keeps fragments, storedMassKg and collectedOre, reports no loss', () => {
    const { state, id } = setup();
    building(state, id).outOfService = true;

    const losses = refreshLogisticsCapacity(state);

    expect(losses).toEqual([]);
    expect(state.logistics.fragments).toHaveLength(1);
    expect(state.logistics.storedMassKg).toBe(MASS);
    expect(state.collectedOre.iron).toBe(ORE_KG);
  });

  it('a closed warehouse contributes no capacity', () => {
    const { state, id } = setup();
    building(state, id).outOfService = true;
    refreshLogisticsCapacity(state);
    expect(state.logistics.storageCapacityKg).toBe(0);
  });

  it('a warehouse switched off (active=false) keeps its stock', () => {
    const { state, id } = setup();
    building(state, id).active = false;

    const losses = refreshLogisticsCapacity(state);

    expect(losses).toEqual([]);
    expect(state.logistics.fragments).toHaveLength(1);
    expect(state.logistics.storedMassKg).toBe(MASS);
    expect(state.collectedOre.iron).toBe(ORE_KG);
  });

  it('a destroyed warehouse (gone from buildings, not planned) loses its stock and debits the totals', () => {
    const { state, id } = setup();
    state.buildings.buildings = state.buildings.buildings.filter(b => b.id !== id);

    const losses = refreshLogisticsCapacity(state);

    expect(losses).toEqual([{ buildingId: id, massKg: MASS, oreKg: { iron: ORE_KG } }]);
    expect(state.logistics.fragments).toHaveLength(0);
    expect(state.logistics.storedMassKg).toBe(0);
    expect(state.collectedOre.iron ?? 0).toBe(0);
  });

  it('a warehouse listed in plannedBuildings (rebuild) keeps its stock', () => {
    const { state, id } = setup();
    state.buildings.buildings = state.buildings.buildings.filter(b => b.id !== id);
    state.plannedBuildings.push({
      id: 1, buildingId: id, type: 'freight_warehouse', tier: 2, x: 0, z: 0, actionId: 1, cost: 0, rebuild: true,
    } as GameState['plannedBuildings'][number]);

    expect(refreshLogisticsCapacity(state)).toEqual([]);
    expect(state.logistics.storedMassKg).toBe(MASS);
    expect(state.logistics.fragments).toHaveLength(1);
  });

  it('closing one warehouse leaves the other warehouse stock untouched and capacity from the open one', () => {
    const { state, id } = setup();
    const other = addWarehouse(state, 20);
    stock(state, 2, other);
    building(state, id).outOfService = true;

    expect(refreshLogisticsCapacity(state)).toEqual([]);

    expect(state.logistics.fragments.map(f => f.warehouseId).sort()).toEqual([id, other].sort());
    expect(state.logistics.storedMassKg).toBe(2 * MASS);
    expect(state.logistics.storageCapacityKg).toBe(getBuildingDef('freight_warehouse', 1).capacity);
  });

  it('destroying one of two warehouses loses only that one stock', () => {
    const { state, id } = setup();
    const other = addWarehouse(state, 20);
    stock(state, 2, other);
    state.buildings.buildings = state.buildings.buildings.filter(b => b.id !== id);

    const losses = refreshLogisticsCapacity(state);

    expect(losses.map(l => l.buildingId)).toEqual([id]);
    expect(state.logistics.fragments.map(f => f.warehouseId)).toEqual([other]);
    expect(state.logistics.storedMassKg).toBe(MASS);
    expect(state.collectedOre.iron).toBe(ORE_KG);
  });
});

// `levelBuildingFootprint`'s contract is simplified (#1198): the widened-
// skirt carve region, the occupancy guard and the self-exclusion filter
// (#1144 review findings 1/2) are all removed — the function now levels
// EXACTLY the true footprint (x..x+sizeX-1, z..z+sizeZ-1) and nothing else,
// so the `buildings` list it used to need for the guard is gone from its
// signature. Direct coverage here per core-purity.md's "every exported
// function gets a unit test in the mirrored tests/unit/ path" convention.
describe('levelBuildingFootprint (#1198)', () => {
  const ROCK_COMPOSITION = { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] };
  const { sizeX: OWN_SIZE_X, sizeZ: OWN_SIZE_Z } = getDefSize(getBuildingDef('driving_center', 1));

  /** A 10x10 grid, every column flat at `height`. */
  function flatGrid(height: number): VoxelGrid {
    const grid = new VoxelGrid(10, 10);
    const compId = grid.palette.intern(ROCK_COMPOSITION);
    for (let z = 0; z < 10; z++) {
      for (let x = 0; x < 10; x++) setVoxelColumnSurfaceHeight(grid, x, z, height, compId);
    }
    return grid;
  }

  it('happy path: carves exactly the true footprint (x..x+sizeX-1, z..z+sizeZ-1) — nothing beyond it', () => {
    const grid = flatGrid(10);
    const compId = grid.palette.intern(ROCK_COMPOSITION);
    // A column INSIDE the true footprint sits proud — must be carved.
    setVoxelColumnSurfaceHeight(grid, OWN_SIZE_X - 1, OWN_SIZE_Z - 1, 15, compId);
    // A column just OUTSIDE the true footprint (x = OWN_SIZE_X, the old
    // widened-skirt column) also sits proud — must be left entirely
    // untouched now that no widened region exists.
    setVoxelColumnSurfaceHeight(grid, OWN_SIZE_X, 0, 15, compId);

    const result = levelBuildingFootprint(grid, 0, 0, OWN_SIZE_X, OWN_SIZE_Z);

    expect(result.targetY).toBeCloseTo(10, 6);
    expect(computeVoxelColumnSurfaceHeight(grid, OWN_SIZE_X - 1, OWN_SIZE_Z - 1)).toBeCloseTo(10, 6);
    expect(computeVoxelColumnSurfaceHeight(grid, OWN_SIZE_X, 0)).toBeCloseTo(15, 6);
    expect(result.region).not.toBeNull();
    expect(result.region!.maxX).toBeLessThan(OWN_SIZE_X);
    expect(result.region!.maxZ).toBeLessThan(OWN_SIZE_Z);
  });

  it("a 1x1 footprint's target always equals its own height — levelling it is a structural no-op; the neighbour stays untouched", () => {
    const grid = flatGrid(10);
    const compId = grid.palette.intern(ROCK_COMPOSITION);
    // The footprint's own (and only) column sits proud — target is derived
    // solely from this single-column rect, so it can only ever be its own
    // height (already "level" for a 1x1 footprint).
    setVoxelColumnSurfaceHeight(grid, 0, 0, 15, compId);
    // Neighbour OUTSIDE the 1x1 footprint — no widened region exists under
    // #1198's single-rect contract, so it must never influence the target
    // and must stay untouched by the carve.
    setVoxelColumnSurfaceHeight(grid, 1, 0, 10, compId);

    const result = levelBuildingFootprint(grid, 0, 0, 1, 1);

    expect(result.targetY).toBeCloseTo(15, 6);
    expect(computeVoxelColumnSurfaceHeight(grid, 0, 0)).toBeCloseTo(15, 6);
    expect(computeVoxelColumnSurfaceHeight(grid, 1, 0)).toBeCloseTo(10, 6);
    expect(result.voxelsCleared).toBe(0);
  });

  it('no-op: an already-level footprint clears 0 voxels', () => {
    const grid = flatGrid(10);

    const result = levelBuildingFootprint(grid, 0, 0, OWN_SIZE_X, OWN_SIZE_Z);

    expect(result.voxelsCleared).toBe(0);
    expect(result.region).toBeNull();
  });

  it('two adjacent buildings, touching with zero gap: levelling one never carves into the true footprint of the other', () => {
    const grid = flatGrid(10);
    const compId = grid.palette.intern(ROCK_COMPOSITION);
    // Second building's true footprint starts exactly where the first one's
    // ends (touching, zero gap) — its origin column sits proud so a carve
    // that spilled over would be observable. No guard mechanism is needed
    // for this to hold — the carve simply never reaches past its own footprint.
    setVoxelColumnSurfaceHeight(grid, OWN_SIZE_X, 0, 15, compId);

    const result = levelBuildingFootprint(grid, 0, 0, OWN_SIZE_X, OWN_SIZE_Z);

    expect(result.voxelsCleared).toBe(0);
    expect(computeVoxelColumnSurfaceHeight(grid, OWN_SIZE_X, 0)).toBeCloseTo(15, 6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// relocateFootprintOccupants — vehicles (#1270)
//
// A vehicle parked on a cell a footprint newly blocks is a stale,
// permanently unreachable pathfinding destination unless it is swept off,
// the same way this function already sweeps bystander employees. These
// tests call `relocateFootprintOccupants` directly, per core-purity.md's
// "adding an exported function here means adding its unit test in the
// mirrored tests/unit/ path" convention.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Marks every cell of `region` 'blocked' directly on the NavGrid — the
 * effect a footprint patch (order/upgrade/move/complete) has already had
 * by the time `relocateFootprintOccupants` runs, without needing a full
 * building-order fixture just to exercise this one pure sweep.
 */
function blockRegion(nav: NavGrid, region: BlastRegion): void {
  for (let z = region.minZ; z <= region.maxZ; z++) {
    for (let x = region.minX; x <= region.maxX; x++) {
      const cell = nav.cellAt(x, z)!;
      cell.type = 'blocked';
      cell.moveCost = Infinity;
    }
  }
}

function insideRegion(x: number, z: number, region: BlastRegion): boolean {
  const cx = Math.round(x);
  const cz = Math.round(z);
  return cx >= region.minX && cx <= region.maxX && cz >= region.minZ && cz <= region.maxZ;
}

describe('relocateFootprintOccupants — vehicles (#1270)', () => {
  const VEHICLE_ROCK_COMPOSITION = { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] };
  const REGION: BlastRegion = { minX: 2, maxX: 3, minZ: 2, maxZ: 3 };

  /** A flat 10x10 walkable NavGrid, no buildings/drill holes, on a fresh GameState. */
  function makeFlatNavState(): ReturnType<typeof createGame> {
    const state = createGame({ seed: SEED });
    const grid = new VoxelGrid(10, 10);
    const compId = grid.palette.intern(VEHICLE_ROCK_COMPOSITION);
    for (let z = 0; z < 10; z++) {
      for (let x = 0; x < 10; x++) setVoxelColumnSurfaceHeight(grid, x, z, 10, compId);
    }
    state.navGrid = NavGrid.buildNavGrid(grid, [], []);
    return state;
  }

  it('moves a parked, unoccupied vehicle off a newly-blocked footprint cell to the same cell findNearestReachableCell reports', () => {
    const state = makeFlatNavState();
    blockRegion(state.navGrid!, REGION);

    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 2);
    expect(vehicle.occupantIds).toEqual([]);

    // Computed off the same (still-unmutated) NavGrid state
    // `relocateFootprintOccupants` itself reads — the expected destination.
    const expected = NavGrid.findNearestReachableCell(state.navGrid!, 0, 0, vehicle.x, vehicle.z, true);

    relocateFootprintOccupants(state, REGION);

    expect(vehicle.x).toBe(expected.x);
    expect(vehicle.z).toBe(expected.z);
    expect(insideRegion(vehicle.x, vehicle.z, REGION)).toBe(false);
  });

  it('flips vehicleOccupied off the vehicle\'s old cell and on for its new cell', () => {
    const state = makeFlatNavState();
    blockRegion(state.navGrid!, REGION);

    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 2);
    const oldCell = state.navGrid!.cellAt(2, 2)!;
    oldCell.vehicleOccupied = true;

    relocateFootprintOccupants(state, REGION);

    const newCell = state.navGrid!.cellAt(Math.round(vehicle.x), Math.round(vehicle.z))!;
    expect(oldCell.vehicleOccupied).toBe(false);
    expect(newCell.vehicleOccupied).toBe(true);
  });

  it('leaves a vehicle whose cell is outside the region untouched while relocating one inside it — proves the sweep discriminates by region, not a no-op', () => {
    const state = makeFlatNavState();
    blockRegion(state.navGrid!, REGION);

    const { vehicle: outside } = purchaseVehicle(state.vehicles, 'debris_hauler', 7, 7);
    const outsideCell = state.navGrid!.cellAt(7, 7)!;
    outsideCell.vehicleOccupied = true;

    const { vehicle: inside } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 2);
    state.navGrid!.cellAt(2, 2)!.vehicleOccupied = true;

    relocateFootprintOccupants(state, REGION);

    // The outside vehicle never moves...
    expect(outside.x).toBe(7);
    expect(outside.z).toBe(7);
    expect(outsideCell.vehicleOccupied).toBe(true);
    // ...while the inside one does — same sweep, same call, so the outside
    // result above is the region check discriminating, not the loop being a
    // no-op regardless of input.
    expect(inside.x === 2 && inside.z === 2).toBe(false);
  });

  it('relocates a mounted employee but deliberately leaves their vehicle untouched — the locomotion tick is the vehicle\'s only mover', () => {
    const state = makeFlatNavState();
    blockRegion(state.navGrid!, REGION);

    const rng = new Random(SEED);
    const { employee } = hireEmployee(state.employees, 'driver', rng, 2, 2);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 2);
    vehicle.occupantIds = [employee.id];
    employee.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    const oldCell = state.navGrid!.cellAt(2, 2)!;
    oldCell.vehicleOccupied = true;

    relocateFootprintOccupants(state, REGION);

    // The employee was relocated (the pre-existing employee sweep) — but the
    // vehicle they're mounted in is left exactly where it was. Moving it here
    // too, one tick early via this function's own reachability search rather
    // than the locomotion tick's normal per-tick sync, is what caused #1270's
    // own regression (building-destruction-visual: the vehicle landed on the
    // one open cell that was a nearby drill hole's only remaining approach,
    // sealing it off). The vehicle self-corrects to the employee's new cell
    // on the very next tick regardless, via Locomotion.ts's per-tick write —
    // the sole place a mounted vehicle's position ever changes.
    expect(employee.x === 2 && employee.z === 2).toBe(false);
    expect(vehicle.x).toBe(2);
    expect(vehicle.z).toBe(2);
    expect(oldCell.vehicleOccupied).toBe(true);
  });

  it('leaves an unoccupied vehicle untouched when its cell falls inside the footprint\'s bounding box but the patch never actually blocked it (#1270 regression)', () => {
    // A footprint's bounding box can geometrically contain a cell the patch
    // protects from becoming 'blocked' — a drill_hole keeps its own type
    // even when a building's box contains its coordinates (NavGridSync's
    // footprint-patch handling). A vehicle parked there was never stranded,
    // and relocating it anyway is not harmless: its `vehicleOccupied` flag
    // can seal the hole's own only approach from every walker afterward
    // (confirmed in building-destruction-visual — a freight_warehouse
    // footprint boxing a drill hole on three sides moved the vehicle parked
    // on the hole onto its fourth, sole approach).
    const state = makeFlatNavState();
    const nav = state.navGrid!;
    // Region matches the vehicle's own cell — normally this alone would
    // trigger relocation — but the cell keeps its 'drill_hole' type rather
    // than being blocked by the (fake, unapplied) footprint patch.
    const holeRegion: BlastRegion = { minX: 3, maxX: 3, minZ: 3, maxZ: 3 };
    nav.cellAt(3, 3)!.type = 'drill_hole';

    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 3, 3);
    const cell = nav.cellAt(3, 3)!;
    cell.vehicleOccupied = true;

    relocateFootprintOccupants(state, holeRegion);

    expect(vehicle.x).toBe(3);
    expect(vehicle.z).toBe(3);
    expect(cell.vehicleOccupied).toBe(true);
  });

  it('calls findNearestReachableCell for a stranded vehicle even when the grid is fully sealed — the fallback path still runs, not skipped', () => {
    // Seal the ENTIRE grid, including the (0,0) anchor
    // `relocateFootprintOccupants` searches from — so findNearestReachableCell
    // falls back to returning the vehicle's own (unchanged) coordinates (see
    // its own doc comment). That return value is numerically identical to
    // "the sweep never touched this vehicle at all", which a plain position
    // assertion can't tell apart from a no-op implementation — so this test
    // spies on the call itself: the fallback path running (and being
    // *reached*, i.e. the vehicle's own cell passed the 'blocked' guard
    // first) is the behavior under test, not the coincidental output value.
    const state = makeFlatNavState();
    const nav = state.navGrid!;
    for (let z = 0; z < nav.height; z++) {
      for (let x = 0; x < nav.width; x++) {
        const cell = nav.cellAt(x, z)!;
        cell.type = 'blocked';
        cell.moveCost = Infinity;
      }
    }

    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 2);
    const spy = vi.spyOn(NavGrid, 'findNearestReachableCell');

    relocateFootprintOccupants(state, REGION);

    expect(spy).toHaveBeenCalledWith(nav, 0, 0, 2, 2, true);
    const expected = spy.mock.results[0]!.value as { x: number; z: number };
    expect(vehicle.x).toBe(expected.x);
    expect(vehicle.z).toBe(expected.z);
    spy.mockRestore();
  });

  it('on a site with a vehicle network, moves a parked vehicle onto the network, never onto ground only walkers reach (#2045)', () => {
    // West of x = 4 a terrace 0.5 m lower: a step a walker takes and a 20-degree vehicle does not. The rally point is
    // east; the nearest free cell to the hauler, and the corner-anchored search's pick, is on the terrace.
    const state = createGame({ seed: SEED });
    state.grade = createGradeState();
    const grid = new VoxelGrid(12, 12);
    const compId = grid.palette.intern(VEHICLE_ROCK_COMPOSITION);
    for (let z = 0; z < 12; z++) {
      for (let x = 0; x < 12; x++) setVoxelColumnSurfaceHeight(grid, x, z, x < 4 ? 10 : 10.5, compId);
    }
    const nav = NavGrid.buildNavGrid(grid, [], []);
    state.navGrid = nav;
    state.rallyPoint = { x: 9, z: 9 };
    const footprint: BlastRegion = { minX: 4, maxX: 6, minZ: 3, maxZ: 7 };
    blockRegion(nav, footprint);
    nav.bumpRevision();
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 4, 5);
    const network = siteVehicleReach(state)!;
    expect(network(3, 5)).toBe(false);

    relocateFootprintOccupants(state, footprint);

    expect(insideRegion(vehicle.x, vehicle.z, footprint)).toBe(false);
    expect(network(vehicle.x, vehicle.z)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// relocateFootprintOccupants — employees (#2097)
//
// The employee sweep must land a displaced employee on a free cell connected to
// the cell they stood on, not on whatever cell the world corner (0, 0) reaches.
// A corner sitting in a pocket (a raised column, a walled-off nook) used to
// teleport every displaced employee across the map to (0, 0).
// ═══════════════════════════════════════════════════════════════════════════════

describe('relocateFootprintOccupants — employees (#2097)', () => {
  const ROCK_COMPOSITION = { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] };
  const SIZE = 12;
  const BASE_HEIGHT = 10;
  /** A rise a walker (about 30 degrees) cannot climb between adjacent cells. */
  const CLIFF = 3;

  /** A SIZE x SIZE game whose surface height per column comes from `heightAt`. */
  function makeNavState(heightAt: (x: number, z: number) => number): GameState {
    const state = createGame({ seed: SEED });
    const grid = new VoxelGrid(SIZE, SIZE);
    const compId = grid.palette.intern(ROCK_COMPOSITION);
    for (let z = 0; z < SIZE; z++) {
      for (let x = 0; x < SIZE; x++) setVoxelColumnSurfaceHeight(grid, x, z, heightAt(x, z), compId);
    }
    state.navGrid = NavGrid.buildNavGrid(grid, [], []);
    return state;
  }

  /** Corner column raised out of reach of its neighbours: (0, 0) is an isolated pocket. */
  function makeIsolatedCornerState(): GameState {
    return makeNavState((x, z) => (x === 0 && z === 0 ? BASE_HEIGHT + CLIFF : BASE_HEIGHT));
  }

  function hireAt(state: GameState, x: number, z: number) {
    const { employee } = hireEmployee(state.employees, 'driver', new Random(SEED), x, z);
    return employee;
  }

  function chebyshev(ax: number, az: number, bx: number, bz: number): number {
    return Math.max(Math.abs(ax - bx), Math.abs(az - bz));
  }

  function isTraversable(state: GameState, x: number, z: number): boolean {
    const type = state.navGrid!.cellAt(Math.round(x), Math.round(z))?.type;
    return type !== undefined && type !== 'blocked' && type !== 'void';
  }

  const MID_REGION: BlastRegion = { minX: 5, maxX: 6, minZ: 5, maxZ: 6 };

  it('corner in an isolated pocket: a mid-map employee lands beside the footprint, not on the world corner (reproduction)', () => {
    const state = makeIsolatedCornerState();
    blockRegion(state.navGrid!, MID_REGION);
    const emp = hireAt(state, 6, 6);

    relocateFootprintOccupants(state, MID_REGION);

    expect(emp.x === 0 && emp.z === 0).toBe(false);
    expect(insideRegion(emp.x, emp.z, MID_REGION)).toBe(false);
    expect(isTraversable(state, emp.x, emp.z)).toBe(true);
    expect(chebyshev(emp.x, emp.z, 6, 6)).toBeLessThanOrEqual(2);
  });

  it('corner walled off by blocked cells: a mid-map employee still lands beside the footprint', () => {
    const state = makeNavState(() => BASE_HEIGHT);
    for (const [x, z] of [[1, 0], [1, 1], [0, 1]] as const) {
      const cell = state.navGrid!.cellAt(x, z)!;
      cell.type = 'blocked';
      cell.moveCost = Infinity;
    }
    blockRegion(state.navGrid!, MID_REGION);
    const emp = hireAt(state, 5, 5);

    relocateFootprintOccupants(state, MID_REGION);

    expect(emp.x === 0 && emp.z === 0).toBe(false);
    expect(insideRegion(emp.x, emp.z, MID_REGION)).toBe(false);
    expect(chebyshev(emp.x, emp.z, 5, 5)).toBeLessThanOrEqual(2);
  });

  it('picks the nearest free cell connected to the employee, skipping a nearer cell in a disconnected pocket', () => {
    // Raised column at (3, 5) is the geometrically nearest free cell to an
    // employee at (4, 5), but a walker cannot climb onto it.
    const state = makeNavState((x, z) => (x === 3 && z === 5 ? BASE_HEIGHT + CLIFF : BASE_HEIGHT));
    const footprint: BlastRegion = { minX: 4, maxX: 6, minZ: 4, maxZ: 6 };
    blockRegion(state.navGrid!, footprint);
    const emp = hireAt(state, 4, 5);

    relocateFootprintOccupants(state, footprint);

    expect(emp.x === 3 && emp.z === 5).toBe(false);
    expect([[3, 4], [3, 6]]).toContainEqual([emp.x, emp.z]);
  });

  it('every employee inside the footprint is relocated off it and none is sent to the corner', () => {
    const state = makeIsolatedCornerState();
    blockRegion(state.navGrid!, MID_REGION);
    const placed = [hireAt(state, 5, 5), hireAt(state, 6, 6), hireAt(state, 5, 6)];

    relocateFootprintOccupants(state, MID_REGION);

    for (const emp of placed) {
      expect(insideRegion(emp.x, emp.z, MID_REGION)).toBe(false);
      expect(emp.x === 0 && emp.z === 0).toBe(false);
      expect(isTraversable(state, emp.x, emp.z)).toBe(true);
    }
  });

  it('a fractional mid-stride position inside the footprint counts as inside and is relocated', () => {
    const state = makeIsolatedCornerState();
    blockRegion(state.navGrid!, MID_REGION);
    const emp = hireAt(state, 5, 5);
    emp.x = 5.4;
    emp.z = 5.6;

    relocateFootprintOccupants(state, MID_REGION);

    expect(insideRegion(emp.x, emp.z, MID_REGION)).toBe(false);
    expect(emp.x === 0 && emp.z === 0).toBe(false);
  });

  it('corner in the employee component: lands on the nearest free cell, as before', () => {
    const state = makeNavState(() => BASE_HEIGHT);
    const footprint: BlastRegion = { minX: 4, maxX: 6, minZ: 4, maxZ: 6 };
    blockRegion(state.navGrid!, footprint);
    const emp = hireAt(state, 4, 5);

    relocateFootprintOccupants(state, footprint);

    expect(emp.x).toBe(3);
    expect(emp.z).toBe(5);
  });

  it('corner in the employee component: matches the corner-anchored nearest-reachable answer', () => {
    const state = makeNavState(() => BASE_HEIGHT);
    const footprint: BlastRegion = { minX: 4, maxX: 6, minZ: 4, maxZ: 6 };
    blockRegion(state.navGrid!, footprint);
    const emp = hireAt(state, 4, 5);
    const expected = NavGrid.findNearestReachableCell(state.navGrid!, 0, 0, emp.x, emp.z, true);

    relocateFootprintOccupants(state, footprint);

    expect({ x: emp.x, z: emp.z }).toEqual(expected);
  });

  it('prefers a free cell on the employee\'s own bench level over a nearer cell across a bench boundary', () => {
    const state = makeNavState(() => BASE_HEIGHT);
    const footprint: BlastRegion = { minX: 4, maxX: 6, minZ: 4, maxZ: 6 };
    blockRegion(state.navGrid!, footprint);
    const emp = hireAt(state, 4, 5);
    const ownLevel = state.navGrid!.cellAt(4, 5)!.benchLevel;
    // The nearest free cell, (3, 5), sits on another bench.
    state.navGrid!.cellAt(3, 5)!.benchLevel = ownLevel + 1;

    relocateFootprintOccupants(state, footprint);

    expect(state.navGrid!.cellAt(emp.x, emp.z)!.benchLevel).toBe(ownLevel);
    expect(insideRegion(emp.x, emp.z, footprint)).toBe(false);
  });

  it('a footprint that seals the employee in: ends on a traversable cell near where they stood, never the corner', () => {
    const state = makeNavState(() => BASE_HEIGHT);
    // Ring of blocked cells one wider than the footprint walls the inside off from every free cell.
    const ring: BlastRegion = { minX: 4, maxX: 7, minZ: 4, maxZ: 7 };
    blockRegion(state.navGrid!, ring);
    const emp = hireAt(state, 5, 5);

    relocateFootprintOccupants(state, MID_REGION);

    expect(emp.x === 0 && emp.z === 0).toBe(false);
    expect(isTraversable(state, emp.x, emp.z)).toBe(true);
    expect(chebyshev(emp.x, emp.z, 5, 5)).toBeLessThanOrEqual(4);
  });

  it('a footprint that seals the employee in, with the corner also an isolated pocket: still not the corner', () => {
    const state = makeIsolatedCornerState();
    const ring: BlastRegion = { minX: 4, maxX: 7, minZ: 4, maxZ: 7 };
    blockRegion(state.navGrid!, ring);
    const emp = hireAt(state, 6, 6);

    relocateFootprintOccupants(state, MID_REGION);

    expect(emp.x === 0 && emp.z === 0).toBe(false);
    expect(isTraversable(state, emp.x, emp.z)).toBe(true);
    expect(chebyshev(emp.x, emp.z, 6, 6)).toBeLessThanOrEqual(4);
  });

  it('a mounted employee is relocated off the corner pocket default while only their own x/z are written — the vehicle is untouched', () => {
    const state = makeIsolatedCornerState();
    blockRegion(state.navGrid!, MID_REGION);
    const emp = hireAt(state, 6, 6);
    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 6, 6);
    vehicle.occupantIds = [emp.id];
    emp.locomotion = { kind: 'mounted', vehicleId: vehicle.id };
    const vehicleCell = state.navGrid!.cellAt(6, 6)!;
    vehicleCell.vehicleOccupied = true;

    relocateFootprintOccupants(state, MID_REGION);

    expect(emp.x === 0 && emp.z === 0).toBe(false);
    expect(insideRegion(emp.x, emp.z, MID_REGION)).toBe(false);
    expect(vehicle.x).toBe(6);
    expect(vehicle.z).toBe(6);
    expect(vehicle.occupantIds).toEqual([emp.id]);
    expect(vehicleCell.vehicleOccupied).toBe(true);
  });

  it('leaves a dead employee and an employee outside the footprint exactly where they are', () => {
    const state = makeIsolatedCornerState();
    blockRegion(state.navGrid!, MID_REGION);
    const outside = hireAt(state, 9, 9);
    const dead = hireAt(state, 5, 5);
    dead.alive = false;
    const inside = hireAt(state, 6, 5);

    relocateFootprintOccupants(state, MID_REGION);

    expect([outside.x, outside.z]).toEqual([9, 9]);
    expect([dead.x, dead.z]).toEqual([5, 5]);
    // The sweep did run: the live employee in the footprint moved.
    expect(insideRegion(inside.x, inside.z, MID_REGION)).toBe(false);
  });

  it('does not land an employee on a cell a vehicle occupies', () => {
    const state = makeIsolatedCornerState();
    const footprint: BlastRegion = { minX: 4, maxX: 6, minZ: 4, maxZ: 6 };
    blockRegion(state.navGrid!, footprint);
    const emp = hireAt(state, 4, 5);
    state.navGrid!.cellAt(3, 5)!.vehicleOccupied = true;

    relocateFootprintOccupants(state, footprint);

    expect(emp.x === 3 && emp.z === 5).toBe(false);
    expect(insideRegion(emp.x, emp.z, footprint)).toBe(false);
    expect(emp.x === 0 && emp.z === 0).toBe(false);
  });
});
