// BlastSimulator2026 — Tests for the ring helpers around a building's
// footprint: the walkable approach cell (#437), the ring test and the free
// exit cell a leaving employee is put out on (#1202).

import { describe, it, expect } from 'vitest';
import { NavGrid } from '../../../src/core/nav/NavGrid.js';
import type { NavCell } from '../../../src/core/nav/NavGrid.js';
import { findBuildingApproachCell, findBuildingExitCell, isOnBuildingRing } from '../../../src/core/nav/BuildingApproach.js';
import { getBuildingDef } from '../../../src/core/entities/Building.js';
import type { Building } from '../../../src/core/entities/Building.js';

// A tier-1 driving_center: 2x2 footprint at (4..5, 4..5), ring (3..6, 3..6).
const SCHOOL: Building = { id: 1, type: 'driving_center', tier: 1, x: 4, z: 4, hp: 100, active: true, occupantIds: [] };
const DEF = getBuildingDef('driving_center', 1);

function grid(overrides: Record<string, Partial<NavCell>> = {}): NavGrid {
  const cells: NavCell[][] = [];
  for (let z = 0; z < 10; z++) {
    const row: NavCell[] = [];
    for (let x = 0; x < 10; x++) {
      const inFootprint = x >= 4 && x <= 5 && z >= 4 && z <= 5;
      const base: NavCell = inFootprint
        ? { type: 'blocked', moveCost: Infinity, benchLevel: 0, vehicleOccupied: false }
        : { type: 'walkable', moveCost: 1, benchLevel: 0, vehicleOccupied: false };
      row.push({ ...base, ...overrides[`${x},${z}`] });
    }
    cells.push(row);
  }
  return new NavGrid(10, 10, cells, 0, 0, 0);
}

describe('isOnBuildingRing', () => {
  it('is true on every ring cell, corners included', () => {
    for (const [x, z] of [[3, 3], [6, 3], [3, 6], [6, 6], [3, 4], [5, 6], [6, 5], [4, 3]] as const) {
      expect(isOnBuildingRing(SCHOOL, DEF, x, z), `${x},${z}`).toBe(true);
    }
  });

  it('is false inside the footprint and two cells out', () => {
    for (const [x, z] of [[4, 4], [5, 5], [2, 4], [7, 5], [4, 7]] as const) {
      expect(isOnBuildingRing(SCHOOL, DEF, x, z), `${x},${z}`).toBe(false);
    }
  });
});

describe('findBuildingExitCell', () => {
  it('returns the entry cell itself when it is free', () => {
    expect(findBuildingExitCell(grid(), SCHOOL, DEF, 3, 4)).toEqual({ x: 3, z: 4 });
  });

  it('skips a ring cell a vehicle now stands on, taking the nearest free one', () => {
    const exit = findBuildingExitCell(grid({ '3,4': { vehicleOccupied: true } }), SCHOOL, DEF, 3, 4);
    expect(exit).toEqual({ x: 3, z: 3 });
  });

  it('skips a ring cell debris now lies on', () => {
    const exit = findBuildingExitCell(grid({ '3,4': { fragmentOccupancy: 1 } }), SCHOOL, DEF, 3, 4);
    expect(isOnBuildingRing(SCHOOL, DEF, exit.x, exit.z)).toBe(true);
    expect(exit).not.toEqual({ x: 3, z: 4 });
  });

  it('falls back to the entry cell with no NavGrid built', () => {
    expect(findBuildingExitCell(null, SCHOOL, DEF, 3, 4)).toEqual({ x: 3, z: 4 });
  });

  it('where the approach cell accepts an occupied cell, the exit cell does not', () => {
    const g = grid({ '3,4': { vehicleOccupied: true } });
    expect(findBuildingApproachCell(g, SCHOOL, DEF, 3, 4)).toEqual({ x: 3, z: 4 });
    expect(findBuildingExitCell(g, SCHOOL, DEF, 3, 4)).not.toEqual({ x: 3, z: 4 });
  });
});
