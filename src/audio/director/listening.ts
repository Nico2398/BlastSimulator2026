// BlastSimulator2026 — What a listener can hear
// The director's own cheap range checks, built on the engine's spatial tuning so
// both agree on what "near" means: a zoomed-in camera hears a small
// neighbourhood, a pulled-back one a wide area.

import type { WorldPoint } from '../AudioPlayer.js';

export function distanceM(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Distance (m) inside which a source is at full level, and beyond which the engine
 * culls one, for a camera this far from its target. The engine's own functions, so
 * the director and `computeSpatial` cannot disagree.
 */
export { referenceDistance as referenceM, cullDistance as cullM } from '../engine/spatial.js';

/** The point `distance` metres from `origin` along `bearingRad`. */
export function offsetPoint(origin: WorldPoint, bearingRad: number, distance: number): WorldPoint {
  return { x: origin.x + Math.cos(bearingRad) * distance, z: origin.z + Math.sin(bearingRad) * distance };
}
