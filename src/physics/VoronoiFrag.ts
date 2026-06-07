// BlastSimulator2026 — Fragmentation score computation and Voronoi seed sampling
// Part of Chapter 5 (Blast Full Pipeline)
// Task 5.8: computeFragmentationScore and Voronoi seed sampling

import type { Vec3 } from '../core/math/Vec3.js';
import { vec3, add, sub, scale, dot, cross, clamp, equals, squaredDistance } from '../core/math/Vec3.js';
import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import { Random } from '../core/math/Random.js';
import { computeThreshold, parseKey } from '../core/mining/BlastCalc.js';
import { FRAGMENTATION_SCORE_SCALE, MAX_FRAGMENTS_PER_VOXEL, MERGE_PROBABILITY } from '../core/config/balance.js';

/**
 * Compute the fragmentation score for a single voxel given its effective energy
 * and fracture threshold.
 *
 * Formula: FRAGMENTATION_SCORE_SCALE * (effectiveEnergy / threshold)
 *
 * @param effectiveEnergy - The energy deposited into the voxel (after propagation).
 * @param threshold - The fracture energy threshold of the voxel (from computeThreshold).
 * @returns The fragmentation score (≥ 0). Higher = more fragments.
 */
export function computeFragmentationScore(
  effectiveEnergy: number,
  threshold: number,
): number {
  if (threshold <= 0) return 0;
  if (effectiveEnergy <= 0) return 0;
  if (!Number.isFinite(effectiveEnergy) || !Number.isFinite(threshold)) return 0;
  return FRAGMENTATION_SCORE_SCALE * (effectiveEnergy / threshold);
}

/**
 * Convert a fragmentation score into an integer fragment count for a single voxel.
 *
 * Formula: Math.max(1, Math.round(score))
 *
 * @param score - The fragmentation score (from computeFragmentationScore).
 * @returns The number of fragments this voxel produces (at least 1).
 */
export function computeFragmentCount(score: number): number {
  if (score <= 0) return 1;
  if (!Number.isFinite(score)) return 1;
  return Math.min(MAX_FRAGMENTS_PER_VOXEL, Math.max(1, Math.round(score)));
}

/**
 * Sample Voronoi seed points from a set of fragmented voxels.
 *
 * For each fragmented voxel, computes the fragmentation score from its effective energy,
 * derives a fragment count, then samples that many random points within the voxel's
 * unit cube [x, x+1) × [y, y+1) × [z, z+1).
 *
 * @param fragmentedVoxels - Set of "x,y,z" keys identifying fragmented voxels.
 * @param effectiveEnergy - Map of "x,y,z" key → deposited energy for each voxel.
 * @param grid - The voxel grid (used for threshold computation and bounds).
 * @param rng - Seeded random number generator for deterministic sampling.
 * @returns Array of Vec3 seed points (fragment centroids) for Voronoi tessellation.
 */
export function sampleVoronoiSeeds(
  fragmentedVoxels: Set<string>,
  effectiveEnergy: Map<string, number>,
  grid: VoxelGrid,
  rng: Random,
): Vec3[] {
  const points: Vec3[] = [];

  for (const key of fragmentedVoxels) {
    const coords = parseKey(key);
    if (!coords) continue;
    const [x, y, z] = coords;

    if (!grid.isInBounds(x, y, z)) continue;

    const voxel = grid.getVoxel(x, y, z);
    if (!voxel) continue;

    const energy = effectiveEnergy.get(key) ?? 0;
    const threshold = computeThreshold(voxel);
    const score = computeFragmentationScore(energy, threshold);
    const count = computeFragmentCount(score);

    for (let i = 0; i < count; i++) {
      const px = rng.nextFloat(x, x + 1);
      const py = rng.nextFloat(y, y + 1);
      const pz = rng.nextFloat(z, z + 1);
      points.push(vec3(px, py, pz));
    }
  }

  return points;
}

