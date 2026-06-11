// BlastSimulator2026 — Integration tests: Survey system (Phase 4)
// Covers seismic, core_sample, and aerial survey methods, estimation accuracy,
// stale surveys, console command pipeline, and post-blast ore reporting.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { employeeCommand } from '../../src/console/commands/entities.js';
import { surveyCommand } from '../../src/console/commands/mining.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import {
  estimateSurveyResult,
  isSurveyStale,
  runSurvey,
  SURVEY_METHODS,
  type EstimateSurveyParams,
  type SurveyResult,
  type SurveyMethod,
} from '../../src/core/mining/SurveyCalc.js';
import { computeBlastOreReport } from '../../src/core/mining/BlastOreReport.js';
import { VoxelGrid } from '../../src/core/world/VoxelGrid.js';
import { Random } from '../../src/core/math/Random.js';
import { createGame } from '../../src/core/state/GameState.js';
import { SURVEY_STALE_TICKS, SURVEY_COSTS, STARTING_CASH } from '../../src/core/config/balance.js';
import { hireEmployee, assignSkill } from '../../src/core/entities/Employee.js';
import type { FragmentData } from '../../src/core/mining/BlastExecution.js';

// ── Shared helpers ──────────────────────────────────────────────────────────

/** Build a fresh context with a real GameState (seed=42, desert biome). */
function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter() };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '32' });
  return ctx;
}

/**
 * Build a test grid with ore in a small region (3x3 columns) so that
 * wide-area surveys (seismic radius 20, aerial radius 30) return many
 * estimate entries, while point surveys (core_sample radius 0) return
 * only the centre column.
 */
function makeOreGrid(size = 30): VoxelGrid {
  const grid = new VoxelGrid(size, 15, size);
  for (let y = 2; y <= 8; y++) {
    for (let x = 9; x <= 11; x++) {
      for (let z = 9; z <= 11; z++) {
        grid.setVoxel(x, y, z, {
          composition: { rocks: [{ rockId: 'cruite', coefficient: 1.0 }] },
          density: 1,
          oreDensities: { blingite: 0.5 },
          fractureModifier: 1.0,
        });
      }
    }
  }
  return grid;
}

/**
 * Run a survey against a VoxelGrid and return the SurveyResult.
 */
function runSurveyOnGrid(
  grid: VoxelGrid,
  method: string,
  cx: number,
  cz: number,
  skill = 1,
  surveyorId = 99,
  id = 1,
  completedTick = 50,
  seed = 12345,
): SurveyResult {
  const params: EstimateSurveyParams = {
    id,
    method: method as SurveyMethod,
    centerX: cx,
    centerZ: cz,
    surveyorId,
    skillLevel: skill,
    completedTick,
  };
  return estimateSurveyResult(grid, params, new Random(seed));
}

/**
 * Hire an employee via the console command and return their ID.
 */
function hireEmployeeByRole(ctx: GameContext, role = 'surveyor'): number {
  const result = employeeCommand(ctx, ['hire'], { role });
  if (!result.success) throw new Error(`hire failed: ${result.output}`);
  return ctx.state!.employees.employees.slice(-1)[0]!.id;
}

// ── Survey system ────────────────────────────────────────────────────────────

