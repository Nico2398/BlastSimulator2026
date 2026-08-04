import { describe, it, expect } from 'vitest';
import { buildCutStone, cutSolid, solidToTriangles, type ConvexSolid } from '../../../src/renderer/FragmentGeometry.js';

/** The variant seeds FragmentMesh actually uses. */
const VARIANT_SEEDS = Array.from({ length: 24 }, (_, i) => 1000 + i * 7919);

/**
 * Watertightness: weld triangle-soup vertices by position, then require every
 * directed edge to appear exactly once, paired with its reverse. An open mesh —
 * the floating-plane bug — breaks this immediately: a boundary edge has no
 * partner on the other side.
 */
function assertWatertight(triangles: Float32Array, label: string): void {
  const key = (x: number, y: number, z: number): string =>
    `${x.toFixed(5)},${y.toFixed(5)},${z.toFixed(5)}`;

  const edges = new Map<string, number>();
  for (let t = 0; t < triangles.length; t += 9) {
    const corners = [0, 3, 6].map(o =>
      key(triangles[t + o]!, triangles[t + o + 1]!, triangles[t + o + 2]!));
    for (let e = 0; e < 3; e++) {
      const edge = `${corners[e]}|${corners[(e + 1) % 3]}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }

  for (const [edge, count] of edges) {
    expect(count, `${label}: directed edge ${edge} used ${count} times`).toBe(1);
    const [a, b] = edge.split('|');
    expect(edges.has(`${b}|${a}`), `${label}: edge ${edge} has no reverse — the mesh is open`).toBe(true);
  }
}

/** Signed volume of the triangle soup via the divergence theorem. */
function signedVolume(triangles: Float32Array): number {
  let volume = 0;
  for (let t = 0; t < triangles.length; t += 9) {
    const ax = triangles[t]!, ay = triangles[t + 1]!, az = triangles[t + 2]!;
    const bx = triangles[t + 3]!, by = triangles[t + 4]!, bz = triangles[t + 5]!;
    const cx = triangles[t + 6]!, cy = triangles[t + 7]!, cz = triangles[t + 8]!;
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return volume;
}

describe('FragmentGeometry — cut stones', () => {
  it('every variant is a closed mesh with no floating planes', () => {
    for (const seed of VARIANT_SEEDS) {
      assertWatertight(solidToTriangles(buildCutStone(seed)), `seed ${seed}`);
    }
  });

  it('every variant encloses a sensible volume, wound outward', () => {
    for (const seed of VARIANT_SEEDS) {
      const volume = signedVolume(solidToTriangles(buildCutStone(seed)));
      // Positive: consistently outward winding. Above 0.15: the cuts did not
      // shave the stone away to a sliver. Below 1: something was actually cut.
      expect(volume, `seed ${seed}`).toBeGreaterThan(0.15);
      expect(volume, `seed ${seed}`).toBeLessThanOrEqual(1.000001);
    }
  });

  it('every variant fills the unit bounding box exactly', () => {
    for (const seed of VARIANT_SEEDS) {
      const solid = buildCutStone(seed);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, y, z] of solid.vertices) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      expect(minX).toBeCloseTo(-0.5, 5);
      expect(maxX).toBeCloseTo(0.5, 5);
      expect(minY).toBeCloseTo(-0.5, 5);
      expect(maxY).toBeCloseTo(0.5, 5);
      expect(minZ).toBeCloseTo(-0.5, 5);
      expect(maxZ).toBeCloseTo(0.5, 5);
    }
  });

  it('variants differ from each other', () => {
    const a = solidToTriangles(buildCutStone(VARIANT_SEEDS[0]!));
    const b = solidToTriangles(buildCutStone(VARIANT_SEEDS[1]!));
    expect(a.length === b.length && a.every((v, i) => v === b[i])).toBe(false);
  });

  it('is deterministic per seed', () => {
    const a = solidToTriangles(buildCutStone(1234));
    const b = solidToTriangles(buildCutStone(1234));
    expect([...a]).toEqual([...b]);
  });
});

describe('FragmentGeometry — cutSolid', () => {
  const cube: ConvexSolid = {
    vertices: [
      [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
      [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
    ],
    faces: [
      [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [0, 4, 7, 3], [1, 2, 6, 5],
    ],
  };

  it('slicing a corner keeps the solid closed and smaller', () => {
    const n: [number, number, number] = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
    const cut = cutSolid(cube, n, 0.5);
    assertWatertight(solidToTriangles(cut), 'corner cut');
    expect(signedVolume(solidToTriangles(cut))).toBeLessThan(1);
    expect(signedVolume(solidToTriangles(cut))).toBeGreaterThan(0.5);
  });

  it('a plane missing the solid changes nothing', () => {
    const cut = cutSolid(cube, [1, 0, 0], 2);
    expect(cut).toBe(cube);
  });

  it('a plane that would erase the whole solid is refused', () => {
    const cut = cutSolid(cube, [1, 0, 0], -2);
    expect(cut).toBe(cube);
  });
});
