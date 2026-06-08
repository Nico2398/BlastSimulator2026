// BlastSimulator2026 — Rigid-body and parabolic-fallback fragment physics simulation
// Extracted from FragmentSim.ts to keep that file under 300 lines.
// Part of Chapter 5 (Blast Full Pipeline)

import { length } from '../core/math/Vec3.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { TerrainBody, findSurfaceY } from './TerrainBody.js';
import { FragmentBody } from './FragmentBody.js';
import type { RockFragment } from './FragmentSim.js';
import type { VoxelGrid } from '../core/world/VoxelGrid.js';
import {
  PHYSICS_FRAGMENT_CAP,
  PHYSICS_STEP_DT,
  PHYSICS_MAX_STEPS,
  PHYSICS_TERRAIN_CLEARANCE,
  GRAVITY,
  SLEEP_VELOCITY_THRESHOLD,
  SLEEP_TICKS_REQUIRED,
} from '../core/config/balance.js';
import { isFragmentValidForPhysics } from './FragmentSimUtils.js';
import type { SupportGraph } from './FragmentSimUtils.js';

/**
 * Run Tier A physics simulation on all fragments with simulationTier === 'projected'.
 * Implements PHYSICS_FRAGMENT_CAP:
 *   - First N get full Cannon-es rigid-body simulation with terrain collision.
 *   - Remaining use kinematic parabolic fallback (analytical trajectory).
 * All processed fragments end with state='static' and updated (cx,cy,cz).
 * Fragments with simulationTier !== 'projected' are returned unchanged.
 */
export function simulateProjectedFragments(
  _fragments: RockFragment[],
  _grid: VoxelGrid,
): RockFragment[] {
  if (_fragments.length === 0) return _fragments;

  // Only process 'projected' fragments
  const projected = _fragments.filter(f => f.simulationTier === 'projected');

  // Split projected at PHYSICS_FRAGMENT_CAP
  const rigidFragments = projected.slice(0, PHYSICS_FRAGMENT_CAP);
  const fallbackFragments = projected.slice(PHYSICS_FRAGMENT_CAP);

  // Simulate
  simulateRigidBodies(rigidFragments, _grid);
  simulateParabolicFallback(fallbackFragments, _grid);

  // Set state = 'static' on all projected fragments
  for (const frag of projected) {
    frag.state = 'static';
  }

  return _fragments;
}

// ─── Private Helpers ───────────────────────────────────────────────────────────

/**
 * Run full Cannon-es rigid-body simulation for the given fragments.
 * Creates a PhysicsWorld, adds terrain and fragment bodies, steps until settled,
 * then reads final positions back into fragment (cx, cy, cz).
 */
function simulateRigidBodies(fragments: RockFragment[], grid: VoxelGrid): void {
  if (fragments.length === 0) return;

  const world = new PhysicsWorld();
  world.init();

  const terrain = new TerrainBody(world);
  terrain.build(grid);

  const bodyManager = new FragmentBody(world);
  bodyManager.addRockFragments(fragments.filter(isFragmentValidForPhysics));

  // Run simulation (FragmentBody.simulate handles stepping and settle detection internally)
  if (bodyManager.bodyCount > 0) {
    bodyManager.simulate();
  }

  // Read final positions back into fragments
  const results = bodyManager.getResults();
  const posMap = new Map(results.map(r => [r.fragmentId, r.finalPosition]));
  for (const frag of fragments) {
    const pos = posMap.get(frag.id);
    if (pos) {
      frag.cx = pos.x;
      frag.cy = pos.y;
      frag.cz = pos.z;
    }
  }

  bodyManager.dispose();
  terrain.dispose();
  world.clear();
}

/**
 * Kinematic parabolic fallback for fragments beyond PHYSICS_FRAGMENT_CAP.
 * Uses semi-implicit Euler integration with findSurfaceY for ground detection.
 */
function simulateParabolicFallback(fragments: RockFragment[], grid: VoxelGrid): void {
  if (fragments.length === 0) return;

  for (const frag of fragments) {
    if (!isFragmentValidForPhysics(frag)) continue;

    let x = frag.cx;
    let y = frag.cy;
    let z = frag.cz;
    let vx = frag.velocity.x;
    let vy = frag.velocity.y;
    let vz = frag.velocity.z;

    let settled = false;

    for (let step = 0; step < PHYSICS_MAX_STEPS; step++) {
      // Semi-implicit Euler integration
      x += vx * PHYSICS_STEP_DT;
      vy += GRAVITY * PHYSICS_STEP_DT;
      y += vy * PHYSICS_STEP_DT;
      z += vz * PHYSICS_STEP_DT;

      // Ground detection via findSurfaceY
      const terrainY = findSurfaceY(grid, Math.floor(x), Math.floor(z));
      if (terrainY >= 0 && y <= terrainY + PHYSICS_TERRAIN_CLEARANCE) {
        frag.cx = x;
        frag.cy = terrainY + PHYSICS_TERRAIN_CLEARANCE;
        frag.cz = z;
        settled = true;
        break;
      }
    }

    // If never settled, use last computed position
    if (!settled) {
      frag.cx = x;
      frag.cy = y;
      frag.cz = z;
    }
  }
}

