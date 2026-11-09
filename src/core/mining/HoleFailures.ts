// BlastSimulator2026 — Why a charged hole did not open its rock (#2202)
//
// A shot that broke nothing, or broke rock that stayed sealed, used to rate
// "bad" with no explanation. This reads the finished energy field and the
// fragmentation mask and names, per charged hole, what went wrong.

import type { BlastPlan } from './BlastPlan.js';
import type { EnergyField } from './EnergyPropagation.js';
import type { FragmentationResult } from './VoxelFragmentation.js';

export type HoleFailureKind = 'below_threshold' | 'fizzled' | 'buried';

export interface HoleFailure {
  holeId: string;
  kind: HoleFailureKind;
  /** `below_threshold`: whole percent more energy the hole would have needed. */
  moreEnergyPct?: number;
  /** `buried`: metres of intact rock left above the charge in the hole's column. */
  rockAboveM?: number;
}

export interface HoleFailureInput {
  plan: BlastPlan;
  field: EnergyField;
  fragmentation: FragmentationResult;
  holeSurfaceYs: Record<string, number>;
  wetHoleIds: ReadonlySet<string>;
}

/** One entry per charged hole that broke no rock at its charge, or left its column sealed. */
export function analyseHoleFailures(_input: HoleFailureInput): HoleFailure[] {
  throw new Error('not implemented');
}
