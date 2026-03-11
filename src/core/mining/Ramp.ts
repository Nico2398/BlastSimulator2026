// BlastSimulator2026 — Ramp building system
// Ramps provide vehicle access to lower pit levels by carving sloped passages.
// Each ramp clears a diagonal column of voxels from surface to target depth.

import type { VoxelGrid } from '../world/VoxelGrid.js';

// ── Config ──

/** Cost per meter of ramp length in game dollars. */
// Real haul road construction: ~$50-200/m. Scaled for gameplay.
const RAMP_COST_PER_METER = 100;
/** Ramp width in voxels. */
const RAMP_WIDTH = 3;

// ── Types ──

export type RampDirection = 'north' | 'south' | 'east' | 'west';

export interface RampDef {
  originX: number;
  originZ: number;
  direction: RampDirection;
  length: number;
  /** Target depth (y level to reach). */
  targetDepth: number;
}

export interface RampResult {
  success: boolean;
  message: string;
  cost: number;
  voxelsCleared: number;
}

// ── Direction offsets ──

const DIR_OFFSETS: Record<RampDirection, { dx: number; dz: number }> = {
  north: { dx: 0, dz: -1 },
  south: { dx: 0, dz: 1 },
  east: { dx: 1, dz: 0 },
  west: { dx: -1, dz: 0 },
};

// ── Core function ──

/**
 * Build a ramp by clearing voxels to create a sloped passage.
 * The ramp starts at (originX, surface, originZ) and descends to targetDepth
 * over the given length. Width is fixed at RAMP_WIDTH.
 *
 * Mutates the VoxelGrid.
 * Returns the result including cost and voxels cleared.
 */
export function buildRamp(
  grid: VoxelGrid,
  ramp: RampDef,
  cash: number,
): RampResult {
  const totalCost = ramp.length * RAMP_COST_PER_METER;

  if (cash < totalCost) {
    return { success: false, message: `Insufficient funds: need $${totalCost}, have $${cash}`, cost: 0, voxelsCleared: 0 };
  }

  if (ramp.length <= 0) {
    return { success: false, message: 'Ramp length must be positive', cost: 0, voxelsCleared: 0 };
  }

  if (ramp.targetDepth <= 0) {
    return { success: false, message: 'Target depth must be positive', cost: 0, voxelsCleared: 0 };
  }

  const offset = DIR_OFFSETS[ramp.direction];
  let voxelsCleared = 0;

  // Perpendicular direction for width
  const perpDx = offset.dz !== 0 ? 1 : 0;
  const perpDz = offset.dx !== 0 ? 1 : 0;
  const halfWidth = Math.floor(RAMP_WIDTH / 2);

  for (let step = 0; step < ramp.length; step++) {
    // Current Y level: descends linearly from 0 to targetDepth
    const currentDepth = Math.floor((step / ramp.length) * ramp.targetDepth);
    // Height clearance for vehicles: 3 voxels
    const clearanceHeight = 3;

    const cx = ramp.originX + offset.dx * step;
    const cz = ramp.originZ + offset.dz * step;

    for (let w = -halfWidth; w <= halfWidth; w++) {
      const wx = cx + perpDx * w;
      const wz = cz + perpDz * w;

      for (let y = currentDepth; y < currentDepth + clearanceHeight; y++) {
        if (grid.isInBounds(wx, y, wz)) {
          const voxel = grid.getVoxel(wx, y, wz);
          if (voxel && voxel.density > 0) {
            grid.clearVoxel(wx, y, wz);
            voxelsCleared++;
          }
        }
      }
    }
  }

  return {
    success: true,
    message: `Ramp built: ${ramp.length}m ${ramp.direction}, ${voxelsCleared} voxels cleared`,
    cost: totalCost,
    voxelsCleared,
  };
}

export { RAMP_COST_PER_METER, RAMP_WIDTH };
