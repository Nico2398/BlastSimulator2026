// BlastSimulator2026 — Drill plan definition
// A drill plan is a set of holes. Each hole has position, depth, and diameter.

import { VoxelGrid } from '../world/VoxelGrid.js';

export interface DrillHole {
  id: string;
  /** Surface position X. */
  x: number;
  /** Surface position Z. */
  z: number;
  /** Hole depth in meters/voxels. */
  depth: number;
  /** Hole diameter in meters (real drill holes: 75–150mm). */
  diameter: number;
}

let nextHoleId = 1;

/** Reset hole ID counter (for tests). */
export function resetHoleIds(): void {
  nextHoleId = 1;
}

/** Create a grid drill pattern. */
export function createGridPlan(
  origin: { x: number; z: number },
  rows: number,
  cols: number,
  spacing: number,
  depth: number,
  diameter: number,
): DrillHole[] {
  const holes: DrillHole[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      holes.push({
        id: `H${nextHoleId++}`,
        x: origin.x + c * spacing,
        z: origin.z + r * spacing,
        depth,
        diameter,
      });
    }
  }
  return holes;
}

/** Add a single hole to an existing plan. */
export function addHole(
  holes: DrillHole[],
  x: number,
  z: number,
  depth: number,
  diameter: number,
): DrillHole {
  const hole: DrillHole = { id: `H${nextHoleId++}`, x, z, depth, diameter };
  holes.push(hole);
  return hole;
}

export interface DigVoxelResult {
  success: boolean;
  /** Highest solid Y in the column after digging; -1 if the column is now empty. */
  newSurfaceY: number;
  /** Column (x, z) containing the dug voxel. */
  affectedCell: { x: number; z: number };
  error?: string;
}

/** Remove a single voxel and return the new column surface Y. */
export function digVoxel(
  grid: VoxelGrid,
  x: number,
  y: number,
  z: number,
): DigVoxelResult {
  const fail = (error: string): DigVoxelResult => ({
    success: false,
    newSurfaceY: -1,
    affectedCell: { x, z },
    error,
  });

  if (!grid.isInBounds(x, y, z)) {
    return fail(`Coordinates (${x}, ${y}, ${z}) are out of bounds.`);
  }

  const voxel = grid.getVoxel(x, y, z);
  if (voxel === undefined || voxel.density === 0) {
    return fail(`Voxel at (${x}, ${y}, ${z}) is already empty.`);
  }

  grid.clearVoxel(x, y, z);

  // Top-down scan to find the new surface Y.
  let newSurfaceY = -1;
  for (let scanY = grid.sizeY - 1; scanY >= 0; scanY--) {
    const v = grid.getVoxel(x, scanY, z);
    if (v !== undefined && v.density > 0) {
      newSurfaceY = scanY;
      break;
    }
  }

  return {
    success: true,
    newSurfaceY,
    affectedCell: { x, z },
  };
}
