import { describe, it, expect } from 'vitest';
import { createGame, buildGameNavGrid } from '../../../src/core/state/GameState.js';
import {
  rallyAreaHeightSpread, chooseRallyPoint, ensureRallyPoint, rallyConnectedCells, isFlatParkingCell, rallySpawnCell,
} from '../../../src/core/state/RallyPoint.js';
import { placeStartingCrew } from '../../../src/core/state/SpawnPlacement.js';
import { purchaseVehicle } from '../../../src/core/entities/Vehicle.js';
import { VoxelGrid, type VoxelData } from '../../../src/core/world/VoxelGrid.js';
import {
  CREW_SPAWN_VEHICLE_SEPARATION, RALLY_POINT_FLAT_RADIUS, RALLY_POINT_MAX_HEIGHT_SPREAD_M, RALLY_POINT_VEHICLE_STANDOFF,
} from '../../../src/core/config/balance.js';

function solidVoxel(): VoxelData {
  return {
    composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
    density: 1.0,
    oreDensities: {},
    fractureModifier: 1.0,
  };
}

/** A grid whose column (x, z) is solid up to `top(x, z)`. */
function makeGrid(size: number, top: (x: number, z: number) => number): VoxelGrid {
  const grid = new VoxelGrid(size, size);
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      for (let y = 0; y <= top(x, z); y++) grid.setVoxel(x, y, z, solidVoxel());
    }
  }
  return grid;
}

/** A state with a nav grid over `grid` and nobody on it. */
function siteOn(grid: VoxelGrid): ReturnType<typeof createGame> {
  const state = createGame({ seed: 42 });
  buildGameNavGrid(state, grid, [], []);
  return state;
}

const flat = (): VoxelGrid => makeGrid(32, () => 1);
/** A climbable hillside west of x=16 (one level every two columns), flat ground east of it. */
const hillThenPlain = (): VoxelGrid => makeGrid(32, x => 1 + Math.floor(Math.max(0, 16 - x) / 2));
const chebyshev = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

