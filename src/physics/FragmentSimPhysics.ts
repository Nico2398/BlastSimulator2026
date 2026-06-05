// BlastSimulator2026 — Rigid-body and parabolic-fallback fragment physics simulation
// Extracted from FragmentSim.ts to keep that file under 300 lines.
// Part of Chapter 5 (Blast Full Pipeline)

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
} from '../core/config/balance.js';
import { isFragmentValidForPhysics } from './FragmentSimUtils.js';

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
