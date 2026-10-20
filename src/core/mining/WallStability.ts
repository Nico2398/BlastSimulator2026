// BlastSimulator2026 — Wall stability / slump (#1941)
// Post-blast pass: faces taller than their rock's safe height slump into the pit.
// A face is a continuous strict drop between neighbouring columns along one axis
// direction; a flat step of WALL_BERM_MIN_WIDTH_M columns (a berm) ends it.
// Deterministic: sorted face order, no randomness, one pass without cascade.

import type { VoxelGrid } from '../world/VoxelGrid.js';
import { computeVoxelColumnSurfaceY, SURFACE_BAND_HALF } from '../world/VoxelGrid.js';
import { getSafeFaceHeightM } from '../world/RockCatalog.js';
import type { BlastRegion } from './BlastExecution.js';
import type { BlastPlan } from './BlastPlan.js';
import {
  WALL_SAFE_FACE_HEIGHT_M_BY_TIER,
  WALL_BERM_MIN_WIDTH_M,
  WALL_SLUMP_DEPTH_M,
  WALL_STABILITY_REGION_MARGIN_M,
  WALL_SLUMP_PILE_MAX_HEIGHT_M,
  WALL_SLUMP_PILE_SEARCH_RADIUS_M,
  WALL_SLOPE_WALK_MAX_M,
} from '../config/balance.js';

/** A continuous drop between neighbouring columns, ended by a berm. */
export interface WallFace {
  crest: { x: number; z: number };
  /** Unit horizontal direction from crest toward the toe. */
  dir: { dx: number; dz: number };
  crestY: number;
  toeY: number;
  heightM: number;
  /** Safe height of the weakest rock along the face. */
  safeM: number;
}

/** What one slump moved. */
export interface SlumpReport {
  crest: { x: number; z: number };
  toe: { x: number; z: number };
  volumeM3: number;
  /** Floor height (top voxel row) of the toe the spill landed on. */
  toeY: number;
  /** Columns that received fill at the toe. */
  toeColumns: Array<{ x: number; z: number }>;
  /** Voxel-space footprint touched by the slump. */
  region: BlastRegion;
  /** Voxel rows touched, for the terrain:updated region. */
  minY: number;
  maxY: number;
}

/**
 * Read-only terrain view the face scan walks. The built grid and a predicted post-blast
 * surface both satisfy it, so the scan serves the slump pass and the preview alike.
 */
export interface WallSurface {
  /** Top voxel row of the column, or null outside the grid. */
  topAt(x: number, z: number): number | null;
  /** Dominant rock id of a voxel ('' when empty). */
  rockAt(x: number, y: number, z: number): string;
}

/** WallSurface over a built grid. */
export function gridSurface(_grid: VoxelGrid): WallSurface {
  return undefined as unknown as WallSurface; // TODO: implement
}

/** A face the preview predicts, with the rock that limits it and its height over safe height. */
export interface PredictedFace {
  face: WallFace;
  /** Rock id of the weakest wall voxel. */
  rockId: string;
  /** face.heightM / face.safeM. */
  ratio: number;
}

/** Faces within `region` whose height is at least `minRatio` of their safe height (default WALL_WARN_RATIO). */
export function findFacesAtRisk(_surface: WallSurface, _region: BlastRegion, _minRatio?: number): PredictedFace[] {
  return []; // TODO: implement
}

/** Faces the armed plan would leave at or over the warning ratio once it fires. */
export function predictWallFaces(_plan: BlastPlan, _grid: VoxelGrid, _wetHoleIds?: ReadonlySet<string>): PredictedFace[] {
  return []; // TODO: implement
}

const DIRECTIONS: ReadonlyArray<{ dx: number; dz: number }> = [
  { dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 },
];
const SOFTEST_SAFE_M = Math.min(...Object.values(WALL_SAFE_FACE_HEIGHT_M_BY_TIER));

function topAt(grid: VoxelGrid, x: number, z: number): number | null {
  return grid.containsColumn(x, z) ? computeVoxelColumnSurfaceY(grid, x, z) : null;
}

/** Safe height of the weakest rock among the wall voxels of columns `cols` (rows toeY+1..top). */
function weakestSafeM(grid: VoxelGrid, cols: ReadonlyArray<{ x: number; z: number; top: number }>, toeY: number): number {
  let safe = Infinity;
  for (const { x, z, top } of cols) {
    for (let y = toeY + 1; y <= top; y++) {
      const rockId = grid.dominantRockAt(x, y, z);
      if (rockId === '') continue;
      safe = Math.min(safe, getSafeFaceHeightM(rockId));
      if (safe <= SOFTEST_SAFE_M) return safe;
    }
  }
  return Number.isFinite(safe) ? safe : getSafeFaceHeightM('');
}

