// BlastSimulator2026 — Seam invariants between the playable and landscape meshes (#907)
//
// The two sheets join correctly when, and only when, two things hold at once:
//
//   1. **Exactly one sheet owns every square metre.** No cell carries geometry
//      from both (a doubled edge, z-fighting) and none carries geometry from
//      neither (a slot you can see through).
//   2. **Both sheets place every shared node at the same height.** A node the
//      two meshes each emit a vertex at is a node on the ring they share, and a
//      disagreement there is a step in the ground.
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
  /** Cells carrying geometry from both sheets, and from neither. */
  doubleCovered: string[];
  uncovered: string[];
}

/** Every lattice node an emitted triangle actually references, with its heights. */
function indexedLatticeNodes(meshes: readonly THREE.Mesh[]): Map<string, number[]> {
  const nodes = new Map<string, number[]>();
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes['position'] as THREE.BufferAttribute;
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
      nodes.set(key, [...(nodes.get(key) ?? []), pos.getY(i)]);
    }
  }
  return nodes;
}

/**
 * Every 1 m cell a mesh puts ground over. A triangle belongs to the cell its
 * centroid falls in; one lying exactly in a vertical boundary plane has no
 * ground footprint at all and is skipped, or the ring itself would read as
 * doubly covered.
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
      const ax = pos.getX(b) - pos.getX(a), az = pos.getZ(b) - pos.getZ(a);
      const bx = pos.getX(c) - pos.getX(a), bz = pos.getZ(c) - pos.getZ(a);
      if (Math.abs(ax * bz - az * bx) < 1e-9) continue; // vertical face
      const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
      const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
      cells.add(`${Math.floor(cx)},${Math.floor(cz)}`);
    }
  }
  return cells;
}

/**
 * Measure the join along the site's whole boundary.
 *
 * `band` is how far either side of the claim to check, in metres. Keep it
 * inside the landscape's FINE_STEP ring (one COARSE_STEP quad, 4 m): a coarse
 * quad puts only two triangle centroids in its sixteen cells, so a wider band
 * reports open ground as uncovered.
 */
export function measureSeam(
  playable: readonly THREE.Mesh[],
  landscape: readonly THREE.Mesh[],
  grid: VoxelGrid,
  band = 2,
): SeamReport {
  const playableNodes = indexedLatticeNodes(playable);
  const landscapeNodes = indexedLatticeNodes(landscape);
  const playableCells = coveredCells(playable);
  const landscapeCells = coveredCells(landscape);

  const report: SeamReport = {
    sharedNodes: 0, worstDisagreement: 0, worstAt: '', doubleCovered: [], uncovered: [],
  };

  for (let x = grid.minX - band; x < grid.maxX + band; x++) {
    for (let z = grid.minZ - band; z < grid.maxZ + band; z++) {
      const key = `${x},${z}`;

      const a = playableNodes.get(key), b = landscapeNodes.get(key);
      if (a && b) {
        report.sharedNodes++;
        // A cliff column carries several playable vertices; the ring node is
        // the one the landscape also placed, so compare the nearest pair.
        let nearest = Infinity;
        for (const ya of a) for (const yb of b) nearest = Math.min(nearest, Math.abs(ya - yb));
        if (nearest > report.worstDisagreement) {
          report.worstDisagreement = nearest;
          report.worstAt = key;
        }
      }

      const inPlayable = playableCells.has(key), inLandscape = landscapeCells.has(key);
      if (inPlayable && inLandscape) report.doubleCovered.push(key);
      if (!inPlayable && !inLandscape) report.uncovered.push(key);
    }
  }
  return report;
}
