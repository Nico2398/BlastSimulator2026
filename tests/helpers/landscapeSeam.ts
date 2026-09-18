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

/** Angle between two unit normals, in degrees. */
function angleBetweenDegrees(a: THREE.Vector3, b: THREE.Vector3): number {
  return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(a.dot(b), -1, 1)));
}

/**
 * Measure the join along the site's whole boundary.
 *
 * `stepA` and `stepB` are the two sheets' own lattice steps, in metres — the
 * band to check either side of the claim is derived from them rather than
 * passed in directly. Keep the derived band inside the landscape's FINE_STEP
 * ring (one COARSE_STEP quad, 4 m): a coarse quad puts only two triangle
 * centroids in its sixteen cells, so a wider band reports open ground as
 * uncovered.
 */
export function measureSeam(
  playable: readonly THREE.Mesh[],
  landscape: readonly THREE.Mesh[],
  grid: VoxelGrid,
  stepA: number,
  stepB: number,
): SeamReport {
  // TODO: implement — derive band from Math.max(stepA, stepB) / 2, then walk
  // the grid as before using indexedLatticeNodes/coveredCells/angleBetweenDegrees.
  void playable; void landscape; void grid; void stepA; void stepB;
  void indexedLatticeNodes; void coveredCells; void angleBetweenDegrees;
  throw new Error('not implemented');
}
