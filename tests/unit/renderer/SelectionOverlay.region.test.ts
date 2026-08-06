// BlastSimulator2026 — Guided region drawing (#489)
//
// The region a tutorial step pins a placement to used to reach the screen only
// as a tint on cells the player had *already* selected — so it was invisible
// until after the click it existed to guide, and never visible at all for the
// point and line tools, which draw no cells. "Click the highlighted tile" with
// nothing highlighted is the reported bug. These tests hold the region on
// screen from the moment the tool arms.

import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { SelectionOverlay } from '../../../src/renderer/SelectionOverlay.js';

let scene: THREE.Scene;
let overlay: SelectionOverlay;

/** The group the region is drawn into, separate from the selection's own. */
function regionGroup(): THREE.Group {
  return scene.getObjectByName('placement-region-overlay') as THREE.Group;
}

beforeEach(() => {
  scene = new THREE.Scene();
  overlay = new SelectionOverlay(scene, () => 0);
});

describe('the guided region is drawn before anything is selected', () => {
  it('draws nothing until a region is published', () => {
    expect(regionGroup()).toBeDefined();
    expect(regionGroup().children).toHaveLength(0);
  });

  it('draws a cell per tile plus a border and corners, with no selection at all', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 });

    const meshes = regionGroup().children.filter(c => c instanceof THREE.Mesh);
    expect(meshes, '3×3 region should tint nine tiles').toHaveLength(9);
    // Border group + four corner lines.
    expect(regionGroup().children.length).toBeGreaterThan(9);
  });

  it('draws a one-tile region — the shape the survey and warehouse steps use', () => {
    overlay.setRegion({ x1: 23, z1: 23, x2: 23, z2: 23 });
    expect(regionGroup().children.filter(c => c instanceof THREE.Mesh)).toHaveLength(1);
  });

  it('replaces the previous region rather than stacking on it', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 });
    const first = regionGroup().children.length;
    overlay.setRegion({ x1: 4, z1: 4, x2: 6, z2: 6 });
    expect(regionGroup().children).toHaveLength(first);
  });

  it('takes the region off on null', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 });
    overlay.setRegion(null);
    expect(regionGroup().children).toHaveLength(0);
  });

  it('survives a selection update, which draws into its own group', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 });
    const before = regionGroup().children.length;
    overlay.update({ shape: 'rect', x1: 20, z1: 20, x2: 22, z2: 22 });
    expect(regionGroup().children).toHaveLength(before);
  });

  it('clear() takes both the selection and the region off', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 });
    overlay.update({ shape: 'point', x: 21, z: 21 });
    overlay.clear();
    expect(regionGroup().children).toHaveLength(0);
  });
});

describe('a refused tile is marked', () => {
  it('adds a cell for the blocked tile and drops it again', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 20, z2: 20 });
    const base = regionGroup().children.length;

    overlay.setBlockedTile({ x: 2, z: 2 });
    expect(regionGroup().children).toHaveLength(base + 1);

    overlay.setBlockedTile(null);
    expect(regionGroup().children).toHaveLength(base);
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
    const withMark = regionGroup().children.length;

    overlay.setRegion({ x1: 20, z1: 20, x2: 20, z2: 20 });

    expect(regionGroup().children).toHaveLength(withMark - 1);
  });
});

describe('dispose', () => {
  it('takes the region group off the scene', () => {
    overlay.setRegion({ x1: 20, z1: 20, x2: 22, z2: 22 });
    overlay.dispose();
    expect(scene.getObjectByName('placement-region-overlay')).toBeUndefined();
  });
});
