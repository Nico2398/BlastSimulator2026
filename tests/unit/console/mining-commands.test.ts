import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';
import { newGameCommand } from '../../../src/console/commands/world.js';
import type { MiningContext } from '../../../src/console/commands/mining.js';
import {
  blastCommand,
  blastPlanCommand,
  blastPreviewCommand,
  buildRampCommand,
  buySoftwareCommand,
  cancelRampCommand,
  chargeCommand,
  drillPlanCommand,
  previewCommand,
  sequenceCommand,
  surveyCommand,
  tubingCommand,
} from '../../../src/console/commands/mining.js';
import { resetHoleIds } from '../../../src/core/mining/DrillPlan.js';
import { hireEmployee, assignSkill } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
import * as SurveyCalcModule from '../../../src/core/mining/SurveyCalc.js';
import * as EventEngineModule from '../../../src/core/events/EventEngine.js';
import { RAMP_COST_PER_METER, carveRampSegment } from '../../../src/core/mining/Ramp.js';
import { TUBING_COST } from '../../../src/core/mining/Tubing.js';
import { MIN_STEMMING_M, MAX_DRILL_GRID_HOLES, MAX_RAMP_LENGTH } from '../../../src/core/config/balance.js';
import { tickCommand } from '../../../src/console/commands/events.js';
import { employeeCommand } from '../../../src/console/commands/employees.js';
import { completePendingAction } from '../../../src/core/engine/TaskDispatch.js';

function makeMiningContext(): MiningContext {
  const ctx: MiningContext = {
    state: null,
    grid: null,
    emitter: new EventEmitter(),
  };
  // Staffed (#553): a `drill_plan grid/add` no longer writes holes straight
  // into state.drillHoles — it queues one drill_hole PendingAction per hole,
  // which needs a qualified employee (`blasting`) and a `drill_rig` vehicle
  // to actually complete. Every test in this file that drills a plan and
  // then charges/blasts it needs the hole to have actually landed, so the
  // context is staffed by default — mirrors drill-plan-queueing.test.ts's
  // `new_game ... staffed:true`. Staffing hires/purchases for free (see
  // applyStaffedComposition, GameState.ts) so it doesn't perturb any of this
  // file's cash-based assertions.
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '1', size: '32', staffed: 'true' });
  return ctx;
}

/**
 * Ticks the game loop until every hole ordered by the most recent
 * `drill_plan grid/add` has landed in `state.drillHoles` (#553), or
 * `maxTicks` is exhausted. Needed anywhere a test drills a plan and then
 * immediately charges/sequences/blasts it — those all read `state.drillHoles`,
 * which now only gains a hole once its own `drill_hole` action completes.
 *
 * Tops every employee's need gauges up before each tick: this file's plans
 * are driven by a single drill_rig/driller, and a multi-hole plan can run
 * long enough (walking between holes, drilling each one) for hunger/fatigue/
 * breakNeed to cross a collapse threshold mid-drive — an unrelated needs
 * mechanic this test isn't exercising. Keeping the gauges topped up isolates
 * the behavior under test (drill_hole queueing/landing) from needs/rest,
 * which have their own dedicated test coverage elsewhere.
 */
function driveDrillPlanToCompletion(ctx: MiningContext, maxTicks = 200): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedDrillHoles.length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.hunger = 100;
      emp.fatigue = 100;
      emp.breakNeed = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
}

/**
 * Ticks the game loop until every charge ordered by the most recent `charge
 * hole:*`/`charge hole:<id>` has landed in `state.chargesByHole` (#554),
 * mirroring driveDrillPlanToCompletion above.
 */
function driveChargePlanToCompletion(ctx: MiningContext, maxTicks = 200): void {
  for (let i = 0; i < maxTicks && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.hunger = 100;
      emp.fatigue = 100;
      emp.breakNeed = 100;
    }
    tickCommand(ctx, ['1'], {});
  }
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

// ── blast_plan validate (#790: no prior coverage — validate shares
// assembleValidBlastPlan with blastCommand/blastPreviewCommand but has its
// own header text and its own success message) ──────────────────────────

describe('blastPlanCommand — validate subcommand', () => {
  it('validate reports "Validation issues" when the plan has errors', () => {
    const ctx = makeMiningContext();
    // Holes drilled but never charged — validateBlastPlan reports a missing
    // charge for each hole (mirrors blastPreviewCommand's own "incomplete
    // plan" test above).
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);

    const result = blastPlanCommand(ctx, ['validate'], {});

    expect(result.success).toBe(false);
    expect(result.output.startsWith('Validation issues:')).toBe(true);
  });

  it('validate reports the plan is ready to blast when there are no errors', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    driveChargePlanToCompletion(ctx);
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });

    const result = blastPlanCommand(ctx, ['validate'], {});

    expect(result.success).toBe(true);
    expect(result.output).toBe('Plan is valid and ready to blast.');
  });
});

// ── drill_plan remove ────────────────────────────────────────────────────────

describe('drillPlanCommand — remove subcommand', () => {
  it('removes the named hole from the plan', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '2', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
    expect(ctx.state!.drillHoles.map(h => h.id)).toEqual(['H1', 'H2']);

    const result = drillPlanCommand(ctx, ['remove'], { hole: 'H1' });

    expect(result.success).toBe(true);
    expect(ctx.state!.drillHoles.map(h => h.id)).toEqual(['H2']);
  });

  it('drops the removed hole\'s charge and sequence delay entries', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    driveChargePlanToCompletion(ctx);
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '25ms' });
    expect(ctx.state!.chargesByHole['H1']).toBeDefined();
    expect(ctx.state!.sequenceDelays['H1']).toBeDefined();

    drillPlanCommand(ctx, ['remove'], { hole: 'H1' });

    expect(ctx.state!.chargesByHole['H1']).toBeUndefined();
    expect(ctx.state!.sequenceDelays['H1']).toBeUndefined();
  });

  it('returns success:false and leaves the plan untouched for an unknown hole ID', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);

    const result = drillPlanCommand(ctx, ['remove'], { hole: 'H99' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('not found');
    expect(ctx.state!.drillHoles.length).toBe(1);
  });

  // ── characterization (#634): a spec matching neither the drilled nor the
  // planned pool falls back to the legacy `hole_${spec}` id form — pin the
  // exact resolved id in the "not found" message for a bare-number spec.
  it('falls back to the hole_<spec> legacy form for a bare-number spec matching no real hole', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);

    const result = drillPlanCommand(ctx, ['remove'], { hole: '42' });

    expect(result.success).toBe(false);
    expect(result.output).toBe('Hole "hole_42" not found');
  });

  // ── characterization (#634): removing a *drilled* hole deletes its charge,
  // sequence delay, AND plannedChargesByHole entry — all three seeded
  // manually here (a real drill/charge flow never populates
  // plannedChargesByHole for an already-drilled hole) to pin the full
  // teardown triple the refactor's clearHoleCharges must reproduce exactly.
  it('removing a drilled hole deletes its charge, sequence delay, AND plannedChargesByHole entry', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
    const holeId = ctx.state!.drillHoles[0]!.id;
    ctx.state!.chargesByHole[holeId] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
    ctx.state!.plannedChargesByHole[holeId] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
    ctx.state!.sequenceDelays[holeId] = 25;

    const result = drillPlanCommand(ctx, ['remove'], { hole: holeId });

    expect(result.success).toBe(true);
    expect(ctx.state!.chargesByHole[holeId]).toBeUndefined();
    expect(ctx.state!.plannedChargesByHole[holeId]).toBeUndefined();
    expect(ctx.state!.sequenceDelays[holeId]).toBeUndefined();
  });
});

// ── drill_plan remove — planned (not-yet-drilled) hole branch (#634) ───────
// No existing test exercises this branch's own charge/sequence/planned-charge
// cleanup — the "drops the removed hole's charge and sequence delay entries"
// test above only covers the already-drilled branch.

