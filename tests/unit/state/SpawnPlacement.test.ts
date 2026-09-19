import { describe, it, expect } from 'vitest';
import { createGame, buildGameNavGrid } from '../../../src/core/state/GameState.js';
import { placeStartingCrew } from '../../../src/core/state/SpawnPlacement.js';
import { findPath } from '../../../src/core/nav/Pathfinding.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import { CREW_SPAWN_VEHICLE_SEPARATION } from '../../../src/core/config/balance.js';

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
  const grid = new VoxelGrid(size, topY + 3, size);
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
  const grid = new VoxelGrid(size, wallTopY + 3, size);
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
