import { describe, it, expect } from 'vitest';
import { createGame, buildGameNavGrid } from '../../../src/core/state/GameState.js';
import { placeStartingCrew, isVehicleRouteAcceptable } from '../../../src/core/state/SpawnPlacement.js';
import { findPath } from '../../../src/core/nav/Pathfinding.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { CREW_SPAWN_VEHICLE_SEPARATION } from '../../../src/core/config/balance.js';
import { isLicensedForRole } from '../../../src/core/engine/VehicleReservation.js';
import type { Vehicle } from '../../../src/core/entities/Vehicle.js';

function solidVoxel(): VoxelData {
  return {
    composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
    density: 1.0,
    oreDensities: {},
    fractureModifier: 1.0,
  };
}

/** Flat ground across the whole site — every authored spawn is sound here. */
function makeFlatGrid(size: number, topY = 1): VoxelGrid {
  const grid = new VoxelGrid(size, size);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      for (let y = 0; y <= topY; y++) grid.setVoxel(x, y, z, solidVoxel());
    }
  }
  return grid;
}

/**
 * The shape #1166 was filed for: a face too steep to climb runs the width of
 * the site just past the spawn rows, with its only gap at the far edge. The
 * crew is not stranded — every cell stays reachable — it just has to walk the
 * length of the site and back to reach any of its own work.
 */
function makeWalledSpawnGrid(size: number, wallZ: number): VoxelGrid {
  const wallTopY = 12;
  const grid = new VoxelGrid(size, size);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const isWall = z === wallZ && x < size - 1;
      const top = isWall ? wallTopY : 1;
      for (let y = 0; y <= top; y++) grid.setVoxel(x, y, z, solidVoxel());
    }
  }
  return grid;
}

function positionsOf(state: ReturnType<typeof createGame>): string[] {
  return [...state.employees.employees, ...state.vehicles.vehicles].map(a => `${a.x},${a.z}`);
}

function pathSteps(
  state: ReturnType<typeof createGame>,
  from: { x: number; z: number },
  to: { x: number; z: number },
): number {
  const result = findPath(state.navGrid!, {
    agentId: 1,
    fromX: Math.round(from.x), fromZ: Math.round(from.z),
    toX: Math.round(to.x), toZ: Math.round(to.z),
    avoidVehicles: false,
  });
  return result.found ? result.waypoints.length : Number.POSITIVE_INFINITY;
}

function walledSite(size = 32): ReturnType<typeof createGame> {
  const state = createGame({ seed: 42, staffed: true });
  buildGameNavGrid(state, makeWalledSpawnGrid(size, 4), [], []);
  return state;
}

// ── #1179: vehicle-reachability-at-spawn fixtures ──────────────────────────
//
// A ridge running the full width (or depth) of the site, joined to the other
// side by a single gap far from where this fixture places its driver/vehicle
// pair — reproducing the shape #1179 is about: a licensed driver stranded on
// the far side of a slope from a vehicle two cells away in a straight line,
// with the only real route a long loop around to the gap (~19 waypoints for
// tutorial_pit's real debris_hauler case).

/** Ridge wall running the full grid width (axis 'z') or depth (axis 'x'), one gap. */
function makeAxisRidgeGrid(size: number, ridgeCoord: number, gapCoord: number, axis: 'x' | 'z'): VoxelGrid {
  const wallTopY = 12;
  const grid = new VoxelGrid(size, size);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const onRidge = axis === 'z' ? z === ridgeCoord : x === ridgeCoord;
      const atGap = axis === 'z' ? x === gapCoord : z === gapCoord;
      const top = onRidge && !atGap ? wallTopY : 1;
      for (let y = 0; y <= top; y++) grid.setVoxel(x, y, z, solidVoxel());
    }
  }
  return grid;
}

/**
 * tutorial_pit-shaped: a ridge along z=10, gap only at the far edge (x=31).
 * Every agent except the truck-licensed driver sits south of the ridge, close
 * to the grid centre (16,16) — so the crew's own aggregate spawn is sound
 * (isRouteAcceptable holds from the averaged anchor) and the pre-existing
 * crew-relocation phase is a no-op. Only the debris_hauler/truck-driver pair
 * straddles the ridge, isolating the new vehicle-fixup phase this file means
 * to exercise.
 */