describe('drillPlanCommand — remove subcommand, planned (not-yet-drilled) hole branch', () => {
  it('splices a still-planned hole out of plannedDrillHoles by its real id', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '2', spacing: '3', depth: '8' });
    // Deliberately not driven to completion — both holes stay in
    // plannedDrillHoles, none reach drillHoles.
    expect(ctx.state!.plannedDrillHoles.map(h => h.id)).toEqual(['H1', 'H2']);
    expect(ctx.state!.drillHoles).toEqual([]);

    const result = drillPlanCommand(ctx, ['remove'], { hole: 'H1' });

    expect(result.success).toBe(true);
    expect(ctx.state!.plannedDrillHoles.map(h => h.id)).toEqual(['H2']);
  });

  it('removing a planned hole deletes its charge, sequence delay, AND plannedChargesByHole entry', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    const holeId = ctx.state!.plannedDrillHoles[0]!.id;
    ctx.state!.chargesByHole[holeId] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
    ctx.state!.plannedChargesByHole[holeId] = { explosiveId: 'boomite', amountKg: 5, stemmingM: 2 };
    ctx.state!.sequenceDelays[holeId] = 25;

    const result = drillPlanCommand(ctx, ['remove'], { hole: holeId });

    expect(result.success).toBe(true);
    expect(ctx.state!.chargesByHole[holeId]).toBeUndefined();
    expect(ctx.state!.plannedChargesByHole[holeId]).toBeUndefined();
    expect(ctx.state!.sequenceDelays[holeId]).toBeUndefined();
  });
});

