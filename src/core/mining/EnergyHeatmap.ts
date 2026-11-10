// BlastSimulator2026 — Energy heatmap model (#2200)
// Column summaries and sections over the plan's fragmentation bands, shared by the top-down
// overlay, the workshop's section view and the scene hover tag.

import type { BlastPlan } from './BlastPlan.js';
import type { VoxelGrid } from '../world/VoxelGrid.js';
import { type FragmentationBand, FRAGMENTATION_BANDS, classifyFragmentationBand } from './FragmentationBand.js';
import {
  type PlanBandCell, type PlanBandMap, type BandShares, type PowderFactorRange,
  previewPlanBands, holeBandMixes, recommendedPowderFactors, ownerHoleOf,
} from './SoftwarePreview.js';
import { holePowderFactors, holeSpacingM } from './ChargePlan.js';
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

/** One voxel of a column: its intensity alone (banded by intensity), or a preview cell already banded with its fate. */
type ColumnVoxel = number | Pick<PlanBandCell, 'intensity' | 'band'>;

/** Summary of one column from its voxels. */
export function summarizeColumn(voxels: readonly ColumnVoxel[]): Omit<ColumnBandSummary, 'x' | 'z'> {
  const counts = Object.fromEntries(FRAGMENTATION_BANDS.map(b => [b, 0])) as Record<FragmentationBand, number>;
  let maxIntensity = 0;
  for (const v of voxels) {
    const intensity = typeof v === 'number' ? v : v.intensity;
    counts[typeof v === 'number' ? classifyFragmentationBand(v) : v.band]++;
    if (intensity > maxIntensity) maxIntensity = intensity;
  }
  const total = voxels.length;
  const worstBand = FINEST_FIRST.find(b => counts[b] > 0) ?? 'intact';
  const band = total === 0
    ? 'intact'
    : FINEST_FIRST.find(b => counts[b] / total >= HEATMAP_COLUMN_BAND_MIN_SHARE) ?? worstBand;
  return { band, worstBand, goodShare: total === 0 ? 0 : counts.good / total, maxIntensity, counts };
}

/** One summary per (x, z) column of the map. */
export function summarizeColumns(map: PlanBandMap): ColumnBandSummary[] {
  const byColumn = new Map<string, { x: number; z: number; values: PlanBandCell[] }>();
  for (const c of map.cells.values()) {
    const key = `${c.x},${c.z}`;
    let col = byColumn.get(key);
    if (!col) byColumn.set(key, col = { x: c.x, z: c.z, values: [] });
    col.values.push(c);
  }
  return [...byColumn.values()].map(c => ({ x: c.x, z: c.z, ...summarizeColumn(c.values) }));
}

/** The cells of the vertical plane z = `z`. */
export function sectionAtZ(map: PlanBandMap, z: number): PlanBandCell[] {
  const out: PlanBandCell[] = [];
  for (const c of map.cells.values()) if (c.z === z) out.push(c);
  return out;
}

/** Sets `hole` on every column inside a charged hole's cell: nearest hole by column, within half its spacing (#2203). */
function annotateHoles(
  columns: ColumnBandSummary[],
  plan: BlastPlan,
  grid: VoxelGrid,
  bands: PlanBandMap,
  wetHoleIds: ReadonlySet<string>,
): ColumnBandSummary[] {
  const charged = plan.holes.filter(h => plan.charges[h.id] !== undefined);
  if (charged.length === 0) return columns;
  const mixes = holeBandMixes(bands, plan.holes);
  const factors = holePowderFactors(plan.holes, plan.charges);
  // One sweep per (explosive, stemming) pair, shared by every hole charged that way.
  const sweeps = new Map<string, Record<string, PowderFactorRange | null>>();
  const recommendedFor = (holeId: string): PowderFactorRange | null => {
    const charge = plan.charges[holeId]!;
    const key = `${charge.explosiveId}|${charge.stemmingM}`;
    let sweep = sweeps.get(key);
    if (!sweep) sweeps.set(key, sweep = recommendedPowderFactors(plan.holes, grid, charge.explosiveId, charge.stemmingM, wetHoleIds));
    return sweep[holeId] ?? null;
  };
  // Every hole competes for a column, charged or not: a column an uncharged hole owns shows no readout.
  const cells = plan.holes.map(h => ({ h, cx: Math.floor(h.x), cz: Math.floor(h.z), half: holeSpacingM(h, plan.holes) / 2 }));
  return columns.map(col => {
    const owner = ownerHoleOf(col.x, col.z, cells);
    const shares = owner && plan.charges[owner.h.id] !== undefined ? mixes[owner.h.id] : undefined;
    if (!owner || !shares) return col;
    const holeId = owner.h.id;
    let memo: { value: PowderFactorRange | null } | null = null;
    const hole: HoleReadout = {
      holeId,
      powderFactor: factors[holeId] ?? 0,
      shares,
      recommended: () => (memo ??= { value: recommendedFor(holeId) }).value,
    };
    return { ...col, hole };
  });
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
  const value = { bands, columns: annotateHoles(summarizeColumns(bands), plan, grid, bands, wetHoleIds) };
  cache = { grid, key, value };
  return value;
}
