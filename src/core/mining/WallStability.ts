// BlastSimulator2026 — Wall stability / slump (#1941)
// Post-blast pass: faces taller than their rock's safe height slump into the pit.
// Skeleton: signatures only.

import type { VoxelGrid } from '../world/VoxelGrid.js';
import type { BlastRegion } from './BlastExecution.js';

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
  /** Column keys ("x,z") that received fill at the toe. */
  toeColumns: string[];
  /** Voxel-space footprint touched by the slump. */
  region: BlastRegion;
}

/** Faces within `region` taller than their safe height. */
export function findOverheightFaces(grid: VoxelGrid, region: BlastRegion): WallFace[] {
  void grid; void region;
  return []; // TODO: implement
}

/** Remove material above the safe height near the crest and deposit it at the toe. Null when nothing moves. */
export function applySlump(grid: VoxelGrid, face: WallFace): SlumpReport | null {
  void grid; void face;
  return null; // TODO: implement
}

/** Find and slump every overheight face around a blast's cleared region. */
export function runWallStability(grid: VoxelGrid, clearedRegion: BlastRegion): SlumpReport[] {
  void grid; void clearedRegion;
  return []; // TODO: implement
}