describe('drillPlanCommand — clear subcommand', () => {
  it('empties holes, charges, and sequence delays', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '2', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
    chargeCommand(ctx, [], { hole: '*', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    driveChargePlanToCompletion(ctx);
    sequenceCommand(ctx, ['auto'], {});
    expect(ctx.state!.drillHoles.length).toBe(2);
    expect(Object.keys(ctx.state!.chargesByHole).length).toBe(2);
    expect(Object.keys(ctx.state!.sequenceDelays).length).toBe(2);

    const result = drillPlanCommand(ctx, ['clear'], {});

    expect(result.success).toBe(true);
    expect(ctx.state!.drillHoles).toEqual([]);
    expect(ctx.state!.chargesByHole).toEqual({});
    expect(ctx.state!.sequenceDelays).toEqual({});
  });

  it('succeeds as a no-op when the plan is already empty', () => {
    const ctx = makeMiningContext();

    const result = drillPlanCommand(ctx, ['clear'], {});

    expect(result.success).toBe(true);
    expect(ctx.state!.drillHoles).toEqual([]);
  });
});

// ── drill_plan grid — bounds (#572) ─────────────────────────────────────────
// A crafted `drill_plan grid --rows/--cols` currently builds the full
// rows×cols hole array (and dispatches a drill_hole action per hole) before
// any claim or cost check runs — unbounded console input straight into a
// double loop, same failure class as #558/#569's claimArea bridge-walk fix.
// These tests pin the guard the plan calls for: reject before
// createGridPlan ever builds the grid.
describe('drillPlanCommand — grid subcommand bounds (#572)', () => {
  it('rejects non-finite rows with a positive-whole-number message, leaving the plan untouched', () => {
    const ctx = makeMiningContext();
    const holesBefore = ctx.state!.plannedDrillHoles.length;

    const result = drillPlanCommand(ctx, ['grid'], { rows: 'abc', cols: '3', spacing: '3', depth: '6' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('rows');
    expect(result.output).toContain('cols');
    expect(result.output.toLowerCase()).toContain('positive whole number');
    expect(ctx.state!.plannedDrillHoles.length).toBe(holesBefore);
  });

  it('rejects non-finite cols with a positive-whole-number message, leaving the plan untouched', () => {
    const ctx = makeMiningContext();
    const holesBefore = ctx.state!.plannedDrillHoles.length;

    const result = drillPlanCommand(ctx, ['grid'], { rows: '3', cols: 'xyz', spacing: '3', depth: '6' });

    expect(result.success).toBe(false);
    expect(result.output.toLowerCase()).toContain('positive whole number');
    expect(ctx.state!.plannedDrillHoles.length).toBe(holesBefore);
  });

  it('rejects rows:0, leaving the plan untouched', () => {
    const ctx = makeMiningContext();
    const holesBefore = ctx.state!.plannedDrillHoles.length;

    const result = drillPlanCommand(ctx, ['grid'], { rows: '0', cols: '3', spacing: '3', depth: '6' });

    expect(result.success).toBe(false);
    expect(ctx.state!.plannedDrillHoles.length).toBe(holesBefore);
  });

  it('rejects a negative cols, leaving the plan untouched', () => {
    const ctx = makeMiningContext();
    const holesBefore = ctx.state!.plannedDrillHoles.length;

    const result = drillPlanCommand(ctx, ['grid'], { rows: '3', cols: '-2', spacing: '3', depth: '6' });

    expect(result.success).toBe(false);
    expect(ctx.state!.plannedDrillHoles.length).toBe(holesBefore);
  });

  it('rejects a grid whose rows*cols exceeds MAX_DRILL_GRID_HOLES, naming the computed count and the limit', () => {
    const ctx = makeMiningContext();
    const holesBefore = ctx.state!.plannedDrillHoles.length;
    // 101 * 100 = 10,100 — one row over the limit.
    const rows = 101, cols = 100;

    const result = drillPlanCommand(ctx, ['grid'], {
      rows: String(rows), cols: String(cols), spacing: '0.01', depth: '6',
    });

    expect(result.success).toBe(false);
    expect(result.output.toLowerCase()).toContain('too large');
    expect(result.output).toMatch(/10,?100/);
    expect(result.output).toMatch(/10,?000/);
    expect(ctx.state!.plannedDrillHoles.length).toBe(holesBefore);
  });

  it('accepts a grid exactly at MAX_DRILL_GRID_HOLES (boundary)', () => {
    const ctx = makeMiningContext();
    // 100 * 100 = 10,000 exactly. Tiny spacing keeps the whole grid on the
    // already-generated site so no expansion/claim bridging is involved —
    // isolates the rows*cols bound from claimArea's own bound (#558/#569).
    const result = drillPlanCommand(ctx, ['grid'], {
      rows: '100', cols: '100', spacing: '0.01', depth: '6',
    });

    expect(result.success).toBe(true);
    expect(ctx.state!.plannedDrillHoles.length).toBe(MAX_DRILL_GRID_HOLES);
  });

  it('rejects a grid one hole over MAX_DRILL_GRID_HOLES (rows*cols === MAX_DRILL_GRID_HOLES + 1)', () => {
    const ctx = makeMiningContext();
    const holesBefore = ctx.state!.plannedDrillHoles.length;

    const result = drillPlanCommand(ctx, ['grid'], {
      rows: '10001', cols: '1', spacing: '0.01', depth: '6',
    });

    expect(result.success).toBe(false);
    expect(ctx.state!.plannedDrillHoles.length).toBe(holesBefore);
  });

  it('refuses an astronomically large grid in bounded time, not by building rows*cols holes (#572)', () => {
    // rows:100000 cols:100000 is 10^10 holes — an unbounded implementation
    // would exhaust memory or hang well past the threshold below building
    // the array (and dispatching one drill_hole action per hole) before ever
    // reaching a claim or cost check. Mirrors PlayableArea.test.ts's #558
    // "refuses an astronomically distant target ... in bounded time" test.
    const ctx = makeMiningContext();
    const holesBefore = ctx.state!.plannedDrillHoles.length;

    const start = Date.now();
    const result = drillPlanCommand(ctx, ['grid'], {
      rows: '100000', cols: '100000', spacing: '3', depth: '6',
    });
    const elapsed = Date.now() - start;

    expect(result.success).toBe(false);
    expect(ctx.state!.plannedDrillHoles.length).toBe(holesBefore);
    expect(elapsed).toBeLessThan(200);
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
    expect(ctx.state!.softwareTier).toBe(1);
  });

  it('mirrors the deduction in state.finances.cash, not just the flat field', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    ctx.state!.finances.cash = 999_999;
    const cashBefore = ctx.state!.cash;

    const result = buySoftwareCommand(ctx, [], { tier: '1' });

    expect(result.success).toBe(true);
    expect(ctx.state!.finances.cash).toBe(ctx.state!.cash);
    expect(ctx.state!.cash).toBeLessThan(cashBefore);
    const entry = ctx.state!.finances.transactions.find(t => t.category === 'equipment');
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('expense');
    expect(entry!.description).toContain('Software tier 1');
  });

  it('tier:1 when at tier 0 succeeds', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    const result = buySoftwareCommand(ctx, [], { tier: '1' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('tier 1');
    expect(ctx.state!.softwareTier).toBe(1);
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
    ctx.state!.softwareTier = 1;
    const result = buySoftwareCommand(ctx, [], { tier: '1' });
    expect(result.success).toBe(false);
    expect(result.output).toBe('Already at tier 1 or higher');
  });

  it('tier:0 when at tier 1 returns error "Already at tier 0 or higher"', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    ctx.state!.softwareTier = 1;
    const result = buySoftwareCommand(ctx, [], { tier: '0' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('Already at tier');
  });
});

describe('tubingCommand — buy subcommand', () => {
  it('deducts cash and adds to inventory', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    const result = tubingCommand(ctx, ['buy'], { amount: '4' });
    expect(result.success).toBe(true);
    expect(ctx.state!.tubingState.inventory).toBe(4);
    expect(ctx.state!.cash).toBe(999_999 - 4 * TUBING_COST);
  });

  it('mirrors the deduction in state.finances.cash, not just the flat field', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    ctx.state!.finances.cash = 999_999;
    const cashBefore = ctx.state!.cash;

    const result = tubingCommand(ctx, ['buy'], { amount: '4' });

    expect(result.success).toBe(true);
    expect(ctx.state!.finances.cash).toBe(ctx.state!.cash);
    expect(ctx.state!.cash).toBeLessThan(cashBefore);
    const entry = ctx.state!.finances.transactions.find(t => t.category === 'equipment' && t.description.startsWith('Tubing'));
    expect(entry).toBeDefined();
    expect(entry!.type).toBe('expense');
    expect(entry!.description).toBe('Tubing x4');
  });
});

// ── blast_preview ─────────────────────────────────────────────────────────────

describe('blast_preview', () => {
  /**
   * Helper: create a mining context with a single-hole plan already set up
   * (1 hole, 1 charge, 1 sequence delay). Optionally sets software tier.
   */
  function makePlan(ctx: MiningContext, tier?: number): void {
    if (tier !== undefined) ctx.state!.softwareTier = tier;
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    driveChargePlanToCompletion(ctx);
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });
  }

  // ── guard: no game loaded ───────────────────────────────────────────────────

  it('returns success:false with "No game loaded" when ctx.state is null', () => {
    const ctx: MiningContext = {
      state: null,
      grid: null,
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
    driveDrillPlanToCompletion(ctx);
    const result = blastPreviewCommand(ctx, [], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('Missing charge');
  });

  // ── software tier 0 — all locked ────────────────────────────────────────────

  it('tier 0 — complete plan, all sections require higher software tier', () => {
    const ctx = makeMiningContext();
    makePlan(ctx);

    const result = blastPreviewCommand(ctx, [], {});
    expect(result.success).toBe(true);
    const matches = result.output.match(/Requires software tier/g);
    expect(matches).toHaveLength(4);
  });

  // ── software tier 1 — energy unlocked ───────────────────────────────────────

  it('tier 1 — energy section shows data, fragmentation+projections+vibrations require higher tier', () => {
    const ctx = makeMiningContext();
    makePlan(ctx, 1);

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
    makePlan(ctx, 2);

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
    makePlan(ctx, 3);

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
    makePlan(ctx, 4);

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

// ── blast_preview — state.lastBlastPreview ───────────────────────────────────

describe('blast_preview — state.lastBlastPreview', () => {
  function makePlan(ctx: MiningContext, tier?: number): void {
    if (tier !== undefined) ctx.state!.softwareTier = tier;
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    driveChargePlanToCompletion(ctx);
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });
  }

  it('is null before any preview has run', () => {
    const ctx = makeMiningContext();
    expect(ctx.state!.lastBlastPreview).toBeNull();
  });

  it('stays untouched (does not throw) when the guard rejects the run', () => {
    const ctx = makeMiningContext();
    blastPreviewCommand(ctx, [], {});
    expect(ctx.state!.lastBlastPreview).toBeNull();
  });

  it('tier 0 — every section is null, tier is recorded', () => {
    const ctx = makeMiningContext();
    makePlan(ctx);

    blastPreviewCommand(ctx, [], {});

    expect(ctx.state!.lastBlastPreview).toEqual({
      tier: 0, energy: null, fragments: null, projections: null, vibrations: null,
    });
  });

  it('tier 1 — energy populated with real numbers, later sections still null', () => {
    const ctx = makeMiningContext();
    makePlan(ctx, 1);

    blastPreviewCommand(ctx, [], {});

    const preview = ctx.state!.lastBlastPreview!;
    expect(preview.tier).toBe(1);
    expect(preview.energy).not.toBeNull();
    expect(preview.energy!.affectedVoxels).toBeGreaterThan(0);
    expect(preview.energy!.maxEnergy).toBeGreaterThanOrEqual(preview.energy!.minEnergy);
    expect(preview.fragments).toBeNull();
    expect(preview.projections).toBeNull();
    expect(preview.vibrations).toBeNull();
  });

  it('tier 2 — fragments populated, avgFragmentSizeCm converted from the raw 0-1 fraction', () => {
    const ctx = makeMiningContext();
    makePlan(ctx, 2);

    blastPreviewCommand(ctx, [], {});

    const fragments = ctx.state!.lastBlastPreview!.fragments!;
    expect(fragments.fractured + fragments.cracked + fragments.unaffected).toBeGreaterThan(0);
    // A fraction of one voxel edge (VOXEL_SIZE_CM=100) never exceeds 100cm.
    expect(fragments.avgFragmentSizeCm).toBeGreaterThan(0);
    expect(fragments.avgFragmentSizeCm).toBeLessThanOrEqual(100);
  });

  it('tier 3 — projections populated with a non-negative collapseFragments', () => {
    const ctx = makeMiningContext();
    makePlan(ctx, 3);

    blastPreviewCommand(ctx, [], {});

    const projections = ctx.state!.lastBlastPreview!.projections!;
    expect(projections.projectionZoneVoxels).toBeGreaterThanOrEqual(0);
    expect(projections.collapseFragments).toBeGreaterThanOrEqual(0);
  });

  it('tier 4 — vibrations populated (0 affected villages: none are wired into this command yet)', () => {
    const ctx = makeMiningContext();
    makePlan(ctx, 4);

    blastPreviewCommand(ctx, [], {});

    const preview = ctx.state!.lastBlastPreview!;
    expect(preview.vibrations).not.toBeNull();
    expect(preview.vibrations!.affectedVillages).toBe(0);
    expect(preview.fragments).not.toBeNull();
    expect(preview.projections).not.toBeNull();
  });

  it('a later run overwrites the earlier snapshot rather than merging it', () => {
    const ctx = makeMiningContext();
    makePlan(ctx, 1);
    blastPreviewCommand(ctx, [], {});
    expect(ctx.state!.lastBlastPreview!.tier).toBe(1);

    ctx.state!.softwareTier = 4;
    blastPreviewCommand(ctx, [], {});

    expect(ctx.state!.lastBlastPreview!.tier).toBe(4);
    expect(ctx.state!.lastBlastPreview!.vibrations).not.toBeNull();
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

  // ── off-site coordinates: claim or refuse, never a silent no-op (#473 D5) ──

  it('claims the ground west of the site and surveys it', () => {
    const ctx = makeMiningContext();
    hireSurveyor(ctx);
    const result = surveyCommand(ctx, ['seismic'], { x: '-1', z: '10' });
    expect(result.success).toBe(true);
    // The claim now covers the survey's full seismic coverage disc (#558),
    // not just the center cell — a 20m-radius disc around x=-1 reaches into
    // the chunk at cx=-2 (minX=-32), one chunk further than the single cell.
    expect(ctx.grid!.minX).toBe(-32);
    expect(ctx.grid!.containsColumn(-1, 10)).toBe(true);
  });

  it('bridges to ground several chunks past the site instead of refusing it', () => {
    const ctx = makeMiningContext();
    hireSurveyor(ctx);
    // makeMiningContext creates a 32×32 site; (100, 10) is several chunks past
    // it, well within MAX_CLAIM_BRIDGE_CHUNKS — the site bridges out to reach
    // it rather than refusing it (#558).
    const result = surveyCommand(ctx, ['seismic'], { x: '100', z: '10' });
    expect(result.success).toBe(true);
    expect(ctx.grid!.containsColumn(100, 10)).toBe(true);
  });

  it('refuses a survey too far south for the site to bridge in one action', () => {
    const ctx = makeMiningContext();
    hireSurveyor(ctx);
    const result = surveyCommand(ctx, ['aerial'], { x: '10', z: '800' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('too far');
  });

  it('does not deduct cash for a survey on ground the site cannot reach', () => {
    const ctx = makeMiningContext();
    hireSurveyor(ctx);
    ctx.state!.cash = 10_000;
    surveyCommand(ctx, ['seismic'], { x: '500', z: '5' });
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

  // ── GameState.lastOreReport wiring (issue #412) ───────────────────────────

  it('leaves state.lastOreReport null before any blast has been executed', () => {
    const ctx = makeMiningContext();
    expect(ctx.state!.lastOreReport).toBeNull();
  });

  it('populates state.lastOreReport with the computed BlastOreReport after a blast', () => {
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
    vi.spyOn(SurveyCalcModule, 'computeBlastOreReport').mockReturnValue(mockedReport);

    const result = blastCommand(ctx, [], {});

    expect(result.success).toBe(true);
    expect(ctx.state!.lastOreReport).not.toBeNull();
    expect(ctx.state!.lastOreReport).toEqual(mockedReport);
  });

  // ── GameState.lastBlastReport wiring (redesign P4/§5.A) ───────────────────

  it('leaves state.lastBlastReport null before any blast has been executed', () => {
    const ctx = makeMiningContext();
    expect(ctx.state!.lastBlastReport).toBeNull();
  });

  it('populates state.lastBlastReport with tick, rating, and spent after a blast', () => {
    const ctx = makeMiningContext();

    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    driveChargePlanToCompletion(ctx);
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });
    // #554: charging is real work — driveChargePlanToCompletion above ticks
    // the clock forward, so the tick this report should carry is set here,
    // right before blasting, not before the charge (and its own ticks) ran.
    ctx.state!.tickCount = 7;

    const result = blastCommand(ctx, [], {});

    expect(result.success).toBe(true);
    const report = ctx.state!.lastBlastReport;
    expect(report).not.toBeNull();
    expect(report!.tick).toBe(7);
    expect(report!.spent).toBe(60); // boomite $12/kg × 5kg
    expect(['perfect', 'good', 'mediocre', 'bad', 'catastrophic']).toContain(report!.rating);
    expect(report!.clearedVoxels).toBeGreaterThanOrEqual(0);
  });

  it('sums spent across every charged hole, not just the last one', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '2', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
    chargeCommand(ctx, [], { hole: '*', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    driveChargePlanToCompletion(ctx);
    sequenceCommand(ctx, ['auto'], {});

    const result = blastCommand(ctx, [], {});

    expect(result.success).toBe(true);
    expect(ctx.state!.lastBlastReport!.spent).toBe(120); // 2 holes × $12/kg × 5kg
  });
});

// ── survey mode / ore_report subcommands (issue #412) ──────────────────────

describe('surveyCommand — mode subcommand', () => {
  it('returns success:true, not the "not implemented" stub placeholder', () => {
    const ctx = makeMiningContext();
    const result = surveyCommand(ctx, ['mode'], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toBe('not implemented');
  });

  it('reports zero completed surveys when none have run yet', () => {
    const ctx = makeMiningContext();
    const result = surveyCommand(ctx, ['mode'], {});
    expect(result.success).toBe(true);
    expect(result.output.toLowerCase()).toMatch(/survey/);
    expect(result.output).toMatch(/\b0\b/);
  });

  it('reflects the count of completed surveys in state.surveyResults', () => {
    const ctx = makeMiningContext();
    ctx.state!.surveyResults.push({
      id: 1,
      method: 'seismic',
      centerX: 10,
      centerZ: 10,
      completedTick: 5,
      surveyorId: 1,
      estimates: {},
      confidence: 0.9,
    });

    const result = surveyCommand(ctx, ['mode'], {});
    expect(result.success).toBe(true);
    expect(result.output).toMatch(/\b1\b/);
  });

  it('requires a loaded game', () => {
    const ctx: MiningContext = {
      state: null, grid: null,
      emitter: new EventEmitter(),
    };
    const result = surveyCommand(ctx, ['mode'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });
});

describe('surveyCommand — ore_report subcommand', () => {
  it('returns success:false with a clear message when no ore report exists yet', () => {
    const ctx = makeMiningContext();
    expect(ctx.state!.lastOreReport).toBeNull();

    const result = surveyCommand(ctx, ['ore_report'], {});
    expect(result.success).toBe(false);
    expect(result.output).not.toBe('not implemented');
    expect(result.output.toLowerCase()).toMatch(/no.*(ore report|blast)/);
  });

  it('formats yield, estimate, and ratio data from a populated lastOreReport', () => {
    const ctx = makeMiningContext();
    ctx.state!.lastOreReport = {
      oreYields: { dirtite: 1300 },
      totalYieldKg: 1300,
      estimatedYieldKg: 1000,
      yieldRatio: 1.3,
      hasTreranium: false,
      absurdiumFraction: 0,
    };

    const result = surveyCommand(ctx, ['ore_report'], {});
    expect(result.success).toBe(true);
    expect(result.output).toContain('dirtite');
    expect(result.output).toMatch(/1300/);
    expect(result.output).toMatch(/1000/);
    // Ratio 1.3 → 130% (or "1.3" / "1.30" depending on format) must appear somewhere
    expect(result.output).toMatch(/130%|1\.3\b/);
  });

  it('does not crash or print NaN% when estimatedYieldKg is 0 and yieldRatio is 1.0', () => {
    const ctx = makeMiningContext();
    ctx.state!.lastOreReport = {
      oreYields: {},
      totalYieldKg: 0,
      estimatedYieldKg: 0,
      yieldRatio: 1.0,
      hasTreranium: false,
      absurdiumFraction: 0,
    };

    const result = surveyCommand(ctx, ['ore_report'], {});
    expect(result.success).toBe(true);
    expect(result.output).not.toMatch(/NaN/);
  });

  it('requires a loaded game', () => {
    const ctx: MiningContext = {
      state: null, grid: null,
      emitter: new EventEmitter(),
    };
    const result = surveyCommand(ctx, ['ore_report'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });
});

// ── chargeCommand — stemming floor (#527) ───────────────────────────────────
// Mirrors the UI's existing 0.5m stemming floor (Charge.ts adjustStemming) so
// a console `charge` command can never under-stem what a player could ever click.

describe('chargeCommand — stemming floor', () => {
  it('a single-hole charge below MIN_STEMMING_M returns success:false and names the refusal', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);

    const result = chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '0.2m' });

    expect(result.success).toBe(false);
    expect(result.output.toLowerCase()).toContain('stemming');
    expect(result.output.toLowerCase()).toContain('minimum');
  });

  it('does not write a charge to state for the refused hole', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);

    chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '0.2m' });

    expect(ctx.state!.chargesByHole['H1']).toBeUndefined();
  });

  it('a stemming value exactly at MIN_STEMMING_M is accepted (boundary)', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);

    const result = chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: `${MIN_STEMMING_M}m` });

    expect(result.success).toBe(true);
    driveChargePlanToCompletion(ctx);
    expect(ctx.state!.chargesByHole['H1']).toBeDefined();
    expect(ctx.state!.chargesByHole['H1']!.stemmingM).toBe(MIN_STEMMING_M);
  });

  it('a batch charge (hole:*) below MIN_STEMMING_M refuses and writes no charges', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '2', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);

    const result = chargeCommand(ctx, [], { hole: '*', explosive: 'boomite', amount: '5kg', stemming: '0.2m' });

    expect(result.success).toBe(false);
    expect(result.output.toLowerCase()).toContain('stemming');
    expect(Object.keys(ctx.state!.chargesByHole).length).toBe(0);
  });

  it('omitting the stemming: argument entirely defaults to MIN_STEMMING_M and succeeds', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);

    const result = chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg' });

    expect(result.success).toBe(true);
    driveChargePlanToCompletion(ctx);
    expect(ctx.state!.chargesByHole['H1']).toBeDefined();
    expect(ctx.state!.chargesByHole['H1']!.stemmingM).toBe(MIN_STEMMING_M);
  });
});

