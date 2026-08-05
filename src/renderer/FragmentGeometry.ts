// BlastSimulator2026 — the shapes blast fragments are drawn with
//
// Every fragment is an instance of one of a small set of shared geometries, so
// a blast can show thousands of rocks in a handful of draw calls. Each variant
// is a unit cube with corners sliced off by a few random planes: a closed
// convex polyhedron with flat fracture faces meeting at irregular sharp edges,
// which is what blasted rock actually looks like.
//
// The previous variants jittered a box's vertices — but a box's corner vertices
// are duplicated per face, and displacing each copy independently tore the box
// open into free-floating planes. Slicing a solid cannot do that: the polygons
// of a clipped convex solid always close, so watertightness holds by
// construction (and is asserted by tests).
//
// The slicing itself is plain math with no three.js in it, so the logic-channel
// tests can check the meshes without a renderer.

import * as THREE from 'three';
import { Random } from '../core/math/Random.js';

/** A convex solid: shared vertices, faces as counter-clockwise vertex loops. */
export interface ConvexSolid {
  vertices: Array<[number, number, number]>;
  faces: number[][];
}

/** How many corner-slicing planes each stone variant takes, and how deep. */
const CUTS_MIN = 4;
const CUTS_MAX = 7;
/** Distance from the centre to a cutting plane, as a fraction of the half-diagonal. */
const CUT_DEPTH_MIN = 0.55;
const CUT_DEPTH_MAX = 0.92;
/** Vertices closer than this merge — slicing near a corner leaves slivers. */
const WELD_EPSILON = 1e-6;

