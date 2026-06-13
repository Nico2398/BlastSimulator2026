// BlastSimulator2026 — Tutorial survey verification (Issue #327)
// Verifies that the tutorial terrain (seed 42, desert, 24×12×24) produces
// ore-bearing voxels near (10,10) and that a seismic survey detects them.

import { describe, it, expect } from 'vitest';
import { generateTerrain } from '../../../src/core/world/TerrainGen.js';
import { getMinePreset } from '../../../src/core/world/MineType.js';
import {
  estimateSurveyResult,
  type EstimateSurveyParams,
} from '../../../src/core/mining/SurveyCalc.js';
import { Random } from '../../../src/core/math/Random.js';

describe('Tutorial survey verification (Issue #327)', () => {
  it('tutorial terrain (seed 42, desert, 24×12×24) has ore-bearing columns near (10,10)', () => {
    const preset = getMinePreset('desert');
    expect(preset).toBeDefined();

    const terrain = generateTerrain({
      sizeX: 24,
      sizeY: 12,
      sizeZ: 24,
      seed: 42,
      preset: preset!,
    });

    // Count how many columns within a 5×5 grid centred on (10,10) contain
    // at least one voxel with a non-empty oreDensities map.
    let oreColumns = 0;
    for (let x = 8; x <= 12; x++) {
      for (let z = 8; z <= 12; z++) {
        for (let y = 0; y < terrain.sizeY; y++) {
          const voxel = terrain.getVoxel(x, y, z);
          if (voxel && Object.keys(voxel.oreDensities).length > 0) {
            oreColumns++;
            break; // one ore-bearing voxel is enough for this column
          }
        }
      }
    }

    expect(oreColumns).toBeGreaterThanOrEqual(1);
  });

  it('seismic survey at (10,10) on tutorial terrain returns non-empty estimates', () => {
    const preset = getMinePreset('desert');
    expect(preset).toBeDefined();

    const terrain = generateTerrain({
      sizeX: 24,
      sizeY: 12,
      sizeZ: 24,
      seed: 42,
      preset: preset!,
    });

    const params: EstimateSurveyParams = {
      id: 1,
      method: 'seismic',
      centerX: 10,
      centerZ: 10,
      surveyorId: 1,
      skillLevel: 3,
      completedTick: 100,
    };

    const surveyRng = new Random(42);
    const result = estimateSurveyResult(terrain, params, surveyRng);

    // The result must contain at least one column estimate with ore data
    const columnKeys = Object.keys(result.estimates);
    expect(columnKeys.length).toBeGreaterThanOrEqual(1);

    // Every column estimate should contain at least one ore type
    for (const key of columnKeys) {
      const oreKeys = Object.keys(result.estimates[key]!);
      expect(oreKeys.length).toBeGreaterThanOrEqual(1);
    }
  });
});
