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
