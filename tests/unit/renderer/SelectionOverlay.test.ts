// BlastSimulator2026 — SelectionOverlay unit tests (#1006)
//
// Covers rect selection cell tint, point/footprint tint, the blocked-tile
// mark, and the survey-radius ring (buildPoint) through the shared
// GroundTintLayer with a mock sampler that varies by column, so a "flat
// plate on sloped terrain" regression shows up as vertex Y that never
// varies. SelectionOverlay.region.test.ts covers setRegion/setBlockedTile
// lifecycle separately; this file is about the ground-conforming geometry
// itself.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SelectionOverlay } from '../../../src/renderer/SelectionOverlay.js';
import type { SurfaceHeightSampler } from '../../../src/renderer/GroundTint.js';

let scene: THREE.Scene;

beforeEach(() => {
  scene = new THREE.Scene();
});

/**
 * Every vertex Y across every Mesh in the scene, in WORLD space. Reading
 * `geometry.attributes.position` directly gives LOCAL coordinates — the
 * overlay's existing cell quads are rotated flat via `mesh.rotation.x`, so
 * their local Y spans their own quad size regardless of terrain height,
 * which would make a still-flat (buggy) quad look like it conforms.
 * Applying `matrixWorld` covers both that legacy rotated-local-plane mesh
 * and a conforming mesh that bakes world height directly into local
 * coordinates at identity transform (a no-op transform in that case).
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

/** World-space X/Z bounds across every Mesh's vertices in the scene — used to check where a footprint-cell tint patch actually sits, not just how it conforms to slope. */
function positionXZBounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
  scene.updateMatrixWorld(true);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const pos = o.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
      if (!pos) return;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.applyMatrix4(o.matrixWorld);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
      }
    }
  });
  return { minX, maxX, minZ, maxZ };
}

/** World-space Y spread across every LineLoop (radius ring) in the scene — rings are built from world-space points with no extra transform, but matrixWorld is applied anyway for robustness. */
function ringYSpread(): number {
  scene.updateMatrixWorld(true);
  let minY = Infinity;
  let maxY = -Infinity;
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (o instanceof THREE.LineLoop) {
      const pos = o.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.applyMatrix4(o.matrixWorld);
        minY = Math.min(minY, v.y);
        maxY = Math.max(maxY, v.y);
      }
    }
  });
  return maxY - minY;
}

// A strong slope so a flat plate is trivially distinguishable from one that
// conforms to it.
const slopedSampler: SurfaceHeightSampler = (x, _z) => x * 3;

describe('SelectionOverlay — rect selection tint conforms to terrain (#1006)', () => {
  it('rect selection tint is not one flat Y across a multi-tile selection', () => {
    const overlay = new SelectionOverlay(scene, () => 0, slopedSampler);
    overlay.update({ shape: 'rect', x1: 0, z1: 0, x2: 4, z2: 0 });

    const ys = allPositionYs();
    expect(ys.length).toBeGreaterThan(0);
    expect(Math.max(...ys) - Math.min(...ys), 'a sloped rect selection must not sit at one flat Y').toBeGreaterThan(5);
  });
});

describe('SelectionOverlay — point/footprint tint conforms to terrain (#1006)', () => {
  it('a multi-cell footprint tint is not one flat Y when cells span a slope', () => {
    const overlay = new SelectionOverlay(scene, () => 0, slopedSampler);
    overlay.update({ shape: 'point', x: 0, z: 0, footprintCells: [[0, 0], [3, 0]] });

    const ys = allPositionYs();
    expect(ys.length).toBeGreaterThan(0);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(5);
  });

  it('boundary: a single-cell point footprint still renders (default footprint)', () => {
    const overlay = new SelectionOverlay(scene, () => 0, slopedSampler);
    overlay.update({ shape: 'point', x: 10, z: 10 });
    expect(allPositionYs().length).toBeGreaterThan(0);
  });

  it('a footprintCells patch is shifted -0.5/-0.5 to center on the building footprint mesh, unlike the default single-tile corner convention (#1198)', () => {
    // Flat terrain isolates the X/Z placement question from the Y-conforming
    // behaviour the rest of this describe block already covers.
    const overlay = new SelectionOverlay(scene, () => 0, () => 5);
    overlay.update({ shape: 'point', x: 5, z: 5, footprintCells: [[0, 0]] });

    const bounds = positionXZBounds();
    // footprintCells present: cell (0,0) at building (5,5) covers
    // [4.5, 5.5] x [4.5, 5.5] — centered on the building position.
    expect(bounds.minX).toBeCloseTo(4.5);
    expect(bounds.maxX).toBeCloseTo(5.5);
    expect(bounds.minZ).toBeCloseTo(4.5);
    expect(bounds.maxZ).toBeCloseTo(5.5);
  });

  it('sanity: without footprintCells the default single-tile patch keeps the unshifted corner convention (#1198)', () => {
    const overlay = new SelectionOverlay(scene, () => 0, () => 5);
    overlay.update({ shape: 'point', x: 5, z: 5 });

    const bounds = positionXZBounds();
    // No footprintCells: cell (0,0) at (5,5) covers [5, 6] x [5, 6] —
    // GroundTintLayer's default per-cell corner convention, NOT centered.
    expect(bounds.minX).toBeCloseTo(5);
    expect(bounds.maxX).toBeCloseTo(6);
    expect(bounds.minZ).toBeCloseTo(5);
    expect(bounds.maxZ).toBeCloseTo(6);
  });
});