// ────────────────────────────────────────────────────────────────────────────
// Task 5.9 — Delaunay tetrahedralization and Voronoi fragment generation
// ────────────────────────────────────────────────────────────────────────────

export interface Tetrahedron {
  a: number; b: number; c: number; d: number;
  circumcenter: Vec3;
}

export interface VoronoiCell {
  seedIndex: number;
  vertices: Vec3[];
  isValid: boolean;
}

export interface BoundingBox {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

/**
 * Compute the axis-aligned bounding box for a set of fragmented voxel keys.
 *
 * @param fragmentedVoxels - Set of "x,y,z" keys identifying fragmented voxels.
 * @returns The bounding box enclosing all fragmented voxels.
 */
export function computeBoundingBox(fragmentedVoxels: Set<string>): BoundingBox {
  if (fragmentedVoxels.size === 0) {
    return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const key of fragmentedVoxels) {
    const coords = parseKey(key);
    if (!coords) continue;
    const [x, y, z] = coords;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  // If no keys parsed successfully, return zeros
  if (!Number.isFinite(minX)) {
    return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 };
  }

  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/**
 * Cull voxels with the lowest fragmentation scores when the number of candidate
 * points exceeds MAX_VORONOI_POINTS.
 *
 * @param fragmentedVoxels - Set of "x,y,z" keys identifying fragmented voxels.
 * @param effectiveEnergy - Map of "x,y,z" key → deposited energy for each voxel.
 * @param grid - The voxel grid (used for threshold computation and bounds).
 * @param maxPoints - Maximum number of seed points to keep.
 * @returns A subset of fragmentedVoxels with the highest-scoring voxels retained.
 */
export function cullLowestScoreVoxels(
  fragmentedVoxels: Set<string>,
  effectiveEnergy: Map<string, number>,
  grid: VoxelGrid,
  maxPoints: number,
): Set<string> {
  if (fragmentedVoxels.size === 0) return new Set();

  // Compute score and estimated fragment count for each voxel
  const voxelInfo = new Map<string, { score: number; count: number }>();
  let totalEstimated = 0;

  for (const key of fragmentedVoxels) {
    const coords = parseKey(key);
    if (!coords) continue;
    const [x, y, z] = coords;

    if (!grid.isInBounds(x, y, z)) {
      voxelInfo.set(key, { score: 0, count: 0 });
      continue;
    }

    const voxel = grid.getVoxel(x, y, z);
    if (!voxel) {
      voxelInfo.set(key, { score: 0, count: 0 });
      continue;
    }

    const energy = effectiveEnergy.get(key) ?? 0;
    const threshold = computeThreshold(voxel);
    const score = computeFragmentationScore(energy, threshold);
    const count = computeFragmentCount(score);
    voxelInfo.set(key, { score, count });
    totalEstimated += count;
  }

  // If under or at limit, return a copy of the original set
  if (totalEstimated <= maxPoints) {
    return new Set(fragmentedVoxels);
  }

  // Sort keys by score ascending (lowest first)
  const sortedKeys = [...voxelInfo.entries()]
    .sort((a, b) => a[1].score - b[1].score)
    .map(([key]) => key);

  // Remove lowest-score voxels until total estimated points ≤ maxPoints
  const result = new Set(fragmentedVoxels);
  let currentTotal = totalEstimated;

  for (const key of sortedKeys) {
    if (currentTotal <= maxPoints) break;
    if (!result.has(key)) continue;

    const info = voxelInfo.get(key);
    if (!info) continue;

    result.delete(key);
    currentTotal -= info.count;
  }

  return result;
}

/**
 * Compute the circumcenter of a tetrahedron defined by four points.
 *
 * @param a - First vertex.
 * @param b - Second vertex.
 * @param c - Third vertex.
 * @param d - Fourth vertex.
 * @returns The circumcenter (center of the circumscribed sphere).
 */
export function computeCircumcenter(a: Vec3, b: Vec3, c: Vec3, d: Vec3): Vec3 {
  // Shift to origin
  const ba = sub(b, a);
  const ca = sub(c, a);
  const da = sub(d, a);

  const cross_ca_da = cross(ca, da);
  const cross_da_ba = cross(da, ba);
  const cross_ba_ca = cross(ba, ca);

  const det = 2 * dot(ba, cross_ca_da);

  // Degenerate case: return centroid
  if (Math.abs(det) < 1e-12) {
    return vec3(
      (a.x + b.x + c.x + d.x) / 4,
      (a.y + b.y + c.y + d.y) / 4,
      (a.z + b.z + c.z + d.z) / 4,
    );
  }

  const ba_len2 = dot(ba, ba);
  const ca_len2 = dot(ca, ca);
  const da_len2 = dot(da, da);

  // numerator = cross(ca,da)*|ba|² + cross(da,ba)*|ca|² + cross(ba,ca)*|da|²
  const num = add(
    add(
      scale(cross_ca_da, ba_len2),
      scale(cross_da_ba, ca_len2),
    ),
    scale(cross_ba_ca, da_len2),
  );

  // result = a + num / det
  return add(a, scale(num, 1 / det));
}

/**
 * Bowyer-Watson algorithm for Delaunay tetrahedralization of a set of 3D points.
 *
 * @param points - Array of 3D points to triangulate.
 * @returns Array of tetrahedra forming the Delaunay triangulation.
 */
export function bowyerWatsonDelaunay(points: Vec3[]): Tetrahedron[] {
  const n = points.length;
  if (n < 4) return [];

  // Find bounding box of all points to construct super-tetrahedron
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    if (p.z > maxZ) maxZ = p.z;
  }

  // Super-tetrahedron center
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;

  // Super-tetrahedron size: double the diagonal of the bounding box
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  const diagonal = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const d = diagonal * 2;

  // Super-tetrahedron vertices (indices n, n+1, n+2, n+3)
  // These are placed far enough to enclose all points
  const s0 = vec3(cx - d, cy - d, cz - d);
  const s1 = vec3(cx + d, cy + d, cz - d);
  const s2 = vec3(cx - d, cy + d, cz + d);
  const s3 = vec3(cx + d, cy - d, cz + d);

  // Extended points array: original points + super-tet vertices
  const allPoints: Vec3[] = [...points, s0, s1, s2, s3];

  // Initial super-tetrahedron
  const circumcenter_super = computeCircumcenter(s0, s1, s2, s3);
  const tetrahedra: Tetrahedron[] = [{
    a: n, b: n + 1, c: n + 2, d: n + 3,
    circumcenter: circumcenter_super,
  }];

  const eps = 1e-10;

  // Insert each point into the triangulation
  for (let i = 0; i < n; i++) {
    const p = points[i]!;

    // Step 1: Find all "bad" tetrahedra whose circumsphere contains point p
    const badTetIndices: number[] = [];
    for (let ti = 0; ti < tetrahedra.length; ti++) {
      const tet = tetrahedra[ti]!;
      const distToCenter = squaredDistance(p, tet.circumcenter);
      const radius = squaredDistance(allPoints[tet.a]!, tet.circumcenter);
      if (distToCenter <= radius + eps) {
        badTetIndices.push(ti);
      }
    }

    // Step 2: Build face boundary — count occurrences of each face
    const faceCount = new Map<string, number>();

    const faceKey = (v0: number, v1: number, v2: number): string => {
      const arr = [v0, v1, v2].sort((a, b) => a - b);
      return `${arr[0]},${arr[1]},${arr[2]}`;
    };

    for (const ti of badTetIndices) {
      const tet = tetrahedra[ti]!;
      // Four faces of a tetrahedron
      const faces: [number, number, number][] = [
        [tet.a, tet.b, tet.c],
        [tet.a, tet.b, tet.d],
        [tet.a, tet.c, tet.d],
        [tet.b, tet.c, tet.d],
      ];
      for (const [v0, v1, v2] of faces) {
        const k = faceKey(v0, v1, v2);
        faceCount.set(k, (faceCount.get(k) ?? 0) + 1);
      }
    }

    // Boundary faces: those that appear exactly once
    const boundaryFaces: [number, number, number][] = [];
    for (const [k, count] of faceCount) {
      if (count === 1) {
        const parts = k.split(',').map(Number) as [number, number, number];
        boundaryFaces.push(parts);
      }
    }

    // Step 3: Remove bad tetrahedra (reverse order to maintain indices)
    const sortedBad = [...badTetIndices].sort((a, b) => b - a);
    for (const ti of sortedBad) {
      tetrahedra.splice(ti, 1);
    }

    // Step 4: Create new tetrahedra from boundary faces and point i
    for (const [v0, v1, v2] of boundaryFaces) {
      const cc = computeCircumcenter(allPoints[v0]!, allPoints[v1]!, allPoints[v2]!, p);
      tetrahedra.push({
        a: v0, b: v1, c: v2, d: i,
        circumcenter: cc,
      });
    }
  }

  // Filter out tetrahedra connected to super-tetrahedron vertices
  return tetrahedra.filter(tet =>
    tet.a < n && tet.b < n && tet.c < n && tet.d < n
  );
}

/**
 * Compute Voronoi cells from a Delaunay tetrahedralization.
 *
 * @param tetrahedra - Array of tetrahedra from the Delaunay triangulation.
 * @param pointCount - Number of original seed points.
 * @returns Array of Voronoi cells (one per seed point).
 */
export function computeVoronoiCells(tetrahedra: Tetrahedron[], pointCount: number): VoronoiCell[] {
  const cells: VoronoiCell[] = [];
  for (let i = 0; i < pointCount; i++) {
    cells.push({ seedIndex: i, vertices: [], isValid: false });
  }

  for (const tet of tetrahedra) {
    const cc = tet.circumcenter;
    cells[tet.a]!.vertices.push(cc);
    cells[tet.b]!.vertices.push(cc);
    cells[tet.c]!.vertices.push(cc);
    cells[tet.d]!.vertices.push(cc);
  }

  for (const cell of cells) {
    cell.isValid = cell.vertices.length >= 4;
  }

  return cells;
}

/**
 * Clip a Voronoi cell to lie within the given bounding box.
 *
 * @param cell - The Voronoi cell to clip.
 * @param bounds - The bounding box to clip against.
 * @returns The clipped Voronoi cell.
 */
export function clipVoronoiCell(cell: VoronoiCell, bounds: BoundingBox): VoronoiCell {
  const minVec = vec3(bounds.minX, bounds.minY, bounds.minZ);
  const maxVec = vec3(bounds.maxX, bounds.maxY, bounds.maxZ);

  // Clamp each vertex to the bounding box
  const clamped: Vec3[] = [];
  for (const v of cell.vertices) {
    clamped.push(clamp(v, minVec, maxVec));
  }

  // Deduplicate using Vec3.equals
  const unique: Vec3[] = [];
  for (const v of clamped) {
    let isDuplicate = false;
    for (const u of unique) {
      if (equals(v, u)) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) unique.push(v);
  }

  return {
    seedIndex: cell.seedIndex,
    vertices: unique,
    isValid: unique.length >= 4,
  };
}

/**
 * Generate Voronoi fragment cells from Delaunay tetrahedra bounded by an AABB.
 *
 * @param points - Array of seed points (Voronoi sites).
 * @param tetrahedra - Array of Delaunay tetrahedra.
 * @param bounds - The bounding box to clip all cells against.
 * @returns Array of clipped Voronoi cells.
 */
export function generateFragments(points: Vec3[], tetrahedra: Tetrahedron[], bounds: BoundingBox): VoronoiCell[] {
  const cells = computeVoronoiCells(tetrahedra, points.length);

  return cells.map(cell => clipVoronoiCell(cell, bounds));
}

// ────────────────────────────────────────────────────────────────────────────
// Task 5.10 — Voronoi merging pass
// ────────────────────────────────────────────────────────────────────────────

/**
 * Builds the adjacency graph from Delaunay tetrahedra.
 *
 * For each pair of seed point indices that share a Delaunay edge (i.e., appear
 * together in the same tetrahedron), an entry is recorded in the adjacency map.
 *
 * @param tetrahedra - Array of Delaunay tetrahedra.
 * @param pointCount - Number of seed points.
 * @returns Map where each key is a seed index and the value is a set of neighbor indices.
 */
export function buildAdjacencyMap(tetrahedra: Tetrahedron[], pointCount: number): Map<number, Set<number>> {
  const adjacencyMap = new Map<number, Set<number>>();
  for (let i = 0; i < pointCount; i++) {
    adjacencyMap.set(i, new Set());
  }
  for (const tet of tetrahedra) {
    const { a, b, c, d } = tet;
    // Skip tetrahedra referencing out-of-range indices (e.g. super-tetrahedron vertices)
    if (a >= pointCount || b >= pointCount || c >= pointCount || d >= pointCount) continue;

    // Register all 6 unordered edges of the tetrahedron (Set deduplicates automatically)
    for (const [u, v] of [[a, b] as const, [a, c] as const, [a, d] as const, [b, c] as const, [b, d] as const, [c, d] as const]) {
      adjacencyMap.get(u)!.add(v);
      adjacencyMap.get(v)!.add(u);
    }
  }
  return adjacencyMap;
}

/**
 * Remove duplicate 3D points, keeping only the first occurrence of each position.
 * Used by convexHull3D when all input points are collinear or coplanar.
 */
function deduplicatePoints(points: Vec3[]): Vec3[] {
  const seen = new Map<string, Vec3>();
  for (const pt of points) {
    const key = `${pt.x},${pt.y},${pt.z}`;
    if (!seen.has(key)) seen.set(key, pt);
  }
  return [...seen.values()];
}

/**
 * Computes the 3D convex hull of a set of points.
 *
 * @param points - Array of 3D points.
 * @returns Array of hull vertices (in no guaranteed order).
 */
export function convexHull3D(points: Vec3[]): Vec3[] {
  const n = points.length;
  const eps = 1e-10;

  // ── Input validation — reject NaN/Infinity ─────────────────────────────────
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      return [];
    }
  }

  // ── Base cases ─────────────────────────────────────────────────────────────
  if (n === 0) return [];
  if (n === 1) return [points[0]!];
  if (n === 2) return [points[0]!, points[1]!];

  // 3 points — check collinearity
  if (n === 3) {
    const p0 = points[0]!;
    const p1 = points[1]!;
    const p2 = points[2]!;
    const crossProduct = cross(sub(p1, p0), sub(p2, p0));
    if (Math.sqrt(dot(crossProduct, crossProduct)) < eps) {
      // Collinear → return endpoints
      return [p0, p2];
    }
    return [p0, p1, p2];
  }

  // ── Find 4 non-coplanar points for initial tetrahedron ────────────────────
  // Strategy: find the widest spread along X, then point farthest from line,
  // then point farthest from the plane of those 3.

  // Step 1: two farthest points along X axis (store indices, not coordinates)
  let minXIdx = 0, maxXIdx = 0;
  for (let i = 1; i < n; i++) {
    if (points[i]!.x < points[minXIdx]!.x) minXIdx = i;
    if (points[i]!.x > points[maxXIdx]!.x) maxXIdx = i;
  }
  const i0 = minXIdx;
  const i1 = maxXIdx;

  // Step 2: find point farthest from the line (i0,i1)
  let i2 = -1;
  let maxSqDist = -1;
  const direction = sub(points[i1]!, points[i0]!);
  const dirLengthSq = dot(direction, direction);
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1) continue;
    // Squared distance from point to line = |cross(p-p0, dir)|² / |dir|²
    const vec = sub(points[i]!, points[i0]!);
    const cr = cross(vec, direction);
    const sqDist = dot(cr, cr) / (dirLengthSq || 1);
    if (sqDist > maxSqDist) {
      maxSqDist = sqDist;
      i2 = i;
    }
  }

  // If all points collinear, return deduplicated set
  if (i2 < 0 || Math.sqrt(maxSqDist) < eps) {
    return deduplicatePoints(points);
  }

  // Step 3: find point farthest from the plane of (i0,i1,i2)
  const p0 = points[i0]!, p1 = points[i1]!, p2 = points[i2]!;
  const planeNormal = cross(sub(p1, p0), sub(p2, p0));
  let i3 = -1;
  let maxVolume = -1;
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1 || i === i2) continue;
    const vol = Math.abs(dot(sub(points[i]!, p0), planeNormal));
    if (vol > maxVolume) {
      maxVolume = vol;
      i3 = i;
    }
  }

  // If all points are coplanar, return deduplicated set
  if (i3 < 0 || maxVolume < eps) {
    return deduplicatePoints(points);
  }

  // We now have 4 non-coplanar points: i0, i1, i2, i3
  const iA = i0, iB = i1, iC = i2, iD = i3;

  // Centroid of initial tetrahedron (used as interior reference for normal orientation)
  // Using tetrahedron centroid guarantees the reference point is inside the hull.
  const tetCentroid = vec3(
    (points[iA]!.x + points[iB]!.x + points[iC]!.x + points[iD]!.x) / 4,
    (points[iA]!.y + points[iB]!.y + points[iC]!.y + points[iD]!.y) / 4,
    (points[iA]!.z + points[iB]!.z + points[iC]!.z + points[iD]!.z) / 4,
  );

  // Face representation
  interface Face {
    a: number;
    b: number;
    c: number;
    normal: Vec3;
  }

  const faces: Face[] = [];

  /** Create a face from three vertex indices with outward-pointing normal. */
  const addFace = (a: number, b: number, c: number): void => {
    const pa = points[a]!;
    const pb = points[b]!;
    const pc = points[c]!;
    const ab = sub(pb, pa);
    const ac = sub(pc, pa);
    const n = cross(ab, ac);
    const faceCentroid = vec3(
      (pa.x + pb.x + pc.x) / 3,
      (pa.y + pb.y + pc.y) / 3,
      (pa.z + pb.z + pc.z) / 3,
    );
    // Outward normal points away from the tetrahedron centroid
    if (dot(n, sub(faceCentroid, tetCentroid)) < 0) {
      faces.push({ a, b, c, normal: scale(n, -1) });
    } else {
      faces.push({ a, b, c, normal: n });
    }
  };

  // Build the 4 faces of the initial tetrahedron
  addFace(iA, iB, iC);
  addFace(iA, iB, iD);
  addFace(iA, iC, iD);
  addFace(iB, iC, iD);

  // Track which points are already inserted
  const inserted = new Set<number>([iA, iB, iC, iD]);

  // ── Incremental insertion of remaining points ──────────────────────────────
  for (let i = 0; i < n; i++) {
    if (inserted.has(i)) continue;
    inserted.add(i);

    const p = points[i]!;

    // Find all faces visible from point p
    // A face is visible if point p is on the positive side of its plane
    const visibleFaces: Face[] = [];
    for (const face of faces) {
      if (dot(face.normal, sub(p, points[face.a]!)) > eps) {
        visibleFaces.push(face);
      }
    }

    if (visibleFaces.length === 0) continue; // point is inside the hull

    // Count edges of visible faces — edges with count 1 form the horizon
    const edgeCount = new Map<string, number>();
    const edgeKey = (v0: number, v1: number): string =>
      v0 < v1 ? `${v0},${v1}` : `${v1},${v0}`;

    for (const face of visibleFaces) {
      for (const [v0, v1] of [[face.a, face.b] as const, [face.b, face.c] as const, [face.c, face.a] as const]) {
        const key = edgeKey(v0, v1);
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
      }
    }

    // Horizon edges are those appearing exactly once (the border between
    // visible and non-visible faces)
    const horizonEdges: [number, number][] = [];
    for (const [key, count] of edgeCount) {
      if (count === 1) {
        const parts = key.split(',').map(Number) as [number, number];
        horizonEdges.push(parts);
      }
    }

    // Remove all visible faces (reverse order to maintain splice indices)
    const visibleSet = new Set(visibleFaces);
    for (let fi = faces.length - 1; fi >= 0; fi--) {
      if (visibleSet.has(faces[fi]!)) {
        faces.splice(fi, 1);
      }
    }

    // Create new triangular faces from each horizon edge + the new point
    for (const [a, b] of horizonEdges) {
      addFace(a, b, i);
    }
  }

  // ── Collect unique vertex indices from all faces ──────────────────────────
  const uniqueIndices = new Set<number>();
  for (const face of faces) {
    uniqueIndices.add(face.a);
    uniqueIndices.add(face.b);
    uniqueIndices.add(face.c);
  }

  return [...uniqueIndices].map(idx => points[idx]!);
}

