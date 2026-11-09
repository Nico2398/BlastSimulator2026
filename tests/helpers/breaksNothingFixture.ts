// BlastSimulator2026 — Shared fixture for the "breaks nothing" warning tests (#2197).
// A block of titanite (the hardest rock) shot with the minimum Pop-Rock charge, the weakest
// explosive in the catalog: no voxel receives enough energy to break.

import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { createGame } from '../../src/core/state/GameState.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { createGridPlan } from '../../src/core/mining/DrillPlan.js';
import { batchCharge } from '../../src/core/mining/ChargePlan.js';
import { assembleBlastPlan } from '../../src/core/mining/BlastPlan.js';
import type { BlastPlan } from '../../src/core/mining/BlastPlan.js';

/** A 40x40 site with a 31x11x31 block of one rock, surface at y = 10. */
export function rockBlockGrid(rockId: string): VoxelGrid {
  const grid = new VoxelGrid(40, 40);
  for (let z = 5; z <= 35; z++) for (let y = 0; y <= 10; y++) for (let x = 5; x <= 35; x++) {
    grid.setVoxel(x, y, z, {
      composition: { rocks: [{ rockId, coefficient: 1.0 }] },
      density: 1.0,
      oreDensities: {},
      fractureModifier: 1.0,
    });
  }
  return grid;
}

/** A 3x3 pattern at (12,12), 4 m spacing, charged with `kg` of `explosive`. */
export function blockShot(explosive: string, kg: number, depth = 8) {
  const holes = createGridPlan({ nextHoleId: 1 }, { x: 12, z: 12 }, 3, 3, 4, depth, 0.089);
  const depths: Record<string, number> = {};
  const diameters: Record<string, number> = {};
  for (const h of holes) { depths[h.id] = h.depth; diameters[h.id] = h.diameter; }
  const { charges, errors } = batchCharge(holes.map(h => h.id), depths, explosive, kg, 2.5, diameters);
  if (errors.length > 0) throw new Error(`charge refused: ${JSON.stringify(errors)}`);
  return { holes, charges, plan: assembleBlastPlan(holes, charges) as BlastPlan };
}

/** Hard rock under a minimum Pop-Rock charge: the shot breaks nothing. */
export function nothingBreaksGrid(): VoxelGrid {
  return rockBlockGrid('titanite');
}

/** A fresh game state holding the nothing-breaks pattern. */
export function nothingBreaksState(): GameState {
  const { holes, charges } = blockShot('pop_rock', 0.5);
  const state = createGame({ seed: 1, mineType: 'desert' });
  state.drillHoles.push(...holes);
  Object.assign(state.chargesByHole, charges);
  return state;
}
