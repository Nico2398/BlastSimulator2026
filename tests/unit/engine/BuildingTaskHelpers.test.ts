// BlastSimulator2026 — Unit tests: BuildingTaskHelpers (#1086)
//
// Core-owned relocation of src/console/commands/buildingHelpers.ts's pure
// building/footprint/nav-patch helpers. TaskCompletionEffects.ts's own tests
// already exercise these indirectly through applyTaskCompletion's
// place_building branch; these tests call each function directly per
// core-purity.md's "adding an exported function here means adding its unit
// test in the mirrored tests/unit/ path" convention.

import { describe, it, expect } from 'vitest';
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
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import type { BlastRegion } from '../../../src/core/mining/BlastExecution.js';

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

  it('an unoccupied vehicle with no reachable cell nearby ends up wherever findNearestReachableCell\'s own fallback returns — unchanged behavior, not a new one', () => {
    const state = makeFlatNavState();
    // Seal the ENTIRE grid, including the (0,0) anchor
    // `relocateFootprintOccupants` searches from — so findNearestReachableCell
    // has nothing traversable to fall back to and returns the target
    // coordinates unchanged (see its own doc comment).
    const nav = state.navGrid!;
    for (let z = 0; z < nav.height; z++) {
      for (let x = 0; x < nav.width; x++) {
        const cell = nav.cellAt(x, z)!;
        cell.type = 'blocked';
        cell.moveCost = Infinity;
      }
    }

    const { vehicle } = purchaseVehicle(state.vehicles, 'debris_hauler', 2, 2);
    const expected = NavGrid.findNearestReachableCell(nav, 0, 0, vehicle.x, vehicle.z, true);

    relocateFootprintOccupants(state, REGION);

    expect(vehicle.x).toBe(expected.x);
    expect(vehicle.z).toBe(expected.z);
  });
});
