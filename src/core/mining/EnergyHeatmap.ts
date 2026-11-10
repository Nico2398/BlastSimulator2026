// BlastSimulator2026 — Energy heatmap model (#2200)
// Column summaries and sections over the plan's fragmentation bands, shared by the top-down
// overlay, the workshop's section view and the scene hover tag.

import type { BlastPlan } from './BlastPlan.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import { type FragmentationBand, FRAGMENTATION_BANDS, classifyFragmentationBand } from './FragmentationBand.js';
import { type PlanBandCell, type PlanBandMap, type BandShares, type PowderFactorRange, previewPlanBands } from './SoftwarePreview.js';
import { HEATMAP_COLUMN_BAND_MIN_SHARE } from '../config/balance.js';

/** What the heatmap hover says about the hole whose rock cell a column sits in (#2203). */
export interface HoleReadout {
  holeId: string;
  /** kg of explosive per m3 of the hole's rock. */
  powderFactor: number;
  shares: BandShares;
  /** Recommended range for this rock with the hole's own explosive and stemming; computed on first call. */
  recommended(): PowderFactorRange | null;
}

export interface ColumnBandSummary {
  /** Set on columns inside a charged hole's cell. */
  hole?: HoleReadout;
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

const FINEST_FIRST: readonly FragmentationBand[] = [...FRAGMENTATION_BANDS].reverse();

/** Summary of one column from its voxels' intensities. */
export function summarizeColumn(intensities: readonly number[]): Omit<ColumnBandSummary, 'x' | 'z'> {
  const counts: Record<FragmentationBand, number> = { intact: 0, cracked: 0, good: 0, fines: 0, dust: 0 };
  let maxIntensity = 0;
  for (const i of intensities) {
    counts[classifyFragmentationBand(i)]++;
    if (i > maxIntensity) maxIntensity = i;
  }
  const total = intensities.length;
  const worstBand = FINEST_FIRST.find(b => counts[b] > 0) ?? 'intact';
  const band = total === 0
    ? 'intact'
    : FINEST_FIRST.find(b => counts[b] / total >= HEATMAP_COLUMN_BAND_MIN_SHARE) ?? worstBand;
  return { band, worstBand, goodShare: total === 0 ? 0 : counts.good / total, maxIntensity, counts };
}

/** One summary per (x, z) column of the map. */
export function summarizeColumns(map: PlanBandMap): ColumnBandSummary[] {
  const byColumn = new Map<string, { x: number; z: number; values: number[] }>();
  for (const c of map.cells.values()) {
    const key = `${c.x},${c.z}`;
    let col = byColumn.get(key);
    if (!col) byColumn.set(key, col = { x: c.x, z: c.z, values: [] });
    col.values.push(c.intensity);
  }
  return [...byColumn.values()].map(c => ({ x: c.x, z: c.z, ...summarizeColumn(c.values) }));
}

/** The cells of the vertical plane z = `z`. */
export function sectionAtZ(map: PlanBandMap, z: number): PlanBandCell[] {
  const out: PlanBandCell[] = [];
  for (const c of map.cells.values()) if (c.z === z) out.push(c);
  return out;
}

interface PlanHeatmap { bands: PlanBandMap; columns: ColumnBandSummary[] }

let cache: { grid: VoxelGrid; key: string; value: PlanHeatmap } | null = null;

/** Bands and column summaries for the plan, recomputed only when grid, holes, charges or wet holes changed. */
export function planHeatmap(
  plan: BlastPlan,
  grid: VoxelGrid,
  wetHoleIds: ReadonlySet<string> = new Set(),
): PlanHeatmap {
  const key = JSON.stringify([plan.holes, plan.charges, [...wetHoleIds].sort(), grid.editRevision]);
  if (cache && cache.grid === grid && cache.key === key) return cache.value;
  const bands = previewPlanBands(plan, grid, wetHoleIds);
  const value = { bands, columns: summarizeColumns(bands) };
  cache = { grid, key, value };
  return value;
}
