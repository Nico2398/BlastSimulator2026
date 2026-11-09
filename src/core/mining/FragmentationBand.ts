// BlastSimulator2026 — Fragmentation bands: how finely a voxel was broken.
//
// Intensity (`intensityAt`, EnergyPropagation) is the energy that went into and
// through a voxel over its breaking threshold. This file is the one place that
// names the ranges; the blast, previews, heatmap and report all read it.
// See the gameplay-blast-system skill, "Fragmentation bands".

import {
  CRACKED_VOXEL_ENERGY_RATIO,
  FRAGMENTATION_MULTIPLIER,
  FRAGMENTATION_BAND_FINES_MIN,
  FRAGMENTATION_BAND_DUST_MIN,
  DUST_LOSS_SHARE,
} from '../config/balance.js';

export type FragmentationBand = 'intact' | 'cracked' | 'good' | 'fines' | 'dust';

/** Every band, finest last. */
export const FRAGMENTATION_BANDS: readonly FragmentationBand[] = ['intact', 'cracked', 'good', 'fines', 'dust'];

/** The band a voxel of this intensity falls in. A bound belongs to the band above it. */
export function classifyFragmentationBand(intensity: number): FragmentationBand {
  if (intensity >= FRAGMENTATION_BAND_DUST_MIN) return 'dust';
  if (intensity >= FRAGMENTATION_BAND_FINES_MIN) return 'fines';
  if (intensity >= FRAGMENTATION_MULTIPLIER) return 'good';
  if (intensity >= CRACKED_VOXEL_ENERGY_RATIO) return 'cracked';
  return 'intact';
}

/** Share of a voxel's mass and ore that survives its band: dust loses `DUST_LOSS_SHARE`, every other band nothing. */
export function bandMassRetention(band: FragmentationBand): number {
  return band === 'dust' ? 1 - DUST_LOSS_SHARE : 1;
}
