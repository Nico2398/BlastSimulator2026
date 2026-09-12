// BlastSimulator2026 — GroundTint shared unit tests (#1006)
//
// One conforming ground-tint primitive every overlay call site routes
// through, so a patch's own geometry follows the sloped marching-cubes
// surface instead of sitting as a flat quad/circle lifted by one constant Y.
// The core regression this file exists to prove: a patch spanning columns of
// different sampled height must NOT render at a single flat Y (issue #1006).

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import {
  bilinearSurfaceHeight,
  buildConformingRing,
  GroundTintLayer,
  GROUND_TINT_Y_EPSILON,
  type SurfaceHeightSampler,
  type GroundTintPatch,
} from '../../../src/renderer/GroundTint.js';

let scene: THREE.Scene;

beforeEach(() => {
  scene = new THREE.Scene();
});

/**
 * Every vertex Y across every Mesh currently in the scene, in WORLD space.
 * Reading `geometry.attributes.position` directly gives LOCAL coordinates —
 * a flat quad/circle rotated flat via `mesh.rotation.x` has local Y spanning
 * its own radius/size regardless of where it sits on the terrain, which
 * would make a still-flat (buggy) patch look like it conforms. Applying
 * `matrixWorld` covers both a legacy rotated-local-plane mesh and a
 * conforming mesh that bakes world height directly into local coordinates
 * at identity transform (a no-op transform in that case).
 */
function allPositionYs(): number[] {
  scene.updateMatrixWorld(true);
  const ys: number[] = [];
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const pos = o.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.applyMatrix4(o.matrixWorld);
        ys.push(v.y);
      }
    }
  });
  return ys;
}

function allMeshes(): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  return meshes;
}

function cellPatch(id: string, x: number, z: number, opts?: Partial<GroundTintPatch>): GroundTintPatch {
  return { id, shape: { kind: 'cell', x, z }, color: 0xffffff, opacity: 1, ...opts };
}

describe('bilinearSurfaceHeight', () => {
  it('at an exact integer lattice point returns exactly the corner sampler value there', () => {
    const sampler: SurfaceHeightSampler = (x, z) => x * 3 + z * 7 + 1;
    expect(bilinearSurfaceHeight(sampler, 5, 9)).toBeCloseTo(sampler(5, 9), 10);
  });

  it('at a fractional point between two corners of different height interpolates between them', () => {
    // Height varies only along x: corner(0,0)=0, corner(1,0)=10.
    const sampler: SurfaceHeightSampler = (x, _z) => x * 10;
    const mid = bilinearSurfaceHeight(sampler, 0.5, 0);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(10);
    expect(mid).not.toBeCloseTo(0, 5);
    expect(mid).not.toBeCloseTo(10, 5);
  });

  it('boundary: a completely flat sampler returns the flat value everywhere, fractional or not', () => {
    const sampler: SurfaceHeightSampler = () => 42;
    expect(bilinearSurfaceHeight(sampler, 0, 0)).toBeCloseTo(42, 10);
    expect(bilinearSurfaceHeight(sampler, 3.7, 8.2)).toBeCloseTo(42, 10);
  });

  it('rejection: a sampler that throws propagates rather than silently defaulting to 0', () => {
    const sampler: SurfaceHeightSampler = () => { throw new Error('no terrain here'); };
    expect(() => bilinearSurfaceHeight(sampler, 1, 1)).toThrow();
  });
});

describe('GROUND_TINT_Y_EPSILON', () => {
  it('is small and positive', () => {
    expect(GROUND_TINT_Y_EPSILON).toBeGreaterThan(0);
    expect(GROUND_TINT_Y_EPSILON).toBeLessThan(0.5);
  });
});

