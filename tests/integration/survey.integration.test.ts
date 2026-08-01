// BlastSimulator2026 — Integration tests: Survey system (Phase 4)
// Covers seismic, core_sample, and aerial survey methods, estimation accuracy,
// stale surveys, console command pipeline, and post-blast ore reporting.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { employeeCommand, buildCommand } from '../../src/console/commands/entities.js';
import { surveyCommand } from '../../src/console/commands/mining.js';
import { tickCommand } from '../../src/console/commands/events.js';
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
import { SURVEY_STALE_TICKS, SURVEY_COSTS, STARTING_CASH, SURVEY_DURATION_TICKS, AGENT_WALK_SPEED } from '../../src/core/config/balance.js';
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

  // ── 6b. Pending survey resolves into surveyResults only after arrival + duration (issue #437) ──
  //
  // Previously surveys resolved INSTANTLY on the very next tick regardless of
  // where the surveyor stood (src/console/commands/events.ts step "8b"). The
  // arrival-gated pipeline requires the claimed surveyor to actually walk to
  // the survey center (here: zero distance, since the surveyor spawns exactly
  // on top of it) and then spend SURVEY_DURATION_TICKS[method] ticks working —
  // a single tick is no longer enough even with zero travel distance.

  it('tickCommand resolves a pending survey action into state.surveyResults only once duration ticks elapse', () => {
    const empId = hireEmployeeByRole(ctx, 'surveyor');
    employeeCommand(ctx, ['assign_skill', String(empId)], { skill: 'geology', level: '3' });
    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;

    // Survey right where the surveyor stands (whichever reachable cell near
    // world centre they actually spawned on — #458 T6.1/D13) so this test
    // stays a zero-travel case regardless of the exact tile.
    surveyCommand(ctx as any, ['core_sample'], { x: String(emp.x), z: String(emp.z) });
    expect(ctx.state!.pendingActions.filter(a => a.type === 'survey')).toHaveLength(1);
    expect(ctx.state!.surveyResults).toHaveLength(0);

    // One tick is not enough — SURVEY_DURATION_TICKS.core_sample ticks of work
    // remain even though the surveyor starts right on top of the target.
    const result = tickCommand(ctx, ['1'], {});
    expect(result.success).toBe(true);
    expect(ctx.state!.surveyResults).toHaveLength(0);

    // Padding: no travel needed here (surveyor spawns on the survey center),
    // just the full duration plus slack.
    for (let i = 0; i < SURVEY_DURATION_TICKS.core_sample + 5; i++) {
      tickCommand(ctx, ['1'], {});
    }

    // The pending survey action is consumed and a result is produced.
    expect(ctx.state!.pendingActions.filter(a => a.type === 'survey')).toHaveLength(0);
    expect(ctx.state!.surveyResults).toHaveLength(1);
    expect(ctx.state!.surveyResults[0]!.method).toBe('core_sample');
  });

  // ── 6c. Claiming a survey far from the surveyor stays pending through travel (issue #437) ──

  it('a survey far from the surveyor produces no result immediately, and only resolves after travel + duration ticks', () => {
    const empId = hireEmployeeByRole(ctx, 'surveyor');
    employeeCommand(ctx, ['assign_skill', String(empId)], { skill: 'geology', level: '3' });
    const emp = ctx.state!.employees.employees.find(e => e.id === empId)!;
    // First-hired employee spawns near (world.sizeX/2, world.sizeZ/2) =
    // (16, 16) for this 32×32 test world, snapped to a reachable,
    // same-bench-level cell (#458 T6.1/D13) — so the exact tile can be off
    // by a cell or two.
    expect(Math.abs(emp.x - 16)).toBeLessThanOrEqual(1);
    expect(Math.abs(emp.z - 16)).toBeLessThanOrEqual(1);
    const [empSpawnX, empSpawnZ] = [emp.x, emp.z];

    surveyCommand(ctx as any, ['seismic'], { x: '2', z: '2' });
    expect(ctx.state!.surveyResults).toHaveLength(0);

    const afterOneTick = tickCommand(ctx, ['1'], {});
    expect(afterOneTick.success).toBe(true);
    // Not resolved yet — the surveyor has only just started walking there.
    expect(ctx.state!.surveyResults).toHaveLength(0);
    expect(emp.destinationX).not.toBeNull();
    expect(emp.destinationZ).not.toBeNull();
    expect(emp.x === 2 && emp.z === 2).toBe(false);

    // Enough ticks for the walk (Euclidean distance / AGENT_WALK_SPEED) plus
    // the full seismic survey duration, with slack.
    const travelTicks = Math.ceil(Math.hypot(empSpawnX - 2, empSpawnZ - 2) / AGENT_WALK_SPEED);
    for (let i = 0; i < travelTicks + SURVEY_DURATION_TICKS.seismic + 5; i++) {
      tickCommand(ctx, ['1'], {});
    }

    expect(ctx.state!.pendingActions.filter(a => a.type === 'survey')).toHaveLength(0);
    expect(ctx.state!.surveyResults).toHaveLength(1);
    expect(ctx.state!.surveyResults[0]!.method).toBe('seismic');
  });

  it('surveyCommand rejects and queues nothing when no qualified surveyor is available', () => {
    // No employee hired — runSurvey requires a qualified surveyor at queue time.
    const result = surveyCommand(ctx as any, ['core_sample'], { x: '16', z: '16' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('No available surveyor');
    expect(ctx.state!.pendingActions.filter(a => a.type === 'survey')).toHaveLength(0);

    tickCommand(ctx, ['1'], {});

    expect(ctx.state!.pendingActions.filter(a => a.type === 'survey')).toHaveLength(0);
    expect(ctx.state!.surveyResults).toHaveLength(0);
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

// ── Survey system — seismic building side effects (issue #412) ─────────────
//
// Skill spec ("Survey Visibility Rules"): seismic surveys disturb nearby
// buildings — −10 HP per survey if a building is within 5 cells of the
// survey center. No such damage exists yet anywhere in src/core or
// src/console — these tests define the expected behavior (TDD red phase).

describe('Survey system — seismic building side effects', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  /** Hire a surveyor with geology skill so runSurvey()'s guard passes. */
  function hireSurveyor(level = 3): void {
    const empId = hireEmployeeByRole(ctx, 'surveyor');
    employeeCommand(ctx, ['assign_skill', String(empId)], { skill: 'geology', level: String(level) });
  }

  /**
   * Resolve queued survey pending-actions by advancing enough ticks for the
   * surveyor to walk to the survey center and complete the full survey
   * duration (issue #437 — surveys no longer resolve on the very next tick
   * regardless of distance). 30 ticks comfortably covers every distance/method
   * combination used in this describe block (worst case here: ~16 travel
   * ticks + 8 duration ticks for a seismic survey at (5,5) from a surveyor
   * spawned at (16,16)).
   */
  function resolveTick(ticks = 30): void {
    for (let i = 0; i < ticks; i++) tickCommand(ctx, ['1'], {});
  }

  function findBuilding(id: number) {
    return ctx.state!.buildings.buildings.find(b => b.id === id)!;
  }

  it('applies -10 HP to a building within 5 cells of a completed seismic survey', () => {
    hireSurveyor();
    // Building at (21,15), survey center at (19,14) → Euclidean distance ≈
    // 2.2 (within 5). Both sit inside the stretch of NavGrid the surveyor's
    // spawn area is on the same bench level as (#458 T6.1/D14): bigger
    // levels carry far more natural terrain relief than the old ones, and a
    // route crossing onto a different bench mid-walk can hit a pathfinding
    // instability where two near-equal routes flip from tick to tick and
    // the surveyor never arrives — confirmed via direct reproduction at the
    // original (20,20)/(22,20) coordinates. A deeper general fix belongs to
    // T6.2 (pathfinding at scale); this sidesteps it for the test.
    const buildResult = buildCommand(ctx, ['living_quarters'], { at: '21,15' });
    expect(buildResult.success).toBe(true);
    const building = ctx.state!.buildings.buildings[ctx.state!.buildings.buildings.length - 1]!;
    const hpBefore = building.hp;

    surveyCommand(ctx as any, ['seismic'], { x: '19', z: '14' });
    resolveTick();

    expect(findBuilding(building.id).hp).toBe(hpBefore - 10);
  });

  it('does not damage a building farther than 5 cells from the seismic survey center', () => {
    hireSurveyor();
    // Building at (25,25), survey center at (5,5) → distance ≈ 28 (outside 5-cell radius).
    const buildResult = buildCommand(ctx, ['living_quarters'], { at: '25,25' });
    expect(buildResult.success).toBe(true);
    const building = ctx.state!.buildings.buildings[ctx.state!.buildings.buildings.length - 1]!;
    const hpBefore = building.hp;

    surveyCommand(ctx as any, ['seismic'], { x: '5', z: '5' });
    resolveTick();

    expect(findBuilding(building.id).hp).toBe(hpBefore);
  });

  it('does not damage a nearby building for a core_sample survey (seismic-only side effect)', () => {
    hireSurveyor();
    const buildResult = buildCommand(ctx, ['living_quarters'], { at: '12,10' });
    expect(buildResult.success).toBe(true);
    const building = ctx.state!.buildings.buildings[ctx.state!.buildings.buildings.length - 1]!;
    const hpBefore = building.hp;

    surveyCommand(ctx as any, ['core_sample'], { x: '10', z: '10' });
    resolveTick();

    expect(findBuilding(building.id).hp).toBe(hpBefore);
  });

  it('does not damage a nearby building for an aerial survey (seismic-only side effect)', () => {
    hireSurveyor();
    const buildResult = buildCommand(ctx, ['living_quarters'], { at: '12,10' });
    expect(buildResult.success).toBe(true);
    const building = ctx.state!.buildings.buildings[ctx.state!.buildings.buildings.length - 1]!;
    const hpBefore = building.hp;

    surveyCommand(ctx as any, ['aerial'], { x: '10', z: '10' });
    resolveTick();

    expect(findBuilding(building.id).hp).toBe(hpBefore);
  });

  it('damages every building within 5 cells when multiple are in range', () => {
    hireSurveyor();
    // living_quarters T1 is a 3x3 footprint; placed so it doesn't overlap
    // the survey's own target cell, which the surveyor must be able to walk
    // to and stand on (#437). Both buildings and the survey centre sit
    // inside the stretch of NavGrid confirmed on the same bench level as
    // the surveyor's spawn (#458 T6.1/D14 — see the single-building test
    // above for why that matters).
    const b1Result = buildCommand(ctx, ['living_quarters'], { at: '17,15' });
    const b2Result = buildCommand(ctx, ['management_office'], { at: '21,14' });
    expect(b1Result.success).toBe(true);
    expect(b2Result.success).toBe(true);
    const b1 = ctx.state!.buildings.buildings.find(b => b.type === 'living_quarters')!;
    const b2 = ctx.state!.buildings.buildings.find(b => b.type === 'management_office')!;
    const b1HpBefore = b1.hp;
    const b2HpBefore = b2.hp;

    surveyCommand(ctx as any, ['seismic'], { x: '19', z: '14' });
    resolveTick();

    expect(findBuilding(b1.id).hp).toBe(b1HpBefore - 10);
    expect(findBuilding(b2.id).hp).toBe(b2HpBefore - 10);
  });
});
