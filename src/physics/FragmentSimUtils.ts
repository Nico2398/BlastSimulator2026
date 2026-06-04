// BlastSimulator2026 — Utility functions for FragmentSim
// Extracted to keep FragmentSim.ts under 300 lines.

import type { Vec3 } from '../core/math/Vec3.js';
import { vec3, ZERO, sub, normalize, distance } from '../core/math/Vec3.js';
import { VoxelGrid, type VoxelRockComposition } from '../core/world/VoxelGrid.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

/** Ore composition for a single voxel or fragment. */
export interface VoxelOreComposition {
  ores: Array<{ oreId: string; density: number }>;
}

/** Tracks which voxel a seed index came from. */
export interface SeedVoxelInfo {
  x: number;
  y: number;
  z: number;
  fragmentCount: number;
  effectiveEnergy: number;
  generatedOverflow: number;
}

// ─── Utility Functions ──────────────────────────────────────────────────────────

/**
 * Convert a record-based ore density map into a structured VoxelOreComposition.
 *
 * @param _oreDensities - Record of oreId → density (0.0–1.0).
 * @returns A VoxelOreComposition with an array of ore entries.
 */
export function convertOreDensities(_oreDensities: Record<string, number>): VoxelOreComposition {
  const entries = Object.entries(_oreDensities)
    .filter(([_, density]) => density > 0)
    .map(([oreId, density]) => ({ oreId, density }))
    .sort((a, b) => a.oreId.localeCompare(b.oreId));
  return { ores: entries };
}

/**
 * Compute the centroid (average position) of a set of vertices.
 *
 * @param _vertices - Array of 3D points.
 * @returns The centroid as a Vec3.
 */
export function computeCentroid(_vertices: Vec3[]): Vec3 {
  if (_vertices.length === 0) return ZERO;
  let sx = 0, sy = 0, sz = 0;
  for (const v of _vertices) {
    sx += v.x;
    sy += v.y;
    sz += v.z;
  }
  const n = _vertices.length;
  return vec3(sx / n, sy / n, sz / n);
}

/**
 * Deflate a set of vertices inward toward their centroid by a given amount.
 *
 * Each vertex is moved along the vector from the centroid to the vertex,
 * shortening that vector by `amount` units. This creates a slightly smaller
 * mesh that sits inside the visual mesh to prevent physics catching on edges.
 *
 * @param _vertices - Array of 3D points.
 * @param _centroid - The centroid to deflate toward.
 * @param _amount - Distance in metres to shrink each vertex.
 * @returns A new array of deflated Vec3 points.
 */
export function deflateVertices(_vertices: Vec3[], _centroid: Vec3, _amount: number): Vec3[] {
  if (_vertices.length === 0) return [];
  const result: Vec3[] = [];
  for (const v of _vertices) {
    const dist = distance(v, _centroid);
    if (dist === 0) {
      result.push(v);
      continue;
    }
    // Direction from vertex toward centroid
    const dir = normalize(sub(_centroid, v));
    const effectiveAmount = Math.min(_amount, dist);
    result.push(vec3(
      v.x + dir.x * effectiveAmount,
      v.y + dir.y * effectiveAmount,
      v.z + dir.z * effectiveAmount,
    ));
  }
  return result;
}

/**
 * Flatten an array of Vec3 points into an interleaved Float32Array (x,y,z,x,y,z,…).
 *
 * @param _vertices - Array of 3D points.
 * @returns A Float32Array of interleaved coordinates.
 */
export function flattenVec3Array(_vertices: Vec3[]): Float32Array {
  const result = new Float32Array(_vertices.length * 3);
  for (let i = 0; i < _vertices.length; i++) {
    const v = _vertices[i]!;
    result[i * 3] = v.x;
    result[i * 3 + 1] = v.y;
    result[i * 3 + 2] = v.z;
  }
  return result;
}

/**
 * Compute the average rock composition across voxels mapped to a set of seed indices.
 *
 * Averages the rock coefficients across all source voxels, weighting each voxel
 * by its fragment count contribution.
 *
 * @param _seedIndices - Array of seed indices belonging to the same fragment.
 * @param _seedToVoxelMap - Map of seed index → source voxel info.
 * @param _grid - The voxel grid to read rock composition from.
 * @returns A VoxelRockComposition with averaged rock coefficients.
 */