describe('GroundTintLayer — conforming to terrain height', () => {
  it('replace() with a single sloped cell patch renders vertex Y that is not constant across the patch — the core #1006 regression', () => {
    const sampler: SurfaceHeightSampler = (x, z) => x + z;
    const layer = new GroundTintLayer(scene, sampler);
    layer.replace([cellPatch('a', 10, 10)]);

    const ys = allPositionYs();
    expect(ys.length, 'a cell patch should produce vertex geometry').toBeGreaterThan(0);
    const uniqueYs = new Set(ys.map((y) => Math.round(y * 1000)));
    expect(uniqueYs.size, 'a sloped cell must not render at one constant Y (#1006)').toBeGreaterThan(1);
  });

  it('two cell patches at columns of different sampled height produce correspondingly different vertex Y', () => {
    const sampler: SurfaceHeightSampler = (x, _z) => (x < 50 ? 2 : 20);
    const layer = new GroundTintLayer(scene, sampler);
    layer.replace([cellPatch('low', 0, 0), cellPatch('high', 60, 0)]);

    const ys = allPositionYs();
    expect(Math.min(...ys)).toBeLessThan(5);
    expect(Math.max(...ys)).toBeGreaterThan(15);
  });

  it('sanity: a flat sampler renders a patch at that constant height — the mechanism does not warp flat ground', () => {
    const sampler: SurfaceHeightSampler = () => 7;
    const layer = new GroundTintLayer(scene, sampler);
    layer.replace([cellPatch('flat', 0, 0)]);

    const ys = allPositionYs();
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(7 - 0.001);
      expect(y).toBeLessThanOrEqual(7 + GROUND_TINT_Y_EPSILON + 0.05);
    }
  });

  it('disc-shaped patch: geometry Y varies across the disc radius when corner heights vary', () => {
    const sampler: SurfaceHeightSampler = (x, _z) => x;
    const layer = new GroundTintLayer(scene, sampler);
    layer.replace([{ id: 'ring', shape: { kind: 'disc', cx: 10, cz: 10, radius: 5, segments: 16 }, color: 0xffffff, opacity: 1 }]);

    const ys = allPositionYs();
    expect(ys.length).toBeGreaterThan(0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1);
  });

  it('supports per-patch opacity without collapsing every patch to one alpha', () => {
    const sampler: SurfaceHeightSampler = () => 0;
    const layer = new GroundTintLayer(scene, sampler);
    layer.replace([
      cellPatch('faint', 0, 0, { opacity: 0.1 }),
      cellPatch('solid', 10, 0, { opacity: 0.9 }),
    ]);

    expect(layer.patchCount).toBe(2);

    const meshes = allMeshes();
    expect(meshes.length, 'ground tint should render something for two patches').toBeGreaterThan(0);

    const perVertexAlphaVaries = meshes.some((m) => {
      const colorAttr = m.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
      if (!colorAttr || colorAttr.itemSize < 4) return false;
      const alphas = new Set<number>();
      for (let i = 0; i < colorAttr.count; i++) alphas.add(Math.round(colorAttr.getW(i) * 100));
      return alphas.size > 1;
    });
    const perMeshOpacityVaries = new Set(meshes.map((m) => (m.material as THREE.Material).opacity)).size > 1;

    expect(
      perVertexAlphaVaries || perMeshOpacityVaries,
      'a faint and a solid patch should render at visibly different alpha, whether encoded per-vertex or per-mesh',
    ).toBe(true);
  });
});

describe('GroundTintLayer — patch-set semantics', () => {
  it('add() preserves patches from a previous call with different ids', () => {
    const layer = new GroundTintLayer(scene, () => 0);
    layer.replace([cellPatch('a', 0, 0)]);
    layer.add([cellPatch('b', 1, 0)]);
    expect(layer.patchCount).toBe(2);
  });

  it('add() replaces an existing patch when the id matches, rather than duplicating it', () => {
    const layer = new GroundTintLayer(scene, () => 0);
    layer.replace([cellPatch('a', 0, 0, { opacity: 0.2 })]);
    layer.add([cellPatch('a', 0, 0, { opacity: 0.9 })]);
    expect(layer.patchCount).toBe(1);
  });

  it('replace() drops patches not named in the new call', () => {
    const layer = new GroundTintLayer(scene, () => 0);
    layer.replace([cellPatch('a', 0, 0), cellPatch('b', 1, 0)]);
    layer.replace([cellPatch('c', 2, 0)]);
    expect(layer.patchCount).toBe(1);
  });

  it('remove(ids) removes only the named patches', () => {
    const layer = new GroundTintLayer(scene, () => 0);
    layer.replace([cellPatch('a', 0, 0), cellPatch('b', 1, 0), cellPatch('c', 2, 0)]);
    layer.remove(['b']);
    expect(layer.patchCount).toBe(2);
  });

  it('clear() removes every patch and leaves nothing rendered in the scene', () => {
    // GroundTintLayer owns one persistent Mesh for its whole lifetime
    // (rebuilt in place by replace()/add()/clear(), see class docs) rather
    // than adding/removing a mesh per call — every overlay's clear()/replace()
    // cycle (SelectionOverlay.buildRect, SurveyConfidenceOverlay.show, …)
    // depends on that mesh staying in the scene across an empty patch set so
    // a later replace() has something to draw into. So "leaves no mesh
    // children" means the mesh renders zero geometry, not that the mesh
    // itself is gone (#1006).
    const layer = new GroundTintLayer(scene, () => 0);
    layer.replace([cellPatch('a', 0, 0), cellPatch('b', 1, 0)]);
    layer.clear();
    expect(layer.patchCount).toBe(0);
    expect(allMeshes()).toHaveLength(1);
    expect(allPositionYs()).toHaveLength(0);
  });

  it('boundary: replace() with an empty array clears everything', () => {
    const layer = new GroundTintLayer(scene, () => 0);
    layer.replace([cellPatch('a', 0, 0)]);
    layer.replace([]);
    expect(layer.patchCount).toBe(0);
  });

  it('rejection: remove() with an unknown id is a no-op, not a throw', () => {
    const layer = new GroundTintLayer(scene, () => 0);
    layer.replace([cellPatch('a', 0, 0)]);
    expect(() => layer.remove(['nonexistent'])).not.toThrow();
    expect(layer.patchCount).toBe(1);
  });

  it('dispose() removes every patch and releases scene resources', () => {
    const layer = new GroundTintLayer(scene, () => 0);
    layer.replace([cellPatch('a', 0, 0)]);
    layer.dispose();
    expect(layer.patchCount).toBe(0);
    expect(allMeshes()).toHaveLength(0);
  });
});

