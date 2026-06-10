// BlastSimulator2026 — Integration tests: Survey system (Phase 4)
// Covers seismic, core_sample, and aerial survey methods, estimation accuracy, and stale surveys.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { Random } from '../../src/core/math/Random.js';
import {
  estimateSurveyResult,
  isSurveyStale,
  type SurveyResult,
  type SurveyMethod,
  type EstimateSurveyParams,
} from '../../src/core/mining/SurveyCalc.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Build a fresh context with a real GameState (seed=42, desert biome). */
function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

/**
 * Build a small test grid with known ore at a specific column.
 * 11×11×11 grid, with gold=0.5 at (5, *, 5) from y=2..8.
 */
function makeOreGrid(): VoxelGrid {
  const grid = new VoxelGrid(11, 11, 11);
  for (let y = 2; y <= 8; y++) {
    grid.setVoxel(5, y, 5, {
      composition: { rocks: [{ rockId: 'granite', coefficient: 1.0 }] },
      density: 1,
      oreDensities: { gold: 0.5 },
      fractureModifier: 1.0,
    });
  }
  return grid;
}

/**
 * Run a survey against a VoxelGrid and return the SurveyResult.
 */
function runSurvey(
  grid: VoxelGrid,
  method: SurveyMethod,
  centerX: number,
  centerZ: number,
  skillLevel = 1,
  surveyorId = 99,
  id = 1,
  completedTick = 50,
  seed = 12345,
): SurveyResult {
  const params: EstimateSurveyParams = {
    id,
    method,
    centerX,
    centerZ,
    surveyorId,
    skillLevel,
    completedTick,
  };
  return estimateSurveyResult(grid, params, new Random(seed));
}

// ── Survey system ────────────────────────────────────────────────────────────

describe('Survey system', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  it('core_sample survey returns a single-column estimate at the centre', () => {
    // TODO: implement
  });

  it('seismic survey returns estimates across a radius of columns', () => {
    // TODO: implement
  });

  it('aerial survey returns estimates across the largest radius', () => {
    // TODO: implement
  });

  it('higher skill level produces higher confidence', () => {
    // TODO: implement
  });

  it('confidence is always between 0 and 1', () => {
    // TODO: implement
  });

  it('isSurveyStale returns true when elapsed ticks exceed SURVEY_STALE_TICKS', () => {
    // TODO: implement
  });

  it('isSurveyStale returns false when elapsed ticks are within the stale threshold', () => {
    // TODO: implement
  });

  it('survey on a column with no ore produces zero-density estimates', () => {
    // TODO: implement
  });

  it('survey cost is deducted from cash', () => {
    // TODO: implement
  });

  it('survey result is persisted on GameState.surveyResults', () => {
    // TODO: implement
  });
});
