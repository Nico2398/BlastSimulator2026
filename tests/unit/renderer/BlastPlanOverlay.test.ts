// BlastPlanOverlay — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BlastPlanOverlay, type BlastPlanOverlayOptions, type HoleOverlayData } from '../../../src/renderer/BlastPlanOverlay.js';
import { holeNumericId } from '../../../src/core/mining/DrillPlan.js';
import type { SurfaceHeightSampler } from '../../../src/renderer/GroundTint.js';

/**
 * BlastPlanOverlay's own hole/label/arc/wave group, found by type rather
 * than by scene-child index. The #1006 heatmap GroundTintLayer adds its own
 * persistent Mesh directly to the scene from its own constructor — sibling
 * to `this.group`, not nested inside it — so `scene.children[0]` is no
 * longer reliably the group (it is that heatmap mesh, added first).
 */
function overlayGroup(scene: THREE.Scene): THREE.Group {
  const group = scene.children.find((c): c is THREE.Group => c instanceof THREE.Group);
  if (!group) throw new Error('BlastPlanOverlay group not found in scene');
  return group;
}

/**
 * WORLD-space vertex Y of every mesh NOT tagged as a hole marker — isolates
 * heatmap/frag/vibration geometry from hole-marker shafts/rings/labels, all
 * of which carry `entityKind: 'hole'` (tagPickable). Reading
 * `geometry.attributes.position` directly gives LOCAL coordinates — the
 * heatmap's existing circle is rotated flat via `mesh.rotation.x`, so its
 * local Y spans its own radius (up to HEATMAP_MAX_RADIUS) regardless of
 * terrain height, which would make a still-flat (buggy) disc look like it
 * conforms. Applying `matrixWorld` covers both that legacy rotated-local
 * disc and a conforming mesh that bakes world height directly into local
 * coordinates at identity transform (a no-op transform in that case).
 */
