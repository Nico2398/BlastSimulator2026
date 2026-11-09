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

/** One colour token per band, shared by the heatmap overlay, its section view and legend (#2200). */
export const FRAGMENTATION_BAND_COLORS: Record<FragmentationBand, number> = {
  intact: 0x2f6fd6,
  cracked: 0x9cc7f2,
  good: 0x3fbf5f,
  fines: 0xf59a2b,
  dust: 0xd8372b,
};

/** Colour token of the band a voxel of this intensity falls in. */
export function heatmapBandColor(intensity: number): number {
  return FRAGMENTATION_BAND_COLORS[classifyFragmentationBand(intensity)];
}

/** Share of the broken rock (good + fines + dust, by volume) that was crushed into fines or dust; 0 when nothing broke (#2202). */
export function finesShare(bandVolumes: Record<FragmentationBand, number>): number {
  const broken = bandVolumes.good + bandVolumes.fines + bandVolumes.dust;
  if (!(broken > 0)) return 0;
  return (bandVolumes.fines + bandVolumes.dust) / broken;
}
