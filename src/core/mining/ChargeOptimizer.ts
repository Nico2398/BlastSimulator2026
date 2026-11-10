// BlastSimulator2026 — Charge optimizer (#2204)
// Proposes, per hole, the explosive and kg that maximise good-band rock within the permit kg limit.

import type { DrillHole } from './DrillPlan.js';
import type { HoleCharge } from './ChargePlan.js';
import type { BandShares } from './SoftwarePreview.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';

export interface OptimizeChargesOptions {
  /** Explosives the level offers. */
  explosiveIds: readonly string[];
  stemmingM: number;
  /** Wet holes: no water-sensitive explosive is proposed for them. */
  wetHoleIds?: ReadonlySet<string>;
  /** Permit kg limit for the whole plan; unlimited when omitted. */
  maxTotalKg?: number;
}

export interface ChargeProposal {
  charges: Record<string, HoleCharge>;
  holeMixes: Record<string, BandShares>;
  /** Pooled band mix of the proposed plan; null with no rock. */
  bandShares: BandShares | null;
  cost: number;
  totalKg: number;
  permitKgLimit: number;
  withinPermit: boolean;
  /** Holes no offered explosive can be proposed for. */
  skippedHoleIds: string[];
}

/** The best charge plan for the pattern. Pure: reads the grid, changes nothing. */
export function optimizeCharges(
  _holes: readonly DrillHole[],
  _grid: VoxelGrid,
  _options: OptimizeChargesOptions,
): ChargeProposal {
  throw new Error('not implemented');
}