describe('SelectionOverlay — blocked-tile mark conforms to terrain (#1006)', () => {
  it('a blocked tile far from the pinned region shows the slope, not the region cell\'s own flat height', () => {
    const overlay = new SelectionOverlay(scene, () => 0, slopedSampler);
    overlay.setRegion({ x1: 0, z1: 0, x2: 0, z2: 0 });
    overlay.setBlockedTile({ x: 10, z: 0 });

    const ys = allPositionYs();
    expect(ys.length).toBeGreaterThan(0);
    expect(Math.max(...ys) - Math.min(...ys), 'region cell + a blocked tile 10 columns away should span a large Y range').toBeGreaterThan(5);
  });
});

describe('SelectionOverlay — survey radius ring conforms to terrain (#1006)', () => {
  it('the radius ring around a survey point is not flat when the sampler varies around its circumference', () => {
    const overlay = new SelectionOverlay(scene, () => 0, slopedSampler);
    overlay.update({ shape: 'point', x: 10, z: 10, radius: 8, tone: 'survey' });

    expect(ringYSpread(), 'a conforming survey radius ring must not sit at one flat Y').toBeGreaterThan(1);
  });

  it('sanity: on flat terrain the radius ring stays flat', () => {
    const overlay = new SelectionOverlay(scene, () => 0, () => 5);
    overlay.update({ shape: 'point', x: 10, z: 10, radius: 8, tone: 'survey' });
    expect(ringYSpread()).toBeLessThan(0.5);
  });
});

describe('SelectionOverlay — no sampler supplied (rejection/back-compat)', () => {
  it('still renders using the plain surfaceYAt when no SurfaceHeightSampler is given', () => {
    const overlay = new SelectionOverlay(scene, () => 3);
    overlay.update({ shape: 'point', x: 0, z: 0 });
    expect(allPositionYs().length).toBeGreaterThan(0);
  });
});

describe('SelectionOverlay — ramp line preview (#1211)', () => {
  const flat: SurfaceHeightSampler = () => 0;

  function body(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
    const found = scene.getObjectByName('ramp-arrow-body');
    expect(found).toBeDefined();
    return found as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  }

  it('previews a diagonal drag as the snapped cardinal ramp, not the raw diagonal', () => {
    const overlay = new SelectionOverlay(scene, flat, flat);
    // dz (10) dominates dx (3): the order runs south from (10,10), 10 steps, carving z 10..19.
    overlay.update({ shape: 'line', x1: 10, z1: 10, x2: 13, z2: 20 });
    const pos = body().geometry.getAttribute('position') as THREE.BufferAttribute;
    const xs: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < pos.count; i++) { xs.push(pos.getX(i)); zs.push(pos.getZ(i)); }
    // Symmetric about the snapped axis x = 10.5 — no drift toward the drag's x = 13.
    expect(Math.max(...xs) + Math.min(...xs)).toBeCloseTo(21);
    expect(Math.max(...xs)).toBeLessThan(12);
    // Reaches the last dug tile (z 19) but not the drag's end tile (z 20).
    expect(Math.max(...zs)).toBeGreaterThan(19.5);
    expect(Math.max(...zs)).toBeLessThan(20.5);
    const outline = scene.getObjectByName('ramp-corridor-outline') as THREE.LineLoop;
    const opos = outline.geometry.getAttribute('position') as THREE.BufferAttribute;
    const oxs: number[] = [];
    for (let i = 0; i < opos.count; i++) oxs.push(opos.getX(i));
    expect(Math.max(...oxs) - Math.min(...oxs)).toBe(3);
  });

  it('shows the refusal colour when the order would be refused', () => {
    const overlay = new SelectionOverlay(scene, flat, flat);
    overlay.update({ shape: 'line', x1: 0, z1: 0, x2: 0, z2: 8 });
    const okColor = body().material.color.getHex();
    overlay.update({ shape: 'line', x1: 0, z1: 0, x2: 0, z2: 8, refused: true });
    const refusedColor = body().material.color.getHex();
    expect(refusedColor).not.toBe(okColor);
    expect(refusedColor).toBe(0xff6a5a);
  });

  it('marks only the anchor for a zero-length drag', () => {
    const overlay = new SelectionOverlay(scene, flat, flat);
    overlay.update({ shape: 'line', x1: 4, z1: 4, x2: 4, z2: 4 });
    expect(scene.getObjectByName('ramp-arrow-body')).toBeUndefined();
    let loops = 0;
    scene.traverse((o) => { if (o instanceof THREE.LineLoop) loops++; });
    expect(loops).toBe(1);
  });
});