describe('GroundTintLayer — front-face culling and winding (#1043)', () => {
  // GroundTintLayer previously used `THREE.DoubleSide`, which hid the fact
  // that emitCell/emitDisc wind their triangles with a downward (-Y) normal.
  // Fixing the material to FrontSide alone would make the overlay invisible
  // from above; the winding must flip too. These three tests pin both halves
  // of the fix independently.

  it('material.side is FrontSide, not DoubleSide, so the overlay culls from below the terrain', () => {
    const layer = new GroundTintLayer(scene, () => 0);
    layer.replace([cellPatch('a', 0, 0)]);

    const mesh = allMeshes()[0];
    expect(mesh, 'replace() with a patch should produce a mesh').toBeDefined();
    const material = mesh!.material as THREE.MeshBasicMaterial;
    expect(material.side).toBe(THREE.FrontSide);
  });

  it('emitCell winds both triangles of a cell patch with an upward (+Y) geometric normal', () => {
    const sampler: SurfaceHeightSampler = () => 5;
    const layer = new GroundTintLayer(scene, sampler);
    layer.replace([cellPatch('a', 10, 10)]);

    const mesh = allMeshes()[0]!;
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(pos.count, 'one cell patch is 2 triangles of 3 vertices each').toBe(6);

    const triCount = pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const v0 = new THREE.Vector3().fromBufferAttribute(pos, t * 3);
      const v1 = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + 1);
      const v2 = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + 2);
      const edge1 = v1.clone().sub(v0);
      const edge2 = v2.clone().sub(v0);
      const normal = edge1.cross(edge2);
      expect(normal.y, `cell triangle ${t} geometric normal should point upward (+Y)`).toBeGreaterThan(0);
    }
  });

  it('emitDisc winds every fan triangle of a disc patch with an upward (+Y) geometric normal', () => {
    const sampler: SurfaceHeightSampler = () => 5;
    const layer = new GroundTintLayer(scene, sampler);
    const segments = 8;
    layer.replace([{
      id: 'disc',
      shape: { kind: 'disc', cx: 10, cz: 10, radius: 5, segments },
      color: 0xffffff,
      opacity: 1,
    }]);

    const mesh = allMeshes()[0]!;
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    expect(pos.count, 'a disc patch is `segments` fan triangles of 3 vertices each').toBe(segments * 3);

    for (let t = 0; t < segments; t++) {
      const v0 = new THREE.Vector3().fromBufferAttribute(pos, t * 3);
      const v1 = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + 1);
      const v2 = new THREE.Vector3().fromBufferAttribute(pos, t * 3 + 2);
      const edge1 = v1.clone().sub(v0);
      const edge2 = v2.clone().sub(v0);
      const normal = edge1.cross(edge2);
      expect(normal.y, `disc triangle ${t} geometric normal should point upward (+Y)`).toBeGreaterThan(0);
    }
  });
});

describe('buildConformingRing', () => {
  it('vertices are not all at one constant Y when the sampler varies by position (mirrors the radius-ring bug)', () => {
    const sampler: SurfaceHeightSampler = (x, _z) => x;
    const ring = buildConformingRing(sampler, 10, 10, 5, 16, 0xffffff, 1);
    const pos = ring.geometry.getAttribute('position') as THREE.BufferAttribute;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    expect(maxY - minY, 'a conforming ring around varying terrain must not sit at one flat Y').toBeGreaterThan(1);
  });

  it('sanity: on flat terrain the ring is flat too', () => {
    const sampler: SurfaceHeightSampler = () => 5;
    const ring = buildConformingRing(sampler, 10, 10, 5, 16, 0xffffff, 1);
    const pos = ring.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBeGreaterThanOrEqual(5 - 0.001);
      expect(pos.getY(i)).toBeLessThanOrEqual(5 + GROUND_TINT_Y_EPSILON + 0.05);
    }
  });
});
