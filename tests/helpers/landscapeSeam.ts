// BlastSimulator2026 — Seam invariants between the playable and landscape meshes (#907)
//
// The two sheets join correctly when, and only when, two things hold at once:
//
//   1. **Exactly one sheet owns every square metre.** No cell carries geometry
//      from both (a doubled edge, z-fighting) and none carries geometry from
//      neither (a slot you can see through).
//   2. **Both sheets place every shared node at the same height, and light it
//      the same way.** A node the two meshes each emit a vertex at is a node on
//      the ring they share: a height disagreement there is a step in the
//      ground, and a normal disagreement is a lighting crease drawn along the
//      site's whole perimeter — the rectangle a player sees on open ground
//      (#1077).
//
// Neither is checkable from one mesh alone, which is exactly why four passes at
// this seam (#458 → #491 → #559 → #560) each shipped green: no test anywhere
// built both meshes and compared them.

import * as THREE from 'three';
import type { VoxelGrid } from '../../src/core/world/VoxelGrid.js';

export interface SeamReport {
  /** Lattice nodes both meshes emit a vertex at — the ring they share. */
  sharedNodes: number;
  /** Largest height disagreement at any shared node, metres. */
  worstDisagreement: number;
  worstAt: string;
  /** Largest angle between the two sheets' normals at any shared node, degrees. */
  worstNormalAngle: number;
  worstNormalAt: string;
  /** Cells carrying geometry from both sheets, and from neither. */
  doubleCovered: string[];
  uncovered: string[];
}

/** One vertex a mesh placed at a lattice node: where it put it, and how it lights it. */
interface NodeVertex {
  y: number;
  normal: THREE.Vector3;
}

/** Every lattice node an emitted triangle actually references, with its vertices. */
function indexedLatticeNodes(meshes: readonly THREE.Mesh[]): Map<string, NodeVertex[]> {
  const nodes = new Map<string, NodeVertex[]>();
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes['position'] as THREE.BufferAttribute;
    const nor = mesh.geometry.attributes['normal'] as THREE.BufferAttribute | undefined;
    const index = mesh.geometry.getIndex();
    // LandscapeMesh pushes every coarse node of a tile up front and indexes
    // only the quads it keeps, so the buffer carries nodes inside the claim
    // that nothing draws. Only referenced vertices are on the surface.
    const used = new Set<number>();
    if (index) for (let i = 0; i < index.count; i++) used.add(index.getX(i));
    else for (let i = 0; i < pos.count; i++) used.add(i);

    for (const i of used) {
      const x = pos.getX(i), z = pos.getZ(i);
      if (Math.abs(x - Math.round(x)) > 1e-4 || Math.abs(z - Math.round(z)) > 1e-4) continue;
      const key = `${Math.round(x)},${Math.round(z)}`;
      const normal = nor
        ? new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i))
        : new THREE.Vector3(0, 1, 0);
      nodes.set(key, [...(nodes.get(key) ?? []), { y: pos.getY(i), normal }]);
    }
  }
  return nodes;
}

/** Sign of the cross product (p - b) x (a - b), for the point-in-triangle test below. */
function edgeSign(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  return (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
}

/** True when (px, pz) falls inside (or on an edge of) the 2D triangle a/b/c. */
function pointInTriangle(
  px: number, pz: number,
  ax: number, az: number, bx: number, bz: number, cx: number, cz: number,
): boolean {
  const d1 = edgeSign(px, pz, ax, az, bx, bz);
  const d2 = edgeSign(px, pz, bx, bz, cx, cz);
  const d3 = edgeSign(px, pz, cx, cz, ax, az);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * Every 1 m cell a mesh puts ground over. A cell belongs to a triangle when
 * the cell's own centre point falls inside it — checked across every cell in
 * the triangle's bounding box, not just the one its own centroid lands in.
 *
 * A single centroid-per-triangle test (the pre-#1153 rule, when every
 * triangle this ran over was already a 1 m cell) silently under-reports once
 * a coarser ladder rung's own quads reach this helper directly (#1153):
 * a >1 m quad's two triangles split it along one diagonal, and a triangle's
 * centroid always lands in the cell nearest its own right-angle corner —
 * so only the diagonal's own two cells were ever marked, and the other two
 * cells of a >1×1 m quad read as "uncovered" though the triangle plainly
 * draws ground over them too. A triangle lying exactly in a vertical
 * boundary plane has no ground footprint at all and is skipped, or the ring
 * itself would read as doubly covered.
 */
function coveredCells(meshes: readonly THREE.Mesh[]): Set<string> {
  const cells = new Set<string>();
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes['position'] as THREE.BufferAttribute;
    const index = mesh.geometry.getIndex();
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const a = index ? index.getX(i) : i;
      const b = index ? index.getX(i + 1) : i + 1;
      const c = index ? index.getX(i + 2) : i + 2;
      const ax = pos.getX(a), az = pos.getZ(a);
      const bx = pos.getX(b), bz = pos.getZ(b);
      const cx = pos.getX(c), cz = pos.getZ(c);
      const edgeAx = bx - ax, edgeAz = bz - az;
      const edgeBx = cx - ax, edgeBz = cz - az;
      if (Math.abs(edgeAx * edgeBz - edgeAz * edgeBx) < 1e-9) continue; // vertical face

      const loX = Math.floor(Math.min(ax, bx, cx)), hiX = Math.ceil(Math.max(ax, bx, cx));
      const loZ = Math.floor(Math.min(az, bz, cz)), hiZ = Math.ceil(Math.max(az, bz, cz));
      for (let gx = loX; gx < hiX; gx++) {
        for (let gz = loZ; gz < hiZ; gz++) {
          if (pointInTriangle(gx + 0.5, gz + 0.5, ax, az, bx, bz, cx, cz)) cells.add(`${gx},${gz}`);
        }
      }
    }
  }
  return cells;
}