/**
 * Merges two adjacent Voronoi cells by computing the convex hull of their
 * combined vertex sets. The merged cell inherits the seedIndex of cellA.
 *
 * @param cellA - First Voronoi cell.
 * @param cellB - Second Voronoi cell (adjacent to cellA).
 * @returns A new merged Voronoi cell.
 */
export function mergeTwoCells(cellA: VoronoiCell, cellB: VoronoiCell): VoronoiCell {
  const combined = [...cellA.vertices, ...cellB.vertices];
  const hull = convexHull3D(combined);
  return { seedIndex: cellA.seedIndex, vertices: hull, isValid: hull.length >= 4 };
}

/**
 * Main Voronoi cell merging pass.
 *
 * Iterates through all cells. For each cell that has not yet been merged,
 * with probability `MERGE_PROBABILITY`, it merges with a randomly chosen
 * adjacent neighbor that also hasn't been merged. Merged cells replace both
 * originals in the output array (the result is stored at the first cell's
 * index and the second cell is marked as merged).
 *
 * @param cells - Array of Voronoi cells to merge.
 * @param tetrahedra - Array of Delaunay tetrahedra (used to build adjacency).
 * @param rng - Seeded random number generator for deterministic merging.
 * @returns A new array of Voronoi cells after merging.
 */
export function mergeVoronoiCells(cells: VoronoiCell[], tetrahedra: Tetrahedron[], rng: Random): VoronoiCell[] {
  // Clone input array to avoid mutating the caller's data
  const working = [...cells];
  const adjacencyMap = buildAdjacencyMap(tetrahedra, working.length);
  const isMerged = new Array<boolean>(working.length).fill(false);

  for (let i = 0; i < working.length; i++) {
    if (isMerged[i]) continue;
    if (!rng.chance(MERGE_PROBABILITY)) continue;

    const neighbors = adjacencyMap.get(i);
    if (!neighbors || neighbors.size === 0) continue;

    // Filter to only include not-yet-merged neighbors
    const available = [...neighbors].filter(j => !isMerged[j]);
    if (available.length === 0) continue;

    // Pick a random available neighbor
    const pickIdx = rng.nextInt(0, available.length - 1);
    const neighborIdx = available[pickIdx]!;

    // Merge cell i with neighborIdx, storing result at index i
    working[i] = mergeTwoCells(working[i]!, working[neighborIdx]!);
    isMerged[neighborIdx] = true;
  }

  // Return all cells that were not merged into another cell
  return working.filter((_, idx) => !isMerged[idx]);
}
