// BlastSimulator2026 — Terrain collision body
// Builds a static Cannon-es collision body from the VoxelGrid surface.
// Strategy: for each solid voxel on or near the surface, add a static box.
// This is not the most efficient approach (heightfield would be better for
// smooth terrain), but it correctly handles craters and blast modifications.
// Must be rebuilt after each blast (terrain changes).

import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import type { PhysicsWorld, PhysicsBodyId } from './PhysicsWorld.js';

// ── Config ──

/** Voxel size in meters. Must match VOXEL_SIZE in BlastExecution. */
const VOXEL_SIZE = 1.0;

/**
 * Number of surface layers to include in the collision body.
 * 1 = only the top surface voxel per column. Enough for fragment settling.
 */
const SURFACE_LAYERS = 2;

// ── TerrainBody ──

/**
 * Manages the static terrain collision body in the physics world.
 * Call `build()` to create or rebuild it after terrain changes.
 * Call `dispose()` to remove all terrain bodies from the world.
 */
export class TerrainBody {
  private world: PhysicsWorld;
  private bodyHandles: PhysicsBodyId[] = [];

  constructor(world: PhysicsWorld) {
    this.world = world;
  }

  /**
   * Build (or rebuild) the static terrain colliders from the voxel grid.
   * Previous terrain bodies are removed first.
   * Only adds surface voxels (top SURFACE_LAYERS solid voxels per column).
   */
  build(grid: VoxelGrid): void {
    this.dispose();

    for (let x = 0; x < grid.sizeX; x++) {
      for (let z = 0; z < grid.sizeZ; z++) {
        let solidCount = 0;
        // Scan from top to bottom, add SURFACE_LAYERS solid voxels per column
        for (let y = grid.sizeY - 1; y >= 0; y--) {
          const voxel = grid.getVoxel(x, y, z);
          if (!voxel || voxel.density <= 0) continue;

          const half = VOXEL_SIZE / 2;
          const cx = x * VOXEL_SIZE + half;
          const cy = y * VOXEL_SIZE + half;
          const cz = z * VOXEL_SIZE + half;

          const handle = this.world.addBody(
            'box',
            [half, half, half],
            0, // mass=0 → static
            { x: cx, y: cy, z: cz },
          );
          this.bodyHandles.push(handle);

          solidCount++;
          if (solidCount >= SURFACE_LAYERS) break;
        }
      }
    }
  }

  /** Remove all terrain collision bodies from the physics world. */
  dispose(): void {
    for (const handle of this.bodyHandles) {
      this.world.removeBody(handle);
    }
    this.bodyHandles = [];
  }

  /** Number of terrain bodies currently in the world. */
  get bodyCount(): number {
    return this.bodyHandles.length;
  }
}

// ── Utility ──

/**
 * Find the Y coordinate of the topmost solid voxel in a column (x, z).
 * Returns -1 if the entire column is empty.
 */
export function findSurfaceY(grid: VoxelGrid, x: number, z: number): number {
  for (let y = grid.sizeY - 1; y >= 0; y--) {
    const v = grid.getVoxel(x, y, z);
    if (v && v.density > 0) return y;
  }
  return -1;
}
