// BlastSimulator2026 — Scene-overlay marker tests
//
// The GTAO depth/normal prepass draws the scene with an override material, so
// an overlay's own transparent/depthWrite:false settings never keep it out —
// it writes depth like rock and, with no `normal` attribute of its own, a
// degenerate normal that GTAO reads as fully occluded and shades black. That
// was the survey-confidence tint rendering as a solid black plate over every
// surveyed cell. PostPipeline hides everything these helpers report.

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  markSceneOverlay,
  unmarkSceneOverlay,
  isSceneOverlay,
  collectSceneOverlays,
} from '../../../../src/renderer/post/SceneOverlay.js';

describe('SceneOverlay marker', () => {
  it('marks and unmarks an object', () => {
    const object = new THREE.Object3D();
    expect(isSceneOverlay(object)).toBe(false);

    markSceneOverlay(object);
    expect(isSceneOverlay(object)).toBe(true);

    unmarkSceneOverlay(object);
    expect(isSceneOverlay(object)).toBe(false);
  });

  it('collects marked descendants anywhere under the root', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    const tint = new THREE.Mesh();
    const rock = new THREE.Mesh();
    markSceneOverlay(tint);
    group.add(tint, rock);
    scene.add(group);

    expect(collectSceneOverlays(scene)).toEqual([tint]);
  });

  it('skips an already-hidden overlay, so restoring visibility cannot switch one back on', () => {
    const scene = new THREE.Scene();
    const tint = new THREE.Mesh();
    markSceneOverlay(tint);
    tint.visible = false;
    scene.add(tint);

    expect(collectSceneOverlays(scene)).toEqual([]);
  });

  it('does not descend into a marked object — hiding it already hides its children', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    const child = new THREE.Mesh();
    markSceneOverlay(group);
    markSceneOverlay(child);
    group.add(child);
    scene.add(group);

    expect(collectSceneOverlays(scene)).toEqual([group]);
  });

  it('reports nothing under a hidden ancestor — the prepass never draws it either', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    const tint = new THREE.Mesh();
    markSceneOverlay(tint);
    group.add(tint);
    group.visible = false;
    scene.add(group);

    expect(collectSceneOverlays(scene)).toEqual([]);
  });
});
