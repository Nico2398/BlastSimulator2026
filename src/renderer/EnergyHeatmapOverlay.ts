// BlastSimulator2026 — Energy heatmap overlay (#2200)
// Top-down tint of the terrain: one colour per column, from the column's displayed fragmentation band.
// A thin GroundTintLayer wrapper, like WallStabilityOverlay.

import type * as THREE from 'three';
import type { ColumnBandSummary } from '../core/mining/EnergyHeatmap.js';
import { FRAGMENTATION_BAND_COLORS } from '../core/mining/FragmentationBand.js';
import { HEATMAP_OVERLAY_OPACITY } from '../core/config/balance.js';
import { GroundTintLayer, OVERLAY_Y_OFFSET, type GroundTintPatch } from './GroundTint.js';

/** The ground patch for one column. */
export function columnPatch(column: ColumnBandSummary): GroundTintPatch {
  return {
    id: `${column.x},${column.z}`,
    shape: { kind: 'cell', x: column.x, z: column.z },
    color: FRAGMENTATION_BAND_COLORS[column.band],
    opacity: HEATMAP_OVERLAY_OPACITY,
  };
}

export class EnergyHeatmapOverlay {
  private readonly layer: GroundTintLayer;

  constructor(scene: THREE.Scene, surfaceYAt: (x: number, z: number) => number) {
    this.layer = new GroundTintLayer(scene, surfaceYAt, { epsilon: OVERLAY_Y_OFFSET, renderOrder: 101 });
    this.layer.setVisible(false);
  }

  /** Replace the tinted columns and show the layer when there are any. */
  show(columns: ReadonlyArray<ColumnBandSummary>): void {
    this.layer.replace(columns.map(columnPatch));
    this.layer.setVisible(columns.length > 0);
  }

  hide(): void {
    this.layer.setVisible(false);
  }

  dispose(): void {
    this.layer.dispose();
  }
}
