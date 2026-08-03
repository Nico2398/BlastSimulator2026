// BlastSimulator2026 — Pathfinding and reachability on a shifted NavGrid (#473 D7)
//
// A site that grows west or north starts at a negative world coordinate, so
// NavGrid carries an origin and `cells` is indexed locally while every public
// query takes world coordinates. A* keeps flat scratch arrays keyed by a local
// index, and the reachability flood fills pack local indices into a queue —
// both convert at the boundary. An off-by-origin there aliases two different
// cells onto one slot, which does not throw: it silently returns a path
// through a wall, or declares a reachable cell unreachable.
//
// The load-bearing test is `shifted grids behave identically`: the same maze
// laid out at the origin and at a negative origin must produce the same route
// and the same cost, shifted. Any aliasing breaks that equality.

import { describe, it, expect } from 'vitest';
import {
  findPath, getBenchLevel, findRampConnections, type PathRequest,
} from '../../../src/core/nav/Pathfinding.js';
import {
  isTraversableCell, findNearestTraversableCell, findNearestReachableCell, computeReachableSet,
} from '../../../src/core/nav/NavGridReachability.js';
import { NavGrid, type NavCell, type NavCellType } from '../../../src/core/nav/NavGrid.js';
import { VoxelGrid } from '../../../src/core/world/VoxelGrid.js';

function makeCell(type: NavCellType, benchLevel = 0): NavCell {
  const moveCost = type === 'walkable' ? 1.0
    : type === 'ramp' ? 1.8
      : type === 'drill_hole' ? 5.0
        : Infinity;
  return { type, moveCost, benchLevel, vehicleOccupied: false };
}

/**
 * Build a grid from an ASCII map, placed with its top-left at (originX, originZ).
 * `.` walkable, `#` blocked, `r` ramp. Row 0 is the northmost row.
 */
function gridFromMap(map: string[], originX: number, originZ: number, maxSurfaceY = 0): NavGrid {
  const cells = map.map(row => [...row].map(ch =>
    makeCell(ch === '#' ? 'blocked' : ch === 'r' ? 'ramp' : 'walkable')));
  return new NavGrid(map[0]!.length, map.length, cells, maxSurfaceY, originX, originZ);
}

/** A corridor maze with exactly one route from the top-left to the bottom-right. */
const MAZE = [
  '.....',
  '####.',
  '.....',
  '.####',
  '.....',
];

function request(fromX: number, fromZ: number, toX: number, toZ: number): PathRequest {
  return { agentId: 1, fromX, fromZ, toX, toZ, avoidVehicles: false };
}

describe('NavGrid — world-coordinate accessors on a shifted grid', () => {
  const grid = gridFromMap(MAZE, -32, -16);

  it('reports the covered box in world coordinates', () => {
    expect(grid.originX).toBe(-32);
    expect(grid.originZ).toBe(-16);
    expect(grid.maxX).toBe(-27);
    expect(grid.maxZ).toBe(-11);
  });

  it('containsCell accepts the shifted box and rejects the un-shifted one', () => {
    expect(grid.containsCell(-32, -16)).toBe(true);
    expect(grid.containsCell(-28, -12)).toBe(true);
    expect(grid.containsCell(-27, -16)).toBe(false);
    // (0, 0) would be in bounds if the origin were being ignored.
    expect(grid.containsCell(0, 0)).toBe(false);
  });

  it('cellAt resolves world coordinates to the right row, not the local one', () => {
    // MAZE row 1 is '####.' — so (-32, -15) is blocked and (-28, -15) is not.
    expect(grid.cellAt(-32, -15)!.type).toBe('blocked');
    expect(grid.cellAt(-28, -15)!.type).toBe('walkable');
    expect(grid.cellAt(0, 0)).toBeUndefined();
  });

  it('setCellAt writes through world coordinates and ignores out-of-box writes', () => {
    const g = gridFromMap(MAZE, -32, -16);
    g.setCellAt(-32, -16, makeCell('drill_hole'));
    expect(g.cellAt(-32, -16)!.type).toBe('drill_hole');
    expect(() => g.setCellAt(500, 500, makeCell('blocked'))).not.toThrow();
  });

  it('clamps a far-away coordinate into the shifted box', () => {
    expect(grid.clampX(-9999)).toBe(-32);
    expect(grid.clampX(9999)).toBe(-28);
    expect(grid.clampZ(9999)).toBe(-12);
  });
});