/** Angle between two unit normals, in degrees. */
function angleBetweenDegrees(a: THREE.Vector3, b: THREE.Vector3): number {
  return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)));
}

/**
 * Measure the join along the site's whole boundary.
 *
 * `stepA` and `stepB` are the two sheets' own lattice steps, in metres. How
 * far either side of the claim to check is derived from them — half the
 * coarser of the two — rather than passed in directly. Keep the derived band
 * inside the coarser sheet's own quad: a coarse quad puts only two triangle
 * centroids in its cells, so a wider band reports open ground as uncovered.
 */
export function measureSeam(
  playable: readonly THREE.Mesh[],
  landscape: readonly THREE.Mesh[],
  grid: VoxelGrid,
  stepA: number,
  stepB: number,
): SeamReport {
  const band = Math.max(stepA, stepB) / 2;

  const playableNodes = indexedLatticeNodes(playable);
  const landscapeNodes = indexedLatticeNodes(landscape);
  const playableCells = coveredCells(playable);
  const landscapeCells = coveredCells(landscape);

  const report: SeamReport = {
    sharedNodes: 0, worstDisagreement: 0, worstAt: '',
    worstNormalAngle: 0, worstNormalAt: '',
    doubleCovered: [], uncovered: [],
  };

  // Every node/cell key is an integer world-metre coordinate (indexedLatticeNodes
  // rounds to the nearest one, coveredCells floors to one), so the scan itself
  // has to land on integers too. `band` is derived from a step pair and is not
  // always a whole number (two level-0, 1 m/1 m sheets give band = 0.5) — a loop
  // that starts at the fractional `grid.minX - band` and steps by a plain `x++`
  // never lands on an integer again, so every lookup below misses by construction
  // and the whole scanned area reads as uncovered with zero shared nodes. Round
  // the scan bounds outward to the nearest integer instead of shifting the whole
  // lattice off it.
  const xLo = Math.floor(grid.minX - band), xHi = Math.ceil(grid.maxX + band);
  const zLo = Math.floor(grid.minZ - band), zHi = Math.ceil(grid.maxZ + band);
  for (let x = xLo; x < xHi; x++) {
    for (let z = zLo; z < zHi; z++) {
      const key = `${x},${z}`;

      const a = playableNodes.get(key), b = landscapeNodes.get(key);
      if (a && b) {
        report.sharedNodes++;
        // A cliff column carries several playable vertices; the ring node is
        // the one the landscape also placed, so compare the nearest pair — and
        // read that same pair's normals, since only the vertices the two
        // sheets actually share light a shared edge.
        let nearest = Infinity;
        let nearestPair: [NodeVertex, NodeVertex] | null = null;
        for (const va of a) for (const vb of b) {
          const gap = Math.abs(va.y - vb.y);
          if (gap >= nearest) continue;
          nearest = gap;
          nearestPair = [va, vb];
        }
        if (nearest > report.worstDisagreement) {
          report.worstDisagreement = nearest;
          report.worstAt = key;
        }
        if (nearestPair) {
          const angle = angleBetweenDegrees(nearestPair[0].normal, nearestPair[1].normal);
          if (angle > report.worstNormalAngle) {
            report.worstNormalAngle = angle;
            report.worstNormalAt = key;
          }
        }
      }

      const inPlayable = playableCells.has(key), inLandscape = landscapeCells.has(key);
      if (inPlayable && inLandscape) report.doubleCovered.push(key);
      if (!inPlayable && !inLandscape) report.uncovered.push(key);
    }
  }
  return report;
}