/** Faces within `region` (grown by the scan margin) taller than their safe height. */
export function findOverheightFaces(grid: VoxelGrid, region: BlastRegion): WallFace[] {
  if (region.maxX < region.minX || region.maxZ < region.minZ) return [];
  const m = WALL_STABILITY_REGION_MARGIN_M;
  const minX = region.minX - m, maxX = region.maxX + m, minZ = region.minZ - m, maxZ = region.maxZ + m;
  const faces: WallFace[] = [];
  // Column tops of the scanned window, read once for all four directions.
  const width = maxX - minX + 1;
  const tops: Array<number | null> = [];
  for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) tops.push(topAt(grid, x, z));

  for (const { dx, dz } of DIRECTIONS) {
    // One scan line per row (dx != 0) or column (dz != 0), walked crest-to-toe.
    const lineStarts: Array<{ x: number; z: number }> = [];
    if (dx !== 0) for (let z = minZ; z <= maxZ; z++) lineStarts.push({ x: dx > 0 ? minX : maxX, z });
    else for (let x = minX; x <= maxX; x++) lineStarts.push({ x, z: dz > 0 ? minZ : maxZ });
    const steps = dx !== 0 ? maxX - minX + 1 : maxZ - minZ + 1;

    for (const start of lineStarts) {
      const cols: Array<{ x: number; z: number; top: number } | null> = [];
      for (let i = 0; i < steps; i++) {
        const x = start.x + dx * i, z = start.z + dz * i;
        const top = tops[(z - minZ) * width + (x - minX)] ?? null;
        cols.push(top === null ? null : { x, z, top });
      }
      let crestIdx = -1; // active face's crest, -1 when none
      let landIdx = -1; // column where the face last dropped to
      let flat = 0; // columns at the landing height so far
      const close = (): void => {
        if (crestIdx >= 0 && landIdx > crestIdx) {
          const crest = cols[crestIdx]!, toe = cols[landIdx]!;
          const heightM = crest.top - toe.top;
          if (heightM > SOFTEST_SAFE_M) {
            const safeM = weakestSafeM(grid, cols.slice(crestIdx, landIdx).filter(c => c !== null), toe.top);
            if (heightM > safeM) {
              faces.push({ crest: { x: crest.x, z: crest.z }, dir: { dx, dz }, crestY: crest.top, toeY: toe.top, heightM, safeM });
            }
          }
        }
        crestIdx = -1; landIdx = -1; flat = 0;
      };
      for (let i = 0; i + 1 < steps; i++) {
        const a = cols[i], b = cols[i + 1];
        if (!a || !b) { close(); continue; }
        if (b.top < a.top) {
          if (crestIdx < 0) crestIdx = i;
          landIdx = i + 1; flat = 1;
        } else if (b.top === a.top && crestIdx >= 0) {
          flat++;
          if (flat >= WALL_BERM_MIN_WIDTH_M) close();
        } else if (b.top > a.top) {
          close();
        }
      }
      close();
    }
  }
  return faces.sort((p, q) =>
    p.crest.x - q.crest.x || p.crest.z - q.crest.z || p.dir.dx - q.dir.dx || p.dir.dz - q.dir.dz);
}

interface Removed { compId: number; ores: Record<string, number> | undefined }

/** Remove material above `cutY` from the column; returns the solid voxels taken, bottom-up. */
function takeAbove(grid: VoxelGrid, x: number, z: number, cutY: number, taken: Removed[]): { minY: number; maxY: number } | null {
  const top = topAt(grid, x, z);
  if (top === null || top <= cutY) return null;
  for (let y = cutY + 1; y <= top; y++) {
    taken.push({ compId: grid.palette.intern(grid.compositionAt(x, y, z)), ores: grid.oresAt(x, y, z) });
  }
  for (let y = cutY + 1; y <= top + SURFACE_BAND_HALF; y++) grid.clearVoxel(x, y, z);
  return { minY: cutY + 1, maxY: top + SURFACE_BAND_HALF };
}

