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
    claimed: false,
    ...overrides,
  };
}

/**
 * Run `gm.update(dt)` for `seconds` of simulated time at 60fps, returning the
 * peak opacity observed on `mesh`'s material and the number of local maxima
 * (pulse peaks) crossed — used to compare claimed-vs-unclaimed pulse ranges
 * and speeds without depending on GhostMesh's internal pulse implementation.
 */
function sampleOpacity(gm: GhostMesh, mesh: THREE.Mesh, seconds: number): { max: number; peaks: number } {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  let max = -Infinity;
  let peaks = 0;
  let prev = -Infinity;
  let rising = true;
  for (let i = 0; i < steps; i++) {
    gm.update(dt);
    const opacity = (mesh.material as THREE.MeshPhongMaterial).opacity;
    max = Math.max(max, opacity);
    if (opacity < prev && rising) {
      peaks++;
      rising = false;
    } else if (opacity > prev) {
      rising = true;
    }
    prev = opacity;
  }
  return { max, peaks };
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

// ── #547: claimed vs unclaimed rendering ─────────────────────────────────────
// A claimed:true preview (an employee has picked up the underlying action and
// is walking to it) must render visually distinct from claimed:false (still
// blue, but dimmer opacity range and a slower pulse) — the ghost now stays on
// screen through the whole claim → walk → work window instead of vanishing
// the instant it's claimed.
describe('GhostMesh — claimed vs unclaimed (#547)', () => {
  it('a claimed ghost peaks dimmer than an unclaimed ghost over a full pulse window', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1, { claimed: false }), makePreview(2, { claimed: true })]);

    const unclaimedMesh = scene.children.find((c) => c.position.x === 3) as THREE.Mesh;
    const claimedMesh = scene.children.find((c) => c.position.x === 6) as THREE.Mesh;
    expect(unclaimedMesh).toBeDefined();
    expect(claimedMesh).toBeDefined();

    const unclaimedStats = sampleOpacity(gm, unclaimedMesh, 8);
    const claimedStats = sampleOpacity(gm, claimedMesh, 8);

    expect(claimedStats.max).toBeLessThan(unclaimedStats.max);
    gm.dispose();
  });

  it('claimed and unclaimed ghosts use distinct material objects, so one\'s pulse cannot affect the other', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1, { claimed: false }), makePreview(2, { claimed: true })]);

    const unclaimedMesh = scene.children.find((c) => c.position.x === 3) as THREE.Mesh;
    const claimedMesh = scene.children.find((c) => c.position.x === 6) as THREE.Mesh;

    expect(unclaimedMesh.material).not.toBe(claimedMesh.material);
    gm.dispose();
  });

  it('claimed ghost pulses slower than unclaimed — fewer opacity peaks over the same elapsed time', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1, { claimed: false }), makePreview(2, { claimed: true })]);

    const unclaimedMesh = scene.children.find((c) => c.position.x === 3) as THREE.Mesh;
    const claimedMesh = scene.children.find((c) => c.position.x === 6) as THREE.Mesh;

    const unclaimedStats = sampleOpacity(gm, unclaimedMesh, 10);
    // sampleOpacity above already advanced time via unclaimedMesh's own
    // update loop calls (gm.update ticks both materials together), so re-run
    // fresh from a new GhostMesh to compare the two pulse rates independently
    // over an identical elapsed window.
    const scene2 = new THREE.Scene();
    const gm2 = new GhostMesh(scene2);
    gm2.sync([makePreview(1, { claimed: true })]);
    const soloClaimedMesh = scene2.children[0] as THREE.Mesh;
    const claimedStats = sampleOpacity(gm2, soloClaimedMesh, 10);

    expect(claimedStats.peaks).toBeLessThan(unclaimedStats.peaks);
    gm.dispose();
    gm2.dispose();
  });

  it('both claimed and unclaimed ghosts stay blue-dominant', () => {
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

  it('toggling claimed across two sync() calls for the same id swaps material without duplicating the mesh', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1, { claimed: false })]);
    expect(gm.count).toBe(1);
    expect(scene.children.length).toBe(1);

    const meshBefore = scene.children[0] as THREE.Mesh;
    const materialBefore = meshBefore.material;
    const unclaimedStats = sampleOpacity(gm, meshBefore, 8);

    gm.sync([makePreview(1, { claimed: true })]);

    // Still exactly one mesh — claiming did not spawn a second ghost for the
    // same action id.
    expect(gm.count).toBe(1);
    expect(scene.children.length).toBe(1);

    const meshAfter = scene.children[0] as THREE.Mesh;
    const claimedStats = sampleOpacity(gm, meshAfter, 8);

    expect(meshAfter.material).not.toBe(materialBefore);
    expect(claimedStats.max).toBeLessThan(unclaimedStats.max);
    gm.dispose();
  });

  it('removing an action (absent from the next sync() list) removes its mesh, claimed or not', () => {
    const scene = new THREE.Scene();
    const gm = new GhostMesh(scene);
    gm.sync([makePreview(1, { claimed: true }), makePreview(2, { claimed: false })]);
    expect(gm.count).toBe(2);

    // Action 1 completed and was removed by completePendingAction — its ghost
    // is no longer in the preview list handed to sync().
    gm.sync([makePreview(2, { claimed: false })]);

    expect(gm.count).toBe(1);
    expect(scene.children.length).toBe(1);
    gm.dispose();
  });
});
