// BlastSimulator2026 — Ground markers over active traffic jams (#1208)

import type * as THREE from 'three';
import type { TrafficJam } from '../core/events/TrafficJams.js';
import type { SurfaceHeightSampler } from './GroundTint.js';

export class TrafficJamMarkerLayer {
  constructor(_scene: THREE.Scene, _surfaceY: SurfaceHeightSampler) {}

  sync(_jams: readonly TrafficJam[]): void {}

  dispose(): void {}
}
