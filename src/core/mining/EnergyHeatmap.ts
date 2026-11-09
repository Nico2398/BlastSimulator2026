// BlastSimulator2026 — Energy heatmap model (#2200)
// Column summaries and sections over the plan's fragmentation bands, shared by the top-down
// overlay, the workshop's section view and the scene hover tag.

import type { BlastPlan } from './BlastPlan.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { FragmentationBand } from './FragmentationBand.js';
import type { PlanBandCell, PlanBandMap } from './SoftwarePreview.js';

export interface ColumnBandSummary {
  x: number;
  z: number;
  /** Displayed band: the finest band covering at least HEATMAP_COLUMN_BAND_MIN_SHARE of the column. */
  band: FragmentationBand;
  /** Finest band present in the column. */
  worstBand: FragmentationBand;
  /** Share of the column's filled voxels in the good band, 0..1. */
  goodShare: number;
  maxIntensity: number;
  counts: Record<FragmentationBand, number>;
}

/** Summary of one column from its voxels' intensities. */
export function summarizeColumn(_intensities: readonly number[]): Omit<ColumnBandSummary, 'x' | 'z'> {
  throw new Error('not implemented');
}

/** One summary per (x, z) column of the map. */
export function summarizeColumns(_map: PlanBandMap): ColumnBandSummary[] {
  throw new Error('not implemented');
}

/** The cells of the vertical plane z = `z`. */
export function sectionAtZ(_map: PlanBandMap, _z: number): PlanBandCell[] {
  throw new Error('not implemented');
}

/** Bands and column summaries for the plan, recomputed only when grid, holes, charges or wet holes changed. */
export function planHeatmap(
  _plan: BlastPlan,
  _grid: VoxelGrid,
  _wetHoleIds: ReadonlySet<string> = new Set(),
): { bands: PlanBandMap; columns: ColumnBandSummary[] } {
  throw new Error('not implemented');
}