/** The unit cube, faces wound counter-clockwise seen from outside. */
function unitCube(): ConvexSolid {
  const v: Array<[number, number, number]> = [
    [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
    [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
  ];
  return {
    vertices: v,
    faces: [
      [0, 3, 2, 1], // -z
      [4, 5, 6, 7], // +z
      [0, 1, 5, 4], // -y
      [2, 3, 7, 6], // +y
      [0, 4, 7, 3], // -x
      [1, 2, 6, 5], // +x
    ],
  };
}

/**
 * Slice a convex solid with the plane `n·p = d`, keeping `n·p <= d`.
 *
 * Standard convex clipping: every face polygon is clipped against the
 * half-space, the points where edges crossed the plane collect into a loop,
 * and that loop becomes the flat new "fracture face" capping the cut.
 */
export function cutSolid(
  solid: ConvexSolid,
  n: [number, number, number],
  d: number,
): ConvexSolid {
  const dist = solid.vertices.map(v => v[0] * n[0] + v[1] * n[1] + v[2] * n[2] - d);
  if (dist.every(x => x <= WELD_EPSILON)) return solid; // plane misses: unchanged
  if (dist.every(x => x >= -WELD_EPSILON)) return solid; // would delete everything: skip

  const vertices: Array<[number, number, number]> = [];
  const keyOf = (p: [number, number, number]): string =>
    `${Math.round(p[0] / WELD_EPSILON)},${Math.round(p[1] / WELD_EPSILON)},${Math.round(p[2] / WELD_EPSILON)}`;
  const indexByKey = new Map<string, number>();
  const add = (p: [number, number, number]): number => {
    const key = keyOf(p);
    const existing = indexByKey.get(key);
    if (existing !== undefined) return existing;
    const idx = vertices.length;
    vertices.push(p);
    indexByKey.set(key, idx);
    return idx;
  };

  const faces: number[][] = [];
  const capPoints: number[] = [];

  for (const face of solid.faces) {
    const kept: number[] = [];
    for (let i = 0; i < face.length; i++) {
      const a = face[i]!;
      const b = face[(i + 1) % face.length]!;
      const da = dist[a]!;
      const db = dist[b]!;
      if (da <= 0) kept.push(add(solid.vertices[a]!));
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
        const t = da / (da - db);
        const pa = solid.vertices[a]!;
        const pb = solid.vertices[b]!;
        const cut = add([
          pa[0] + (pb[0] - pa[0]) * t,
          pa[1] + (pb[1] - pa[1]) * t,
          pa[2] + (pb[2] - pa[2]) * t,
        ]);
        kept.push(cut);
        capPoints.push(cut);
      }
    }
    // Consecutive duplicates appear when a vertex lies exactly on the plane.
    const cleaned = kept.filter((v, i) => v !== kept[(i + 1) % kept.length]);
    if (cleaned.length >= 3) faces.push(cleaned);
  }

  // The cap: every cut point, ordered around the plane normal so the loop is
  // convex and wound with its face normal pointing along `n` (outward).
  const cap = [...new Set(capPoints)];
  if (cap.length >= 3) {
    let cx = 0, cy = 0, cz = 0;
    for (const i of cap) {
      cx += vertices[i]![0];
      cy += vertices[i]![1];
      cz += vertices[i]![2];
    }
    cx /= cap.length; cy /= cap.length; cz /= cap.length;

    // Basis in the cut plane.
    const [nx, ny, nz] = n;
    const ax = Math.abs(nx) < 0.9 ? 1 : 0;
    const ay = Math.abs(nx) < 0.9 ? 0 : 1;
    // u = arbitrary-axis × n, v = n × u
    const ux = ay * nz - 0 * ny, uy = 0 * nx - ax * nz, uz = ax * ny - ay * nx;
    const ul = Math.hypot(ux, uy, uz);
    const u = [ux / ul, uy / ul, uz / ul] as const;
    const v = [
      ny * u[2] - nz * u[1],
      nz * u[0] - nx * u[2],
      nx * u[1] - ny * u[0],
    ] as const;

    cap.sort((a, b) => {
      const pa = vertices[a]!;
      const pb = vertices[b]!;
      const angleA = Math.atan2(
        (pa[0] - cx) * v[0] + (pa[1] - cy) * v[1] + (pa[2] - cz) * v[2],
        (pa[0] - cx) * u[0] + (pa[1] - cy) * u[1] + (pa[2] - cz) * u[2],
      );
      const angleB = Math.atan2(
        (pb[0] - cx) * v[0] + (pb[1] - cy) * v[1] + (pb[2] - cz) * v[2],
        (pb[0] - cx) * u[0] + (pb[1] - cy) * u[1] + (pb[2] - cz) * u[2],
      );
      return angleA - angleB;
    });

    // Wind the cap so its normal points along n (outward for the kept side).
    const p0 = vertices[cap[0]!]!;
    const p1 = vertices[cap[1]!]!;
    const p2 = vertices[cap[2]!]!;
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const cross = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    if (cross[0]! * nx + cross[1]! * ny + cross[2]! * nz < 0) cap.reverse();
    faces.push(cap);
  }

  return { vertices, faces };
}

/**
 * One cut-stone solid: a unit cube with corners sliced off by seeded planes,
 * re-normalised so its bounding box is exactly the unit cube again — instance
 * scaling by a fragment's half-extents then gives the carved size back.
 */
export function buildCutStone(seed: number): ConvexSolid {
  const rng = new Random(seed);
  let solid = unitCube();

  const cuts = CUTS_MIN + Math.floor(rng.next() * (CUTS_MAX - CUTS_MIN + 1));
  for (let c = 0; c < cuts; c++) {
    // Random direction, biased nowhere in particular; reject near-zero vectors.
    let nx = 0, ny = 0, nz = 0, len = 0;
    do {
      nx = rng.next() * 2 - 1;
      ny = rng.next() * 2 - 1;
      nz = rng.next() * 2 - 1;
      len = Math.hypot(nx, ny, nz);
    } while (len < 0.1);
    nx /= len; ny /= len; nz /= len;

    const halfDiagonal = Math.sqrt(3) / 2;
    const d = halfDiagonal * (CUT_DEPTH_MIN + rng.next() * (CUT_DEPTH_MAX - CUT_DEPTH_MIN));
    solid = cutSolid(solid, [nx, ny, nz], d);
  }

  // Normalise the AABB back to the unit cube.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const [x, y, z] of solid.vertices) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const sx = maxX - minX || 1;
  const sy = maxY - minY || 1;
  const sz = maxZ - minZ || 1;
  return {
    vertices: solid.vertices.map(([x, y, z]) => [
      (x - minX) / sx - 0.5,
      (y - minY) / sy - 0.5,
      (z - minZ) / sz - 0.5,
    ]),
    faces: solid.faces,
  };
}

/**
 * Triangulate a solid into a flat-shaded soup: vertices duplicated per face so
 * every fracture face keeps its own hard normal. Duplication cannot open the
 * mesh — the faces themselves still share the same welded corner positions.
 */
export function solidToTriangles(solid: ConvexSolid): Float32Array {
  const out: number[] = [];
  for (const face of solid.faces) {
    for (let i = 1; i + 1 < face.length; i++) {
      for (const idx of [face[0]!, face[i]!, face[i + 1]!]) {
        const [x, y, z] = solid.vertices[idx]!;
        out.push(x, y, z);
      }
    }
  }
  return new Float32Array(out);
}

/** The shared variant geometries, built once, deterministic per variant index. */
export function buildFragmentGeometries(count: number): THREE.BufferGeometry[] {
  const geometries: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const positions = solidToTriangles(buildCutStone(1000 + i * 7919));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    geometries.push(geo);
  }
  return geometries;
}
