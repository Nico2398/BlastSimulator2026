// BlastSimulator2026 — Shared fixture for the wall-warning prediction tests (#1943).
// A plateau of height `plateauTop` for x <= `plateauEdgeX` beside a 20 m bench; a 3x3 krackle shot
// at (16,16) digs a crater floored at 12 m, so the plateau wall that results is plateauTop - 12 tall.

import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { createGame } from '../../src/core/state/GameState.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { createGridPlan } from '../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../src/core/mining/ChargePlan.js';
import { assembleBlastPlan } from '../../src/core/mining/BlastPlan.js';
import type { BlastPlan } from '../../src/core/mining/BlastPlan.js';
import { createGradeState } from '../../src/core/economy/MineGrade.js';

export const GRID_SIZE = 40;
export const BENCH_TOP = 20;

export interface WallGridOpts {
  plateauTop: number;
  plateauEdgeX?: number;
  /** Rock by voxel row; default one rock throughout. */
  rock?: string | ((y: number) => string);
}

export function buildWallGrid({ plateauTop, plateauEdgeX = 13, rock = 'cruite' }: WallGridOpts): VoxelGrid {
  const grid = new VoxelGrid(GRID_SIZE, GRID_SIZE);
  for (let z = 0; z < GRID_SIZE; z++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const top = x <= plateauEdgeX ? plateauTop : BENCH_TOP;
      for (let y = 0; y <= top; y++) {
        const rockId = typeof rock === 'string' ? rock : rock(y);
        grid.setVoxel(x, y, z, { composition: { rocks: [{ rockId, coefficient: 1 }] }, density: 1, oreDensities: {}, fractureModifier: 1 });
      }
    }
  }
  return grid;
}

export interface ShotPlan { plan: BlastPlan; state: GameState; holeIds: string[] }

/** The 3x3 shot, 8 m holes, 4 m spacing from (16,16). Also written into a fresh game state. */
export function standardShot(explosive = 'krackle', amountKg = 8, progression = true): ShotPlan {
  const counter = { nextHoleId: 1 };
  const holes = createGridPlan(counter, { x: 16, z: 16 }, 3, 3, 4, 8, 0.089);
  const depths: Record<string, number> = {};
  for (const h of holes) depths[h.id] = h.depth;
  const { charges } = batchCharge(holes.map(h => h.id), depths, explosive, amountKg, 2.5);
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.drillHoles.push(...holes);
  Object.assign(state.chargesByHole, charges);
  if (progression) state.grade = createGradeState();
  return { plan: assembleBlastPlan(holes, charges), state, holeIds: holes.map(h => h.id) };
}
