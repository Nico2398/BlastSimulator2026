// BlastSimulator2026 — a BlastPreviewSummary the way `blast_preview` fills it at each software tier (#2201).
// Energy is free, so it is present at every tier; T1 adds the fragment distribution, T2 the projections, T3 the vibrations.

import { BLAST_PREVIEW_SHAPE } from '../../src/core/config/balance.js';
import type { BlastPreviewSummary } from '../../src/core/mining/Software.js';
import type { BlastRating } from '../../src/core/mining/BlastExecution.js';

/** Figures chosen to be told apart in rendered text. */
export const PREVIEW_FIGURES = {
  affectedVoxels: 4217,
  oversized: 37,
  goodVolumeM3: 120,
  finesVolumeM3: 45,
  dustVolumeM3: 18,
  dustLossValue: 4800,
  dustLossMassKg: 9100,
  avgFragmentSizeCm: 55.4,
  thrownShare: 0.25,
  furthestThrowM: 14,
  peakVibration: 3.21,
};

export function makePreviewSummary(
  tier: number,
  opts: { rating?: BlastRating } = {},
): BlastPreviewSummary {
  const f = PREVIEW_FIGURES;
  return {
    shape: BLAST_PREVIEW_SHAPE,
    tier,
    energy: { affectedVoxels: f.affectedVoxels, minEnergy: 1.5, maxEnergy: 9.25 },
    fragments: tier >= 1
      ? {
        fractured: 77, cracked: 3, unaffected: 1, avgFragmentSizeCm: f.avgFragmentSizeCm,
        bandVolumes: { intact: 7, cracked: 6, coarse: 0, good: f.goodVolumeM3, fines: f.finesVolumeM3, dust: f.dustVolumeM3 },
        fragmentCount: 100,
        oversizedFragments: f.oversized,
        goodVolumeM3: f.goodVolumeM3,
        finesVolumeM3: f.finesVolumeM3,
        dustVolumeM3: f.dustVolumeM3,
        dustLossMassKg: f.dustLossMassKg,
        dustLossValue: f.dustLossValue,
      }
      : null,
    projections: tier >= 2
      ? {
        projectionZoneVoxels: 5, collapseFragments: 2,
        predictedRating: opts.rating ?? 'bad', thrownFragments: 25, totalFragments: 100,
        thrownShare: f.thrownShare, furthestThrowM: f.furthestThrowM,
      }
      : null,
    vibrations: tier >= 3 ? { maxVibration: f.peakVibration, affectedVillages: 2 } : null,
  };
}
