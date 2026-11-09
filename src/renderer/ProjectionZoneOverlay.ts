// BlastSimulator2026 — Projection risk zone overlay (#2201)
// Tints the terrain columns a dry run says would throw rock (software T2).

import type * as THREE from 'three';

export class ProjectionZoneOverlay {
  constructor(_scene: THREE.Scene, _surfaceYAt: (x: number, z: number) => number) {
    throw new Error('not implemented');
  }

  show(_columns: ReadonlyArray<{ x: number; z: number }>): void {
    throw new Error('not implemented');
  }

  hide(): void {
    throw new Error('not implemented');
  }

  dispose(): void {
    throw new Error('not implemented');
  }
}
