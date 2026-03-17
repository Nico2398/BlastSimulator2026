// BlastPlanOverlay — unit tests

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BlastPlanOverlay, type BlastPlanOverlayOptions, type HoleOverlayData } from '../../../src/renderer/BlastPlanOverlay.js';

function makeHole(id: string, x: number, z: number): HoleOverlayData {
  return {
    hole: { id, x, z, depth: 5, diameter: 0.1 },
    delayMs: parseInt(id.replace('H', '')) * 50,
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