// ── chargeCommand — hole id resolution (#634) ───────────────────────────────
// Characterizes the inline ternary at the top of chargeCommand's non-'*'
// branch: a spec matching a real drilled OR planned hole id resolves to that
// exact id; anything else falls back to the legacy hole_${spec} form.
// Unlike sequenceCommand/tubingCommand below, chargeCommand DOES check the
// planned pool — that's the intentional divergence pinned in case 4/5.

describe('chargeCommand — hole id resolution', () => {
  it('a spec matching a drilled hole\'s real id resolves and charges it', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
    const holeId = ctx.state!.drillHoles[0]!.id;

    const result = chargeCommand(ctx, [], { hole: holeId, explosive: 'boomite', amount: '5kg', stemming: '2m' });

    expect(result.success).toBe(true);
    driveChargePlanToCompletion(ctx);
    expect(ctx.state!.chargesByHole[holeId]).toBeDefined();
  });

  it('a spec matching only a planned (not-drilled) hole\'s real id resolves to that id and reports "has not been drilled yet."', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    const holeId = ctx.state!.plannedDrillHoles[0]!.id;
    expect(ctx.state!.drillHoles).toEqual([]);

    const result = chargeCommand(ctx, [], { hole: holeId, explosive: 'boomite', amount: '5kg', stemming: '2m' });

    expect(result.success).toBe(false);
    expect(result.output).toBe(`Hole "${holeId}" has not been drilled yet.`);
  });

  it('a spec matching neither pool, not already hole_-prefixed, reports Hole "hole_<spec>" not found', () => {
    const ctx = makeMiningContext();

    const result = chargeCommand(ctx, [], { hole: '42', explosive: 'boomite', amount: '5kg', stemming: '2m' });

    expect(result.success).toBe(false);
    expect(result.output).toBe('Hole "hole_42" not found');
  });

  it('a spec matching neither pool, already hole_-prefixed, reports Hole "<spec>" not found (not doubled)', () => {
    const ctx = makeMiningContext();

    const result = chargeCommand(ctx, [], { hole: 'hole_42', explosive: 'boomite', amount: '5kg', stemming: '2m' });

    expect(result.success).toBe(false);
    expect(result.output).toBe('Hole "hole_42" not found');
  });
});

