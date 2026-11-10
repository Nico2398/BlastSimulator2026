// BlastSimulator2026 — shared fixtures for the charge optimizer tests (#2204): a mixed-rock grid and a small hole pattern.

import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { createGridPlan, type DrillHole } from '../../src/core/mining/DrillPlan.js';

const SOFT = { composition: { rocks: [{ rockId: 'sandite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };
const HARD = { composition: { rocks: [{ rockId: 'stubite', coefficient: 1.0 }] }, density: 1.0, oreDensities: {}, fractureModifier: 1.0 };

/** 30x30 grid, rock from y=0..11: soft on the low-x side of x=11.5, hard beyond. */
export function mixedRockGrid(): VoxelGrid {
  const grid = new VoxelGrid(30, 30);
  for (let z = 3; z <= 22; z++)
    for (let y = 0; y <= 11; y++)
      for (let x = 3; x <= 22; x++) grid.setVoxel(x, y, z, x <= 11 ? SOFT : HARD);
  return grid;
}

/** 2x2 holes 3 m apart from (10, 10): two over the soft side, two over the hard side. */
export function mixedRockHoles(depth = 8, diameter = 0.089): DrillHole[] {
  return createGridPlan({ nextHoleId: 1 }, { x: 10, z: 10 }, 2, 2, 3, depth, diameter);
}

/** Order-stable fingerprint of every voxel in the fixture region, to prove a call did not touch the grid. */
export function gridFingerprint(grid: VoxelGrid): string {
  const parts: string[] = [];
  for (let z = 0; z <= 25; z++)
    for (let y = 0; y <= 14; y++)
      for (let x = 0; x <= 25; x++) {
        const v = grid.getVoxel(x, y, z);
        parts.push(v ? `${v.density}|${v.fractureModifier}|${JSON.stringify(v.composition)}` : '-');
      }
  return parts.join(';');
}
