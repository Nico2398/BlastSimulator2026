// Shared fixtures for the survey-coverage UI tests (#1960): a solid ore-bearing
// grid, a charged hole that breaks rock in it, and surveys covering a column range.

import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { addHole } from '../../src/core/mining/DrillPlan.js';
import { createCharge } from '../../src/core/mining/ChargePlan.js';
import type { GameState } from '../../src/core/state/GameState.js';
import type { SurveyResult } from '../../src/core/mining/SurveyCalc.js';

export const SURFACE_Y = 24;

export function makeOreGrid(): VoxelGrid {
  const grid = new VoxelGrid(40, 40);
  for (let z = 6; z <= 34; z++) {
    for (let y = 0; y <= SURFACE_Y; y++) {
      for (let x = 6; x <= 34; x++) {
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId: 'molite', coefficient: 1.0 }] },
          density: 1.0,
          oreDensities: { blingite: 0.9 },
          fractureModifier: 1.0,
        });
      }
    }
  }
  return grid;
}

/** Survey covering columns min..max on both axes with a flat blingite reading down the window. */
export function makeCoverageSurvey(min: number, max: number, id = 1): SurveyResult {
  const estimates: Record<string, Record<string, number>> = {};
  const depthProfile: Record<string, Array<{ fromM: number; toM: number; ores: Record<string, number> }>> = {};
  const surfaceYs: Record<string, number> = {};
  for (let x = min; x <= max; x++) {
    for (let z = 0; z <= 39; z++) {
      const key = `${x},${z}`;
      estimates[key] = { blingite: 0.2 };
      depthProfile[key] = [{ fromM: 0, toM: 25, ores: { blingite: 0.2 } }];
      surfaceYs[key] = SURFACE_Y;
    }
  }
  return {
    id, method: 'seismic', centerX: 20, centerZ: 20, completedTick: 10, surveyorId: 1,
    estimates, depthProfile, surfaceYs, confidence: 1.0,
  } as SurveyResult;
}

/** Two charged holes 16 m apart (x = 12 and x = 28), so a survey over x <= 20 covers about half the blast. */
export function addChargedPattern(state: GameState, counter: { nextHoleId: number }): void {
  for (const x of [12, 28]) {
    const hole = addHole(counter, state.drillHoles, x, 20, 8, 0.15);
    const res = createCharge('krackle', 8, 2, hole.depth);
    if ('charge' in res) state.chargesByHole[hole.id] = res.charge;
  }
}
