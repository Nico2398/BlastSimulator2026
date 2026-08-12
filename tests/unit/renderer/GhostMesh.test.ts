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
    // Unclaimed by default (#547) — callers override to model a claimed ghost.
    claimed: false,
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

  // ── #547: claimed vs unclaimed previews must read distinctly ────────────────
  // An employee still walking to a claimed action should not look identical to
  // an untouched, unclaimed one — dimmer + slower pulse, both stay blue.

  describe('claimed vs unclaimed rendering (#547)', () => {
    it('a claimed preview animates with a lower peak opacity than an unclaimed one', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1, { claimed: false }), makePreview(2, { claimed: true })]);

      // Identify each mesh by its (unique, preview-id-derived) x position —
      // GhostMesh exposes no id->mesh lookup, only the synced scene graph.
      const unclaimedMesh = scene.children.find(c => (c as THREE.Mesh).position.x === 3) as THREE.Mesh;
      const claimedMesh = scene.children.find(c => (c as THREE.Mesh).position.x === 6) as THREE.Mesh;
      expect(unclaimedMesh).toBeDefined();
      expect(claimedMesh).toBeDefined();

      let unclaimedMax = -Infinity;
      let claimedMax = -Infinity;
      for (let i = 0; i < 180; i++) {
        gm.update(1 / 60);
        unclaimedMax = Math.max(unclaimedMax, (unclaimedMesh.material as THREE.MeshPhongMaterial).opacity);
        claimedMax = Math.max(claimedMax, (claimedMesh.material as THREE.MeshPhongMaterial).opacity);
      }

      expect(claimedMax).toBeLessThan(unclaimedMax);
      gm.dispose();
    });

    it('a claimed preview pulses slower than an unclaimed one (smaller opacity swing on the very first tick, both starting from their own minimum)', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1, { claimed: false }), makePreview(2, { claimed: true })]);

      const unclaimedMesh = scene.children.find(c => (c as THREE.Mesh).position.x === 3) as THREE.Mesh;
      const claimedMesh = scene.children.find(c => (c as THREE.Mesh).position.x === 6) as THREE.Mesh;

      const unclaimedStart = (unclaimedMesh.material as THREE.MeshPhongMaterial).opacity;
      const claimedStart = (claimedMesh.material as THREE.MeshPhongMaterial).opacity;

      gm.update(0.05);

      const unclaimedDelta = Math.abs((unclaimedMesh.material as THREE.MeshPhongMaterial).opacity - unclaimedStart);
      const claimedDelta = Math.abs((claimedMesh.material as THREE.MeshPhongMaterial).opacity - claimedStart);

      expect(claimedDelta).toBeLessThan(unclaimedDelta);
      gm.dispose();
    });

    it('both a claimed and unclaimed preview stay blue (blue channel dominant)', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1, { claimed: false }), makePreview(2, { claimed: true })]);

      for (const mesh of scene.children as THREE.Mesh[]) {
        const mat = mesh.material as THREE.MeshPhongMaterial;
        expect(mat.transparent).toBe(true);
        expect(mat.color.b).toBeGreaterThan(mat.color.r);
      }
      gm.dispose();
    });

    it('flipping claimed in place on the same id updates the existing mesh rather than recreating it, and its opacity ceiling drops into the claimed (dimmer) range', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      // A permanently-unclaimed control preview (id 9) syncs alongside the one
      // whose claimed flag flips, so this test has a same-run baseline to
      // compare against rather than a hardcoded opacity constant.
      gm.sync([makePreview(1, { claimed: false }), makePreview(9, { claimed: false })]);

      expect(scene.children).toHaveLength(2);
      const meshBefore = scene.children.find(c => (c as THREE.Mesh).position.x === 3) as THREE.Mesh;

      gm.sync([makePreview(1, { claimed: true }), makePreview(9, { claimed: false })]);

      expect(scene.children).toHaveLength(2);
      const meshAfter = scene.children.find(c => (c as THREE.Mesh).position.x === 3) as THREE.Mesh;
      const controlMesh = scene.children.find(c => (c as THREE.Mesh).position.x === 27) as THREE.Mesh;
      // Same mesh instance — not removed/re-added — proving the material was
      // swapped/updated in place rather than the whole ghost being recreated.
      expect(meshAfter).toBe(meshBefore);

      let maxAfter = -Infinity;
      let controlMax = -Infinity;
      for (let i = 0; i < 180; i++) {
        gm.update(1 / 60);
        maxAfter = Math.max(maxAfter, (meshAfter.material as THREE.MeshPhongMaterial).opacity);
        controlMax = Math.max(controlMax, (controlMesh.material as THREE.MeshPhongMaterial).opacity);
      }
      // The flipped mesh's ceiling must now sit below the still-unclaimed
      // control's ceiling — proving the in-place update actually changed its
      // rendering, not merely its `claimed` bookkeeping field.
      expect(maxAfter).toBeLessThan(controlMax);
      gm.dispose();
    });

    it('removing a claimed preview from the sync input removes its mesh, same as an unclaimed one', () => {
      const scene = new THREE.Scene();
      const gm = new GhostMesh(scene);
      gm.sync([makePreview(1, { claimed: true })]);
      expect(gm.count).toBe(1);

      gm.sync([]);

      expect(gm.count).toBe(0);
      expect(scene.children.length).toBe(0);
      gm.dispose();
    });
  });
});
