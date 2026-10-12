// BlastSimulator2026 — What a listener can hear
// The director's own cheap range checks, built on the engine's spatial tuning so
// both agree on what "near" means: a zoomed-in camera hears a small
// neighbourhood, a pulled-back one a wide area.

import type { WorldPoint } from '../AudioPlayer.js';
import { SPATIAL_CONFIG } from '../../core/config/audio/engine.js';
import { clamp } from '../engine/units.js';

export function distanceM(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Distance (m) inside which a source is at full level for a camera this far from its target. */
export function referenceM(viewDistance: number): number {
  return clamp(viewDistance * SPATIAL_CONFIG.referencePerViewMetre, SPATIAL_CONFIG.minReferenceM, SPATIAL_CONFIG.maxReferenceM);
}

/** Distance (m) beyond which the engine culls a positional sound. */
export function cullM(viewDistance: number): number {
  return referenceM(viewDistance) * SPATIAL_CONFIG.cullDistanceFactor;
}

/** The point `distance` metres from `origin` along `bearingRad`. */
export function offsetPoint(origin: WorldPoint, bearingRad: number, distance: number): WorldPoint {
  return { x: origin.x + Math.cos(bearingRad) * distance, z: origin.z + Math.sin(bearingRad) * distance };
}
