// BlastSimulator2026 — Shared fixture for the breakout-warning tests (#2003).
// The real sandbox site (desert_badlands, seed 42) with a 3x3 pattern at (24,32), 4 m spacing and
// 2.5 m stemming, written into a fresh game state: the plan the issue's measurements fired.

import { createRunner } from '../../src/console/createRunner.js';
import { createGame } from '../../src/core/state/GameState.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { createGridPlan } from '../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../src/core/mining/ChargePlan.js';
import type { VoxelGrid } from '../../src/core/world/VoxelGrid.js';

let cached: VoxelGrid | null = null;

/** The sandbox site's ground. Shared and never mutated by the tests that use it (prediction forks it). */
export function sandboxPadGrid(): VoxelGrid {
  if (cached) return cached;
  const { runner, ctx } = createRunner();
  const res = runner.run('sandbox start biome:desert_badlands difficulty:normal seed:42');
  if (!res.success) throw new Error(`sandbox start failed: ${res.output}`);
  cached = ctx.grid!;
  return cached;
}

/** A fresh game state holding the charged 3x3 pattern. */
export function breakoutShotState(depth: number, explosive: string, kg: number, diameter = 0.089): GameState {
  const holes = createGridPlan({ nextHoleId: 1 }, { x: 24, z: 32 }, 3, 3, 4, depth, diameter);
  const depths: Record<string, number> = {};
  const diameters: Record<string, number> = {};
  for (const h of holes) { depths[h.id] = h.depth; diameters[h.id] = h.diameter; }
  const { charges } = batchCharge(holes.map(h => h.id), depths, explosive, kg, 2.5, diameters);
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.drillHoles.push(...holes);
  Object.assign(state.chargesByHole, charges);
  return state;
}