/** Floor columns around the toe that can take spill, nearest first (ties by x then z). */
function pileColumns(grid: VoxelGrid, toe: { x: number; z: number }, toeY: number): Array<{ x: number; z: number; top: number; d: number }> {
  const r = WALL_SLUMP_PILE_SEARCH_RADIUS_M;
  const out: Array<{ x: number; z: number; top: number; d: number }> = [];
  for (let x = toe.x - r; x <= toe.x + r; x++) {
    for (let z = toe.z - r; z <= toe.z + r; z++) {
      const top = topAt(grid, x, z);
      const isToe = x === toe.x && z === toe.z;
      if (top === null || top < toeY || (isToe ? top >= toeY + WALL_SLUMP_PILE_MAX_HEIGHT_M : top !== toeY)) continue;
      out.push({ x, z, top, d: isToe ? -1 : Math.max(Math.abs(x - toe.x), Math.abs(z - toe.z)) });
    }
  }
  out.sort((p, q) => p.d - q.d || p.x - q.x || p.z - q.z);
  return out;
}

/** Stack `count` removed voxels on a column, solid up to the new flat top. */
function stack(grid: VoxelGrid, x: number, z: number, top: number, voxels: Removed[]): number {
  // The old surface voxel may be a partial-density band; make it whole beneath the new fill.
  const below = grid.palette.intern(grid.compositionAt(x, top, z));
  grid.fillVoxel(x, top, z, below, grid.oresAt(x, top, z), 1);
  voxels.forEach((v, i) => grid.fillVoxel(x, top + 1 + i, z, v.compId, v.ores, 1));
  return top + voxels.length;
}

/** Remove material above the safe height near the crest and deposit it at the toe. Null when nothing moves. */
export function applySlump(grid: VoxelGrid, face: WallFace): SlumpReport | null {
  const { dx, dz } = face.dir;
  const cutY = face.toeY + Math.floor(face.safeM);
  const taken: Removed[] = [];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  const touch = (x: number, z: number, y0: number, y1: number): void => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    minY = Math.min(minY, y0); maxY = Math.max(maxY, y1);
  };

  // Columns from the depth behind the crest down the slope to the toe.
  let toe = { x: face.crest.x, z: face.crest.z };
  const path: Array<{ x: number; z: number }> = [];
  for (let k = WALL_SLUMP_DEPTH_M - 1; k >= 1; k--) path.push({ x: face.crest.x - dx * k, z: face.crest.z - dz * k });
  for (let k = 0; k < WALL_SLOPE_WALK_MAX_M; k++) {
    const x = face.crest.x + dx * k, z = face.crest.z + dz * k;
    const top = topAt(grid, x, z);
    if (top === null) break;
    if (k > 0 && top <= face.toeY) { toe = { x, z }; break; }
    path.push({ x, z });
  }
  if (toe.x === face.crest.x && toe.z === face.crest.z) return null;

  for (const c of path) {
    const span = takeAbove(grid, c.x, c.z, cutY, taken);
    if (!span) continue;
    touch(c.x, c.z, span.minY, span.maxY);
  }
  if (taken.length === 0) return null;

  // The cut face is whole rock (density 1) and the piles end in whole voxels: no band regrade needed.
  const toeColumns: Array<{ x: number; z: number }> = [];
  let rest = taken;
  const candidates = pileColumns(grid, toe, face.toeY);
  if (candidates.length === 0 || candidates[0]!.d !== -1) {
    candidates.unshift({ x: toe.x, z: toe.z, top: topAt(grid, toe.x, toe.z) ?? face.toeY, d: -1 });
  }
  for (const col of candidates) {
    if (rest.length === 0) break;
    const room = Math.max(1, face.toeY + WALL_SLUMP_PILE_MAX_HEIGHT_M - col.top);
    const batch = rest.slice(0, room);
    rest = rest.slice(room);
    const newTop = stack(grid, col.x, col.z, col.top, batch);
    toeColumns.push({ x: col.x, z: col.z });
    touch(col.x, col.z, col.top, newTop + SURFACE_BAND_HALF);
  }
  if (rest.length > 0) { // no floor left: never lose volume, stack the remainder on the toe
    const top = topAt(grid, toe.x, toe.z) ?? face.toeY;
    const newTop = stack(grid, toe.x, toe.z, top, rest);
    touch(toe.x, toe.z, top, newTop + SURFACE_BAND_HALF);
  }

  return {
    crest: { ...face.crest },
    toe,
    volumeM3: taken.length,
    toeY: face.toeY,
    toeColumns,
    region: { minX, maxX, minZ, maxZ },
    minY,
    maxY,
  };
}

/** Find and slump every overheight face around a blast's cleared region. */
export function runWallStability(grid: VoxelGrid, clearedRegion: BlastRegion): SlumpReport[] {
  const reports: SlumpReport[] = [];
  for (const face of findOverheightFaces(grid, clearedRegion)) {
    const report = applySlump(grid, face);
    if (report) reports.push(report);
  }
  return reports;
}
