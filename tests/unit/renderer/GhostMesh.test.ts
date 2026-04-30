// GhostMesh — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import type { GhostPreview } from '../../../src/core/state/GameState.js';
import { GhostMesh } from '../../../src/renderer/GhostMesh.js';

function makePreview(id: number, overrides: Partial<GhostPreview> = {}): GhostPreview {
  return {
    id,
    type: 'drill_hole',
    targetX: id * 3,
    targetY: 0,
    targetZ: id * 3,
    ...overrides,
  };
}

describe('GhostMesh', () => {
  it('sync adds a mesh per preview', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1), makePreview(2)]);
    expect(gm.count).toBe(2);
    expect(scene.children.length).toBe(2);
    gm.dispose();
  });

  it('sync removes meshes for gone previews', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1), makePreview(2)]);
    gm.sync([makePreview(2)]);
    expect(gm.count).toBe(1);
    expect(scene.children.length).toBe(1);
    gm.dispose();
  });

  it('sync is idempotent — does not duplicate existing ghosts', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    const preview = makePreview(1);
    gm.sync([preview]);
    gm.sync([preview]);
    expect(gm.count).toBe(1);
    gm.dispose();
  });

  it('sync with empty list clears all ghosts', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1), makePreview(2)]);
    gm.sync([]);
    expect(gm.count).toBe(0);
    expect(scene.children.length).toBe(0);
    gm.dispose();
  });

  it('mesh is positioned at targetX/Y/Z', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(5, { targetX: 10, targetY: 2, targetZ: 7 })]);
    const mesh = scene.children[0] as THREE.Mesh;
    expect(mesh.position.x).toBe(10);
    expect(mesh.position.z).toBe(7);
    expect(mesh.position.y).toBeGreaterThan(2); // elevated by half ghost size
    gm.dispose();
  });

  it('update animates opacity between min and max', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1)]);
    const mat = (scene.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;

    const opacities = new Set<number>();
    for (let i = 0; i < 60; i++) {
      gm.update(1 / 60);
      opacities.add(Math.round(mat.opacity * 100));
    }
    // Opacity should vary — not constant
    expect(opacities.size).toBeGreaterThan(1);
    gm.dispose();
  });

  it('material is transparent and blue', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1)]);
    const mat = (scene.children[0] as THREE.Mesh).material as THREE.MeshPhongMaterial;
    expect(mat.transparent).toBe(true);
    // Blue channel dominant
    expect(mat.color.b).toBeGreaterThan(mat.color.r);
    gm.dispose();
  });

  it('clearAll removes all meshes', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1), makePreview(2), makePreview(3)]);
    gm.clearAll();
    expect(gm.count).toBe(0);
    expect(scene.children.length).toBe(0);
    gm.dispose();
  });

  it('dispose clears meshes and disposes material', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1)]);
    gm.dispose();
    expect(gm.count).toBe(0);
    expect(scene.children.length).toBe(0);
  });
});
