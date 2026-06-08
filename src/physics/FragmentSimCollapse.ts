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

  // BFS to find all transitively supported fragments
  const affectedIds = new Set<number>(_fragmentIds);
  const queue = [..._fragmentIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const supported = _graph.supporting.get(id) ?? [];
    for (const supportedId of supported) {
      if (!affectedIds.has(supportedId)) {
        affectedIds.add(supportedId);
        queue.push(supportedId);
      }
    }
  }

  // Build quick lookup map
  const fragMap = new Map<number, RockFragment>();
  for (const frag of fragments) {
    fragMap.set(frag.id, frag);
  }

  // Get the dropping fragments (affected but NOT removed)
  const droppingIds = [...affectedIds].filter(id => !removedIds.has(id));
  // Sort by cy ascending (lowest first) for stable settling
  const sortedDropping = droppingIds
    .map(id => fragMap.get(id)!)
    .filter(f => f !== undefined)
    .sort((a, b) => a.cy - b.cy);

  const STACK_EPSILON = 0.001;
  const otherFragments = fragments.filter(f => !removedIds.has(f.id));

  // Perform gravity drop for each dropping fragment
  for (const frag of sortedDropping) {
    if (!isFragmentValidForPhysics(frag)) {
      frag.state = 'static';
      continue;
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
      const terrainY = findSurfaceY(_grid, Math.floor(frag.cx), Math.floor(frag.cz));
      if (terrainY >= 0 && bottomY <= terrainY + PHYSICS_TERRAIN_CLEARANCE) {
        frag.cy = terrainY + PHYSICS_TERRAIN_CLEARANCE + halfHeight;
        settled = true;
        break;
      }

      // b) Check other fragments below — use current simulated y, not original frag.cy
      for (const other of otherFragments) {
        if (other.id === frag.id) continue;
        if (removedIds.has(other.id)) continue;
        if (other.state !== 'static') continue;
        // Only consider fragments that are below the dropping one (using current y)
        if (other.cy >= y) continue;

        const otherAabb = computeFragmentAABB(other);
        const { overlapArea, minArea } = computeXZOverlap(fragAabb, otherAabb);
        if (!horizontalOverlap(overlapArea, minArea, _horizontalTolerance)) continue;

        const otherHalfHeight = (otherAabb.maxY - otherAabb.minY) / 2;
        const otherTopY = other.cy + otherHalfHeight;

        if (bottomY <= otherTopY + STACK_EPSILON) {
          // Land on this fragment's top
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

  // Rebuild support graph from the updated other fragments (including those that just settled)
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