function debrisHaulerRidgeSite(size = 32): ReturnType<typeof createGame> {
  const state = createGame({ seed: 42, staffed: true });
  buildGameNavGrid(state, makeAxisRidgeGrid(size, 10, size - 1, 'z'), [], []);

  const [driller, blaster, truckDriver, excavator1, excavator2] = state.employees.employees;
  const [drillRig, debrisHauler, rockDigger, rockFragmenter] = state.vehicles.vehicles;

  // South of the ridge (z > 10), clustered near the grid centre.
  driller!.x = 10; driller!.z = 16;
  blaster!.x = 11; blaster!.z = 16;
  excavator1!.x = 12; excavator1!.z = 16;
  excavator2!.x = 13; excavator2!.z = 16;
  drillRig!.x = 10; drillRig!.z = 18;
  rockDigger!.x = 12; rockDigger!.z = 18;
  rockFragmenter!.x = 14; rockFragmenter!.z = 18;
  debrisHauler!.x = 16; debrisHauler!.z = 15;

  // North of the ridge — the debris hauler's only truck-licensed driver,
  // straight-line distance 10 from the hauler but with no legal route short
  // of looping all the way round to the gap at x=31.
  truckDriver!.x = 16; truckDriver!.z = 5;

  return state;
}

/**
 * dusty_hollow-shaped: same property, a differently oriented ridge (along
 * x=10, gap at the far edge z=31) isolating the drill_rig from its only
 * licensed driller instead of the debris_hauler from its truck driver.
 */
function drillRigRidgeSite(size = 32): ReturnType<typeof createGame> {
  const state = createGame({ seed: 42, staffed: true });
  buildGameNavGrid(state, makeAxisRidgeGrid(size, 10, size - 1, 'x'), [], []);

  const [driller, blaster, truckDriver, excavator1, excavator2] = state.employees.employees;
  const [drillRig, debrisHauler, rockDigger, rockFragmenter] = state.vehicles.vehicles;

  // East of the ridge (x > 10), clustered near the grid centre.
  blaster!.x = 16; blaster!.z = 11;
  truckDriver!.x = 16; truckDriver!.z = 12;
  excavator1!.x = 16; excavator1!.z = 13;
  excavator2!.x = 16; excavator2!.z = 14;
  drillRig!.x = 11; drillRig!.z = 16;
  debrisHauler!.x = 18; debrisHauler!.z = 11;
  rockDigger!.x = 18; rockDigger!.z = 13;
  rockFragmenter!.x = 18; rockFragmenter!.z = 14;

  // West of the ridge — the drill_rig's only licensed driller, straight-line
  // distance 2 from the rig but with no legal route short of looping round
  // to the gap at z=31.
  driller!.x = 9; driller!.z = 16;

  return state;
}

/**
 * Whether at least one employee licensed for `vehicle`'s role can reach it
 * along a route accepted by the real `isVehicleRouteAcceptable` check —
 * the exact formula `fixUnreachableVehicles` is specified to enforce, called
 * here rather than reimplemented so a bug in the production formula itself
 * cannot slip past its own test's oracle.
 * Vacuously true when no employee holds the licence at all: that is the skip
 * case, covered by its own test below, not a reachability failure.
 */
function hasReachableLicensedDriver(state: ReturnType<typeof createGame>, vehicle: Vehicle): boolean {
  const licensed = state.employees.employees.filter(e => isLicensedForRole(e, vehicle.type));
  if (licensed.length === 0) return true;

  return licensed.some(emp =>
    isVehicleRouteAcceptable(
      state.navGrid!,
      { x: Math.round(emp.x), z: Math.round(emp.z) },
      { x: Math.round(vehicle.x), z: Math.round(vehicle.z) },
    ),
  );
}

