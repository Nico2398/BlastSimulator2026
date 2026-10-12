// BlastSimulator2026 — Positional sound maths
// Listener + source point -> level, stereo pan and air-absorption cutoff. Pure.

import type { Listener, WorldPoint } from '../AudioPlayer.js';
import { SPATIAL_CONFIG } from '../../core/config/audio/engine.js';
import { clamp } from './units.js';

/** The tunables of SPATIAL_CONFIG as plain numbers, so a test can pass its own. */
type SpatialConfig = { readonly [K in keyof typeof SPATIAL_CONFIG]: number };

export interface SpatialResult {
  /** False when the source is culled or too quiet to bother playing. */
  readonly audible: boolean;
  /** Linear level factor 0..1. */
  readonly gain: number;
  /** Stereo position -1 (left) .. 1 (right). */
  readonly pan: number;
  /** Lowpass cutoff in Hz: distant sources lose their highs. */
  readonly lowpassHz: number;
}

/** Distance (m) inside which a source is at full level: a zoomed-in camera hears a small neighbourhood. */
export function referenceDistance(viewDistance: number, cfg: SpatialConfig = SPATIAL_CONFIG): number {
  return clamp(viewDistance * cfg.referencePerViewMetre, cfg.minReferenceM, cfg.maxReferenceM);
}

/** Distance (m) beyond which a positional sound is culled. */
export function cullDistance(viewDistance: number, cfg: SpatialConfig = SPATIAL_CONFIG): number {
  return referenceDistance(viewDistance, cfg) * cfg.cullDistanceFactor;
}

/** Level trim of the camera height: pulling back widens what is heard but makes all of it quieter. */
function zoomTrim(viewDistance: number, cfg: SpatialConfig = SPATIAL_CONFIG): number {
  const ratio = cfg.zoomTrimNearViewM / Math.max(viewDistance, cfg.zoomTrimNearViewM);
  return Math.max(Math.pow(ratio, cfg.zoomTrimExponent), cfg.zoomTrimMin);
}

export function computeSpatial(listener: Listener, point: WorldPoint, cfg: SpatialConfig = SPATIAL_CONFIG): SpatialResult {
  const dx = point.x - listener.x;
  const dz = point.z - listener.z;
  const distance = Math.hypot(dx, dz);
  const reference = referenceDistance(listener.viewDistance, cfg);
  const cull = cullDistance(listener.viewDistance, cfg);

  const inverse = distance <= reference ? 1 : reference / (reference + cfg.rolloff * (distance - reference));
  const edgeStart = cull * (1 - cfg.cullFadeFraction);
  const edge = distance <= edgeStart ? 1 : clamp((cull - distance) / (cull - edgeStart), 0, 1);
  const gain = Math.max(inverse, cfg.floorGain) * edge * zoomTrim(listener.viewDistance, cfg);

  const side = distance > 0 ? (dx * listener.rightX + dz * listener.rightZ) / distance : 0;
  const ease = clamp(distance / cfg.panEaseDistanceM, 0, 1);
  const pan = clamp(side * cfg.maxPan * ease, -cfg.maxPan, cfg.maxPan);

  const lowpassHz = clamp(
    (cfg.lowpassMaxHz * cfg.airDistanceM) / (cfg.airDistanceM + distance),
    cfg.lowpassMinHz,
    cfg.lowpassMaxHz,
  );
  return { audible: distance < cull && gain >= cfg.audibleGain, gain, pan, lowpassHz };
}
