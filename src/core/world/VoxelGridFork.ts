// BlastSimulator2026 — independent voxel grid copy for dry-run simulation (#1968)

import { VoxelGrid } from './VoxelGrid.js';

/**
 * Independent copy of `grid` that a blast can mutate without touching the original.
 *
 * The fork owns the same chunk rects, shares the (read-only) chunk source, and starts from a
 * cloned edit log, so its slabs materialize lazily to exactly what the original reads - no
 * voxel is copied up front. A grid with no chunk source has nothing to regenerate from, so its
 * resident solid voxels are copied over each owned chunk instead.
 */
export function forkVoxelGrid(grid: VoxelGrid): VoxelGrid {
  const fork = new VoxelGrid(0, 0, grid.edits.clone());
  for (const comp of grid.palette.toArray()) fork.palette.intern(comp); // keep palette indices aligned

  const source = grid.getChunkSource();
  for (const { cx, cz } of grid.ownedChunks()) {
    const rect = grid.chunkRect(cx, cz)!;
    fork.addChunkWithRect(cx, cz, rect);
    if (source) continue;
    const range = grid.allocatedCyRange(cx, cz);
    if (!range) continue;
    const size = VoxelGrid.CHUNK_SIZE;
    fork.withoutEditRecording(() => {
      grid.forEachSolidInRegion(
        { x: rect.minX, y: range.min * size, z: rect.minZ },
        { x: rect.maxX - 1, y: (range.max + 1) * size - 1, z: rect.maxZ - 1 },
        (x, y, z) => fork.setVoxel(x, y, z, grid.getVoxel(x, y, z)!),
      );
    });
  }
  if (source) fork.attachChunkSource(source);
  return fork;
}