describe('findPath on a shifted grid', () => {
  it('routes through the maze and returns world-coordinate waypoints', () => {
    const grid = gridFromMap(MAZE, -32, -16);
    const result = findPath(grid, request(-32, -16, -28, -12));

    expect(result.found).toBe(true);
    for (const wp of result.waypoints) {
      expect(wp.x).toBeGreaterThanOrEqual(-32);
      expect(wp.x).toBeLessThanOrEqual(-28);
      expect(wp.z).toBeGreaterThanOrEqual(-16);
      expect(wp.z).toBeLessThanOrEqual(-12);
    }
    expect(result.waypoints[0]).toEqual({ x: -32, z: -16 });
    expect(result.waypoints[result.waypoints.length - 1]).toEqual({ x: -28, z: -12 });
  });

  it('never routes through a blocked cell', () => {
    const grid = gridFromMap(MAZE, -32, -16);
    const result = findPath(grid, request(-32, -16, -28, -12));
    for (const wp of result.waypoints) {
      expect(grid.cellAt(wp.x, wp.z)!.type).not.toBe('blocked');
    }
  });

  it('returns contiguous waypoints — each step is a single cell move', () => {
    const grid = gridFromMap(MAZE, -32, -16);
    const { waypoints } = findPath(grid, request(-32, -16, -28, -12));
    for (let i = 1; i < waypoints.length; i++) {
      const dx = Math.abs(waypoints[i]!.x - waypoints[i - 1]!.x);
      const dz = Math.abs(waypoints[i]!.z - waypoints[i - 1]!.z);
      expect(Math.max(dx, dz)).toBe(1);
    }
  });

  it('shifted grids behave identically — same route, same cost, just offset', () => {
    const atOrigin = gridFromMap(MAZE, 0, 0);
    const shifted = gridFromMap(MAZE, -32, -16);

    const a = findPath(atOrigin, request(0, 0, 4, 4));
    const b = findPath(shifted, request(-32, -16, -28, -12));

    expect(b.found).toBe(a.found);
    expect(b.totalCost).toBeCloseTo(a.totalCost, 10);
    expect(b.waypoints).toEqual(a.waypoints.map(w => ({ x: w.x - 32, z: w.z - 16 })));
  });

  it('refuses a goal walled off inside the shifted grid', () => {
    const grid = gridFromMap([
      '..#..',
      '..#..',
      '..#..',
    ], -48, -48);
    expect(findPath(grid, request(-48, -48, -44, -48)).found).toBe(false);
  });

  it('reports start == goal at a negative coordinate as a trivial path', () => {
    const grid = gridFromMap(MAZE, -32, -16);
    const result = findPath(grid, request(-32, -16, -32, -16));
    expect(result.found).toBe(true);
    expect(result.waypoints).toEqual([{ x: -32, z: -16 }]);
    expect(result.totalCost).toBe(0);
  });

  it('clamps an out-of-box request into the shifted grid rather than failing', () => {
    const grid = gridFromMap(['.....'], -32, -16);
    const result = findPath(grid, request(-9999, -9999, 9999, 9999));
    expect(result.found).toBe(true);
    expect(result.waypoints[0]).toEqual({ x: -32, z: -16 });
  });
});

describe('bench levels and ramps on a shifted grid', () => {
  it('getBenchLevel reads the cell the world coordinate names', () => {
    const cells = [[makeCell('walkable', 0), makeCell('walkable', 3)]];
    const grid = new NavGrid(2, 1, cells, 9, -20, -8);
    expect(getBenchLevel(grid, -20, -8)).toBe(0);
    expect(getBenchLevel(grid, -19, -8)).toBe(3);
  });

  it('findRampConnections reports ramp and neighbour positions in world coordinates', () => {
    const cells = [[
      makeCell('walkable', 0), makeCell('ramp', 0), makeCell('walkable', 2),
    ]];
    const grid = new NavGrid(3, 1, cells, 9, -20, -8);

    const [connection] = findRampConnections(grid);
    expect(connection).toBeDefined();
    expect(connection!.rampX).toBe(-19);
    expect(connection!.rampZ).toBe(-8);
    expect([connection!.upperX, connection!.lowerX].sort((a, b) => a - b)).toEqual([-20, -18]);
  });
});

