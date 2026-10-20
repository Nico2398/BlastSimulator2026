// BlastSimulator2026 — Wall stability preview overlay (#1943)
// Tints the predicted wall faces of an armed blast: amber near the safe height, red over it.

import type * as THREE from 'three';
import type { WallFace } from '../core/mining/WallStability.js';

/** Tint of a face by its height against its safe height; null when it needs none. */
export type WallFaceTint = 'amber' | 'red';

export function wallFaceTint(_heightM: number, _safeM: number): WallFaceTint | null {
  return null; // TODO: implement
}

export class WallStabilityOverlay {
  constructor(_scene: THREE.Scene, _surfaceYAt: (x: number, z: number) => number) {
    // TODO: implement
  }

  show(_faces: ReadonlyArray<WallFace>): void {
    // TODO: implement
  }

  hide(): void {
    // TODO: implement
  }

  dispose(): void {
    // TODO: implement
  }
}
