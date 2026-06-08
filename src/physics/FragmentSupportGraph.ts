// BlastSimulator2026 — Fragment support graph functions
// Extracted from FragmentSimUtils.ts to keep that file under 300 lines.

// ─── Types ──────────────────────────────────────────────────────────────────────

/** Axis-aligned bounding box derived from fragment vertices. */
export interface AABB {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

/** Bi-directional support graph for fragment stacking. */
export interface SupportGraph {
  /** fragmentId → IDs of fragments directly above that it supports */
  supporting: Map<number, number[]>;
  /** fragmentId → IDs of fragments directly below that support it */
  supportedBy: Map<number, number[]>;
}

// ─── Fragment Support Graph & Stack-Collapse ─────────────────────────────────────

/**
 * Compute the axis-aligned bounding box (AABB) from a fragment's graphic vertices.
 *
 * Iterates over the interleaved Float32Array (every 3 floats = one vertex)
 * and tracks the min/max for each axis.
 *
 * @param frag - Fragment object containing a `graphicVertices` Float32Array.
 * @returns A new AABB with the computed extents.
 */
export function computeFragmentAABB(_frag: { graphicVertices: Float32Array }): AABB {
  const verts = _frag.graphicVertices;
  if (verts.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
  }
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < verts.length; i += 3) {
    const x = verts[i]!;
    const y = verts[i + 1]!;
    const z = verts[i + 2]!;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  // Handle degenerate case where all vertices have same coordinate on an axis
  if (!Number.isFinite(minX)) minX = 0;
  if (!Number.isFinite(maxX)) maxX = 0;
  if (!Number.isFinite(minY)) minY = 0;
  if (!Number.isFinite(maxY)) maxY = 0;
  if (!Number.isFinite(minZ)) minZ = 0;
  if (!Number.isFinite(maxZ)) maxZ = 0;
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

/**
 * Compute the XZ overlap between two axis-aligned bounding boxes.
 *
 * Returns the overlap extents on X and Z axes, the product (overlapArea),
 * and the minimum of the two boxes' XZ areas (minArea).
 *
 * @param aabbA - First AABB.
 * @param aabbB - Second AABB.
 * @returns Overlap metrics.
 */
export function computeXZOverlap(_aabbA: AABB, _aabbB: AABB): { overlapX: number; overlapZ: number; overlapArea: number; minArea: number } {
  const overlapX = Math.max(0, Math.min(_aabbA.maxX, _aabbB.maxX) - Math.max(_aabbA.minX, _aabbB.minX));
  const overlapZ = Math.max(0, Math.min(_aabbA.maxZ, _aabbB.maxZ) - Math.max(_aabbA.minZ, _aabbB.minZ));
  const overlapArea = overlapX * overlapZ;
  const areaA = (_aabbA.maxX - _aabbA.minX) * (_aabbA.maxZ - _aabbA.minZ);
  const areaB = (_aabbB.maxX - _aabbB.minX) * (_aabbB.maxZ - _aabbB.minZ);
  const minArea = Math.min(areaA, areaB);
  return { overlapX, overlapZ, overlapArea, minArea };
}

/**
 * Test whether the horizontal overlap ratio meets the given tolerance.
 *
 * Returns true when overlapArea / minArea >= tolerance.
 *
 * @param overlapArea - Overlapping area on the XZ plane.
 * @param minArea - Minimum of the two boxes' XZ areas.
 * @param tolerance - Ratio threshold (0–1).
 * @returns True if the overlap ratio meets or exceeds the tolerance.
 */
export function horizontalOverlap(_overlapArea: number, _minArea: number, _tolerance: number): boolean {
  if (_minArea === 0) {
    return _overlapArea === 0;
  }
  return _overlapArea / _minArea >= _tolerance;
}

/**
 * Compute the vertical gap between the bottom of the upper fragment's AABB
 * and the top of the lower fragment's AABB.
 *
 * Positive values indicate a gap; zero or negative values indicate interpenetration.
 *
 * @param above - Fragment above with a `cy` centroid coordinate.
 * @param below - Fragment below with a `cy` centroid coordinate.
 * @param aboveAabb - AABB of the upper fragment.
 * @param belowAabb - AABB of the lower fragment.
 * @returns The vertical gap in metres.
 */
export function verticalGap(
  _above: { cy: number },
  _below: { cy: number },
  _aboveAabb: AABB,
  _belowAabb: AABB,
): number {
  const aboveHalfHeight = (_aboveAabb.maxY - _aboveAabb.minY) / 2;
  const belowHalfHeight = (_belowAabb.maxY - _belowAabb.minY) / 2;
  const aboveMinY = _above.cy - aboveHalfHeight;
  const belowMaxY = _below.cy + belowHalfHeight;
  return aboveMinY - belowMaxY;
}

/**
 * Build a bi-directional support graph from an array of fragments.
 *
 * For every pair of fragments where one is vertically above the other,
 * checks horizontal overlap ratio and vertical gap. If both meet the
 * provided tolerances, a support relationship is recorded.
 *
 * @param fragments - Array of fragments with at least `id` and `state`.
 * @param horizontalTolerance - Minimum horizontal overlap ratio (0–1).
 * @param maxVerticalGap - Maximum allowed vertical gap (metres).
 * @returns A bi-directional SupportGraph.
 */
export function buildSupportGraph(
  _fragments: Array<{ id: number; state: string; cx: number; cy: number; cz: number; graphicVertices: Float32Array }>,
  _horizontalTolerance: number,
  _maxVerticalGap: number,
): SupportGraph {
  const supporting = new Map<number, number[]>();
  const supportedBy = new Map<number, number[]>();

  const staticFrags = _fragments.filter(f => f.state === 'static');

  for (let i = 0; i < staticFrags.length; i++) {
    const a = staticFrags[i]!;
    for (let j = i + 1; j < staticFrags.length; j++) {
      const b = staticFrags[j]!;

      // Ensure a is below b (a.cy < b.cy)
      const below = a.cy <= b.cy ? a : b;
      const above = a.cy <= b.cy ? b : a;

      const aabbBelow = computeFragmentAABB(below);
      const aabbAbove = computeFragmentAABB(above);

      const { overlapArea, minArea } = computeXZOverlap(aabbBelow, aabbAbove);

      if (!horizontalOverlap(overlapArea, minArea, _horizontalTolerance)) continue;

      const gap = verticalGap(above, below, aabbAbove, aabbBelow);

      if (gap >= 0 && gap <= _maxVerticalGap) {
        // below supports above
        const belowList = supporting.get(below.id) ?? [];
        belowList.push(above.id);
        supporting.set(below.id, belowList);

        const aboveList = supportedBy.get(above.id) ?? [];
        aboveList.push(below.id);
        supportedBy.set(above.id, aboveList);
      }
    }
  }

  return { supporting, supportedBy };
}

/**
 * Get the IDs of fragments directly supported by (i.e. resting on top of) the given fragment.
 *
 * @param graph - The support graph.
 * @param fragmentId - ID of the fragment to query.
 * @returns Array of fragment IDs directly above the given fragment.
 */
export function getDirectlySupported(_graph: SupportGraph, _fragmentId: number): number[] {
  return _graph.supporting.get(_fragmentId) ?? [];
}