describe('placeStartingCrew', () => {
  it('moves a crew whose authored spawn is walled off from its own site', () => {
    const state = walledSite();

    expect(placeStartingCrew(state)).toBe(true);
  });

  it('leaves the moved crew a short walk from the middle of the site', () => {
    const state = walledSite();
    const before = pathSteps(state, { x: 4, z: 1 }, { x: 16, z: 16 });

    placeStartingCrew(state);

    const after = pathSteps(state, state.employees.employees[0]!, { x: 16, z: 16 });
    // The detour around the wall is the defect; anything close to a straight
    // line (~16 cells for this fixture) is the fix.
    expect(after).toBeLessThan(before / 2);
    expect(after).toBeLessThanOrEqual(24);
  });

  it('puts every employee within a few legal steps of every starting vehicle', () => {
    const state = walledSite();

    placeStartingCrew(state);

    for (const employee of state.employees.employees) {
      for (const vehicle of state.vehicles.vehicles) {
        // Short, not merely finite: the bug this guards was a route that
        // existed and cost 113 waypoints to cross two metres.
        expect(pathSteps(state, employee, vehicle)).toBeLessThanOrEqual(16);
      }
    }
  });

  it('keeps starting vehicles CREW_SPAWN_VEHICLE_SEPARATION cells apart', () => {
    const state = walledSite();

    placeStartingCrew(state);

    const vehicles = state.vehicles.vehicles;
    for (let i = 0; i < vehicles.length; i++) {
      for (let j = i + 1; j < vehicles.length; j++) {
        const a = vehicles[i]!, b = vehicles[j]!;
        expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)))
          .toBeGreaterThanOrEqual(CREW_SPAWN_VEHICLE_SEPARATION);
      }
    }
  });

  it('never puts an employee on a cell a vehicle occupies', () => {
    const state = walledSite();

    placeStartingCrew(state);

    const vehicleCells = new Set(state.vehicles.vehicles.map(v => `${v.x},${v.z}`));
    for (const employee of state.employees.employees) {
      expect(vehicleCells.has(`${employee.x},${employee.z}`)).toBe(false);
    }
  });

  it('places the same crew in the same cells on every run', () => {
    const runs = [0, 1].map(() => {
      const state = walledSite();
      placeStartingCrew(state);
      return positionsOf(state);
    });

    expect(runs[0]).toEqual(runs[1]);
  });

  it('leaves an authored spawn on ordinary ground exactly where the level put it', () => {
    const state = createGame({ seed: 42, staffed: true });
    buildGameNavGrid(state, makeFlatGrid(32), [], []);
    const before = positionsOf(state);

    // A level's spawn coordinates are a design decision — work sites are
    // authored around them — so sound ground is never second-guessed.
    expect(placeStartingCrew(state)).toBe(false);
    expect(positionsOf(state)).toEqual(before);
  });

  it('reports failure and moves nobody when no navgrid has been built yet', () => {
    const state = createGame({ seed: 42, staffed: true });
    const before = positionsOf(state);

    expect(placeStartingCrew(state)).toBe(false);
    expect(positionsOf(state)).toEqual(before);
  });

  it('moves nobody on a site too small to hold the crew apart', () => {
    const state = createGame({ seed: 42, staffed: true });
    buildGameNavGrid(state, makeFlatGrid(4), [], []);
    const before = positionsOf(state);

    expect(placeStartingCrew(state)).toBe(false);
    expect(positionsOf(state)).toEqual(before);
  });

  it('does nothing for an unstaffed game that has no crew to place', () => {
    const state = createGame({ seed: 42 });
    buildGameNavGrid(state, makeFlatGrid(32), [], []);

    expect(placeStartingCrew(state)).toBe(false);
  });
});

// ── #1179: vehicle reachability at staffed spawn ────────────────────────────

describe('placeStartingCrew — vehicle reachability (#1179)', () => {
  it('gives the debris_hauler a licensed driver within tolerance after fixing the tutorial_pit-shaped ridge case', () => {
    const state = debrisHaulerRidgeSite();
    const debrisHauler = state.vehicles.vehicles.find(v => v.type === 'debris_hauler')!;
    // Confirms the fixture actually reproduces the bug before asserting the fix.
    expect(hasReachableLicensedDriver(state, debrisHauler)).toBe(false);

    placeStartingCrew(state);

    expect(hasReachableLicensedDriver(state, debrisHauler)).toBe(true);
  });

  it('gives every vehicle a licensed driver within tolerance after fixing the dusty_hollow-shaped ridge case', () => {
    const state = drillRigRidgeSite();
    const drillRig = state.vehicles.vehicles.find(v => v.type === 'drill_rig')!;
    expect(hasReachableLicensedDriver(state, drillRig)).toBe(false);

    placeStartingCrew(state);

    for (const vehicle of state.vehicles.vehicles) {
      expect(hasReachableLicensedDriver(state, vehicle)).toBe(true);
    }
  });

  it('places the same crew and fleet in the same cells on every run of the vehicle-fixup phase', () => {
    const runs = [0, 1].map(() => {
      const state = debrisHaulerRidgeSite();
      placeStartingCrew(state);
      return positionsOf(state);
    });

    expect(runs[0]).toEqual(runs[1]);
  });

  it('leaves every vehicle exactly where it was on flat ground, since no vehicle ever trips the ratio check there', () => {
    const state = createGame({ seed: 42, staffed: true });
    buildGameNavGrid(state, makeFlatGrid(32), [], []);
    const before = state.vehicles.vehicles.map(v => ({ x: v.x, z: v.z }));
    for (const vehicle of state.vehicles.vehicles) {
      expect(hasReachableLicensedDriver(state, vehicle)).toBe(true);
    }

    expect(placeStartingCrew(state)).toBe(false);

    const after = state.vehicles.vehicles.map(v => ({ x: v.x, z: v.z }));
    expect(after).toEqual(before);
  });

  it('does not crash and leaves a vehicle where it was when no employee holds any licence at all', () => {
    const state = debrisHaulerRidgeSite();
    for (const employee of state.employees.employees) employee.qualifications = [];
    const debrisHauler = state.vehicles.vehicles.find(v => v.type === 'debris_hauler')!;
    const before = { x: debrisHauler.x, z: debrisHauler.z };

    let result = false;
    expect(() => { result = placeStartingCrew(state); }).not.toThrow();
    expect(result).toBe(false);
    expect(debrisHauler.x).toBe(before.x);
    expect(debrisHauler.z).toBe(before.z);
  });
});
