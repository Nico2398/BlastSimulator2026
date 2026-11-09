// BlastSimulator2026 — Energy heatmap overlay (#2200)
// Top-down tint of the terrain: one colour per column, from the column's displayed fragmentation band.
// A thin GroundTintLayer wrapper, like WallStabilityOverlay.

import type * as THREE from 'three';
import type { ColumnBandSummary } from '../core/mining/EnergyHeatmap.js';
import type { GroundTintPatch } from './GroundTint.js';

/** The ground patch for one column. */
export function columnPatch(_column: ColumnBandSummary): GroundTintPatch {
  throw new Error('not implemented');
}

export class EnergyHeatmapOverlay {
  constructor(_scene: THREE.Scene, _surfaceYAt: (x: number, z: number) => number) {
    throw new Error('not implemented');
  }

  show(_columns: ReadonlyArray<ColumnBandSummary>): void {
    throw new Error('not implemented');
  }

  hide(): void {
    throw new Error('not implemented');
  }

  dispose(): void {
    throw new Error('not implemented');
  }
}
