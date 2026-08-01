// BlastSimulator2026 — Ramp building system
// Ramps provide vehicle access to lower pit levels by carving sloped passages.
// Each ramp clears a diagonal column of voxels from surface to target depth.

import { formatMoney } from '../economy/formatMoney.js';
import { computeVoxelColumnSurfaceY, type VoxelGrid } from '../world/VoxelGrid.js';
import type { EventEmitter } from '../state/EventEmitter.js';

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
  emitter?: EventEmitter,
): RampResult {
  const totalCost = ramp.length * RAMP_COST_PER_METER;

  if (cash < totalCost) {
    return { success: false, message: `Insufficient funds: need $${formatMoney(totalCost)}, have $${formatMoney(cash)}`, cost: 0, voxelsCleared: 0 };
  }

  if (ramp.length <= 0) {
    return { success: false, message: 'Ramp length must be positive', cost: 0, voxelsCleared: 0 };
  }

  if (ramp.targetDepth <= 0) {
    return { success: false, message: 'Target depth must be positive', cost: 0, voxelsCleared: 0 };
  }

  const offset = DIR_OFFSETS[ramp.direction];
  let voxelsCleared = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;

  // Perpendicular direction for width
  const perpDx = offset.dz !== 0 ? 1 : 0;
  const perpDz = offset.dx !== 0 ? 1 : 0;
  const halfWidth = Math.floor(RAMP_WIDTH / 2);

  for (let step = 0; step < ramp.length; step++) {
    // Depth of descent at this step: grows linearly from 0 to targetDepth
    const currentDepth = Math.floor((step / ramp.length) * ramp.targetDepth);
    // Height clearance for vehicles: 3 voxels
    const clearanceHeight = 3;

    const cx = ramp.originX + offset.dx * step;
    const cz = ramp.originZ + offset.dz * step;

    // Carve relative to this column's live surface height, not an absolute
    // world Y — real terrain sits far above y=0, so an absolute band would
    // land buried under solid rock and never change the surface.
    const surfaceY = computeColumnSurfaceY(grid, cx, cz);
    const floorY = surfaceY - currentDepth;
    const ceilingY = surfaceY + clearanceHeight;

    for (let w = -halfWidth; w <= halfWidth; w++) {
      const wx = cx + perpDx * w;
      const wz = cz + perpDz * w;

      for (let y = floorY; y < ceilingY; y++) {
        if (grid.densityAt(wx, y, wz) > 0) {
          grid.clearVoxel(wx, y, wz);
          voxelsCleared++;
          minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
        }
      }
    }
  }

  if (voxelsCleared > 0) {
    emitter?.emit('terrain:updated', { region: { minX, maxX, minY, maxY, minZ, maxZ } });
  }

  return {
    success: true,
    message: `Ramp built: ${ramp.length}m ${ramp.direction}, ${voxelsCleared} voxels cleared`,
    cost: totalCost,
    voxelsCleared,
  };
}

// ── Local column surface resolution ──

/**
 * Resolve the local surface Y for column (x, z) — the highest voxel with
 * density >= 0.5, matching NavGrid.computeSurfaceY's contract. Both delegate
 * to VoxelGrid.computeVoxelColumnSurfaceY (a leaf-module free function) so
 * core/mining doesn't need to import from core/nav (core/nav already depends
 * on core/mining — DrillPlan, BlastExecution — so the reverse edge would
 * cycle). Returns -1 if the column is entirely void.
 */
function computeColumnSurfaceY(grid: VoxelGrid, x: number, z: number): number {
  return computeVoxelColumnSurfaceY(grid, x, z);
}

export { RAMP_COST_PER_METER, RAMP_WIDTH, computeColumnSurfaceY };
