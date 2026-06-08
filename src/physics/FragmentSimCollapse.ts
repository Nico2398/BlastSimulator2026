// BlastSimulator2026 — Fragment collapse support graph simulation
// Extracted from FragmentSimPhysics.ts to keep that file under 300 lines.
// Part of Tier B (collapse) mechanics: fragments that drop straight down
// when their supporting fragments are removed.

import { findSurfaceY } from './TerrainBody.js';
import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import {
  PHYSICS_MAX_STEPS,
  PHYSICS_TERRAIN_CLEARANCE,
  GRAVITY,
  PHYSICS_STEP_DT,
} from '../core/config/balance.js';
import { isFragmentValidForPhysics } from './FragmentSimUtils.js';
import {
  computeFragmentAABB,
  computeXZOverlap,
  horizontalOverlap,
  buildSupportGraph,
} from './FragmentSupportGraph.js';
import type { SupportGraph } from './FragmentSupportGraph.js';
import type { RockFragment } from './FragmentSim.js';

// ─── Internal Helpers ────────────────────────────────────────────────────────────

/**
 * BFS traversal to find all fragment IDs transitively supported by the given set.
 *
 * Starting from `fragmentIds`, walks the support graph upward to collect every
 * fragment that depends (directly or indirectly) on any of the given fragments.
 *
 * @param fragmentIds - Seed fragment IDs whose dependents are sought.
 * @param graph - The bi-directional support graph.
 * @returns Set containing all directly and transitively supported fragment IDs.
 */
function findTransitivelySupported(
  fragmentIds: number[],
  graph: SupportGraph,
): Set<number> {
  const affectedIds = new Set<number>(fragmentIds);
  const queue = [...fragmentIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const supported = graph.supporting.get(id) ?? [];
    for (const supportedId of supported) {
      if (!affectedIds.has(supportedId)) {
        affectedIds.add(supportedId);
        queue.push(supportedId);
      }
    }
  }
  return affectedIds;
}

/** Small epsilon (metres) added above a landed-on fragment to prevent interpenetration. */
const STACK_EPSILON = 0.001;

/**
 * Simulate a single fragment's vertical gravity drop until it lands on terrain
 * or on top of another static fragment.
 *
 * Uses semi-implicit Euler integration (vertical only). The fragment's `cy` and
 * `state` are updated in-place when settled.
 *
 * @param frag - The fragment to drop (mutated in place).
 * @param otherFragments - All non-removed fragments (some may already be settled).
 * @param removedIds - Set of fragment IDs that were removed (skipped during collision).
 * @param grid - The voxel grid for terrain collision.
 * @param horizontalTolerance - Minimum XZ overlap ratio for stacking (0–1).
 */
function simulateFragmentDrop(
  frag: RockFragment,
  otherFragments: RockFragment[],
  removedIds: Set<number>,
  grid: VoxelGrid,
  horizontalTolerance: number,
): void {
  if (!isFragmentValidForPhysics(frag)) {
    frag.state = 'static';
    return;
  }

  const fragAabb = computeFragmentAABB(frag);
  const halfHeight = (fragAabb.maxY - fragAabb.minY) / 2;

  let y = frag.cy;
  let vy = frag.velocity.y;
  let settled = false;

  for (let step = 0; step < PHYSICS_MAX_STEPS; step++) {
    // Semi-implicit Euler integration (vertical only)
    vy += GRAVITY * PHYSICS_STEP_DT;
    y += vy * PHYSICS_STEP_DT;

    const bottomY = y - halfHeight;

    // a) Check terrain
    const terrainY = findSurfaceY(grid, Math.floor(frag.cx), Math.floor(frag.cz));
    if (terrainY >= 0 && bottomY <= terrainY + PHYSICS_TERRAIN_CLEARANCE) {
      frag.cy = terrainY + PHYSICS_TERRAIN_CLEARANCE + halfHeight;
      settled = true;
      break;
    }

    // b) Check other fragments below
    for (const other of otherFragments) {
      if (other.id === frag.id) continue;
      if (removedIds.has(other.id)) continue;
      if (other.state !== 'static') continue;
      if (other.cy >= y) continue;

      const otherAabb = computeFragmentAABB(other);
      const { overlapArea, minArea } = computeXZOverlap(fragAabb, otherAabb);
      if (!horizontalOverlap(overlapArea, minArea, horizontalTolerance)) continue;

      const otherHalfHeight = (otherAabb.maxY - otherAabb.minY) / 2;
      const otherTopY = other.cy + otherHalfHeight;

      if (bottomY <= otherTopY + STACK_EPSILON) {
        frag.cy = otherTopY + halfHeight + STACK_EPSILON;
        settled = true;
        break;
      }
    }

    if (settled) break;
  }

  if (!settled) {
    frag.cy = y;
  }

  frag.state = 'static';
}

