// BlastSimulator2026 — Projection risk zone overlay (#2201)
// Tints the terrain columns a dry run says would throw rock (software T2).
// A thin GroundTintLayer wrapper, like EnergyHeatmapOverlay.

import type * as THREE from 'three';
import { PROJECTION_ZONE_COLOR, PROJECTION_ZONE_OPACITY } from '../core/config/balance.js';
import { GroundTintLayer, OVERLAY_Y_OFFSET, type GroundTintPatch } from './GroundTint.js';

/** The ground patch for one at-risk column. */
function columnPatch(column: { x: number; z: number }): GroundTintPatch {
  return {
    id: `${column.x},${column.z}`,
    shape: { kind: 'cell', x: column.x, z: column.z },
    color: PROJECTION_ZONE_COLOR,
    opacity: PROJECTION_ZONE_OPACITY,
  };
}

export class ProjectionZoneOverlay {
  private readonly layer: GroundTintLayer;

  constructor(scene: THREE.Scene, surfaceYAt: (x: number, z: number) => number) {
    this.layer = new GroundTintLayer(scene, surfaceYAt, { epsilon: OVERLAY_Y_OFFSET, renderOrder: 102 });
    this.layer.setVisible(false);
  }

  /** Replace the tinted columns and show the layer when there are any. */
  show(columns: ReadonlyArray<{ x: number; z: number }>): void {
    const ordered = [...columns].sort((a, b) => b.x - a.x || b.z - a.z);
    this.layer.replace(ordered.map(columnPatch));
    this.layer.setVisible(columns.length > 0);
  }

  hide(): void {
    this.layer.setVisible(false);
  }

  dispose(): void {
    this.layer.dispose();
  }
}