describe('rallyAreaHeightSpread', () => {
  it('is 0 across flat ground', () => {
    expect(rallyAreaHeightSpread(siteOn(flat()).navGrid!, 10, 10)).toBe(0);
  });

  it('measures the rise across the area on a slope', () => {
    const spread = rallyAreaHeightSpread(siteOn(hillThenPlain()).navGrid!, 6, 10);
    expect(spread).toBeGreaterThan(RALLY_POINT_MAX_HEIGHT_SPREAD_M);
  });

  it('is Infinity when the area runs off the grid', () => {
    expect(rallyAreaHeightSpread(siteOn(flat()).navGrid!, RALLY_POINT_FLAT_RADIUS - 1, 10)).toBe(Number.POSITIVE_INFINITY);
  });

  it('is Infinity when a building stands inside the area', () => {
    const state = createGame({ seed: 42 });
    buildGameNavGrid(state, flat(), [{ type: 'freight_warehouse', tier: 1, x: 10, z: 10 }], []);
    expect(rallyAreaHeightSpread(state.navGrid!, 11, 11)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('chooseRallyPoint', () => {
  it('keeps the preferred cell when its ground is flat', () => {
    expect(chooseRallyPoint(siteOn(flat()).navGrid!, { x: 12, z: 9 })).toEqual({ x: 12, z: 9 });
  });

  it('moves off a hillside to the nearest flat area', () => {
    const navGrid = siteOn(hillThenPlain()).navGrid!;
    const point = chooseRallyPoint(navGrid, { x: 4, z: 16 });
    expect(rallyAreaHeightSpread(navGrid, point.x, point.z)).toBeLessThanOrEqual(RALLY_POINT_MAX_HEIGHT_SPREAD_M);
    expect(point.z).toBe(16);
    expect(point.x).toBeLessThanOrEqual(16);
  });

  it('never picks a flat plateau walled off from the rest of the site', () => {
    // A flat plateau in the north-west corner atop a cliff nobody can climb,
    // above the flat floor that makes up the rest of the site.
    const grid = makeGrid(32, (x, z) => (x < 10 && z < 10 ? 30 : 1));
    const navGrid = siteOn(grid).navGrid!;
    const point = chooseRallyPoint(navGrid, { x: 4, z: 4 });
    expect(point.x >= 10 || point.z >= 10).toBe(true);
  });

  it('settles for the flattest ground when no area is flat enough', () => {
    const navGrid = siteOn(makeGrid(24, (x, z) => 1 + ((x + z) % 3))).navGrid!;
    const point = chooseRallyPoint(navGrid, { x: 12, z: 12 });
    expect(Number.isFinite(rallyAreaHeightSpread(navGrid, point.x, point.z))).toBe(true);
  });
});

describe('ensureRallyPoint', () => {
  it('chooses and records a point near the preferred cell when the state has none', () => {
    const state = siteOn(flat());
    expect(ensureRallyPoint(state, { x: 8, z: 20 })).toEqual({ x: 8, z: 20 });
    expect(state.rallyPoint).toEqual({ x: 8, z: 20 });
  });

  it('defaults to the site centre', () => {
    const state = siteOn(flat());
    expect(ensureRallyPoint(state)).toEqual({ x: 16, z: 16 });
  });

  it('never moves a point the state already has', () => {
    const state = siteOn(flat());
    state.rallyPoint = { x: 3, z: 3 };
    expect(ensureRallyPoint(state, { x: 20, z: 20 })).toEqual({ x: 3, z: 3 });
  });

  it('is null without a nav grid', () => {
    expect(ensureRallyPoint(createGame({ seed: 42 }))).toBeNull();
  });
});

describe('rallyConnectedCells', () => {
  it('starts at the start cell and grows nearest first', () => {
    const cells = rallyConnectedCells(siteOn(flat()).navGrid!, { x: 10, z: 10 }, 9);
    expect(cells[0]).toEqual({ x: 10, z: 10 });
    expect(cells).toHaveLength(9);
    for (const c of cells) expect(chebyshev(c, { x: 10, z: 10 })).toBeLessThanOrEqual(1);
  });

  it('never crosses a step too steep to climb', () => {
    const grid = makeGrid(16, x => (x < 8 ? 1 : 12));
    const cells = rallyConnectedCells(siteOn(grid).navGrid!, { x: 3, z: 8 }, 1000);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every(c => c.x < 8)).toBe(true);
  });
});

describe('isFlatParkingCell', () => {
  it('is true on flat ground and false on a hillside', () => {
    const navGrid = siteOn(makeGrid(32, x => 1 + Math.max(0, 16 - x))).navGrid!;
    expect(isFlatParkingCell(navGrid, { x: 24, z: 10 })).toBe(true);
    expect(isFlatParkingCell(navGrid, { x: 5, z: 10 })).toBe(false);
  });
});

describe('rallySpawnCell', () => {
  it('spawns an employee next to the flag, never on it', () => {
    const state = siteOn(flat());
    state.rallyPoint = { x: 10, z: 10 };
    const cell = rallySpawnCell(state, 'employee');
    expect(chebyshev(cell, state.rallyPoint)).toBe(1);
  });

  it('never spawns two employees on one cell', () => {
    const state = siteOn(flat());
    state.rallyPoint = { x: 10, z: 10 };
    const first = rallySpawnCell(state, 'employee');
    state.employees.employees.push({ id: 1, x: first.x, z: first.z } as never);
    const second = rallySpawnCell(state, 'employee');
    expect(second).not.toEqual(first);
  });

  it('keeps a vehicle its standoff from the flag and its separation from the fleet', () => {
    const state = siteOn(flat());
    state.rallyPoint = { x: 16, z: 16 };
    for (let i = 0; i < 4; i++) {
      const cell = rallySpawnCell(state, 'vehicle');
      expect(chebyshev(cell, state.rallyPoint)).toBeGreaterThanOrEqual(RALLY_POINT_VEHICLE_STANDOFF);
      for (const v of state.vehicles.vehicles) {
        expect(chebyshev(cell, v)).toBeGreaterThanOrEqual(CREW_SPAWN_VEHICLE_SEPARATION);
      }
      purchaseVehicle(state.vehicles, 'debris_hauler', cell.x, cell.z, 1);
    }
  });

  it('parks a vehicle on level ground when the flag stands at the foot of a hill', () => {
    const state = siteOn(hillThenPlain());
    state.rallyPoint = { x: 17, z: 16 };
    const cell = rallySpawnCell(state, 'vehicle');
    expect(isFlatParkingCell(state.navGrid!, cell)).toBe(true);
  });

  it('spawns at the default site centre when there is no grid', () => {
    expect(rallySpawnCell(createGame({ seed: 42 }), 'employee')).toEqual({ x: 32, z: 32 });
  });
});

describe('placeStartingCrew with a rally point', () => {
  it('gathers the whole staffed crew around the flag, leaving its cell clear', () => {
    const state = createGame({ seed: 42, staffed: true });
    buildGameNavGrid(state, makeGrid(48, () => 1), [], []);
    state.rallyPoint = { x: 30, z: 30 };

    expect(placeStartingCrew(state)).toBe(true);

    for (const agent of [...state.employees.employees, ...state.vehicles.vehicles]) {
      expect(chebyshev(agent, state.rallyPoint), `agent at (${agent.x},${agent.z})`).toBeLessThanOrEqual(8);
      expect(agent.x === 30 && agent.z === 30).toBe(false);
    }
    for (const vehicle of state.vehicles.vehicles) {
      expect(chebyshev(vehicle, state.rallyPoint)).toBeGreaterThanOrEqual(RALLY_POINT_VEHICLE_STANDOFF);
    }
  });
});
