// BlastSimulator2026 — Guided region drawing (#489), retargeted for #1006
//
// The region a tutorial step pins a placement to used to reach the screen only
// as a tint on cells the player had *already* selected, so it was invisible
// until after the click it existed to guide, and never visible at all for the
// point and line tools, which draw no cells. "Click the highlighted tile" with
// nothing highlighted is the reported bug. These tests hold the region on
// screen from the moment the tool arms.
//
// #1006 retarget: the region's per-cell tint used to be one flat THREE.Mesh
// per tile, counted directly as `regionGroup().children`. GroundTintLayer
// (issue #1006) merges every cell into ONE conforming BufferGeometry per
// `replace()` call instead — and its constructor only accepts a THREE.Scene,
// not an arbitrary parent Group, so the merged tint mesh cannot live nested
// inside `regionGroup` the way the old per-cell meshes did. Every assertion
// that used to count cell meshes inside `regionGroup` is rewritten below to
// look at the whole scene instead, and to assert on patch/vertex-count
// scaling rather than a one-mesh-per-cell count. The border/corner/beacon
// scaffolding (THREE.Line, not a ground tint) still lives in `regionGroup`
// unchanged, so those assertions are untouched.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SelectionOverlay } from '../../../src/renderer/SelectionOverlay.js';

let scene: THREE.Scene;
let overlay: SelectionOverlay;

/** The group the region's border/corner/beacon scaffolding is drawn into, separate from the selection's own. */
function regionGroup(): THREE.Group {
  return scene.getObjectByName('placement-region-overlay') as THREE.Group;
}

/** Every THREE.Mesh anywhere in the scene — the region's conforming ground-tint patch(es) live here, not necessarily under regionGroup. */
function sceneMeshes(): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  scene.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  return meshes;
}

function totalVertexCount(meshes: THREE.Mesh[]): number {
  return meshes.reduce((n, m) => {
    const pos = m.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    return n + (pos ? pos.count : 0);
  }, 0);
}

/**
 * SelectionOverlay owns TWO GroundTintLayer instances — one for the live
 * selection, one for the pinned region/blocked-tile — each with its own
 * persistent Mesh added to the scene for the overlay's whole lifetime (same
 * design GroundTint.test.ts covers: a layer's mesh survives an empty patch
 * set so a later replace() has something to draw into). `sceneMeshes()`
 * therefore never drops to 0 or 1 — it is always exactly these two meshes,
 * empty or not. "how many meshes carry a region/selection tint right now"
 * means filtering to the ones with actual vertices, not counting scene
 * children (#1006).
 */
function meshesWithGeometry(): THREE.Mesh[] {
  return sceneMeshes().filter((m) => totalVertexCount([m]) > 0);
}

beforeEach(() => {
  scene = new THREE.Scene();
  overlay = new SelectionOverlay(scene, () => 0);
});

