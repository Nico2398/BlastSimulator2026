// BlastSimulator2026 — recorded terrain edits (#1180)
// A compact, replayable log of every dig/add/fracture change made to a
// VoxelGrid's generated baseline. Replaying this log onto a freshly
// generated grid reproduces the live grid voxel for voxel, without saving
// every voxel's full state.

import type { VoxelGrid, VoxelRockComposition } from './VoxelGrid';

export type EditKind = 'dug' | 'added';

/** Exact voxel state at a segment's boundary row, when the edit's true bound
 *  falls mid-voxel there. Stored verbatim (not re-derived from a formula at
 *  replay time) because which composition/ores a boundary row carries varies
 *  by call site. `composition` is portable composition data
 *  (`VoxelRockComposition`) — re-interned into the target grid's own palette
 *  at replay time to get a locally valid index. */
export interface EditBoundary {
  density: number;
  composition: VoxelRockComposition;
  ores?: Record<string, number>;
}

export interface EditSegment {
  yLo: number;  // inclusive voxel row
  yHi: number;  // inclusive voxel row
  kind: EditKind;
  composition?: VoxelRockComposition;   // 'added' only — portable composition data for every fully-covered interior/boundary row without its own override
  ores?: Record<string, number>;
  bottomBoundary?: EditBoundary;  // present only when yLo's true edge is fractional
  topBoundary?: EditBoundary;     // present only when yHi's true edge is fractional
}

interface Column {
  x: number;
  z: number;
  segments: EditSegment[];
}

interface FractureEntry {
  x: number;
  y: number;
  z: number;
  modifier: number;
}

