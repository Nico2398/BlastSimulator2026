// BlastSimulator2026 — Generate RockFragment objects from Voronoi cells
// Part of Chapter 5 (Blast Full Pipeline)
// Task 5.11: graphic mesh, deflated collision mesh, overflowEnergy from source voxels

import { vec3, ZERO, type Vec3 } from '../core/math/Vec3.js';
import type { VoxelGrid, VoxelRockComposition } from '../core/world/VoxelGrid.js';
import type { Random } from '../core/math/Random.js';
import { convexHull3D, buildAdjacencyMap, computeFragmentationScore, computeFragmentCount, type VoronoiCell, type Tetrahedron } from './VoronoiFrag.js';
import { computeThreshold, parseKey } from '../core/mining/BlastCalc.js';
import { COLLISION_DEFLATE_AMOUNT, MERGE_PROBABILITY, PHYSICS_FRAGMENT_CAP, GRAVITY } from '../core/config/balance.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { TerrainBody, findSurfaceY } from './TerrainBody.js';
import { assignFragmentVelocity } from './FragmentSimVelocity.js';
import { getRock } from '../core/world/RockCatalog.js';

import {
  type VoxelOreComposition,
  type SeedVoxelInfo,
  computeCentroid,
  deflateVertices,
  flattenVec3Array,
  computeAverageRockComposition,
  computeAverageOreComposition,
  computeVolumeM3,
} from './FragmentSimUtils.js';

// Re-export for backward compatibility
export {
  VoxelOreComposition,
  SeedVoxelInfo,
  convertOreDensities,
  computeCentroid,
  deflateVertices,
  flattenVec3Array,
  computeAverageRockComposition,
  computeAverageOreComposition,
  computeVolumeM3,
} from './FragmentSimUtils.js';

export {
  computeEnergyGradientDirection,
  distanceToNearestAirVoxel,
  computeSurfaceProximityFactor,
  computeVelocityMagnitude,
  classifySimulationTier,
  assignFragmentVelocity,
} from './FragmentSimVelocity.js';

// ─── Types ──────────────────────────────────────────────────────────────────────

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

// ─── Core Functions ─────────────────────────────────────────────────────────────

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
  _grid: VoxelGrid,
  _rng: Random,
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
  _rng: Random,
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
  _grid: VoxelGrid,
  _effectiveEnergy: Map<string, number>,
  _generatedOverflow: Map<string, number>,
  _rng: Random,
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

    const fragment: RockFragment = {
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
    };
    assignFragmentVelocity(fragment, _effectiveEnergy, _grid);
    fragments.push(fragment);
  }

  return fragments;
}

/**
 * Run Tier A physics simulation on all fragments with simulationTier === 'projected'.
 * Implements PHYSICS_FRAGMENT_CAP:
 *   - First N get full Cannon-es rigid-body simulation with terrain collision.
 *   - Remaining use kinematic parabolic fallback (analytical trajectory).
 * All processed fragments end with state='static' and updated (cx,cy,cz).
 * Fragments with simulationTier !== 'projected' are returned unchanged.
 */
export function simulateProjectedFragments(
  _fragments: RockFragment[],
  _grid: VoxelGrid,
): RockFragment[] {
  if (_fragments.length === 0) return _fragments;

  // Separate projected from collapse fragments
  const projected: RockFragment[] = [];
  const collapse: RockFragment[] = [];

  for (const frag of _fragments) {
    if (frag.simulationTier === 'projected') {
      projected.push(frag);
    } else {
      collapse.push(frag);
    }
  }

  // Split projected at PHYSICS_FRAGMENT_CAP
  const rigidFragments = projected.slice(0, PHYSICS_FRAGMENT_CAP);
  const fallbackFragments = projected.slice(PHYSICS_FRAGMENT_CAP);

  // Simulate
  simulateRigidBodies(rigidFragments, _grid);
  simulateParabolicFallback(fallbackFragments, _grid);

  // Set state = 'static' on all projected fragments
  for (const frag of projected) {
    frag.state = 'static';
  }

  return _fragments;
}

