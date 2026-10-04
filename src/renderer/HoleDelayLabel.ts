// BlastSimulator2026 — Hole delay label for the blast plan overlay.
// Camera-facing text plane showing a hole's detonation delay.

import * as THREE from 'three';

export interface HoleDelayLabelSpec {
  /** Localised label text, e.g. "150 ms". */
  text: string;
  /** Bucket colour as 0xRRGGBB (flat-colour fallback without DOM). */
  color: number;
  /** Same colour as a CSS string for canvas text. */
  cssColor: string;
}

/** Pure: label text + colour for a delay; null when the delay is negative (unsequenced). */
export function holeDelayLabelSpec(_delayMs: number): HoleDelayLabelSpec | null {
  // TODO: implement
  return undefined as unknown as HoleDelayLabelSpec | null;
}

/** Plane mesh with canvas text (flat colour without DOM); sets `userData.delayLabelText`. */
export function createHoleDelayLabel(_spec: HoleDelayLabelSpec): THREE.Mesh {
  // TODO: implement
  return undefined as unknown as THREE.Mesh;
}