/** Shallow equality of two optional ore-density records. */
export function oresDeepEqual(a: Record<string, number> | undefined, b: Record<string, number> | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Structural equality of two optional compositions, for adjacency-merge
 * eligibility (`canMerge`). Every composition reaching this module comes
 * from `CompositionPalette.get(...).comp` (via `VoxelGrid`'s recorder),
 * which already quantizes coefficients and sorts by `rockId` — so array
 * order is canonical and a positional comparison is sufficient without
 * re-sorting here.
 */
function compositionDeepEqual(
  a: VoxelRockComposition | undefined,
  b: VoxelRockComposition | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.rocks.length !== b.rocks.length) return false;
  for (let i = 0; i < a.rocks.length; i++) {
    if (a.rocks[i]!.rockId !== b.rocks[i]!.rockId) return false;
    if (a.rocks[i]!.coefficient !== b.rocks[i]!.coefficient) return false;
  }
  return true;
}

function cloneBoundary(boundary: EditBoundary): EditBoundary {
  return boundary.ores
    ? { density: boundary.density, composition: boundary.composition, ores: { ...boundary.ores } }
    : { density: boundary.density, composition: boundary.composition };
}

/**
 * Per-column log of dig/add edits plus a sparse per-voxel fracture-modifier
 * log, both recorded relative to a grid's generated baseline.
 */
export class TerrainEdits {
  private readonly columnMap = new Map<string, Column>();
  private readonly fractures = new Map<string, FractureEntry>();

  static empty(): TerrainEdits {
    return new TerrainEdits();
  }

  recordDig(
    x: number,
    z: number,
    yLo: number,
    yHi: number,
    bottomBoundary?: EditBoundary,
    topBoundary?: EditBoundary,
  ): void {
    this.paintInterval(x, z, yLo, yHi, 'dug', undefined, undefined, bottomBoundary, topBoundary);
  }

  recordAdd(
    x: number,
    z: number,
    yLo: number,
    yHi: number,
    composition: VoxelRockComposition,
    ores?: Record<string, number>,
    bottomBoundary?: EditBoundary,
    topBoundary?: EditBoundary,
  ): void {
    this.paintInterval(x, z, yLo, yHi, 'added', composition, ores, bottomBoundary, topBoundary);
  }

  /** `fractureModifier === 1` deletes any existing entry at (x, y, z). */
  recordFracture(x: number, y: number, z: number, fractureModifier: number): void {
    const key = `${x},${y},${z}`;
    if (fractureModifier === 1) {
      this.fractures.delete(key);
    } else {
      this.fractures.set(key, { x, y, z, modifier: fractureModifier });
    }
  }

  /** Bottom-to-top, non-overlapping segments recorded for column (x, z). */
  segmentsAt(x: number, z: number): readonly EditSegment[] {
    return this.columnMap.get(`${x},${z}`)?.segments ?? [];
  }

  fractureAt(x: number, y: number, z: number): number | undefined {
    return this.fractures.get(`${x},${y},${z}`)?.modifier;
  }

  columns(): Array<{ x: number; z: number; segments: readonly EditSegment[] }> {
    return [...this.columnMap.values()].map(c => ({ x: c.x, z: c.z, segments: c.segments }));
  }

  fractureEntries(): Array<{ x: number; y: number; z: number; modifier: number }> {
    return [...this.fractures.values()];
  }

  isEmpty(): boolean {
    return this.columnMap.size === 0 && this.fractures.size === 0;
  }

  /**
   * Paint interval [yLo, yHi] onto column (x, z): trims/splits every existing
   * segment overlapping the interval, inserts the new segment, then merges it
   * with adjacent same-kind/same-material neighbors when the shared seam
   * carries no boundary override that merging would discard.
   */
  private paintInterval(
    x: number,
    z: number,
    yLo: number,
    yHi: number,
    kind: EditKind,
    composition: VoxelRockComposition | undefined,
    ores: Record<string, number> | undefined,
    bottomBoundary: EditBoundary | undefined,
    topBoundary: EditBoundary | undefined,
  ): void {
    const key = `${x},${z}`;
    const existing = this.columnMap.get(key)?.segments ?? [];

    const next: EditSegment[] = [];
    for (const seg of existing) {
      if (seg.yHi < yLo || seg.yLo > yHi) {
        // No overlap with the painted interval — carried through unchanged.
        next.push(seg);
        continue;
      }
      if (seg.yLo < yLo) {
        // Below remainder survives, its topBoundary cleared (no longer at an edge).
        const below: EditSegment = { ...seg, yHi: yLo - 1 };
        delete below.topBoundary;
        next.push(below);
      }
      if (seg.yHi > yHi) {
        // Above remainder survives, its bottomBoundary cleared (no longer at an edge).
        const above: EditSegment = { ...seg, yLo: yHi + 1 };
        delete above.bottomBoundary;
        next.push(above);
      }
      // Otherwise the segment is fully inside [yLo, yHi] — dropped entirely.
    }

    const inserted: EditSegment = { yLo, yHi, kind };
    if (kind === 'added' && composition !== undefined) {
      inserted.composition = composition;
      if (ores && Object.keys(ores).length > 0) inserted.ores = { ...ores };
    }
    if (bottomBoundary) inserted.bottomBoundary = cloneBoundary(bottomBoundary);
    if (topBoundary) inserted.topBoundary = cloneBoundary(topBoundary);
    next.push(inserted);

    next.sort((a, b) => a.yLo - b.yLo);

    const merged = this.mergeAdjacent(next);

    if (merged.length === 0) {
      this.columnMap.delete(key);
    } else {
      this.columnMap.set(key, { x, z, segments: merged });
    }
  }

  private mergeAdjacent(segments: EditSegment[]): EditSegment[] {
    const merged: EditSegment[] = [];
    for (const seg of segments) {
      const prev = merged[merged.length - 1];
      if (prev && this.canMerge(prev, seg)) {
        const mergedSeg: EditSegment = { yLo: prev.yLo, yHi: seg.yHi, kind: prev.kind };
        if (prev.composition !== undefined) mergedSeg.composition = prev.composition;
        if (prev.ores !== undefined) mergedSeg.ores = prev.ores;
        if (prev.bottomBoundary !== undefined) mergedSeg.bottomBoundary = prev.bottomBoundary;
        if (seg.topBoundary !== undefined) mergedSeg.topBoundary = seg.topBoundary;
        merged[merged.length - 1] = mergedSeg;
      } else {
        merged.push(seg);
      }
    }
    return merged;
  }

  /**
   * Two adjacent segments merge only when they carry the same kind/material
   * AND neither's shared seam carries a boundary override that merging would
   * discard — `a`'s topBoundary and `b`'s bottomBoundary are the ones lost by
   * merging, so both must be absent. Only the outer edges (`a.bottomBoundary`,
   * `b.topBoundary`) survive into the merged segment.
   */
  private canMerge(a: EditSegment, b: EditSegment): boolean {
    if (a.yHi + 1 !== b.yLo) return false;
    if (a.kind !== b.kind) return false;
    if (a.kind === 'added') {
      if (!compositionDeepEqual(a.composition, b.composition)) return false;
      if (!oresDeepEqual(a.ores, b.ores)) return false;
    }
    if (a.topBoundary || b.bottomBoundary) return false;
    return true;
  }
}

/**
 * Apply `edits` onto `grid` (assumed freshly generated) so it reproduces the
 * live grid the edits were recorded from, voxel for voxel. Writes through
 * `grid.withoutEditRecording` so replay never re-records itself.
 */
export function replayTerrainEdits(grid: VoxelGrid, edits: TerrainEdits): void {
  grid.withoutEditRecording(() => {
    for (const { x, z, segments } of edits.columns()) {
      for (const seg of segments) {
        for (let y = seg.yLo; y <= seg.yHi; y++) {
          const boundary = y === seg.yLo && seg.bottomBoundary ? seg.bottomBoundary
            : y === seg.yHi && seg.topBoundary ? seg.topBoundary
            : undefined;
          if (boundary) {
            // `boundary.composition` is portable composition data, not a
            // palette index — re-intern it into the TARGET grid's own
            // palette to get a locally valid index before writing dense
            // storage (#1180).
            const localCompId = grid.palette.intern(boundary.composition);
            grid.fillVoxel(x, y, z, localCompId, boundary.ores, boundary.density);
          } else if (seg.kind === 'added') {
            const localCompId = grid.palette.intern(seg.composition!);
            grid.fillVoxel(x, y, z, localCompId, seg.ores);
          } else {
            grid.clearVoxel(x, y, z);
          }
        }
      }
    }
    for (const { x, y, z, modifier } of edits.fractureEntries()) {
      grid.setFractureAt(x, y, z, modifier);
    }
  });
}