// ─── Private Helpers ───────────────────────────────────────────────────────────

/**
 * Run full Cannon-es rigid-body simulation for the given fragments.
 * Creates a PhysicsWorld, adds terrain and fragment bodies, steps until settled,
 * then reads final positions back into fragment (cx, cy, cz).
 * Fragments with massKg <= 0 or NaN positions are skipped.
 */
function simulateRigidBodies(fragments: RockFragment[], grid: VoxelGrid): void {
  if (fragments.length === 0) return;

  const world = new PhysicsWorld();
  world.init();

  const terrain = new TerrainBody(world);
  terrain.build(grid);

  // Track fragment-handle associations
  const tracked: Array<{ frag: RockFragment; handleId: number }> = [];

  for (const frag of fragments) {
    // Skip invalid fragments: mass <= 0 or NaN/Infinity positions
    if (frag.massKg <= 0) continue;
    if (!Number.isFinite(frag.cx) || !Number.isFinite(frag.cy) || !Number.isFinite(frag.cz)) continue;

    const halfExtent = Math.max(0.1, Math.cbrt(frag.volumeM3) / 2);
    const handle = world.addBody(
      'box',
      [halfExtent, halfExtent, halfExtent],
      frag.massKg,
      { x: frag.cx, y: frag.cy, z: frag.cz },
      { x: frag.velocity.x, y: frag.velocity.y, z: frag.velocity.z },
    );
    tracked.push({ frag, handleId: handle.id });
  }

  // Step until settled or max steps reached
  const dt = 1 / 60;
  const maxSteps = 600;

  for (let step = 0; step < maxSteps; step++) {
    world.step(dt);

    // Check if >= 95% have speed < 0.1
    let settledCount = 0;
    for (const { handleId } of tracked) {
      if (world.getBodySpeed({ id: handleId }) < 0.1) settledCount++;
    }
    if (tracked.length > 0 && settledCount / tracked.length >= 0.95) break;
  }

  // Read final positions back into fragments
  for (const { frag, handleId } of tracked) {
    const pos = world.getBodyPosition({ id: handleId });
    if (pos) {
      frag.cx = pos.x;
      frag.cy = pos.y;
      frag.cz = pos.z;
    }
  }

  terrain.dispose();
  world.clear();
}

/**
 * Kinematic parabolic fallback for fragments beyond PHYSICS_FRAGMENT_CAP.
 * Uses semi-implicit Euler integration with findSurfaceY for ground detection.
 */
function simulateParabolicFallback(fragments: RockFragment[], grid: VoxelGrid): void {
  if (fragments.length === 0) return;

  const dt = 1 / 60;
  const maxSteps = 600;

  for (const frag of fragments) {
    // Skip invalid fragments: mass <= 0 or NaN/Infinity positions
    if (frag.massKg <= 0) continue;
    if (!Number.isFinite(frag.cx) || !Number.isFinite(frag.cy) || !Number.isFinite(frag.cz)) continue;

    let x = frag.cx;
    let y = frag.cy;
    let z = frag.cz;
    let vx = frag.velocity.x;
    let vy = frag.velocity.y;
    let vz = frag.velocity.z;

    let settled = false;

    for (let step = 0; step < maxSteps; step++) {
      // Semi-implicit Euler integration
      x += vx * dt;
      vy += GRAVITY * dt;
      y += vy * dt;
      z += vz * dt;

      // Ground detection via findSurfaceY
      const terrainY = findSurfaceY(grid, Math.floor(x), Math.floor(z));
      if (terrainY >= 0 && y <= terrainY + 1.0) {
        frag.cx = x;
        frag.cy = terrainY + 1.0;
        frag.cz = z;
        settled = true;
        break;
      }
    }

    // If never settled, use last computed position
    if (!settled) {
      frag.cx = x;
      frag.cy = y;
      frag.cz = z;
    }
  }
}
