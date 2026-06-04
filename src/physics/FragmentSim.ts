// BlastSimulator2026 — Generate RockFragment objects from Voronoi cells
// Part of Chapter 5 (Blast Full Pipeline)
// Task 5.11: graphic mesh, deflated collision mesh, overflowEnergy from source voxels

import type { Vec3 } from '../core/math/Vec3.js';
import type { VoxelRockComposition } from '../core/world/VoxelGrid.js';
import type { VoronoiCell, Tetrahedron } from './VoronoiFrag.js';

import { vec3, ZERO, sub, normalize, distance } from '../core/math/Vec3.js';
import { convexHull3D, buildAdjacencyMap } from './VoronoiFrag.js';
import { computeThreshold, parseKey } from '../core/mining/BlastCalc.js';
import { computeFragmentationScore, computeFragmentCount } from './VoronoiFrag.js';
import { COLLISION_DEFLATE_AMOUNT, MERGE_PROBABILITY } from '../core/config/balance.js';
import { getRock } from '../core/world/RockCatalog.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

/** Ore composition for a single voxel or fragment. */
export interface VoxelOreComposition {
  ores: Array<{ oreId: string; density: number }>;
}

/** Full RockFragment schema. */
export interface RockFragment {
  id: number;
  cx: number;
  cy: number;
  cz: number;
  graphicVertices: Float32Array;
  collisionVertices: Float32Array;
  composition: VoxelRockComposition;
  oreComposition: VoxelOreComposition;
  volumeM3: number;
  massKg: number;
  overflowEnergy: number;
  velocity: Vec3;
  simulationTier: 'projected' | 'collapse';
  state: 'flying' | 'settling' | 'static';
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

// ─── Stub Functions ─────────────────────────────────────────────────────────────

/**
 * Sample Voronoi seed points with a mapping back to source voxels.
 *
 * For each fragmented voxel key, computes the fragment count and samples that many
 * random seed points within the voxel. Records which voxel each seed originated from
 * so downstream stages can look up composition, energy, and overflow.
 *
 * @param _fragmentedVoxels - Set of "x,y,z" keys identifying fragmented voxels.
 * @param _effectiveEnergy - Map of "x,y,z" key → deposited energy for each voxel.
 * @param _generatedOverflow - Map of "x,y,z" key → overflow energy for each voxel.
 * @param _grid - The voxel grid (used for bounds and threshold computation).
 * @param _rng - Seeded random number generator for deterministic sampling.
 * @returns An object containing the seed array and a seed-index-to-voxel map.
 */
export function sampleSeedsWithMapping(
  _fragmentedVoxels: Set<string>,
  _effectiveEnergy: Map<string, number>,
  _generatedOverflow: Map<string, number>,
  _grid: any,
  _rng: any,
): { seeds: Vec3[]; seedToVoxelMap: Map<number, SeedVoxelInfo> } {
  const seeds: Vec3[] = [];
  const seedToVoxelMap = new Map<number, SeedVoxelInfo>();
  let seedIndex = 0;

  // Sort keys for determinism
  const sortedKeys = [..._fragmentedVoxels].sort();

  for (const key of sortedKeys) {
    const coords = parseKey(key);
    if (!coords) continue;

    const [x, y, z] = coords;

    if (!_grid.isInBounds(x, y, z)) continue;

    const voxel = _grid.getVoxel(x, y, z);
    if (!voxel) continue;

    const energy = _effectiveEnergy.get(key) ?? 0;
    const threshold = computeThreshold(voxel);
    const score = computeFragmentationScore(energy, threshold);
    const count = computeFragmentCount(score);
    const overflow = _generatedOverflow.get(key) ?? 0;

    for (let i = 0; i < count; i++) {
      const px = _rng.nextFloat(x, x + 1);
      const py = _rng.nextFloat(y, y + 1);
      const pz = _rng.nextFloat(z, z + 1);
      seeds.push(vec3(px, py, pz));
      seedToVoxelMap.set(seedIndex, {
        x,
        y,
        z,
        fragmentCount: count,
        effectiveEnergy: energy,
        generatedOverflow: overflow,
      });
      seedIndex++;
    }
  }

  return { seeds, seedToVoxelMap };
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
  _grid: any,
): VoxelRockComposition {
  // Accumulate weighted coefficients per rockId
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
  _grid: any,
): VoxelOreComposition {
  // Accumulate weighted densities per oreId
  const weightedSum = new Map<string, number>();
  const totalWeight = new Map<string, number>();

  for (const seedIdx of _seedIndices) {
    const info = _seedToVoxelMap.get(seedIdx);
    if (!info) continue;

    const voxel = _grid.getVoxel(info.x, info.y, info.z);
    if (!voxel) continue;

    const weight = 1 / info.fragmentCount;

    for (const [oreId, density] of Object.entries(voxel.oreDensities as Record<string, number>)) {
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
 * Merge Voronoi cells with tracking of which seeds were grouped together.
 *
 * Wraps the existing mergeVoronoiCells logic (task 5.10) but additionally
 * returns the seed groupings so downstream stages know which seed indices
 * share the same merged fragment.
 *
 * @param _cells - Array of Voronoi cells to merge.
 * @param _tetrahedra - Array of Delaunay tetrahedra (used to build adjacency).
 * @param _rng - Seeded random number generator for deterministic merging.
 * @returns An object containing the merged cells and seed groupings.
 */
export function mergeVoronoiCellsWithGrouping(
  _cells: VoronoiCell[],
  _tetrahedra: Tetrahedron[],
  _rng: any,
): { mergedCells: VoronoiCell[]; seedGroupings: number[][] } {
  // Clone input cells to avoid mutating caller's data
  const working = _cells.map(c => ({ ...c, vertices: [...c.vertices] }));
  const seedGroupings: number[][] = _cells.map(c => [c.seedIndex]);

  const adjacencyMap = buildAdjacencyMap(_tetrahedra, working.length);
  const isMerged = new Array<boolean>(working.length).fill(false);

  for (let i = 0; i < working.length; i++) {
    if (isMerged[i]) continue;
    if (!_rng.chance(MERGE_PROBABILITY)) continue;

    const neighbors = adjacencyMap.get(i);
    if (!neighbors || neighbors.size === 0) continue;

    // Filter to only include not-yet-merged neighbors
    const available = [...neighbors].filter(j => !isMerged[j]);
    if (available.length === 0) continue;

    // Pick a random available neighbor
    const pickIdx = _rng.nextInt(0, available.length - 1);
    const neighborIdx = available[pickIdx]!;

    // Merge cell i with neighbor: compute convex hull of combined vertices
    const combined = [...working[i]!.vertices, ...working[neighborIdx]!.vertices];
    const hull = convexHull3D(combined);
    working[i] = { seedIndex: working[i]!.seedIndex, vertices: hull, isValid: hull.length >= 4 };

    // Merge seed groupings
    seedGroupings[i] = seedGroupings[i]!.concat(seedGroupings[neighborIdx]!);
    isMerged[neighborIdx] = true;
  }

  return {
    mergedCells: working.filter((_, idx) => !isMerged[idx]),
    seedGroupings: seedGroupings.filter((_, idx) => !isMerged[idx]),
  };
}

/**
 * Compute the total volume (m³) of a fragment from its constituent voxels.
 *
 * The volume is the sum of the voxel volumes (1 m³ each) weighted by density.
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
    volume += (seeds / fragmentCount) * 1.0;
  }

  return volume;
}

/**
 * Main entry point: generate an array of RockFragment objects from merged Voronoi cells.
 *
 * For each merged cell (or unmerged single cell), builds the graphic mesh from
 * convex hull vertices, creates a deflated collision mesh, looks up the
 * composition/ore/volume from connected seed voxels, and computes overflow energy.
 *
 * @param _cells - Array of (possibly merged) Voronoi cells.
 * @param _seedToVoxelMap - Map of seed index → source voxel info.
 * @param _seedGroupings - Arrays of seed indices that belong to the same fragment.
 * @param _grid - The voxel grid.
 * @param _generatedOverflow - Map of "x,y,z" key → overflow energy for each voxel.
 * @param _rng - Seeded random number generator for deterministic results.
 * @param _nextId - Optional starting fragment ID (default 1).
 * @returns An array of fully populated RockFragment objects.
 */
export function generateRockFragments(
  _cells: VoronoiCell[],
  _seedToVoxelMap: Map<number, SeedVoxelInfo>,
  _seedGroupings: number[][],
  _grid: any,
  _generatedOverflow: Map<string, number>,
  _rng: any,
  _nextId?: number,
): RockFragment[] {
  const fragments: RockFragment[] = [];
  let nextId = _nextId ?? 1;

  for (let i = 0; i < _cells.length; i++) {
    const cell = _cells[i]!;

    // Skip invalid cells
    if (!cell.isValid) continue;

    const seedIndices = _seedGroupings[i]!;

    // Skip empty seed groupings
    if (seedIndices.length === 0) continue;

    // Compute convex hull of cell vertices
    const hull = convexHull3D(cell.vertices);

    // Skip degenerate hulls (need at least 4 vertices for a 3D shape)
    if (hull.length < 4) continue;

    // Compute centroid
    const centroid = computeCentroid(hull);

    // Graphic vertices (convex hull)
    const graphicVertices = flattenVec3Array(hull);

    // Collision vertices (deflated inward)
    const deflated = deflateVertices(hull, centroid, COLLISION_DEFLATE_AMOUNT);
    const collisionVertices = flattenVec3Array(deflated);

    // Volume
    const volumeM3 = computeVolumeM3(seedIndices, _seedToVoxelMap);

    // Composition
    const composition = computeAverageRockComposition(seedIndices, _seedToVoxelMap, _grid);
    const oreComposition = computeAverageOreComposition(seedIndices, _seedToVoxelMap, _grid);

    // Mass: volume * rock density
    let totalDensity = 0;
    for (const rock of composition.rocks) {
      const rockDef = getRock(rock.rockId);
      if (rockDef) totalDensity += rock.coefficient * rockDef.density;
    }
    const massKg = volumeM3 * totalDensity;

    // Overflow energy: sum of generated overflow from all unique source voxels
    const overflowVoxels = new Set<string>();
    for (const seedIdx of seedIndices) {
      const info = _seedToVoxelMap.get(seedIdx);
      if (!info) continue;
      overflowVoxels.add(`${info.x},${info.y},${info.z}`);
    }
    let overflowEnergy = 0;
    for (const voxelKey of overflowVoxels) {
      overflowEnergy += _generatedOverflow.get(voxelKey) ?? 0;
    }

    fragments.push({
      id: nextId++,
      cx: centroid.x,
      cy: centroid.y,
      cz: centroid.z,
      graphicVertices,
      collisionVertices,
      composition,
      oreComposition,
      volumeM3,
      massKg,
      overflowEnergy,
      velocity: ZERO,
      simulationTier: 'collapse',
      state: 'settling',
    });
  }

  return fragments;
}