// ── sequenceCommand set — hole id resolution (#634) ─────────────────────────
// Characterizes the inline ternary in sequenceCommand's 'set' branch: unlike
// chargeCommand, this one checks ONLY state.drillHoles, never
// plannedDrillHoles — an existing, intentional divergence pinned here as
// current behavior, not treated as a bug.

describe('sequenceCommand — set subcommand, hole id resolution', () => {
  it('a spec matching a drilled hole\'s real id resolves and sets sequenceDelays under that exact key', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
    const holeId = ctx.state!.drillHoles[0]!.id;

    const result = sequenceCommand(ctx, ['set'], { hole: holeId, delay: '25ms' });

    expect(result.success).toBe(true);
    expect(ctx.state!.sequenceDelays[holeId]).toBe(25);
  });

  it('a spec matching only a planned (undrilled) hole\'s real id does NOT resolve to that id — falls through to the hole_${spec} legacy form', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    const holeId = ctx.state!.plannedDrillHoles[0]!.id;
    expect(ctx.state!.drillHoles).toEqual([]);

    const result = sequenceCommand(ctx, ['set'], { hole: holeId, delay: '25ms' });

    expect(result.success).toBe(true);
    // NOT set under the planned hole's own real id...
    expect(ctx.state!.sequenceDelays[holeId]).toBeUndefined();
    // ...instead set under the legacy hole_<spec> fallback form.
    expect(ctx.state!.sequenceDelays[`hole_${holeId}`]).toBe(25);
  });
});

// ── tubingCommand install — hole id resolution (#634) ───────────────────────
// Characterizes the inline ternary in tubingCommand's 'install' branch —
// behaviorally identical to sequenceCommand's: checks only state.drillHoles,
// never plannedDrillHoles.

describe('tubingCommand — install subcommand, hole id resolution', () => {
  it('a spec matching a drilled hole\'s real id resolves and installs tubing under that exact id', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    tubingCommand(ctx, ['buy'], { amount: '1' });
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
    const holeId = ctx.state!.drillHoles[0]!.id;

    const result = tubingCommand(ctx, ['install'], { hole: holeId });

    expect(result.success).toBe(true);
    expect(result.output).toBe(`Tubing installed on hole ${holeId}`);
    expect(ctx.state!.tubingState.installedHoles.has(holeId)).toBe(true);
  });

  it('a spec matching only a planned (undrilled) hole\'s real id falls through to the hole_${spec} legacy form, exactly mirroring sequenceCommand', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    tubingCommand(ctx, ['buy'], { amount: '1' });
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    const holeId = ctx.state!.plannedDrillHoles[0]!.id;
    expect(ctx.state!.drillHoles).toEqual([]);

    const result = tubingCommand(ctx, ['install'], { hole: holeId });

    expect(result.success).toBe(true);
    expect(result.output).toBe(`Tubing installed on hole hole_${holeId}`);
    expect(ctx.state!.tubingState.installedHoles.has(holeId)).toBe(false);
    expect(ctx.state!.tubingState.installedHoles.has(`hole_${holeId}`)).toBe(true);
  });

  it('a spec matching neither pool (bare number, no hole_ prefix) resolves to hole_<spec>, reporting the exact current duplicate message', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 999_999;
    tubingCommand(ctx, ['buy'], { amount: '1' });
    // Pre-seed the fallback id as already installed so the resolved id shows
    // up verbatim in the response, proving resolution landed on hole_42
    // rather than "42" or some doubled form.
    ctx.state!.tubingState.installedHoles.add('hole_42');

    const result = tubingCommand(ctx, ['install'], { hole: '42' });

    expect(result.success).toBe(false);
    expect(result.output).toBe('Tubing already installed on hole hole_42');
  });
});

