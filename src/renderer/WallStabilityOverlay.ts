// BlastSimulator2026 — Wall stability overlay (#1943)
// Tints the wall faces the geology view flags: amber from WALL_WARN_RATIO of the safe
// height, red at or over it. A thin GroundTintLayer wrapper, like SurveyConfidenceOverlay.

import type * as THREE from 'three';
import { WALL_WARN_RATIO, WALL_OVERLAY_OPACITY, WALL_OVERLAY_MAX_FACE_CELLS } from '../core/config/balance.js';
import { WALL_RATIO_EPSILON, type WallFace } from '../core/mining/WallStability.js';
import { GroundTintLayer, type GroundTintPatch } from './GroundTint.js';

/** Tint of a face by its height against its safe height; null when it needs none. */
type WallFaceTint = 'amber' | 'red';

const TINT_COLOR: Record<WallFaceTint, number> = { amber: 0xffb000, red: 0xff2a1a };

/** Epsilon above the sampled surface; GroundTintLayer scales it up on steep faces. */
const OVERLAY_Y_OFFSET = 0.05;

export function wallFaceTint(heightM: number, safeM: number): WallFaceTint | null {
  const ratio = heightM / safeM;
  if (ratio >= 1 - WALL_RATIO_EPSILON) return 'red';
  return ratio >= WALL_WARN_RATIO - WALL_RATIO_EPSILON ? 'amber' : null;
}

export class WallStabilityOverlay {
  private readonly layer: GroundTintLayer;

  constructor(scene: THREE.Scene, private readonly surfaceYAt: (x: number, z: number) => number) {
    this.layer = new GroundTintLayer(scene, surfaceYAt, { epsilon: OVERLAY_Y_OFFSET, renderOrder: 101 });
    this.layer.setVisible(false);
  }

  /** Replace the tinted faces; each paints the cells from its crest down to its toe. */
  show(faces: ReadonlyArray<WallFace>): void {
    const patches = new Map<string, GroundTintPatch>();
    for (const face of faces) {
      const tint = wallFaceTint(face.heightM, face.safeM);
      if (!tint) continue;
      for (let k = 0; k < WALL_OVERLAY_MAX_FACE_CELLS; k++) {
        const x = face.crest.x + face.dir.dx * k, z = face.crest.z + face.dir.dz * k;
        if (k > 0 && this.surfaceYAt(x + 0.5, z + 0.5) <= face.toeY + 1) break;
        const id = `${x},${z}`;
        const prev = patches.get(id);
        // Where faces overlap, red wins.
        if (prev && prev.color === TINT_COLOR.red) continue;
        patches.set(id, { id, shape: { kind: 'cell', x, z }, color: TINT_COLOR[tint], opacity: WALL_OVERLAY_OPACITY });
      }
    }
    this.layer.replace([...patches.values()]);
    this.layer.setVisible(patches.size > 0);
  }

  hide(): void {
    this.layer.setVisible(false);
  }

  dispose(): void {
    this.layer.dispose();
  }
}
