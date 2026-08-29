// BlastPlanOverlay — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BlastPlanOverlay, type BlastPlanOverlayOptions, type HoleOverlayData } from '../../../src/renderer/BlastPlanOverlay.js';
import { holeNumericId } from '../../../src/core/mining/DrillPlan.js';

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
    const group = scene.children[0] as THREE.Group;
    expect(group.visible).toBe(false);
    overlay.dispose();
  });

  it('show makes overlay visible', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    overlay.show(makeOptions(0));
    const group = scene.children[0] as THREE.Group;
    expect(group.visible).toBe(true);
    overlay.dispose();
  });

  it('hide makes overlay invisible', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    overlay.show(makeOptions(0));
    overlay.hide();
    const group = scene.children[0] as THREE.Group;
    expect(group.visible).toBe(false);
    overlay.dispose();
  });

  it('show adds hole markers for each hole', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    overlay.show(makeOptions(0, 5));
    const group = scene.children[0] as THREE.Group;
    // Each hole has: ring + fill + line + label = ~4 children minimum
    expect(group.children.length).toBeGreaterThanOrEqual(5);
    overlay.dispose();
  });

  it('tier 1 software adds heatmap circles', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    overlay.show(makeOptions(0, 3)); // no software
    const countTier0 = (scene.children[0] as THREE.Group).children.length;

    overlay.clear();
    overlay.show(makeOptions(1, 3)); // tier 1
    const countTier1 = (scene.children[0] as THREE.Group).children.length;

    expect(countTier1).toBeGreaterThan(countTier0);
    overlay.dispose();
  });

  it('tier 4 software adds vibration wave rings', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    overlay.show(makeOptions(3, 2)); // tier 3
    const countTier3 = (scene.children[0] as THREE.Group).children.length;

    overlay.clear();
    overlay.show(makeOptions(4, 2)); // tier 4
    const countTier4 = (scene.children[0] as THREE.Group).children.length;

    expect(countTier4).toBeGreaterThan(countTier3);
    overlay.dispose();
  });

  it('clear removes all children', () => {
    const scene = new THREE.Scene();
    const overlay = new BlastPlanOverlay(scene);
    overlay.show(makeOptions(4, 4));
    overlay.clear();
    const group = scene.children[0] as THREE.Group;
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
    const group = scene.children[0] as THREE.Group;
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
    const countTier2 = (scene.children[0] as THREE.Group).children.length;

    overlay.clear();
    // Add high-speed projection hole
    const opts3: BlastPlanOverlayOptions = {
      ...options,
      softwareTier: 3,
      holes: options.holes.map((h) => ({ ...h, projectionSpeed: 20 })), // trigger arcs
    };
    overlay.show(opts3);
    const countTier3 = (scene.children[0] as THREE.Group).children.length;

    expect(countTier3).toBeGreaterThan(countTier2);
    overlay.dispose();
  });
});