export function computeAverageRockComposition(
  _seedIndices: number[],
  _seedToVoxelMap: Map<number, SeedVoxelInfo>,
  _grid: VoxelGrid,
): VoxelRockComposition {
  const weightedSum = new Map<string, number>();
  const totalWeight = new Map<string, number>();

  for (const seedIdx of _seedIndices) {
    const info = _seedToVoxelMap.get(seedIdx);
    if (!info) continue;

    const voxel = _grid.getVoxel(info.x, info.y, info.z);
    if (!voxel) continue;

    const weight = 1 / info.fragmentCount;

    for (const rock of voxel.composition.rocks) {
      weightedSum.set(rock.rockId, (weightedSum.get(rock.rockId) ?? 0) + rock.coefficient * weight);
      totalWeight.set(rock.rockId, (totalWeight.get(rock.rockId) ?? 0) + weight);
    }
  }

  if (weightedSum.size === 0) return { rocks: [] };

  const rocks = [...weightedSum.entries()]
    .map(([rockId, sum]) => ({
      rockId,
      coefficient: sum / (totalWeight.get(rockId) ?? 1),
    }));

  return { rocks };
}

/**
 * Compute the average ore composition across voxels mapped to a set of seed indices.
 *
 * Averages the ore densities across all source voxels, weighting each voxel
 * by its fragment count contribution.
 *
 * @param _seedIndices - Array of seed indices belonging to the same fragment.
 * @param _seedToVoxelMap - Map of seed index → source voxel info.
 * @param _grid - The voxel grid to read ore densities from.
 * @returns A VoxelOreComposition with averaged ore densities.
 */
export function computeAverageOreComposition(
  _seedIndices: number[],
  _seedToVoxelMap: Map<number, SeedVoxelInfo>,
  _grid: VoxelGrid,
): VoxelOreComposition {
  const weightedSum = new Map<string, number>();
  const totalWeight = new Map<string, number>();

  for (const seedIdx of _seedIndices) {
    const info = _seedToVoxelMap.get(seedIdx);
    if (!info) continue;

    const voxel = _grid.getVoxel(info.x, info.y, info.z);
    if (!voxel) continue;

    const weight = 1 / info.fragmentCount;

    for (const [oreId, density] of Object.entries(voxel.oreDensities)) {
      weightedSum.set(oreId, (weightedSum.get(oreId) ?? 0) + density * weight);
      totalWeight.set(oreId, (totalWeight.get(oreId) ?? 0) + weight);
    }
  }

  if (weightedSum.size === 0) return { ores: [] };

  const ores = [...weightedSum.entries()]
    .map(([oreId, sum]) => ({
      oreId,
      density: sum / (totalWeight.get(oreId) ?? 1),
    }))
    .sort((a, b) => a.oreId.localeCompare(b.oreId));

  return { ores };
}

/**
 * Compute the total volume (m³) of a fragment from its constituent voxels.
 *
 * The volume is the sum of the voxel volumes (CELL_SIZE³ each) weighted by density.
 *
 * @param _seedIndices - Array of seed indices belonging to the same fragment.
 * @param _seedToVoxelMap - Map of seed index → source voxel info.
 * @returns The total volume in cubic metres.
 */
export function computeVolumeM3(
  _seedIndices: number[],
  _seedToVoxelMap: Map<number, SeedVoxelInfo>,
): number {
  let volume = 0;

  // Use a map to avoid double-counting seeds from the same source voxel
  const voxelContributions = new Map<string, { seeds: number; fragmentCount: number }>();

  for (const seedIdx of _seedIndices) {
    const info = _seedToVoxelMap.get(seedIdx);
    if (!info) continue;

    const key = `${info.x},${info.y},${info.z}`;
    const entry = voxelContributions.get(key);
    if (entry) {
      entry.seeds++;
    } else {
      voxelContributions.set(key, { seeds: 1, fragmentCount: info.fragmentCount });
    }
  }

  for (const { seeds, fragmentCount } of voxelContributions.values()) {
    volume += (seeds / fragmentCount) * VoxelGrid.CELL_SIZE;
  }

  return volume;
}
