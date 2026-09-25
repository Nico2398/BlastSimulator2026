// BlastSimulator2026 — recorded terrain edits (#1180)
// A compact, replayable log of every dig/add/fracture change made to a
// VoxelGrid's generated baseline. Replaying this log onto a freshly
// generated grid reproduces the live grid voxel for voxel, without saving
// every voxel's full state.

import type { VoxelGrid } from './VoxelGrid';

export type EditKind = 'dug' | 'added';

/** Exact voxel state at a segment's boundary row, when the edit's true bound
 *  falls mid-voxel there. Stored verbatim (not re-derived from a formula at
 *  replay time) because which compId/ores a boundary row carries varies by
 *  call site. */
export interface EditBoundary {
  density: number;
  compId: number;
  ores?: Record<string, number>;
}

export interface EditSegment {
  yLo: number;  // inclusive voxel row
  yHi: number;  // inclusive voxel row
  kind: EditKind;
  compId?: number;   // 'added' only — material for every fully-covered interior/boundary row without its own override
  ores?: Record<string, number>;
  bottomBoundary?: EditBoundary;  // present only when yLo's true edge is fractional
  topBoundary?: EditBoundary;     // present only when yHi's true edge is fractional
}

/**
 * Per-column log of dig/add edits plus a sparse per-voxel fracture-modifier
 * log, both recorded relative to a grid's generated baseline.
 */
export class TerrainEdits {
  static empty(): TerrainEdits {
    throw new Error('not implemented');
  }

  recordDig(
    _x: number,
    _z: number,
    _yLo: number,
    _yHi: number,
    _bottomBoundary?: EditBoundary,
    _topBoundary?: EditBoundary,
  ): void {
    throw new Error('not implemented');
  }

  recordAdd(
    _x: number,
    _z: number,
    _yLo: number,
    _yHi: number,
    _compId: number,
    _ores?: Record<string, number>,
    _bottomBoundary?: EditBoundary,
    _topBoundary?: EditBoundary,
  ): void {
    throw new Error('not implemented');
  }

  /** `fractureModifier === 1` deletes any existing entry at (x, y, z). */
  recordFracture(_x: number, _y: number, _z: number, _fractureModifier: number): void {
    throw new Error('not implemented');
  }

  /** Bottom-to-top, non-overlapping segments recorded for column (x, z). */
  segmentsAt(_x: number, _z: number): readonly EditSegment[] {
    throw new Error('not implemented');
  }

  fractureAt(_x: number, _y: number, _z: number): number | undefined {
    throw new Error('not implemented');
  }

  columns(): Array<{ x: number; z: number; segments: readonly EditSegment[] }> {
    throw new Error('not implemented');
  }

  fractureEntries(): Array<{ x: number; y: number; z: number; modifier: number }> {
    throw new Error('not implemented');
  }

  isEmpty(): boolean {
    throw new Error('not implemented');
  }
}

/**
 * Apply `edits` onto `grid` (assumed freshly generated) so it reproduces the
 * live grid the edits were recorded from, voxel for voxel. Writes through
 * `grid.withoutEditRecording` so replay never re-records itself.
 */
export function replayTerrainEdits(_grid: VoxelGrid, _edits: TerrainEdits): void {
  throw new Error('not implemented');
}