describe('buildRampCommand', () => {
  it('builds a ramp from origin/direction/length and deducts cost', () => {
    const ctx = makeMiningContext();
    const cashBefore = ctx.state!.cash;

    const result = buildRampCommand(ctx, [], {
      origin: '5,5', direction: 'south', length: '5', depth: '8',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Ramp ordered');
    expect(ctx.state!.cash).toBe(cashBefore - 5 * RAMP_COST_PER_METER);
  });

  it('builds a ramp from start/end and infers direction and length', () => {
    const ctx = makeMiningContext();
    const cashBefore = ctx.state!.cash;

    const result = buildRampCommand(ctx, [], { start: '5,5', end: '5,10', depth: '6' });

    expect(result.success).toBe(true);
    // Inferred length = |10 - 5| = 5
    expect(ctx.state!.cash).toBe(cashBefore - 5 * RAMP_COST_PER_METER);
  });

  it('deducts the cost from finances.cash too, not just the flat cash field', () => {
    const ctx = makeMiningContext();
    const cashBefore = ctx.state!.cash;

    buildRampCommand(ctx, [], { origin: '5,5', direction: 'south', length: '5', depth: '8' });

    expect(ctx.state!.finances.cash).toBe(cashBefore - 5 * RAMP_COST_PER_METER);
    expect(ctx.state!.finances.cash).toBe(ctx.state!.cash);
  });

  it('returns an error and does not deduct cash when funds are insufficient', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 10;
    const cashBefore = ctx.state!.cash;

    const result = buildRampCommand(ctx, [], {
      origin: '5,5', direction: 'south', length: '5', depth: '8',
    });

    expect(result.success).toBe(false);
    expect(ctx.state!.cash).toBe(cashBefore);
  });

  it('requires a loaded game', () => {
    const ctx: MiningContext = {
      state: null, grid: null,
      emitter: new EventEmitter(),
    };
    const result = buildRampCommand(ctx, [], { origin: '0,0', direction: 'south', length: '5' });
    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });
});

// ── build_ramp — length bounds (#572) ───────────────────────────────────────
// `length` (direct --length, or derived from --start/--end as
// Math.abs(Math.round(dx or dz))) has no Number.isFinite check and no upper
// bound before rampFootprint/cellsInRect build the footprint — unbounded
// console input straight into a double loop, same failure class as the grid
// bound above and #558/#569's claimArea bridge-walk fix.
describe('buildRampCommand — length bounds (#572)', () => {
  it('rejects a non-finite length derived from --start/--end producing Infinity', () => {
    // "Infinity" is a valid Number() literal: Number('Infinity') === Infinity.
    // dx = Infinity - 0, so length = Math.abs(Math.round(Infinity)) = Infinity —
    // the specific Number.isFinite gap the issue calls out.
    const ctx = makeMiningContext();
    ctx.state!.cash = 10_000_000;
    ctx.state!.finances.cash = 10_000_000;
    const cashBefore = ctx.state!.cash;
    const rampsBefore = ctx.state!.plannedRamps.length;

    const result = buildRampCommand(ctx, [], { start: '0,10', end: 'Infinity,10', depth: '8' });

    expect(result.success).toBe(false);
    expect(result.output.toLowerCase()).toContain('finite');
    expect(ctx.state!.cash).toBe(cashBefore);
    expect(ctx.state!.plannedRamps.length).toBe(rampsBefore);
  });

  it('rejects length:0 with a positive-length message, no cash deducted', () => {
    const ctx = makeMiningContext();
    const cashBefore = ctx.state!.cash;
    const rampsBefore = ctx.state!.plannedRamps.length;

    const result = buildRampCommand(ctx, [], { origin: '0,0', direction: 'south', length: '0', depth: '8' });

    expect(result.success).toBe(false);
    expect(result.output.toLowerCase()).toContain('positive');
    expect(ctx.state!.cash).toBe(cashBefore);
    expect(ctx.state!.plannedRamps.length).toBe(rampsBefore);
  });

  it('rejects a negative length with a positive-length message, no cash deducted', () => {
    const ctx = makeMiningContext();
    const cashBefore = ctx.state!.cash;
    const rampsBefore = ctx.state!.plannedRamps.length;

    const result = buildRampCommand(ctx, [], { origin: '0,0', direction: 'south', length: '-5', depth: '8' });

    expect(result.success).toBe(false);
    expect(result.output.toLowerCase()).toContain('positive');
    expect(ctx.state!.cash).toBe(cashBefore);
    expect(ctx.state!.plannedRamps.length).toBe(rampsBefore);
  });

  it('rejects a direct --length exceeding MAX_RAMP_LENGTH, naming the length and the limit', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 10_000_000;
    ctx.state!.finances.cash = 10_000_000;
    const cashBefore = ctx.state!.cash;
    const rampsBefore = ctx.state!.plannedRamps.length;

    const result = buildRampCommand(ctx, [], { origin: '0,0', direction: 'east', length: '5000', depth: '8' });

    expect(result.success).toBe(false);
    expect(result.output.toLowerCase()).toContain('too long');
    expect(result.output).toContain('5000');
    expect(result.output).toMatch(/1,?000/);
    expect(ctx.state!.cash).toBe(cashBefore);
    expect(ctx.state!.plannedRamps.length).toBe(rampsBefore);
  });

  it('rejects a --start/--end delta exceeding MAX_RAMP_LENGTH, naming the length and the limit', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 10_000_000;
    ctx.state!.finances.cash = 10_000_000;
    const cashBefore = ctx.state!.cash;
    const rampsBefore = ctx.state!.plannedRamps.length;

    const result = buildRampCommand(ctx, [], { start: '0,10', end: '5000,10', depth: '8' });

    expect(result.success).toBe(false);
    expect(result.output.toLowerCase()).toContain('too long');
    expect(ctx.state!.cash).toBe(cashBefore);
    expect(ctx.state!.plannedRamps.length).toBe(rampsBefore);
  });

  it('accepts a ramp exactly at MAX_RAMP_LENGTH (boundary)', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 10_000_000;
    ctx.state!.finances.cash = 10_000_000;

    // Extend the site east in bridgeable (<=384 voxel) steps first — a bare
    // 1000m ramp from an untouched 32-voxel site would be refused as
    // too_far by claimArea's own bound (#558/#569), which is a different
    // limit than the one under test here.
    for (const x of [16, 380, 750, 1010]) {
      const claimResult = drillPlanCommand(ctx, ['add'], { x: String(x), z: '10', depth: '1' });
      expect(claimResult.success).toBe(true);
    }

    const result = buildRampCommand(ctx, [], { origin: '0,10', direction: 'east', length: '1000', depth: '8' });

    expect(result.success).toBe(true);
    expect(ctx.state!.plannedRamps[ctx.state!.plannedRamps.length - 1]!.def.length).toBe(MAX_RAMP_LENGTH);
  });

  it('rejects a ramp one metre over MAX_RAMP_LENGTH (length === MAX_RAMP_LENGTH + 1)', () => {
    const ctx = makeMiningContext();
    ctx.state!.cash = 10_000_000;
    ctx.state!.finances.cash = 10_000_000;
    const cashBefore = ctx.state!.cash;
    const rampsBefore = ctx.state!.plannedRamps.length;

    const result = buildRampCommand(ctx, [], { origin: '0,10', direction: 'east', length: '1001', depth: '8' });

    expect(result.success).toBe(false);
    expect(ctx.state!.cash).toBe(cashBefore);
    expect(ctx.state!.plannedRamps.length).toBe(rampsBefore);
  });

  it('refuses an astronomically long direct --length in bounded time, no cash deducted, no ramp queued (#572)', () => {
    // --length 100000000 mirrors PlayableArea.test.ts's #558 bounded-time
    // test: an unbounded implementation builds a length x RAMP_WIDTH
    // footprint (cellsInRect) before any claim or cost check, exhausting
    // memory well past the threshold below.
    const ctx = makeMiningContext();
    ctx.state!.cash = 10_000_000_000;
    ctx.state!.finances.cash = 10_000_000_000;
    const cashBefore = ctx.state!.cash;
    const rampsBefore = ctx.state!.plannedRamps.length;

    const start = Date.now();
    const result = buildRampCommand(ctx, [], { origin: '0,0', direction: 'east', length: '100000000', depth: '8' });
    const elapsed = Date.now() - start;

    expect(result.success).toBe(false);
    expect(ctx.state!.cash).toBe(cashBefore);
    expect(ctx.state!.plannedRamps.length).toBe(rampsBefore);
    expect(elapsed).toBeLessThan(200);
  });

  it('refuses a --start/--end delta producing an astronomical finite length in bounded time (#572)', () => {
    // 1e300 is finite (well under Number.MAX_VALUE) but astronomically over
    // MAX_RAMP_LENGTH — proves the bound catches a huge *finite* derived
    // length, not just the Infinity case above.
    const ctx = makeMiningContext();
    ctx.state!.cash = 10_000_000_000;
    ctx.state!.finances.cash = 10_000_000_000;
    const cashBefore = ctx.state!.cash;
    const rampsBefore = ctx.state!.plannedRamps.length;

    const start = Date.now();
    const result = buildRampCommand(ctx, [], { start: '0,0', end: '1e300,0', depth: '8' });
    const elapsed = Date.now() - start;

    expect(result.success).toBe(false);
    expect(ctx.state!.cash).toBe(cashBefore);
    expect(ctx.state!.plannedRamps.length).toBe(rampsBefore);
    expect(elapsed).toBeLessThan(200);
  });
});

