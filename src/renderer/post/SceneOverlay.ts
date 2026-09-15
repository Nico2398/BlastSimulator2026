// BlastSimulator2026 — Scene-overlay marker (#1043 follow-up)
// Which objects in the scene are see-through overlays rather than geometry,
// recorded on the object itself so it travels with it.
//
// The GTAO depth/normal prepass draws the whole scene with an override
// material, so an overlay's own `transparent`/`depthWrite:false` settings do
// not keep it out: it lands in the depth buffer like solid rock, and — when
// its geometry carries no `normal` attribute, as every ground tint does — it
// writes a degenerate normal that GTAO reads as fully occluded and shades
// black. That is the survey-confidence/pinned-region tint rendering as a
// black plate. PostPipeline hides every marked object while that pass runs.
//
// A marker rather than a registration list because "this is an overlay" is a
// property of the object, not of the pipeline: a GroundTintLayer builds its
// own mesh deep inside TerrainMesh/SelectionOverlay, where no PostPipeline
// reference is in reach and plumbing one through would couple four
// constructors to the post stack for one boolean.

import * as THREE from 'three';

const OVERLAY_FLAG = 'sceneOverlay';

/** Keep `object` (and its descendants) out of the GTAO depth/normal prepass. */
export function markSceneOverlay(object: THREE.Object3D): void {
  object.userData[OVERLAY_FLAG] = true;
}

/** Undo `markSceneOverlay` — the object renders into the prepass again. */
export function unmarkSceneOverlay(object: THREE.Object3D): void {
  delete object.userData[OVERLAY_FLAG];
}

/** Whether `object` is marked as a see-through overlay. */
export function isSceneOverlay(object: THREE.Object3D): boolean {
  return object.userData[OVERLAY_FLAG] === true;
}

/**
 * Every marked overlay under `root` that is currently visible.
 *
 * Walked per prepass rather than cached: the set changes whenever an overlay
 * is built, disposed or toggled (a survey overlay per toggle, a selection
 * tint per pointer move), and one traversal of the scene graph is far below
 * the cost of the prepass it precedes. Descendants of a marked object are not
 * visited — hiding the marked object already hides them.
 */
export function collectSceneOverlays(root: THREE.Object3D): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  const visit = (object: THREE.Object3D): void => {
    if (!object.visible) return;
    if (isSceneOverlay(object)) { found.push(object); return; }
    for (const child of object.children) visit(child);
  };
  visit(root);
  return found;
}