describe('Survey system', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  // ── 1. Seismic produces many estimate entries ─────────────────────────────

  it('seismic survey produces estimates for many columns', () => {
    const grid = makeOreGrid(30);
    const result = runSurveyOnGrid(grid, 'seismic', 10, 10);
    const entryCount = Object.keys(result.estimates).length;

    // Seismic radius 20 covers the entire 9,9..11,11 ore block
    // plus potentially other columns — must see multiple entries.
    expect(entryCount).toBeGreaterThan(1);
    // Every estimate entry should have the blingite ore id
    for (const colKey of Object.keys(result.estimates)) {
      expect(result.estimates[colKey]).toHaveProperty('blingite');
    }
  });

  // ── 2. Core sample returns exactly 1 column ───────────────────────────────

  it('core_sample survey produces single column estimate', () => {
    const grid = makeOreGrid(30);
    const result = runSurveyOnGrid(grid, 'core_sample', 10, 10);
    const entryCount = Object.keys(result.estimates).length;

    // Core_sample radius = 0 — only the centre column is sampled
    expect(entryCount).toBe(1);
    expect(result.estimates).toHaveProperty('10,10');
  });

  // ── 3. Every SURVEY_METHOD works ──────────────────────────────────────────

  it('all SURVEY_METHODS can estimate', () => {
    const grid = makeOreGrid(30);

    for (const method of SURVEY_METHODS) {
      const result = runSurveyOnGrid(grid, method, 10, 10);
      expect(result).toBeDefined();
      expect(result.method).toBe(method);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      // Must have at least the centre-column estimate
      expect(Object.keys(result.estimates).length).toBeGreaterThanOrEqual(1);
    }
  });

  // ── 4. Higher skill → higher confidence ───────────────────────────────────

  it('higher skill increases confidence', () => {
    const grid = makeOreGrid(30);

    // Use core_sample for deterministic estimate (radius 0, lowest base error)
    const lowSkill = runSurveyOnGrid(grid, 'core_sample', 10, 10, 1);
    const highSkill = runSurveyOnGrid(grid, 'core_sample', 10, 10, 5);

    expect(highSkill.confidence).toBeGreaterThan(lowSkill.confidence);
    // Skill 1 → confidence = 1 - (0.05 * (1 - 0)) = 0.95
    // Skill 5 → confidence = 1 - (0.05 * (1 - 0.12*4)) = 1 - (0.05 * 0.52) = 0.974
    // Both are high for core_sample, but skill 5 must be higher
    expect(highSkill.confidence).toBeGreaterThan(0.95);
  });

  // ── 5. Stale boundary test ───────────────────────────────────────────────

  it('survey becomes stale after SURVEY_STALE_TICKS interval', () => {
    const grid = makeOreGrid(30);
    const survey = runSurveyOnGrid(grid, 'core_sample', 10, 10, 1, 99, 1, 0);

    // Exactly SURVEY_STALE_TICKS ticks later — still fresh (boundary inclusive)
    expect(isSurveyStale(survey, SURVEY_STALE_TICKS)).toBe(false);

    // One tick past the threshold — stale
    expect(isSurveyStale(survey, SURVEY_STALE_TICKS + 1)).toBe(true);

    // Long past threshold — also stale
    expect(isSurveyStale(survey, SURVEY_STALE_TICKS + 100)).toBe(true);
  });

  // ── 6. Survey command with employee queues pending action ─────────────────

  it('survey console command with employee queues pending action', () => {
    // Hire a surveyor and give them geology skill
    const empId = hireEmployeeByRole(ctx, 'surveyor');
    const skillResult = employeeCommand(
      ctx,
      ['assign_skill', String(empId)],
      { skill: 'geology', level: '3' },
    );
    expect(skillResult.success).toBe(true);

    // Survey at a valid position
    const result = surveyCommand(ctx as any, ['core_sample'], { x: '16', z: '16' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('core_sample survey queued');
    expect(result.output).toContain('Action ID:');

    // State should now have a pending survey action
    const pending = ctx.state!.pendingActions.filter(a => a.type === 'survey');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.payload).toMatchObject({
      method: 'core_sample',
      centerX: 16,
      centerZ: 16,
    });

    // A ghost preview should also be created
    expect(ctx.state!.ghostPreviews).toHaveLength(1);
    expect(ctx.state!.ghostPreviews[0]!.type).toBe('survey');
  });

  // ── 7. Out-of-bounds coordinates rejected ────────────────────────────────

  it('survey rejects out-of-bounds coordinates', () => {
    // Grid is 32x32x32, so (100, 100) is out of bounds
    const result = surveyCommand(ctx as any, ['seismic'], { x: '100', z: '100' });
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/out of bounds/i);

    // Negative coordinates should also be rejected
    const negResult = surveyCommand(ctx as any, ['aerial'], { x: '-5', z: '16' });
    expect(negResult.success).toBe(false);
    expect(negResult.output).toMatch(/out of bounds/i);
  });

  // ── 8. Insufficient funds ────────────────────────────────────────────────

  it('survey with insufficient funds returns error', () => {
    // Set cash to 0
    ctx.state!.cash = 0;

    // We need a surveyor for the runSurvey guard to reach the cash check
    const empId = hireEmployeeByRole(ctx, 'surveyor');
    employeeCommand(ctx, ['assign_skill', String(empId)], { skill: 'geology', level: '1' });

    // Most expensive survey (seismic = $3000) — cash is 0
    const result = surveyCommand(ctx as any, ['seismic'], { x: '16', z: '16' });
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/insufficient funds/i);
    expect(result.output).toMatch(/3000/);
  });

  // ── 9. No surveyor → fail ────────────────────────────────────────────────

  it('survey without surveyor fails', () => {
    // No employees hired at all — no geology qualification exists
    const result = surveyCommand(ctx as any, ['seismic'], { x: '16', z: '16' });
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/no available surveyor/i);
  });

  // ── 10. computeBlastOreReport ────────────────────────────────────────────

  it('computeBlastOreReport returns yield info', () => {
    // Fragment with blingite at 0.5 density, volume 2.0 m³
    // → mass = 2.0 * 0.5 * 2500 = 2500 kg
    const fragments: FragmentData[] = [
      {
        id: 1,
        position: { x: 10, y: 4, z: 10 },
        volume: 2.0,
        mass: 5000,
        rockId: 'cruite',
        oreDensities: { blingite: 0.5 },
        initialVelocity: { x: 0, y: 0, z: 0 },
        isProjection: false,
      },
      {
        id: 2,
        position: { x: 12, y: 3, z: 10 },
        volume: 1.0,
        mass: 2500,
        rockId: 'cruite',
        oreDensities: { dirtite: 0.3 },
        initialVelocity: { x: 0, y: 0, z: 0 },
        isProjection: false,
      },
    ];

    const report = computeBlastOreReport(fragments);

    // Total blingite: 2.0 * 0.5 * 2500 = 2500 kg
    // Total dirtite: 1.0 * 0.3 * 2500 = 750 kg
    // Total yield: 3250 kg
    expect(report.oreYields).toHaveProperty('blingite');
    expect(report.oreYields).toHaveProperty('dirtite');
    expect(report.oreYields['blingite']).toBeCloseTo(2500, 0);
    expect(report.oreYields['dirtite']).toBeCloseTo(750, 0);
    expect(report.totalYieldKg).toBeCloseTo(3250, 0);

    // No survey results provided → estimatedYieldKg = 0, yieldRatio = 1.0
    expect(report.estimatedYieldKg).toBe(0);
    expect(report.yieldRatio).toBe(1.0);

    // No treranium or absurdium
    expect(report.hasTreranium).toBe(false);
    expect(report.absurdiumFraction).toBe(0);

    // ── With a survey result matching fragment columns ──
    const surveyResult: SurveyResult = {
      id: 10,
      method: 'core_sample',
      centerX: 10,
      centerZ: 10,
      completedTick: 50,
      surveyorId: 1,
      estimates: {
        '10,10': { blingite: 0.5 },
        '12,10': { dirtite: 0.3 },
      },
      confidence: 0.95,
    };

    const reportWithSurvey = computeBlastOreReport(fragments, [surveyResult]);
    expect(reportWithSurvey.estimatedYieldKg).toBeGreaterThan(0);
    // estimated Yield = (2.0 * 0.5 * 2500) + (1.0 * 0.3 * 2500) = 2500 + 750 = 3250
    expect(reportWithSurvey.estimatedYieldKg).toBeCloseTo(3250, 0);
    // actual / estimated compute
    const actual = reportWithSurvey.totalYieldKg;
    const estimated = reportWithSurvey.estimatedYieldKg;
    expect(reportWithSurvey.yieldRatio).toBeCloseTo(actual / estimated, 4);
  });

  // ── Additional: confidence is always [0, 1] ────────────────────────────────

  it('confidence is always between 0 and 1', () => {
    const grid = makeOreGrid(30);
    for (const method of SURVEY_METHODS) {
      for (const skill of [1, 3, 5]) {
        const result = runSurveyOnGrid(grid, method, 10, 10, skill);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
      }
    }
  });

  // ── Additional: column with no ore → zero-density estimate omitted ────────

  it('survey on a column with no ore produces no estimates', () => {
    const grid = new VoxelGrid(30, 15, 30);
    // No ore placed anywhere — grid is all air/empty

    const result = runSurveyOnGrid(grid, 'seismic', 15, 15);
    // No ore exists → no estimates
    expect(Object.keys(result.estimates)).toHaveLength(0);
    // Confidence should still be valid
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  // ── Additional: survey cost deducted from cash via runSurvey ──────────────

  it('survey cost is deducted from cash', () => {
    const grid = makeOreGrid(30);
    const state = createGame({ seed: 42, startingCash: 100_000 });

    // Add a surveyor with geology
    const rng = new Random(42);
    const { employee } = hireEmployee(state.employees, 'surveyor', rng);
    assignSkill(state.employees, employee.id, 'geology', 3);

    const beforeCash = state.cash;
    const result = runSurvey(state, { method: 'core_sample', centerX: 10, centerZ: 10 });

    expect(result.success).toBe(true);
    expect(state.cash).toBe(beforeCash - SURVEY_COSTS.core_sample);
  });

  // ── Additional: survey result is persisted on GameState ───────────────────

  it('survey result is persisted on GameState.surveyResults', () => {
    const grid = makeOreGrid(30);
    const state = createGame({ seed: 42 });

    // Run a survey and manually push it (as the game loop would)
    const survey = runSurveyOnGrid(grid, 'core_sample', 10, 10, 3, 99, 1, 50);
    state.surveyResults.push(survey);

    expect(state.surveyResults).toHaveLength(1);
    expect(state.surveyResults[0]!.method).toBe('core_sample');
    expect(state.surveyResults[0]!.estimates['10,10']).toBeDefined();
  });
});