// ── build_ramp cancel (#555 code review — no coverage before this) ─────────
// Mirrors #553/#554's drill_hole/charge_hole cancel coverage
// (charge-plan-queueing.test.ts's "employee cancel <id>" describe block):
// cancelling a ramp order must keep already-carved terrain carved, refund
// only the unspent remainder, clear the PlannedRamp/ghosts, and the generic
// `employee cancel <id>` path (Operations panel single-segment cancel) must
// touch only the one segment cancelled, not the whole ramp.
//
// Segment 0 is completed the same way the real tick-completion handler
// (console/commands/events.ts's 'dig_ramp_segment' branch) does — carving its
// cells via carveRampSegment and marking its RampSegmentTracker.done — rather
// than driving a full navmesh walk through `tick`, which is exercised
// end-to-end by GameLoop.test.ts's dig_ramp_segment describe block already.
describe('build_ramp cancel / employee cancel — ramp segment cancellation (#555)', () => {
  /**
   * Marks ramp segment `index` as carved-and-done, exactly like the real
   * tick-completion handler (console/commands/events.ts's 'tick' handler):
   * carve the cells, remove the now-finished PendingAction/ghost via
   * completePendingAction (already done by the time that handler's own
   * 'dig_ramp_segment' branch runs), then mark the tracker done.
   */
  function completeSegment(ctx: MiningContext, rampId: number, index: number): void {
    const ramp = ctx.state!.plannedRamps.find(r => r.id === rampId)!;
    const tracker = ramp.segments.find(s => s.index === index)!;
    carveRampSegment(ctx.grid!, { index, cells: tracker.cells, region: tracker.region });
    completePendingAction(ctx.state!, tracker.actionId);
    tracker.done = true;
  }

  it('cancelling a partially-dug ramp keeps already-carved cells carved and refunds only the undone segments', () => {
    const ctx = makeMiningContext();

    const buildResult = buildRampCommand(ctx, [], { origin: '5,5', direction: 'south', length: '5', depth: '8' });
    expect(buildResult.success).toBe(true);
    const ramp = ctx.state!.plannedRamps[0]!;
    const rampId = ramp.id;
    const totalSegments = ramp.segments.length;
    expect(totalSegments).toBeGreaterThan(1);

    // Complete segment 0 for real — carve its cells and mark it done — before
    // the ramp is ever cancelled.
    const doneSegment = ramp.segments[0]!;
    completeSegment(ctx, rampId, doneSegment.index);
    for (const cell of doneSegment.cells) {
      expect(ctx.grid!.densityAt(cell.x, cell.y, cell.z)).toBe(0);
    }

    const cashBeforeCancel = ctx.state!.cash;
    const undoneCount = totalSegments - 1;

    const result = cancelRampCommand(ctx, rampId);

    expect(result.success).toBe(true);
    // Only the undone segments' cost comes back — the done segment's share
    // was already spent on real, carved terrain.
    expect(ctx.state!.cash).toBe(cashBeforeCancel + undoneCount * RAMP_COST_PER_METER);
    expect(ctx.state!.finances.cash).toBe(ctx.state!.cash);

    // Already-carved terrain is untouched by the cancel.
    for (const cell of doneSegment.cells) {
      expect(ctx.grid!.densityAt(cell.x, cell.y, cell.z)).toBe(0);
    }

    // The PlannedRamp is gone entirely.
    expect(ctx.state!.plannedRamps.find(r => r.id === rampId)).toBeUndefined();

    // No dig_ramp_segment action or ghost survives for this ramp.
    const remainingActions = ctx.state!.pendingActions.filter(
      a => a.type === 'dig_ramp_segment' && a.payload['rampId'] === rampId,
    );
    expect(remainingActions).toHaveLength(0);
    const remainingGhosts = ctx.state!.ghostPreviews.filter(g =>
      remainingActions.some(a => a.id === g.id),
    );
    expect(remainingGhosts).toHaveLength(0);
  });

  it('cancelling a non-existent ramp id fails cleanly with no state change', () => {
    const ctx = makeMiningContext();
    buildRampCommand(ctx, [], { origin: '5,5', direction: 'south', length: '5', depth: '8' });
    const cashBefore = ctx.state!.cash;
    const rampsBefore = ctx.state!.plannedRamps.length;
    const actionsBefore = ctx.state!.pendingActions.length;

    const result = cancelRampCommand(ctx, 999999);

    expect(result.success).toBe(false);
    expect(result.output).toBe('Ramp #999999 not found');
    expect(ctx.state!.cash).toBe(cashBefore);
    expect(ctx.state!.plannedRamps).toHaveLength(rampsBefore);
    expect(ctx.state!.pendingActions).toHaveLength(actionsBefore);
  });

  it('the generic "employee cancel <id>" path cancels only one segment of a multi-segment ramp, leaving the rest untouched', () => {
    const ctx = makeMiningContext();

    const buildResult = buildRampCommand(ctx, [], { origin: '5,5', direction: 'south', length: '5', depth: '8' });
    expect(buildResult.success).toBe(true);
    const ramp = ctx.state!.plannedRamps[0]!;
    const rampId = ramp.id;
    const totalSegments = ramp.segments.length;
    expect(totalSegments).toBeGreaterThan(1);

    // Cancel segment index 1 (still queued — segment 0 is the only one
    // claimable first, per isRampSegmentClaimable) via the generic
    // Operations-panel cancel path, not build_ramp's own cancel command.
    const targetTracker = ramp.segments.find(s => s.index === 1)!;
    const otherTrackers = ramp.segments.filter(s => s.index !== 1);
    const cashBefore = ctx.state!.cash;

    const result = employeeCommand(ctx, ['cancel', String(targetTracker.actionId)], {});

    expect(result.success).toBe(true);
    // Only that one segment's cost is refunded.
    expect(ctx.state!.cash).toBe(cashBefore + RAMP_COST_PER_METER);
    expect(ctx.state!.finances.cash).toBe(ctx.state!.cash);

    // The PlannedRamp survives — other segments remain outstanding.
    const survivingRamp = ctx.state!.plannedRamps.find(r => r.id === rampId);
    expect(survivingRamp).toBeDefined();
    expect(survivingRamp!.segments.find(s => s.index === 1)).toBeUndefined();
    expect(survivingRamp!.segments).toHaveLength(totalSegments - 1);

    // Every other segment's own tracking is unaffected.
    for (const other of otherTrackers) {
      const stillThere = survivingRamp!.segments.find(s => s.index === other.index);
      expect(stillThere).toEqual(other);
      const stillQueued = ctx.state!.pendingActions.find(a => a.id === other.actionId);
      expect(stillQueued).toBeDefined();
    }

    // The cancelled segment's own action/ghost are gone.
    expect(ctx.state!.pendingActions.find(a => a.id === targetTracker.actionId)).toBeUndefined();
    expect(ctx.state!.ghostPreviews.find(g => g.id === targetTracker.actionId)).toBeUndefined();
  });
});

