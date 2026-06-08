import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { newGameCommand } from '../../../src/console/commands/world.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import {
  blastCommand,
  blastPlanCommand,
  blastPreviewCommand,
  buySoftwareCommand,
  chargeCommand,
  drillPlanCommand,
  sequenceCommand,
  surveyCommand,
} from '../../../src/console/commands/mining.js';
import { createTubingState } from '../../../src/core/mining/Tubing.js';
import { resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import * as SurveyCalcModule from '../../../src/core/mining/SurveyCalc.js';
import * as EventEngineModule from '../../../src/core/events/EventEngine.js';

function makeMiningContext(): MiningContext {
  const ctx: MiningContext = {
    state: null,
    grid: null,
    softwareTier: 0,
    tubingState: createTubingState(),
    emitter: new EventEmitter(),
  };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32' });
  return ctx;
}

beforeEach(() => resetHoleIds());
afterEach(() => vi.restoreAllMocks());

// ── blast_plan list ──────────────────────────────────────────────────────────

describe('blast_plan list', () => {
  it('returns "No saved plans." when no plans have been saved', () => {
    const ctx = makeMiningContext();
    const result = blastPlanCommand(ctx, ['list'], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe('No saved plans.');
  });

  it('lists plan names after saving one', () => {
    const ctx = makeMiningContext();
    // Create a minimal drill plan so save has something to store
    drillPlanCommand(ctx, ['grid'], { rows: '2', cols: '2', spacing: '3', depth: '6' });
    blastPlanCommand(ctx, ['save'], { name: 'alpha' });

    const result = blastPlanCommand(ctx, ['list'], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('Saved plans:');
    expect(result.output).toContain('  alpha');
  });

  it('lists multiple saved plan names', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '2', cols: '2', spacing: '3', depth: '6' });
    blastPlanCommand(ctx, ['save'], { name: 'plan-a' });
    blastPlanCommand(ctx, ['save'], { name: 'plan-b' });

    const result = blastPlanCommand(ctx, ['list'], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('  plan-a');
    expect(result.output).toContain('  plan-b');
  });

  it('usage error mentions list subcommand', () => {
    const ctx = makeMiningContext();
    const result = blastPlanCommand(ctx, ['unknown'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('list');
  });
});

// ── buy_software tier validation ─────────────────────────────────────────────

describe('buy_software tier validation', () => {
  it('no tier arg buys the next tier (tier 0 → tier 1)', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    const result = buySoftwareCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('tier 1');
    expect(ctx.softwareTier).toBe(1);
  });

  it('tier:1 when at tier 0 succeeds', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    const result = buySoftwareCommand(ctx, [], { tier: '1' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('tier 1');
    expect(ctx.softwareTier).toBe(1);
  });

  it('tier:2 when at tier 0 returns error "Must purchase tier 1 first"', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    const result = buySoftwareCommand(ctx, [], { tier: '2' });
    expect(result.success).toBe(false);
    expect(result.output).toBe('Must purchase tier 1 first');
  });

  it('tier:4 when at tier 0 returns error "Must purchase tier 1 first"', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    const result = buySoftwareCommand(ctx, [], { tier: '4' });
    expect(result.success).toBe(false);
    expect(result.output).toBe('Must purchase tier 1 first');
  });

  it('tier:1 when already at tier 1 returns error "Already at tier 1 or higher"', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    ctx.softwareTier = 1;
    const result = buySoftwareCommand(ctx, [], { tier: '1' });
    expect(result.success).toBe(false);
    expect(result.output).toBe('Already at tier 1 or higher');
  });

  it('tier:0 when at tier 1 returns error "Already at tier 0 or higher"', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    ctx.softwareTier = 1;
    const result = buySoftwareCommand(ctx, [], { tier: '0' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Already at tier');
  });
});

// ── blast_preview ─────────────────────────────────────────────────────────────

describe('blast_preview', () => {
  // ── guard: no game loaded ───────────────────────────────────────────────────

  it('returns success:false with "No game loaded" when ctx.state is null', () => {
    const ctx: MiningContext = {
      state: null,
      grid: null,
      softwareTier: 0,
      tubingState: createTubingState(),
      emitter: new EventEmitter(),
    };
    const result = blastPreviewCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });

  // ── guard: no drill plan ────────────────────────────────────────────────────

  it('returns success:false with "No drill plan" when drillHoles is empty', () => {
    const ctx = makeMiningContext();
    const result = blastPreviewCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('No drill plan');
  });

  // ── guard: incomplete plan ──────────────────────────────────────────────────

  it('returns success:false with validation error when holes exist but charges are missing', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    const result = blastPreviewCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Missing charge');
  });

  // ── software tier 0 — all locked ────────────────────────────────────────────

  it('tier 0 — complete plan, all sections require higher software tier', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });

    const result = blastPreviewCommand(ctx, [], {});
    expect(result.success).toBe(true);
    const matches = result.output.match(/Requires software tier/g);
    expect(matches).toHaveLength(4);
  });

  // ── software tier 1 — energy unlocked ───────────────────────────────────────

  it('tier 1 — energy section shows data, fragmentation+projections+vibrations require higher tier', () => {
    const ctx = makeMiningContext();
    ctx.softwareTier = 1;
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });

    const result = blastPreviewCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('Affected voxels');
    expect(result.output).toContain('Min energy');
    expect(result.output).toContain('Max energy');
    // Remaining 3 sections still locked
    const matches = result.output.match(/Requires software tier/g);
    expect(matches).toHaveLength(3);
  });

  // ── software tier 2 — energy + frag unlocked ────────────────────────────────

  it('tier 2 — energy + fragmentation show data, projections+vibrations require higher tier', () => {
    const ctx = makeMiningContext();
    ctx.softwareTier = 2;
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });

    const result = blastPreviewCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('Affected voxels');
    expect(result.output).toContain('Min energy');
    expect(result.output).toContain('Max energy');
    expect(result.output).toContain('Fractured');
    expect(result.output).toContain('Cracked');
    expect(result.output).toContain('Average fragment size');
    // Remaining 2 sections still locked
    const matches = result.output.match(/Requires software tier/g);
    expect(matches).toHaveLength(2);
  });

  // ── software tier 3 — energy + frag + projections unlocked ─────────────────

  it('tier 3 — energy + fragmentation + projections show data, vibrations require higher tier', () => {
    const ctx = makeMiningContext();
    ctx.softwareTier = 3;
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });

    const result = blastPreviewCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('Affected voxels');
    expect(result.output).toContain('Fractured');
    expect(result.output).toContain('Projection zone voxels');
    expect(result.output).toContain('Projected fragments');
    expect(result.output).toContain('Collapse fragments');
    // Remaining 1 section still locked
    const matches = result.output.match(/Requires software tier/g);
    expect(matches).toHaveLength(1);
  });

  // ── software tier 4 — all unlocked ─────────────────────────────────────────

  it('tier 4 — all sections show data', () => {
    const ctx = makeMiningContext();
    ctx.softwareTier = 4;
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });

    const result = blastPreviewCommand(ctx, [], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('Energy Map');
    expect(result.output).toContain('Fragmentation');
    expect(result.output).toContain('Projections');
    expect(result.output).toContain('Vibrations');
    expect(result.output).toContain('Affected voxels');
    expect(result.output).toContain('Fractured');
    expect(result.output).toContain('Projection zone voxels');
    expect(result.output).toContain('Max vibration');
    expect(result.output).toContain('Affected villages');
    // All unlocked — no "Requires software tier" messages
    expect(result.output).not.toMatch(/Requires software tier/);
  });
});

