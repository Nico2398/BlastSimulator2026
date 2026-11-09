// BlastSimulator2026 — Fragmentation bands: how finely a voxel was broken.
//
// Intensity (`intensityAt`, EnergyPropagation) is the energy that went into and
// through a voxel over its breaking threshold. This file is the one place that
// names the ranges; the blast, previews, heatmap and report all read it.
// See the gameplay-blast-system skill, "Fragmentation bands".

export type FragmentationBand = 'intact' | 'cracked' | 'good' | 'fines' | 'dust';

/** Every band, finest last. */
export const FRAGMENTATION_BANDS: readonly FragmentationBand[] = ['intact', 'cracked', 'good', 'fines', 'dust'];

/** The band a voxel of this intensity falls in. A bound belongs to the band above it. */
export function classifyFragmentationBand(_intensity: number): FragmentationBand {
  throw new Error('not implemented');
}

/** Share of a voxel's mass and ore that survives its band: dust loses `DUST_LOSS_SHARE`, every other band nothing. */
export function bandMassRetention(_band: FragmentationBand): number {
  throw new Error('not implemented');
}
