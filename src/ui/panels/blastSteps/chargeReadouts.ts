// BlastSimulator2026 — Charge step: predicted band mixes and recommended ranges (#2203)
// Memoizes the field builds behind the explosive cards and the hole rows. A card preview is
// ~one blast field, a recommended range ~RECOMMENDED_SWEEP_STEPS of them, so neither is
// recomputed until the pattern, the wet holes, the terrain or the asked-for stemming changes.

import { holePowderFactors, type HoleCharge } from '../../../core/mining/ChargePlan.js';
import type { DrillHole } from '../../../core/mining/DrillPlan.js';
import { planHeatmap } from '../../../core/mining/EnergyHeatmap.js';
import {
  type BandShares, type PowderFactorRange,
  holeBandMixes, previewExplosiveBandShares, recommendedPowderFactors,
} from '../../../core/mining/SoftwarePreview.js';
import type { VoxelGrid } from '../../../core/world/VoxelGrid.js';
import type { HoleRowReadout } from './ChargeHoleList.js';

export class ChargeReadouts {
  private grid: VoxelGrid | null = null;
  private holes: readonly DrillHole[] = [];
  private wet: ReadonlySet<string> = new Set();
  private patternKey = '';
  private readonly cardMixes = new Map<string, BandShares | null>();
  private readonly ranges = new Map<string, Record<string, PowderFactorRange | null>>();

  /** Point the cache at the current pattern; drops every memo when the pattern, wet holes or terrain changed. */
  begin(holes: readonly DrillHole[], wetIds: readonly string[], grid: VoxelGrid | null): void {
    const key = JSON.stringify([holes, [...wetIds].sort(), grid ? grid.editRevision : null]);
    if (key !== this.patternKey || grid !== this.grid) {
      this.patternKey = key;
      this.cardMixes.clear();
      this.ranges.clear();
    }
    this.holes = holes;
    this.wet = new Set(wetIds);
    this.grid = grid;
  }

  /** A signature fragment: changes whenever the cached predictions could. */
  get revision(): string { return this.grid ? `${this.grid.editRevision}` : 'nogrid'; }

  /** Band mix the explosive would give the whole pattern, every hole filled up to `stemmingM`; null without a grid or holes. */
  cardMix(explosiveId: string, stemmingM: number): BandShares | null {
    if (!this.grid || this.holes.length === 0) return null;
    const key = `${explosiveId}|${stemmingM}`;
    if (!this.cardMixes.has(key)) {
      this.cardMixes.set(key, previewExplosiveBandShares(this.holes, this.grid, explosiveId, stemmingM, this.wet));
    }
    return this.cardMixes.get(key) ?? null;
  }

  /** Per-hole readouts: powder factor for charged holes; band mix and recommended range need a grid. */
  rows(charges: Readonly<Record<string, HoleCharge>>, explosiveId: string): Record<string, HoleRowReadout> {
    const out: Record<string, HoleRowReadout> = {};
    const grid = this.grid;
    const factors = holePowderFactors(this.holes, charges);
    let ranges: Record<string, PowderFactorRange | null> | undefined;
    let mixes: Record<string, BandShares> = {};
    if (grid) {
      ranges = this.ranges.get(explosiveId);
      if (!ranges) this.ranges.set(explosiveId, ranges = recommendedPowderFactors(this.holes, grid, explosiveId, this.wet));
      const plan = { holes: [...this.holes], charges: { ...charges } };
      mixes = holeBandMixes(planHeatmap(plan, grid, this.wet).bands, this.holes);
    }
    for (const hole of this.holes) {
      const readout: HoleRowReadout = {};
      if (ranges) readout.recommended = ranges[hole.id] ?? null;
      const factor = factors[hole.id];
      if (factor !== undefined) {
        readout.powderFactor = factor;
        const shares = mixes[hole.id];
        if (shares) readout.shares = shares;
      }
      out[hole.id] = readout;
    }
    return out;
  }
}