// ── surveyCommand ─────────────────────────────────────────────────────────────

describe('surveyCommand', () => {
  /**
   * Hire a surveyor employee and assign the 'geology' qualification so the
   * runSurvey() guard passes.  Uses a fixed seed (42) so tests are deterministic.
   */
  function hireSurveyor(ctx: MiningContext): void {
    const rng = new Random(42);
    const { employee } = hireEmployee(ctx.state!.employees, 'surveyor', rng);
    assignSkill(ctx.state!.employees, employee.id, 'geology', 1);
  }

  // ── guard: no game loaded ───────────────────────────────────────────────────

  it('returns success:false with "No game loaded" when ctx.state is null', () => {
    const ctx: MiningContext = {
      state: null,
      grid: null,
      softwareTier: 0,
      tubingState: createTubingState(),
      emitter: new EventEmitter(),
    };
    const result = surveyCommand(ctx, ['seismic'], { x: '10', z: '10' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });

  // ── guard: missing / invalid method ────────────────────────────────────────

  it('returns success:false with usage hint (no "Unknown method") when no method argument is provided', () => {
    const ctx = makeMiningContext();
    const result = surveyCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage');
    expect(result.output).not.toContain('Unknown method');
  });

  it('returns success:false mentioning "Unknown method" for an unrecognized method', () => {
    const ctx = makeMiningContext();
    const result = surveyCommand(ctx, ['foobar'], { x: '10', z: '10' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Unknown method');
  });

  // ── guard: missing coordinates ──────────────────────────────────────────────

  it('returns success:false with usage hint when z coordinate is missing', () => {
    const ctx = makeMiningContext();
    // x is present but z is absent
    const result = surveyCommand(ctx, ['seismic'], { x: '10' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Usage');
  });

  it('returns success:false when both x and z coordinates are missing', () => {
    const ctx = makeMiningContext();
    const result = surveyCommand(ctx, ['aerial'], {});
    expect(result.success).toBe(false);
  });

  // ── guard: out-of-bounds coordinates ───────────────────────────────────────

  it('returns success:false mentioning "Out of bounds" for negative x', () => {
    const ctx = makeMiningContext();
    const result = surveyCommand(ctx, ['seismic'], { x: '-1', z: '10' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Out of bounds');
  });

  it('returns success:false mentioning "Out of bounds" for x beyond grid width', () => {
    const ctx = makeMiningContext();
    // makeMiningContext creates a 32×32 grid
    const result = surveyCommand(ctx, ['seismic'], { x: '100', z: '10' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Out of bounds');
  });

  it('returns success:false mentioning "Out of bounds" for z beyond grid depth', () => {
    const ctx = makeMiningContext();
    const result = surveyCommand(ctx, ['aerial'], { x: '10', z: '200' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Out of bounds');
  });

  it('does not deduct cash when coordinates are out of bounds', () => {
    const ctx = makeMiningContext();
    hireSurveyor(ctx);
    ctx.state!.cash = 10_000;
    surveyCommand(ctx, ['seismic'], { x: '-5', z: '5' });
    expect(ctx.state!.cash).toBe(10_000);
  });

  // ── guard: insufficient funds ───────────────────────────────────────────────

  it('returns success:false mentioning "Insufficient funds" when cash is below seismic cost ($3000)', () => {
    const ctx = makeMiningContext();
    hireSurveyor(ctx);
    ctx.state!.cash = 100;
    const result = surveyCommand(ctx, ['seismic'], { x: '10', z: '10' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
  });

  it('returns success:false mentioning "Insufficient funds" when cash is below core_sample cost ($800)', () => {
    const ctx = makeMiningContext();
    hireSurveyor(ctx);
    ctx.state!.cash = 500;
    const result = surveyCommand(ctx, ['core_sample'], { x: '5', z: '5' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
  });

  // ── guard: no surveyor ──────────────────────────────────────────────────────

  it('returns success:false mentioning "No available surveyor" when no geology employee exists', () => {
    const ctx = makeMiningContext();
    // No employees hired — geology guard must fail
    ctx.state!.cash = 50_000;
    const result = surveyCommand(ctx, ['seismic'], { x: '10', z: '10' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('No available surveyor');
  });

  it('returns success:false mentioning "No available surveyor" even when a non-geology employee is present', () => {
    const ctx = makeMiningContext();
    // Hire a driller — no geology qualification
    const rng = new Random(99);
    hireEmployee(ctx.state!.employees, 'driller', rng);
    ctx.state!.cash = 50_000;
    const result = surveyCommand(ctx, ['seismic'], { x: '10', z: '10' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('No available surveyor');
  });

  // ── success: seismic ────────────────────────────────────────────────────────

  it('succeeds for seismic survey, output mentions "seismic" and "queued"', () => {
    const ctx = makeMiningContext();
    hireSurveyor(ctx);
    ctx.state!.cash = 10_000;
    const result = surveyCommand(ctx, ['seismic'], { x: '10', z: '10' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('seismic');
    expect(result.output.toLowerCase()).toContain('queued');
  });

  it('deducts $3000 from cash after a successful seismic survey', () => {
    const ctx = makeMiningContext();
    hireSurveyor(ctx);
    ctx.state!.cash = 10_000;
    surveyCommand(ctx, ['seismic'], { x: '10', z: '10' });
    expect(ctx.state!.cash).toBe(7_000);
  });

  it('enqueues one pending action of type "survey" after a successful seismic survey', () => {
    const ctx = makeMiningContext();
    hireSurveyor(ctx);
    ctx.state!.cash = 10_000;
    surveyCommand(ctx, ['seismic'], { x: '10', z: '10' });
    const surveyActions = ctx.state!.pendingActions.filter(a => a.type === 'survey');
    expect(surveyActions).toHaveLength(1);
  });

  // ── success: core_sample ────────────────────────────────────────────────────

  it('succeeds for core_sample survey, output mentions "core_sample" and "queued"', () => {
    const ctx = makeMiningContext();
    hireSurveyor(ctx);
    ctx.state!.cash = 5_000;
    const result = surveyCommand(ctx, ['core_sample'], { x: '5', z: '5' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('core_sample');
    expect(result.output.toLowerCase()).toContain('queued');
  });

  it('deducts $800 from cash after a successful core_sample survey', () => {
    const ctx = makeMiningContext();
    hireSurveyor(ctx);
    ctx.state!.cash = 5_000;
    surveyCommand(ctx, ['core_sample'], { x: '5', z: '5' });
    expect(ctx.state!.cash).toBe(4_200);
  });

  // ── success: aerial ─────────────────────────────────────────────────────────

  it('succeeds for aerial survey, output mentions "aerial" and "queued"', () => {
    const ctx = makeMiningContext();
    hireSurveyor(ctx);
    ctx.state!.cash = 5_000;
    const result = surveyCommand(ctx, ['aerial'], { x: '15', z: '15' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('aerial');
    expect(result.output.toLowerCase()).toContain('queued');
  });

  it('deducts $1500 from cash after a successful aerial survey', () => {
    const ctx = makeMiningContext();
    hireSurveyor(ctx);
    ctx.state!.cash = 5_000;
    surveyCommand(ctx, ['aerial'], { x: '15', z: '15' });
    expect(ctx.state!.cash).toBe(3_500);
  });

  // ── survey show ─────────────────────────────────────────────────────────────

  it('survey show returns success:true with "No pending surveys." when queue is empty', () => {
    const ctx = makeMiningContext();
    const result = surveyCommand(ctx, ['show'], {});
    expect(result.success).toBe(true);
    expect(result.output).toBe('No pending surveys.');
  });

  it('survey show lists the method of a queued survey', () => {
    const ctx = makeMiningContext();
    hireSurveyor(ctx);
    ctx.state!.cash = 10_000;
    surveyCommand(ctx, ['seismic'], { x: '10', z: '10' });
    const result = surveyCommand(ctx, ['show'], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('seismic');
  });

  it('survey show lists all queued surveys when multiple are pending', () => {
    const ctx = makeMiningContext();
    hireSurveyor(ctx);
    ctx.state!.cash = 50_000;
    surveyCommand(ctx, ['seismic'], { x: '10', z: '10' });
    surveyCommand(ctx, ['aerial'], { x: '20', z: '20' });
    const result = surveyCommand(ctx, ['show'], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('seismic');
    expect(result.output).toContain('aerial');
  });
});

describe('blastCommand — ore report event wiring', () => {
  it('computes post-blast ore report and triggers detectOreReport with game event state', () => {
    const ctx = makeMiningContext();

    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });

    const mockedReport = {
      oreYields: { dirtite: 1300 },
      totalYieldKg: 1300,
      estimatedYieldKg: 1000,
      yieldRatio: 1.3,
      hasTreranium: false,
      absurdiumFraction: 0,
    };
    const computeSpy = vi.spyOn(SurveyCalcModule, 'computeBlastOreReport').mockReturnValue(mockedReport);
    const detectSpy = vi.spyOn(EventEngineModule, 'detectOreReport');

    const result = blastCommand(ctx, [], {});

    expect(result.success).toBe(true);
    expect(computeSpy).toHaveBeenCalledOnce();
    expect(computeSpy).toHaveBeenCalledWith(expect.any(Array), ctx.state!.surveyResults);
    expect(detectSpy).toHaveBeenCalledOnce();
    expect(detectSpy).toHaveBeenCalledWith(mockedReport, ctx.state!.events, ctx.state!.tickCount);
    expect(ctx.state!.events.pendingEvent?.eventId).toBe('lucky_strike');
  });
});