// ─── Tier B: Collapse Fragments ───────────────────────────────────────────

/**
 * Run Tier B collapse simulation on all fragments with simulationTier === 'collapse'.
 * Straight-down gravity drop via semi-implicit Euler integration:
 *   vy += GRAVITY * dt  each step
 *   y   += vy * dt      each step
 * Terrain detection via findSurfaceY().
 * Once settled on terrain → state = 'static' (no Cannon-es involvement).
 * Collapse fragments have no cap — all processed, CPU-free (pure arithmetic).
 * Non-collapse fragments are returned unchanged.
 */
export function simulateCollapseFragments(
  _fragments: RockFragment[],
  _grid: VoxelGrid,
): RockFragment[] {
  if (_fragments.length === 0) return _fragments;

  // Only process 'collapse' fragments
  const collapseFrags = _fragments.filter(f => f.simulationTier === 'collapse');

  for (const frag of collapseFrags) {
    if (!isFragmentValidForPhysics(frag)) {
      // Skip simulation but still mark as static
      frag.state = 'static';
      continue;
    }

    let y = frag.cy;
    let vy = frag.velocity.y;
    let settled = false;

    // Collapse fragments have no horizontal motion, so look up terrain column once
    const terrainY = findSurfaceY(_grid, Math.floor(frag.cx), Math.floor(frag.cz));

    // Semi-implicit Euler integration, vertical only
    for (let step = 0; step < PHYSICS_MAX_STEPS; step++) {
      vy += GRAVITY * PHYSICS_STEP_DT;
      y += vy * PHYSICS_STEP_DT;

      // Ground detection — terrain height is computed once (no horizontal movement)
      if (terrainY >= 0 && y <= terrainY + PHYSICS_TERRAIN_CLEARANCE) {
        frag.cy = terrainY + PHYSICS_TERRAIN_CLEARANCE;
        settled = true;
        break;
      }
    }

    if (!settled) {
      // Never reached ground within step limit — use last computed y
      frag.cy = y;
    }

    frag.state = 'static';
  }

  return _fragments;
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
  // TODO: implement
  return { updatedFragments: [...fragments], updatedGraph: { supporting: new Map(), supportedBy: new Map() } };
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
  // TODO: implement
  return { remainingFragments: [...fragments], updatedGraph: { supporting: new Map(), supportedBy: new Map() } };
}

// ─── Sleep Detection ─────────────────────────────────────────────────────────

/**
 * Increment sleepTicks on stationary fragments and transition to 'static' state
 * when sleepTicks reaches SLEEP_TICKS_REQUIRED.
 *
 * For each fragment that is not already 'static':
 *   - If its speed is below SLEEP_VELOCITY_THRESHOLD, sleepTicks advances by tickCount.
 *   - Otherwise, sleepTicks resets to 0.
 * Transitions to 'static' when sleepTicks >= SLEEP_TICKS_REQUIRED.
 *
 * @param fragments - Array of fragments to evaluate (mutated in place).
 * @param tickCount - Number of ticks to advance (must be a finite positive number;
 *                    invalid values (NaN, Infinity, <=0) default to 1).
 * @returns The same array reference for chaining.
 */
export function updateFragmentSleepStates(
  _fragments: RockFragment[],
  _tickCount: number = 1,
): RockFragment[] {
  // Guard: ensure tickCount is a valid positive finite number
  if (!Number.isFinite(_tickCount) || _tickCount <= 0) {
    _tickCount = 1;
  }

  for (const fragment of _fragments) {
    if (fragment.state === 'static') continue;

    const speed = length(fragment.velocity);

    if (speed < SLEEP_VELOCITY_THRESHOLD) {
      fragment.sleepTicks += _tickCount;
      if (fragment.sleepTicks >= SLEEP_TICKS_REQUIRED) {
        fragment.state = 'static';
      }
    } else {
      fragment.sleepTicks = 0;
    }
  }

  return _fragments;
}