describe('the guided region is drawn before anything is selected', () => {
  it('draws nothing until a region is published', () => {
    expect(regionGroup()).toBeDefined();
    expect(regionGroup().children).toHaveLength(0);
    expect(totalVertexCount(sceneMeshes()), 'the persistent ground-tint meshes should carry no geometry yet').toBe(0);
  });

  it('merges a 3x3 region\'s cell tint into a single conforming mesh, not one mesh per cell (#1006)', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 });

    const meshes = meshesWithGeometry();
    expect(meshes, '3x3 region tint should merge into a single conforming mesh, not nine separate meshes').toHaveLength(1);
    // Border group + four corner lines + beacon still live in regionGroup as plain Line objects.
    expect(regionGroup().children.length).toBeGreaterThan(0);
  });

  it('the merged region-tint geometry carries more vertices for a bigger region (#1006)', () => {
    overlay.setRegion({ x1: 23, z1: 23, x2: 23, z2: 23 }); // 1 cell
    const singleCellVerts = totalVertexCount(sceneMeshes());
    expect(singleCellVerts).toBeGreaterThan(0);

    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 }); // 3x3 = 9 cells
    const nineCellVerts = totalVertexCount(sceneMeshes());

    expect(nineCellVerts, 'nine cells worth of conforming geometry should carry more vertices than one').toBeGreaterThan(singleCellVerts);
  });

  it('the border/corner/beacon scaffolding count does not grow with region size — cell tint now merges elsewhere', () => {
    overlay.setRegion({ x1: 23, z1: 23, x2: 23, z2: 23 }); // 1 cell
    const smallCount = regionGroup().children.length;

    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 }); // 3x3 = 9 cells
    const bigCount = regionGroup().children.length;

    expect(bigCount, 'regionGroup itself should no longer scale with cell count once cell tint is a merged ground-tint patch').toBe(smallCount);
  });

  it('draws a one-tile region as a single conforming patch — the shape the survey and warehouse steps use', () => {
    overlay.setRegion({ x1: 23, z1: 23, x2: 23, z2: 23 });
    expect(meshesWithGeometry()).toHaveLength(1);
  });

  it('replaces the previous region rather than stacking on it', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 });
    const firstRegionGroupCount = regionGroup().children.length;
    const firstMeshCount = meshesWithGeometry().length;

    overlay.setRegion({ x1: 4, z1: 4, x2: 6, z2: 6 });

    expect(regionGroup().children).toHaveLength(firstRegionGroupCount);
    expect(meshesWithGeometry(), 'replacing a region should not stack a second merged tint mesh').toHaveLength(firstMeshCount);
  });

  it('takes the region off on null', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 });
    overlay.setRegion(null);
    expect(regionGroup().children).toHaveLength(0);
    expect(totalVertexCount(sceneMeshes()), 'no ground-tint geometry should remain once the region is taken off').toBe(0);
  });

  it('survives a selection update, which draws into its own group', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 });
    const before = regionGroup().children.length;
    overlay.update({ shape: 'rect', x1: 20, z1: 20, x2: 22, z2: 22 });
    expect(regionGroup().children).toHaveLength(before);
  });

  it('clear() takes both the selection and the region off, including the merged tint mesh', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 });
    overlay.update({ shape: 'point', x: 21, z: 21 });
    overlay.clear();
    expect(regionGroup().children).toHaveLength(0);
    expect(totalVertexCount(sceneMeshes()), 'no ground-tint geometry should remain after clear()').toBe(0);
  });
});

describe('a refused tile is marked', () => {
  it('folds the blocked-tile mark into the shared ground-tint mesh rather than adding a new mesh (#1006)', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 20, z2: 20 });
    const beforeMeshCount = sceneMeshes().length;
    expect(meshesWithGeometry().length, 'the 1x1 region tint should already be a single merged mesh').toBe(1);
    const beforeVerts = totalVertexCount(sceneMeshes());

    overlay.setBlockedTile({ x: 2, z: 2 });
    expect(sceneMeshes().length, 'the blocked-tile mark should not add a second mesh').toBe(beforeMeshCount);
    const afterVerts = totalVertexCount(sceneMeshes());
    expect(afterVerts, 'the blocked-tile mark should add vertices to the shared geometry').toBeGreaterThan(beforeVerts);

    overlay.setBlockedTile(null);
    expect(totalVertexCount(sceneMeshes())).toBe(beforeVerts);
  });

  it('does not rebuild when the same tile is set again', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 20, z2: 20 });
    overlay.setBlockedTile({ x: 2, z: 2 });
    const marked = regionGroup().children.map(c => c.uuid);

    overlay.setBlockedTile({ x: 2, z: 2 });

    expect(regionGroup().children.map(c => c.uuid)).toEqual(marked);
  });

  it('is cleared whenever a new region is published', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 20, z2: 20 });
    overlay.setBlockedTile({ x: 2, z: 2 });
    const withMarkVerts = totalVertexCount(sceneMeshes());

    overlay.setRegion({ x1: 20, z1: 20, x2: 20, z2: 20 });
    const afterVerts = totalVertexCount(sceneMeshes());

    expect(afterVerts, 'republishing the region drops the blocked-tile mark, so vertex count should fall').toBeLessThan(withMarkVerts);
  });
});

describe('dispose', () => {
  it('takes the region group off the scene', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 });
    overlay.dispose();
    expect(scene.getObjectByName('placement-region-overlay')).toBeUndefined();
  });

  it('leaves no ground-tint mesh behind either', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 });
    overlay.dispose();
    expect(sceneMeshes()).toHaveLength(0);
  });
});

