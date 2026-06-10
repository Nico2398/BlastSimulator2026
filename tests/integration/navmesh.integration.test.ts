// BlastSimulator2026 — Integration tests: NavMesh and pathfinding
// Covers NavGrid construction, A* pathfinding, and dynamic updates.

import { describe, it, expect } from 'vitest';
import { NavGrid } from '../../src/core/nav/NavGrid.js';
import { findPath, findRampConnections, octileHeuristic } from '../../src/core/nav/Pathfinding.js';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { createBuildingState, placeBuilding } from '../../src/core/entities/Building.js';
import { generateTerrain } from '../../src/core/world/TerrainGen.js';
import { getMinePreset } from '../../src/core/world/MineType.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fill every column with solid rock from y=0 to yMax (inclusive). */
function fillSolid(grid: VoxelGrid, yMax: number) {
  for (let x = 0; x < grid.sizeX; x++)
    for (let y = 0; y <= yMax; y++)
      for (let z = 0; z < grid.sizeZ; z++)
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
          density: 1.0, oreDensities: {}, fractureModifier: 1.0,
        });
}

// ── NavMesh and pathfinding ──────────────────────────────────────────────────

describe('NavMesh and pathfinding', () => {

  it('buildNavGrid creates walkable surface on solid terrain', () => {
    // 5×10×5 voxel grid, solid y=0..4 → every column has surfaceY=4 → all walkable
    const vg = new VoxelGrid(5, 10, 5);
    fillSolid(vg, 4);

    const nav = NavGrid.buildNavGrid(vg, [], []);

    expect(nav.width).toBe(5);
    expect(nav.height).toBe(5);
    expect(nav.maxSurfaceY).toBe(4);

    for (let z = 0; z < nav.height; z++) {
      for (let x = 0; x < nav.width; x++) {
        const cell = nav.cells[z]![x]!;
        expect(cell.type).toBe('walkable');
        expect(cell.moveCost).toBe(1.0);
        expect(cell.benchLevel).toBe(0);
        expect(cell.vehicleOccupied).toBe(false);
      }
    }

    // Flat terrain has no ramp connections
    expect(findRampConnections(nav)).toEqual([]);
  });

  it('buildings mark footprint cells as blocked', () => {
    const vg = new VoxelGrid(10, 10, 10);
    fillSolid(vg, 4);

    const state = createBuildingState();
    const result = placeBuilding(state, 'management_office', 2, 2, vg.sizeX, vg.sizeZ, 1);
    expect(result.success).toBe(true);

    const nav = NavGrid.buildNavGrid(vg, state.buildings, []);

    // management_office tier 1 has a 2×2 footprint covering (2,2)-(3,3)
    const footprintCells: [number, number][] = [[2, 2], [3, 2], [2, 3], [3, 3]];
    for (const [fx, fz] of footprintCells) {
      expect(nav.cells[fz]![fx]!.type).toBe('blocked');
      expect(nav.cells[fz]![fx]!.moveCost).toBe(Infinity);
    }

    // A cell well outside the footprint stays walkable
    expect(nav.cells[5]![5]!.type).toBe('walkable');
  });

  it('findPath returns waypoints for reachable cells', () => {
    const vg = new VoxelGrid(10, 10, 10);
    fillSolid(vg, 4);

    const nav = NavGrid.buildNavGrid(vg, [], []);
    const result = findPath(nav, {
      agentId: 1, fromX: 0, fromZ: 0, toX: 9, toZ: 9, avoidVehicles: false,
    });

    expect(result.found).toBe(true);
    expect(result.waypoints.length).toBeGreaterThanOrEqual(2);
    // First waypoint is the start
    expect(result.waypoints[0]!.x).toBe(0);
    expect(result.waypoints[0]!.z).toBe(0);
    // Last waypoint is the goal
    expect(result.waypoints[result.waypoints.length - 1]!.x).toBe(9);
    expect(result.waypoints[result.waypoints.length - 1]!.z).toBe(9);
    expect(result.totalCost).toBeGreaterThan(0);
  });

  it('findPath returns empty for blocked destination', () => {
    const vg = new VoxelGrid(5, 10, 5);
    fillSolid(vg, 4);

    const nav = NavGrid.buildNavGrid(vg, [], []);
    // Manually mark the goal cell as blocked
    nav.cells[4]![4] = {
      type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false,
    };

    const result = findPath(nav, {
      agentId: 1, fromX: 0, fromZ: 0, toX: 4, toZ: 4, avoidVehicles: false,
    });

    expect(result.found).toBe(false);
    expect(result.waypoints).toEqual([]);
    expect(result.totalCost).toBe(0);
  });

  it('findPath routes around obstacles', () => {
    // 10×5×10 grid, flat solid terrain → NavGrid 10×10
    const vg = new VoxelGrid(10, 5, 10);
    fillSolid(vg, 4);

    const nav = NavGrid.buildNavGrid(vg, [], []);
    // Block the entire middle column (x=5) across all z-rows
    for (let z = 0; z < nav.height; z++) {
      nav.cells[z]![5] = {
        type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false,
      };
    }

    const result = findPath(nav, {
      agentId: 1, fromX: 0, fromZ: 5, toX: 9, toZ: 5, avoidVehicles: false,
    });

    expect(result.found).toBe(true);
    // No waypoint should land on the blocked column
    for (const wp of result.waypoints) {
      expect(nav.cells[wp.z]![wp.x]!.type).not.toBe('blocked');
    }
  });

  it('patchNavGrid updates cells after terrain change', () => {
    const vg = new VoxelGrid(10, 10, 10);
    fillSolid(vg, 4);

    const nav = NavGrid.buildNavGrid(vg, [], []);
    expect(nav.cells[0]![0]!.type).toBe('walkable');

    // Remove all solid voxels in a 2×2 region → those columns become void
    for (let z = 0; z <= 1; z++) {
      for (let x = 0; x <= 1; x++) {
        for (let y = 0; y <= 4; y++) {
          vg.clearVoxel(x, y, z);
        }
      }
    }

    const region = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
    NavGrid.patchNavGrid(nav, vg, [], [], region);

    // Cells inside the cleared region become void
    expect(nav.cells[0]![0]!.type).toBe('void');
    expect(nav.cells[0]![1]!.type).toBe('void');
    expect(nav.cells[1]![0]!.type).toBe('void');
    expect(nav.cells[1]![1]!.type).toBe('void');

    // Cell outside the patched region stays walkable
    expect(nav.cells[5]![5]!.type).toBe('walkable');
  });

  it('patchNavGrid corrects building cells after removal', () => {
    const vg = new VoxelGrid(10, 10, 10);
    fillSolid(vg, 4);

    const state = createBuildingState();
    placeBuilding(state, 'management_office', 2, 2, vg.sizeX, vg.sizeZ, 1);

    // Build nav with the building present — footprint cells are blocked
    const nav = NavGrid.buildNavGrid(vg, state.buildings, []);
    expect(nav.cells[2]![2]!.type).toBe('blocked');

    // "Demolish" the building by emptying the array
    state.buildings = [];

    // Patch the region that was occupied by the building footprint
    const region = { minX: 2, maxX: 3, minZ: 2, maxZ: 3 };
    NavGrid.patchNavGrid(nav, vg, [], [], region);

    // Cells that were blocked should revert to walkable
    expect(nav.cells[2]![2]!.type).toBe('walkable');
    expect(nav.cells[2]![3]!.type).toBe('walkable');
    expect(nav.cells[3]![2]!.type).toBe('walkable');
    expect(nav.cells[3]![3]!.type).toBe('walkable');
    expect(nav.cells[2]![2]!.moveCost).toBe(1.0);
  });

  it('computeSurfaceY returns highest solid voxel', () => {
    const vg = new VoxelGrid(5, 10, 5);
    fillSolid(vg, 5); // solid y=0..5

    // The highest solid voxel is at y=5
    expect(NavGrid.computeSurfaceY(vg, 2, 2)).toBe(5);
    expect(NavGrid.computeSurfaceY(vg, 0, 0)).toBe(5);
    expect(NavGrid.computeSurfaceY(vg, 4, 4)).toBe(5);

    // Edge clamped column (999, 999 → (4,4)) also returns 5
    expect(NavGrid.computeSurfaceY(vg, 999, 999)).toBe(5);

    // All-air column returns -1
    const empty = new VoxelGrid(3, 10, 3);
    expect(NavGrid.computeSurfaceY(empty, 1, 1)).toBe(-1);
  });

  it('drill holes marked as blocked cells', () => {
    const vg = new VoxelGrid(10, 10, 10);
    fillSolid(vg, 4);

    const holes = [{ id: 'DH1', x: 3, z: 3, depth: 5, diameter: 0.15 }];
    const nav = NavGrid.buildNavGrid(vg, [], holes);

    // The cell with a drill hole gets type 'drill_hole' and cost 5.0
    expect(nav.cells[3]![3]!.type).toBe('drill_hole');
    expect(nav.cells[3]![3]!.moveCost).toBe(5.0);
    expect(nav.cells[3]![3]!.benchLevel).toBe(0);

    // A cell without a drill hole stays walkable
    expect(nav.cells[0]![0]!.type).toBe('walkable');
    expect(nav.cells[9]![9]!.type).toBe('walkable');
  });

  it('octile heuristic computes correctly', () => {
    // h = max(|dx|,|dz|) + (√2 − 1) × min(|dx|,|dz|)

    // Pure horizontal: dx=5, dz=0 → h = max(5,0) + (√2-1)×0 = 5
    expect(octileHeuristic(0, 0, 5, 0)).toBe(5);
    expect(octileHeuristic(0, 0, 0, 5)).toBe(5);

    // Pure diagonal: dx=5, dz=5 → h = 5 + (√2-1)×5 = 5√2
    expect(octileHeuristic(0, 0, 5, 5)).toBeCloseTo(5 * Math.SQRT2, 6);

    // Asymmetric: dx=7, dz=3 → h = 7 + (√2-1)×3
    const expected = 7 + (Math.SQRT2 - 1) * 3;
    expect(octileHeuristic(0, 0, 7, 3)).toBeCloseTo(expected, 6);

    // Arbitrary offset: (2,5) → (8,1): dx=6, dz=4 → h = 6 + (√2-1)×4
    const expected2 = 6 + (Math.SQRT2 - 1) * 4;
    expect(octileHeuristic(2, 5, 8, 1)).toBeCloseTo(expected2, 6);

    // Same point: h = 0
    expect(octileHeuristic(3, 3, 3, 3)).toBe(0);
  });

});