// ── #790 characterization tests ─────────────────────────────────────────────
// The refactor extracts requireGameWithSub/dispatchDrillHoleAction/
// assembleCurrentBlastPlan/validateCurrentBlastPlan/formatBlastPlanErrors as
// shared helpers behind drillPlanCommand/sequenceCommand/blastPlanCommand/
// tubingCommand/previewCommand's existing bodies. These tests pin the current,
// pre-refactor observable behavior of those public command functions so the
// refactor can be proven behavior-preserving: they pass today against the
// unmodified bodies and must keep passing unchanged once the helpers are
// wired in.

// ── Cluster 1 — no-game-loaded guard, one command each that currently has no
// dedicated test for it (#790) ──────────────────────────────────────────────

describe('drillPlanCommand — requires a loaded game', () => {
  it('returns success:false with "No game loaded" when ctx.state is null', () => {
    const ctx: MiningContext = { state: null, grid: null, emitter: new EventEmitter() };
    const result = drillPlanCommand(ctx, ['grid'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });
});

describe('sequenceCommand — requires a loaded game', () => {
  it('returns success:false with "No game loaded" when ctx.state is null', () => {
    const ctx: MiningContext = { state: null, grid: null, emitter: new EventEmitter() };
    const result = sequenceCommand(ctx, ['set'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });
});

describe('blastPlanCommand — requires a loaded game', () => {
  it('returns success:false with "No game loaded" when ctx.state is null', () => {
    const ctx: MiningContext = { state: null, grid: null, emitter: new EventEmitter() };
    const result = blastPlanCommand(ctx, ['save'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });
});

describe('tubingCommand — requires a loaded game', () => {
  it('returns success:false with "No game loaded" when ctx.state is null', () => {
    const ctx: MiningContext = { state: null, grid: null, emitter: new EventEmitter() };
    const result = tubingCommand(ctx, ['buy'], {});
    expect(result.success).toBe(false);
    expect(result.output).toContain('No game loaded');
  });
});

// ── Cluster 2 — drill_plan add's dispatched action, currently unasserted in
// payload detail (#790) ─────────────────────────────────────────────────────

describe('drillPlanCommand — add subcommand dispatch (#790 characterization)', () => {
  it('queues one drill_hole PendingAction with the expected payload', () => {
    const ctx = makeMiningContext();

    const result = drillPlanCommand(ctx, ['add'], { x: '5', z: '5', depth: '8', diameter: '0.15' });

    expect(result.success).toBe(true);
    const drillActions = ctx.state!.pendingActions.filter(a => a.type === 'drill_hole');
    expect(drillActions).toHaveLength(1);
    const action = drillActions[0]!;
    expect(action.requiredSkill).toBe('blasting');
    expect(action.requiredVehicleRole).toBe('drill_rig');
    expect(action.targetX).toBe(5);
    expect(action.targetZ).toBe(5);
    expect(action.payload['depth']).toBe(8);
    expect(action.payload['diameter']).toBe(0.15);
    expect(typeof action.payload['durationTicks']).toBe('number');
    expect(action.payload['durationTicks'] as number).toBeGreaterThan(0);
  });

  it('pushes the new hole into plannedDrillHoles', () => {
    const ctx = makeMiningContext();

    const result = drillPlanCommand(ctx, ['add'], { x: '5', z: '5', depth: '8', diameter: '0.15' });

    expect(result.success).toBe(true);
    expect(ctx.state!.plannedDrillHoles).toHaveLength(1);
    const action = ctx.state!.pendingActions.find(a => a.type === 'drill_hole')!;
    expect(ctx.state!.plannedDrillHoles[0]!.id).toBe(action.payload['holeId']);
  });

  it('is additive — a prior grid plan survives a following add', () => {
    const ctx = makeMiningContext();
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '2', spacing: '3', depth: '6' });
    const gridCount = ctx.state!.plannedDrillHoles.length;
    expect(gridCount).toBe(2);

    drillPlanCommand(ctx, ['add'], { x: '5', z: '5', depth: '8', diameter: '0.15' });

    expect(ctx.state!.plannedDrillHoles.length).toBe(gridCount + 1);
  });
});

// ── Cluster 3 — previewCommand has zero direct test coverage today (#790) ──

describe('previewCommand (#790 characterization)', () => {
  /**
   * Mirrors blast_preview's own makePlan helper above: a single-hole plan
   * (1 hole, 1 charge, 1 sequence delay), optionally at a given software tier.
   */
  function makePlan(ctx: MiningContext, tier?: number): void {
    if (tier !== undefined) ctx.state!.softwareTier = tier;
    drillPlanCommand(ctx, ['grid'], { rows: '1', cols: '1', spacing: '3', depth: '8' });
    driveDrillPlanToCompletion(ctx);
    chargeCommand(ctx, [], { hole: 'H1', explosive: 'boomite', amount: '5kg', stemming: '2m' });
    driveChargePlanToCompletion(ctx);
    sequenceCommand(ctx, ['set'], { hole: 'H1', delay: '0ms' });
  }

  it('returns the usage message with no subcommand', () => {
    const ctx = makeMiningContext();
    makePlan(ctx, 4);

    const result = previewCommand(ctx, [], {});

    expect(result.success).toBe(false);
    expect(result.output).toBe('Usage: preview energy|fragments|projections|vibrations');
  });

  it('tier 0 — energy/fragments/projections/vibrations all require higher tier', () => {
    const ctx = makeMiningContext();
    makePlan(ctx, 0);

    const energy = previewCommand(ctx, ['energy'], {});
    expect(energy.success).toBe(false);
    expect(energy.output).toBe('Requires software tier 1+ (current: 0)');

    const fragments = previewCommand(ctx, ['fragments'], {});
    expect(fragments.success).toBe(false);
    expect(fragments.output).toBe('Requires software tier 2+ (current: 0)');

    const projections = previewCommand(ctx, ['projections'], {});
    expect(projections.success).toBe(false);
    expect(projections.output).toBe('Requires software tier 3+ (current: 0)');

    const vibrations = previewCommand(ctx, ['vibrations'], {});
    expect(vibrations.success).toBe(false);
    expect(vibrations.output).toBe('Requires software tier 4+ (current: 0)');
  });

  it('tier 1+ — energy sub returns a populated summary', () => {
    const ctx = makeMiningContext();
    makePlan(ctx, 1);

    const result = previewCommand(ctx, ['energy'], {});

    expect(result.success).toBe(true);
    expect(result.output).toMatch(/^Energy preview: \d+ voxels, max=[\d.]+, min=[\d.]+$/);
  });

  it('unknown subcommand returns the usage message', () => {
    const ctx = makeMiningContext();
    makePlan(ctx, 4);

    const result = previewCommand(ctx, ['bogus'], {});

    expect(result.success).toBe(false);
    expect(result.output).toBe('Usage: preview energy|fragments|projections|vibrations');
  });
});