function nonHoleMeshYs(scene: THREE.Scene): number[] {
  scene.updateMatrixWorld(true);
  const ys: number[] = [];
  const v = new THREE.Vector3();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData['entityKind'] !== 'hole') {
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

function makeHole(id: string, x: number, z: number): HoleOverlayData {
  return {
    hole: { id, x, z, depth: 5, diameter: 0.1 },
    delayMs: parseInt(id.replace('H', '')) * 50,
    drilled: false,
    surfaceY: 8,
    charge: { explosiveId: 'anfo', amountKg: 50, stemmingM: 1.5 },
    predictedFragSizeCm: 20,
    projectionSpeed: 3,
  };
}

function makeOptions(softwareTier: number, holeCount = 4): BlastPlanOverlayOptions {
  return {
    softwareTier,
    origin: new THREE.Vector3(20, 0, 20),
    holes: Array.from({ length: holeCount }, (_, i) => makeHole(`H${i + 1}`, i * 5, 0)),
  };
}

describe('BlastPlanOverlay', () => {
  it('starts hidden', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    const group = overlayGroup(scene);
    expect(group.visible).toBe(false);
    overlay.dispose();
  });

  it('show makes overlay visible', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    overlay.show(makeOptions(0));
    const group = overlayGroup(scene);
    expect(group.visible).toBe(true);
    overlay.dispose();
  });

  it('hide makes overlay invisible', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    overlay.show(makeOptions(0));
    overlay.hide();
    const group = overlayGroup(scene);
    expect(group.visible).toBe(false);
    overlay.dispose();
  });

  it('show adds hole markers for each hole', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    overlay.show(makeOptions(0, 5));
    const group = overlayGroup(scene);
    // Each hole has: ring + fill + line + label = ~4 children minimum
    expect(group.children.length).toBeGreaterThanOrEqual(5);
    overlay.dispose();
  });

  it('tier 1 software adds heatmap geometry (retargeted at the shared ground-tint unit, #1006)', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene, () => 0);
    overlay.show(makeOptions(0, 3)); // no software
    // The heatmap's GroundTintLayer owns one persistent Mesh for the
    // overlay's whole lifetime (#1006), rebuilt in place rather than added
    // fresh per tier — so mesh *count* is constant regardless of tier, and
    // the geometry it actually carries is what has to scale.
    const vertsTier0 = nonHoleMeshYs(scene).length;

    overlay.clear();
    overlay.show(makeOptions(1, 3)); // tier 1
    const vertsTier1 = nonHoleMeshYs(scene).length;

    expect(vertsTier1).toBeGreaterThan(vertsTier0);
    overlay.dispose();
  });

  it('tier 1 heatmap discs conform to sloped terrain instead of one flat Y (#1006)', () => {
    const scene = new THREE.Scene();
    const sampler: SurfaceHeightSampler = (x, _z) => x * 2; // strong local slope
    const overlay = new BlastPlanOverlay(scene, sampler);
    overlay.show(makeOptions(1, 3)); // tier 1 — energy heatmap only

    const ys = nonHoleMeshYs(scene);
    expect(ys.length, 'tier 1 should draw energy-heatmap geometry').toBeGreaterThan(0);
    expect(
      Math.max(...ys) - Math.min(...ys),
      'the heatmap disc should conform to the slope beneath it, not sit at one flat Y (#1006)',
    ).toBeGreaterThan(1);
    overlay.dispose();
  });

  it('tier 4 software adds vibration wave rings', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    overlay.show(makeOptions(3, 2)); // tier 3
    const countTier3 = overlayGroup(scene).children.length;

    overlay.clear();
    overlay.show(makeOptions(4, 2)); // tier 4
    const countTier4 = overlayGroup(scene).children.length;

    expect(countTier4).toBeGreaterThan(countTier3);
    overlay.dispose();
  });

  it('clear removes all children', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    overlay.show(makeOptions(4, 4));
    overlay.clear();
    const group = overlayGroup(scene);
    expect(group.children.length).toBe(0);
    overlay.dispose();
  });

  it('dispose removes group from scene', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    overlay.dispose();
    expect(scene.children.length).toBe(0);
  });

  it('vibration wave rings anchor at the blast-site surface Y, not a hardcoded near-zero height', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    // A mine site is rarely near world Y=0 — use a non-zero origin so a
    // hardcoded ring height (the old bug) is distinguishable from one that
    // actually reads origin.y.
    const options: BlastPlanOverlayOptions = { ...makeOptions(4, 2), origin: new THREE.Vector3(20, 12, 20) };
    overlay.show(options);
    const group = overlayGroup(scene);
    const rings = group.children.filter(
      (c): c is THREE.Mesh => c instanceof THREE.Mesh && c.geometry instanceof THREE.RingGeometry,
    );
    expect(rings.length).toBeGreaterThan(0);
    for (const ring of rings) {
      expect(ring.position.y).toBeCloseTo(options.origin.y + 0.15, 5);
    }
    overlay.dispose();
  });

  it('pickables() returns every hole marker mesh, tagged with its numeric hole id', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    overlay.show(makeOptions(0, 3));

    const picks = overlay.pickables();
    expect(picks.length).toBeGreaterThan(0);
    for (const pick of picks) expect(pick.userData['entityKind']).toBe('hole');
    const ids = new Set(picks.map(p => p.userData['entityId']));
    expect(ids).toEqual(new Set([1, 2, 3]));
    overlay.dispose();
  });

  it('pickables() is empty before show() is ever called', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    expect(overlay.pickables()).toEqual([]);
    overlay.dispose();
  });

  it('pickables() is empty after hide() — a hidden overlay is not clickable', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    overlay.show(makeOptions(0, 3));
    overlay.hide();
    expect(overlay.pickables()).toEqual([]);
    overlay.dispose();
  });

  it('getHolePosition() resolves each hole\'s surface position by numeric id', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    const options = makeOptions(0, 2);
    overlay.show(options);

    for (const hd of options.holes) {
      const pos = overlay.getHolePosition(holeNumericId(hd.hole.id));
      expect(pos).not.toBeNull();
      expect(pos!.x).toBeCloseTo(hd.hole.x);
      expect(pos!.z).toBeCloseTo(hd.hole.z);
      expect(pos!.y).toBeCloseTo(hd.surfaceY);
    }
    overlay.dispose();
  });

  it('getHolePosition() returns null for an id that was never shown', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    overlay.show(makeOptions(0, 2));
    expect(overlay.getHolePosition(999)).toBeNull();
    overlay.dispose();
  });

  it('getHolePosition() returns null after clear()', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    overlay.show(makeOptions(0, 2));
    overlay.clear();
    expect(overlay.getHolePosition(1)).toBeNull();
    overlay.dispose();
  });

  it('high-speed projection holes get arc lines (tier 3)', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    const options = makeOptions(2, 2); // tier 2 — no arcs
    overlay.show(options);
    const countTier2 = overlayGroup(scene).children.length;

    overlay.clear();
    // Add high-speed projection hole
    const opts3: BlastPlanOverlayOptions = {
      ...options,
      softwareTier: 3,
      holes: options.holes.map((h) => ({ ...h, projectionSpeed: 20 })), // trigger arcs
    };
    overlay.show(opts3);
    const countTier3 = overlayGroup(scene).children.length;

    expect(countTier3).toBeGreaterThan(countTier2);
    overlay.dispose();
  });
});
