// BlastSimulator2026 — Voronoi cell merging pass
// Part of Chapter 5 (Blast Full Pipeline)
// Task 5.10: adjacency graph, convex hull, cell merging

import type { Vec3 } from '../core/math/Vec3.js';
import { vec3, sub, scale, dot, cross } from '../core/math/Vec3.js';
import { Random } from '../core/math/Random.js';
import { MERGE_PROBABILITY } from '../core/config/balance.js';
import { type Tetrahedron, type VoronoiCell } from './DelaunayTessellation.js';

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
