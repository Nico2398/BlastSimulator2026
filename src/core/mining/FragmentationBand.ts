// BlastSimulator2026 — Fragmentation bands: how finely a voxel was broken.
//
// Intensity (`intensityAt`, EnergyPropagation) is the energy that went into and
// through a voxel over its breaking threshold. This file is the one place that
// names the ranges; the blast, previews, heatmap and report all read it.
//
// One state is not an intensity range: `coarse` is rock the blast removes
// without enough energy to fragment it (undermined burden that lifts, rock
// floored to grade, unsupported rock). It comes out as large blocks, so the
// player must never see it labelled as rock that stays put.
// See the gameplay-blast-system skill, "Fragmentation bands".

import {
  CRACKED_VOXEL_ENERGY_RATIO,
  FRAGMENTATION_MULTIPLIER,
  FRAGMENTATION_BAND_FINES_MIN,
  FRAGMENTATION_BAND_DUST_MIN,
  DUST_LOSS_SHARE,
} from '../config/balance.js';

export type FragmentationBand = 'intact' | 'cracked' | 'coarse' | 'good' | 'fines' | 'dust';

/** Every band, finest last. */
export const FRAGMENTATION_BANDS: readonly FragmentationBand[] = ['intact', 'cracked', 'coarse', 'good', 'fines', 'dust'];

/** The band a voxel of this intensity falls in. A bound belongs to the band above it. */
export function classifyFragmentationBand(intensity: number): FragmentationBand {
  if (intensity >= FRAGMENTATION_BAND_DUST_MIN) return 'dust';
  if (intensity >= FRAGMENTATION_BAND_FINES_MIN) return 'fines';
  if (intensity >= FRAGMENTATION_MULTIPLIER) return 'good';
  if (intensity >= CRACKED_VOXEL_ENERGY_RATIO) return 'cracked';
  return 'intact';
}

/**
 * The band of a voxel once its fate is known: rock the blast removes without enough
 * energy to fragment it is `coarse`; everything else is `classifyFragmentationBand`.
 */
export function fragmentationBandOf(intensity: number, broken: boolean): FragmentationBand {
  if (broken && intensity < FRAGMENTATION_MULTIPLIER) return 'coarse';
  return classifyFragmentationBand(intensity);
}

/** Share of a voxel's mass and ore that survives its band: dust loses `DUST_LOSS_SHARE`, every other band nothing. */
export function bandMassRetention(band: FragmentationBand): number {
  return band === 'dust' ? 1 - DUST_LOSS_SHARE : 1;
}

/** One colour token per band, shared by the heatmap overlay, its section view and legend (#2200). */
export const FRAGMENTATION_BAND_COLORS: Record<FragmentationBand, number> = {
  intact: 0x2f6fd6,
  cracked: 0x9cc7f2,
  coarse: 0x8e5bd0,
  good: 0x3fbf5f,
  fines: 0xf59a2b,
  dust: 0xd8372b,
};

/** Colour token of the band a voxel of this intensity falls in. */
export function heatmapBandColor(intensity: number): number {
  return FRAGMENTATION_BAND_COLORS[classifyFragmentationBand(intensity)];
}

/**
 * Share of the broken rock (coarse + good + fines + dust, by volume) that was crushed into fines or dust;
 * 0 when nothing broke (#2202). Reports saved before `coarse` existed count none.
 */
export function finesShare(bandVolumes: Readonly<Partial<Record<FragmentationBand, number>>>): number {
  const fines = (bandVolumes.fines ?? 0) + (bandVolumes.dust ?? 0);
  const broken = (bandVolumes.coarse ?? 0) + (bandVolumes.good ?? 0) + fines;
  if (!(broken > 0)) return 0;
  return fines / broken;
}