// ─── Fragment Support Graph & Stack-Collapse ─────────────────────────────────────

/**
 * Collapse all fragments supported by (resting on top of) the given fragment IDs.
 *
 * Given a set of fragment IDs being removed/picked up, computes the set of
 * fragments that are directly or transitively supported by them, then marks
 * those fragments for collapse (Tier B simulation). Returns the updated
 * fragment array and a rebuilt support graph.
 *
 * @param fragmentIds - IDs of fragments being removed.
 * @param fragments - Current array of all fragments.
 * @param graph - Current support graph.
 * @param grid - The voxel grid (for terrain collision during collapse).
 * @param horizontalTolerance - Minimum horizontal overlap ratio (0–1).
 * @param maxVerticalGap - Maximum allowed vertical gap (metres).
 * @returns Updated fragments and graph after collapse.
 */
export function collapseSupportedFragments(
  _fragmentIds: number[],
  fragments: RockFragment[],
  _graph: SupportGraph,
  _grid: VoxelGrid,
  _horizontalTolerance: number,
  _maxVerticalGap: number,
): { updatedFragments: RockFragment[]; updatedGraph: SupportGraph } {
  const removedIds = new Set(_fragmentIds);

  // 1) Find all fragments transitively supported by the removed ones
  const affectedIds = findTransitivelySupported(_fragmentIds, _graph);

  // 2) Build quick lookup and determine dropping fragments (affected but NOT removed)
  const fragMap = new Map<number, RockFragment>();
  for (const frag of fragments) {
    fragMap.set(frag.id, frag);
  }

  // Sort by cy ascending (lowest first) so lower fragments settle before upper ones
  const droppingIds = [...affectedIds].filter(id => !removedIds.has(id));
  const sortedDropping = droppingIds
    .map(id => fragMap.get(id)!)
    .filter(f => f !== undefined)
    .sort((a, b) => a.cy - b.cy);

  const otherFragments = fragments.filter(f => !removedIds.has(f.id));

  // 3) Perform gravity drop for each dropping fragment
  for (const frag of sortedDropping) {
    simulateFragmentDrop(frag, otherFragments, removedIds, _grid, _horizontalTolerance);
  }

  // 4) Rebuild support graph from the updated fragments
  const updatedGraph = buildSupportGraph(otherFragments, _horizontalTolerance, _maxVerticalGap);

  return { updatedFragments: otherFragments, updatedGraph };
}

/**
 * Remove a single fragment and collapse any fragments that were depending on it.
 *
 * Removes the specified fragment from the array, identifies all fragments
 * that were directly or transitively supported by it, marks them for collapse,
 * and returns the remaining fragments together with an updated support graph.
 *
 * @param fragmentId - ID of the fragment to remove.
 * @param fragments - Current array of all fragments.
 * @param graph - Current support graph.
 * @param grid - The voxel grid (for terrain collision during collapse).
 * @param horizontalTolerance - Minimum horizontal overlap ratio (0–1).
 * @param maxVerticalGap - Maximum allowed vertical gap (metres).
 * @returns Remaining fragments and updated graph after removal and collapse.
 */
export function removeFragmentWithCollapse(
  _fragmentId: number,
  fragments: RockFragment[],
  _graph: SupportGraph,
  _grid: VoxelGrid,
  _horizontalTolerance: number,
  _maxVerticalGap: number,
): { remainingFragments: RockFragment[]; updatedGraph: SupportGraph } {
  const result = collapseSupportedFragments(
    [_fragmentId],
    fragments,
    _graph,
    _grid,
    _horizontalTolerance,
    _maxVerticalGap,
  );
  return {
    remainingFragments: result.updatedFragments,
    updatedGraph: result.updatedGraph,
  };
}