describe('reachability on a shifted grid', () => {
  const OPEN = ['.....', '.....', '.....'];

  it('isTraversableCell answers in world coordinates', () => {
    const grid = gridFromMap(OPEN, -32, -16);
    expect(isTraversableCell(grid, -32, -16)).toBe(true);
    expect(isTraversableCell(grid, 0, 0)).toBe(false);
  });

  it('findNearestTraversableCell returns a world coordinate inside the box', () => {
    const grid = gridFromMap(['#.#', '...', '#.#'], -32, -16);
    const found = findNearestTraversableCell(grid, -32, -16);
    expect(grid.containsCell(found.x, found.z)).toBe(true);
    expect(grid.cellAt(found.x, found.z)!.type).not.toBe('blocked');
  });

  it('computeReachableSet.has answers in world coordinates, not local ones', () => {
    const grid = gridFromMap(OPEN, -32, -16);
    const set = computeReachableSet(grid, -32, -16);
    expect(set.has(-30, -15)).toBe(true);
    expect(set.has(0, 0)).toBe(false);
    expect(set.size).toBe(15);
  });

  it('computeReachableSet excludes a walled-off pocket in the shifted grid', () => {
    const grid = gridFromMap([
      '.#.',
      '.#.',
      '.#.',
    ], -40, -40);
    const set = computeReachableSet(grid, -40, -40);
    expect(set.has(-40, -38)).toBe(true);
    expect(set.has(-38, -40)).toBe(false);
  });

  it('findNearestReachableCell lands on a cell connected to the anchor', () => {
    const grid = gridFromMap([
      '.#.',
      '.#.',
      '.#.',
    ], -40, -40);
    const found = findNearestReachableCell(grid, -40, -40, -38, -40);
    expect(computeReachableSet(grid, -40, -40).has(found.x, found.z)).toBe(true);
  });
});

describe('a real claimed-westward VoxelGrid drives a shifted NavGrid', () => {
  /** A 16 m site plus the chunk west of it, both floored with solid ground. */
  function claimedWestwardGrid(): VoxelGrid {
    const grid = new VoxelGrid(16, 8, 16);
    grid.addChunk(-1, 0);
    for (let x = -16; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        grid.fillVoxel(x, 0, z, 0, undefined, 1);
      }
    }
    return grid;
  }

  it('buildNavGrid takes its origin and width from the claimed set', () => {
    const nav = NavGrid.buildNavGrid(claimedWestwardGrid(), [], []);
    expect(nav.originX).toBe(-16);
    expect(nav.width).toBe(32);
    expect(nav.cellAt(-16, 0)!.type).toBe('walkable');
    expect(nav.cellAt(15, 15)!.type).toBe('walkable');
  });

  it('an agent can path from the original site into the claimed chunk', () => {
    const nav = NavGrid.buildNavGrid(claimedWestwardGrid(), [], []);
    const result = findPath(nav, request(14, 8, -14, 8));

    expect(result.found).toBe(true);
    expect(result.waypoints[result.waypoints.length - 1]).toEqual({ x: -14, z: 8 });
    // The route genuinely crosses the old west edge into negative coordinates.
    expect(result.waypoints.some(w => w.x < 0)).toBe(true);
  });

  it('the claimed chunk is reachable from the original site, not an island', () => {
    const nav = NavGrid.buildNavGrid(claimedWestwardGrid(), [], []);
    const set = computeReachableSet(nav, 8, 8);
    expect(set.has(-14, 8)).toBe(true);
  });

  it('patchNavGrid rewrites the negative-coordinate cells a dig region names', () => {
    const voxels = claimedWestwardGrid();
    const nav = NavGrid.buildNavGrid(voxels, [], []);
    const untouched = nav.cellAt(-4, 8)!.type;

    // Carve the single column away, then patch just that cell.
    voxels.clearVoxel(-14, 0, 8);
    NavGrid.patchNavGrid(nav, voxels, [], [], { minX: -14, maxX: -14, minZ: 8, maxZ: 8 });

    expect(nav.cellAt(-14, 8)!.type).toBe('void');
    expect(nav.cellAt(-4, 8)!.type).toBe(untouched);
  });
});
