// BlastSimulator2026 — Shared scene-picking vocabulary (P2)
// Entity mesh classes tag their root Object3D's userData with these keys so
// ScenePicking can resolve a raycast hit back to a game entity without a
// separate id/kind lookup table. Fragments are the exception: one
// InstancedMesh represents many fragments, so it's tagged with a bucket
// index instead of an entity id — FragmentMesh.fragmentIdAt() resolves the
// specific fragment from the raycast hit's `instanceId`.

import * as THREE from 'three';

export type PickableKind = 'building' | 'vehicle' | 'employee' | 'fragment';

/** Tag an entity's root Object3D so a raycast hit on it (or a child) resolves back to (kind, id). */
export function tagPickable(object: THREE.Object3D, kind: PickableKind, id: number): void {
  object.userData['entityKind'] = kind;
  object.userData['entityId'] = id;
}

/** A resolved raycast hit: which entity, and the point in world space it was hit at. */
export interface PickHit {
  kind: PickableKind;
  id: number;
  point: THREE.Vector3;
  distance: number;
}

/**
 * Walk up from a raycast-hit object (which is often a child mesh inside an
 * entity's Group) until an ancestor tagged by `tagPickable` is found.
 * Returns null if nothing in the chain is tagged (e.g. terrain).
 */
export function resolveTaggedAncestor(hitObject: THREE.Object3D): { kind: PickableKind; id: number } | null {
  let node: THREE.Object3D | null = hitObject;
  while (node) {
    const kind = node.userData['entityKind'] as PickableKind | undefined;
    const id = node.userData['entityId'] as number | undefined;
    if (kind !== undefined && id !== undefined) return { kind, id };
    node = node.parent;
  }
  return null;
}