// ── #1646: centred regions line up with the footprint preview convention ──
describe('a centred region is drawn on the footprint convention (#1646)', () => {
  /** Bounding box in x/z of every vertex in the given objects. */
  function bounds(objs: THREE.Object3D[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
    const box = new THREE.Box3();
    for (const o of objs) box.expandByObject(o);
    return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
  }
  const tintBounds = () => bounds(meshesWithGeometry());
  const scaffoldBounds = () => bounds([...regionGroup().children]);

  it('shifts the tint by -0.5 in x and z relative to the corner convention', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 });
    const plain = tintBounds();
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22, centred: true });
    const centred = tintBounds();
    expect(centred.minX).toBeCloseTo(plain.minX - 0.5);
    expect(centred.maxX).toBeCloseTo(plain.maxX - 0.5);
    expect(centred.minZ).toBeCloseTo(plain.minZ - 0.5);
    expect(centred.maxZ).toBeCloseTo(plain.maxZ - 0.5);
  });

  it('a size-3 centred region at origin spans [x-0.5, x+size-0.5], like the footprint preview', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22, centred: true });
    const b = tintBounds();
    expect(b.minX).toBeCloseTo(19.5);
    expect(b.maxX).toBeCloseTo(22.5);
    expect(b.minZ).toBeCloseTo(19.5);
    expect(b.maxZ).toBeCloseTo(22.5);
  });

  it('matches the cells the footprint preview tints for the same origin and size', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22, centred: true });
    const region = tintBounds();
    overlay.setRegion(null);
    const cells: Array<readonly [number, number]> = [];
    for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) cells.push([dx, dz]);
    overlay.update({ shape: 'point', x: 20, z: 20, footprintCells: cells } as never);
    const preview = tintBounds();
    expect(region.minX).toBeCloseTo(preview.minX);
    expect(region.maxX).toBeCloseTo(preview.maxX);
    expect(region.minZ).toBeCloseTo(preview.minZ);
    expect(region.maxZ).toBeCloseTo(preview.maxZ);
  });

  /** The beacon is the only scaffold child that is a vertical mast: zero x/z extent, non-zero height. */
  const beaconXZ = () => {
    for (const child of regionGroup().children) {
      const box = new THREE.Box3().expandByObject(child);
      if (box.max.x === box.min.x && box.max.z === box.min.z && box.max.y > box.min.y) {
        return { x: box.min.x, z: box.min.z };
      }
    }
    throw new Error('no beacon in the region group');
  };

  it('shifts border, corners and beacon by -0.5 as well', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 });
    const plain = scaffoldBounds();
    const plainBeacon = beaconXZ();
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22, centred: true });
    const centred = scaffoldBounds();
    const centredBeacon = beaconXZ();
    expect(centredBeacon.x).toBeCloseTo(plainBeacon.x - 0.5);
    expect(centredBeacon.z).toBeCloseTo(plainBeacon.z - 0.5);
    expect(centred.minX).toBeCloseTo(plain.minX - 0.5);
    expect(centred.maxX).toBeCloseTo(plain.maxX - 0.5);
    expect(centred.minZ).toBeCloseTo(plain.minZ - 0.5);
    expect(centred.maxZ).toBeCloseTo(plain.maxZ - 0.5);
  });

  it('a non-centred one-tile region stays unshifted on [x, x+1]', () => {
    overlay.setRegion({ x1: 23, z1: 23, x2: 23, z2: 23 });
    const b = tintBounds();
    expect(b.minX).toBeCloseTo(23);
    expect(b.maxX).toBeCloseTo(24);
    expect(b.minZ).toBeCloseTo(23);
    expect(b.maxZ).toBeCloseTo(24);
  });

  it('leaves the blocked-tile patch unshifted on a centred region', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 20, z2: 20, centred: true });
    overlay.setBlockedTile({ x: 2, z: 2 });
    const b = tintBounds();
    expect(b.minX).toBeCloseTo(2);
    expect(b.minZ).toBeCloseTo(2);
    expect(b.maxX).toBeCloseTo(20.5);
  });
});
