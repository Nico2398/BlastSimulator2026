// BlastSimulator2026 — Integration tests: drill_hole action queueing (#553)
//
// Confirming a drill plan used to write finished DrillHole records straight
// into state.drillHoles in one frame — instant, no employee, no time. #553
// changes this: `drill_plan grid` queues one `drill_hole` PendingAction per
// hole instead, and a hole only lands in state.drillHoles once its own
// action completes (nearest-first, one at a time per employee). Ordered-but-
// undrilled holes live in state.plannedDrillHoles in the meantime.
//
// Uses the console/createRunner layer (mirrors
// tests/integration/tutorial.integration.test.ts's haul-debris suite) so the
// full dispatch -> claim -> walk -> board -> drive -> tick -> land pipeline
// runs exactly as a real player's `tick` commands would drive it.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import { NavGrid } from '../../src/core/nav/NavGrid.js';
import { findPath } from '../../src/core/nav/Pathfinding.js';
import { tickUntil } from './helpers.js';
import { getFinancialReport } from '../../src/core/economy/Finance.js';
import { t } from '../../src/core/i18n/I18n.js';
import { checkProtectedPositions } from '../../src/core/mining/BlastPlan.js';
import { buildingFootprintOccupants } from '../../src/core/nav/NavGridSync.js';

describe('drill_plan grid — queues drill_hole actions instead of writing holes instantly (#553)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pushes one PlannedHole per hole into plannedDrillHoles and queues one drill_hole PendingAction per hole, leaving drillHoles unchanged', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    const drillHolesBefore = [...state.drillHoles];

    const result = run('drill_plan grid rows:2 cols:2 spacing:5 depth:8 start:14,14');
    expect(result.success).toBe(true);

    expect(state.plannedDrillHoles).toHaveLength(4);
    expect(state.drillHoles).toEqual(drillHolesBefore);

    const drillHoleActions = state.pendingActions.filter(a => a.type === 'drill_hole');
    expect(drillHoleActions).toHaveLength(4);
    for (const action of drillHoleActions) {
      expect(action.requiredSkill).toBe('blasting');
      expect(action.requiredVehicleRole).toBe('drill_rig');
      const holeId = action.payload['holeId'];
      expect(typeof holeId).toBe('string');
      expect(state.plannedDrillHoles.some(h => h.id === holeId)).toBe(true);
    }
  });

  it('a hole only lands in state.drillHoles once its own drill_hole action completes — ticking makes progress', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    expect(run('drill_plan grid rows:1 cols:2 spacing:5 depth:8 start:14,14').success).toBe(true);
    expect(state.plannedDrillHoles).toHaveLength(2);
    expect(state.drillHoles).toHaveLength(0);

    tickUntil(run, () => state.drillHoles.length > 0);

    expect(state.drillHoles.length).toBeGreaterThan(0);
    // A hole that has landed is no longer ordered.
    for (const landed of state.drillHoles) {
      expect(state.plannedDrillHoles.some(h => h.id === landed.id)).toBe(false);
    }
  });

  it('every hole eventually lands: plannedDrillHoles empties into drillHoles with the same ids, none lost or duplicated', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    expect(run('drill_plan grid rows:2 cols:2 spacing:5 depth:8 start:14,14').success).toBe(true);
    const orderedIds = state.plannedDrillHoles.map(h => h.id).sort();

    tickUntil(run, () => state.plannedDrillHoles.length === 0, 800);

    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.drillHoles).toHaveLength(4);
    expect(state.drillHoles.map(h => h.id).sort()).toEqual(orderedIds);
    // No hole drilled twice.
    expect(new Set(state.drillHoles.map(h => h.id)).size).toBe(4);
  });

  it('hole ids stay stable: a hole ordered as H2 lands as H2', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    expect(run('drill_plan grid rows:1 cols:2 spacing:5 depth:8 start:14,14').success).toBe(true);
    expect(state.plannedDrillHoles.map(h => h.id)).toEqual(['H1', 'H2']);

    tickUntil(run, () => state.plannedDrillHoles.length === 0, 800);

    expect(state.drillHoles.map(h => h.id).sort()).toEqual(['H1', 'H2']);
  });

  it('NavGrid.patchNavGrid is called once per landed hole with a single-cell region, not once upfront for the whole pattern', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;

    const patchSpy = vi.spyOn(NavGrid, 'patchNavGrid');
    patchSpy.mockClear();

    expect(run('drill_plan grid rows:1 cols:2 spacing:5 depth:8 start:14,14').success).toBe(true);

    // Confirming the plan alone (before any hole is actually drilled) must
    // not patch the navgrid for the whole pattern's footprint — the holes
    // don't exist as terrain yet, only as ordered/planned entries.
    expect(patchSpy).not.toHaveBeenCalled();

    tickUntil(run, () => state.plannedDrillHoles.length === 0, 800);

    // Exactly one patch call per landed hole, each a single-cell region.
    expect(patchSpy).toHaveBeenCalledTimes(2);
    for (const call of patchSpy.mock.calls) {
      const region = call[4] as { minX: number; maxX: number; minZ: number; maxZ: number };
      expect(region.minX).toBe(region.maxX);
      expect(region.minZ).toBe(region.maxZ);
    }
  });
});

describe('charge — refuses a hole still in plannedDrillHoles, distinct from an unknown hole (#553)', () => {
  it('charge hole:<ordered-but-undrilled id> is refused with "has not been drilled yet"', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    expect(run('drill_plan grid rows:1 cols:1 spacing:5 depth:8 start:14,14').success).toBe(true);
    expect(state.plannedDrillHoles).toHaveLength(1);
    const orderedId = state.plannedDrillHoles[0]!.id;

    const result = run(`charge hole:${orderedId} explosive:boomite amount:5 stemming:2`);

    expect(result.success).toBe(false);
    expect(result.output).toBe(`Hole "${orderedId}" has not been drilled yet.`);
  });

  it('charge hole:<unknown id> is refused with "not found" — distinct wording from the not-yet-drilled case', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    void ctx;

    const result = run('charge hole:H999 explosive:boomite amount:5 stemming:2');

    expect(result.success).toBe(false);
    // Matches chargeCommand's existing "not found" phrasing exactly — an
    // unrecognized spec that doesn't already start with "hole_" is
    // normalized to the legacy "hole_<spec>" form before the lookup fails
    // (see chargeCommand, mining.ts), unrelated to #553.
    expect(result.output).toBe('Hole "hole_H999" not found');
    expect(result.output).not.toContain('has not been drilled yet');
  });

  it('charge hole:<id> succeeds once the hole has actually landed in drillHoles', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    expect(run('drill_plan grid rows:1 cols:1 spacing:5 depth:8 start:14,14').success).toBe(true);
    expect(state.plannedDrillHoles.length).toBeGreaterThan(0);
    const orderedId = state.plannedDrillHoles[0]!.id;

    for (let i = 0; i < 400 && state.drillHoles.length === 0; i++) run('tick 1');
    expect(state.drillHoles).toHaveLength(1);

    const result = run(`charge hole:${orderedId} explosive:boomite amount:5 stemming:2`);

    expect(result.success).toBe(true);
  });
});

describe('drill_plan clear / remove — cancel in-flight drill_hole actions (#553)', () => {
  it('drill_plan clear while holes are still ordered/drilling cancels their drill_hole actions and empties plannedDrillHoles', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    expect(run('drill_plan grid rows:2 cols:2 spacing:5 depth:8 start:14,14').success).toBe(true);
    expect(state.plannedDrillHoles).toHaveLength(4);
    expect(state.pendingActions.filter(a => a.type === 'drill_hole')).toHaveLength(4);

    // Let dispatch settle a bit so some actions are assigned/in_progress —
    // clear must still cancel them, not just the still-queued ones.
    for (let i = 0; i < 10; i++) run('tick 1');

    const result = run('drill_plan clear');
    expect(result.success).toBe(true);

    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.pendingActions.filter(a => a.type === 'drill_hole')).toHaveLength(0);
    expect(state.drillHoles).toHaveLength(0);
  });

  it('drill_plan remove hole:<id> on an ordered (not yet drilled) hole cancels just that one action and hole, leaving the rest untouched', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    expect(run('drill_plan grid rows:1 cols:3 spacing:5 depth:8 start:14,14').success).toBe(true);
    expect(state.plannedDrillHoles).toHaveLength(3);
    const [first, second, third] = state.plannedDrillHoles.map(h => h.id);

    const result = run(`drill_plan remove hole:${second}`);
    expect(result.success).toBe(true);

    expect(state.plannedDrillHoles.map(h => h.id).sort()).toEqual([first, third].sort());
    const remainingActions = state.pendingActions.filter(a => a.type === 'drill_hole');
    expect(remainingActions).toHaveLength(2);
    expect(remainingActions.some(a => a.payload['holeId'] === second)).toBe(false);
    expect(remainingActions.some(a => a.payload['holeId'] === first)).toBe(true);
    expect(remainingActions.some(a => a.payload['holeId'] === third)).toBe(true);
  });
});

// #1278: agent-occupancy dispatch deadlock/worker-revolt at extreme density
// (1m-spacing hole grids, several drillers/drill_rigs converging on
// adjacent holes) — the same reproduction shape as
// scripts/scenario-defs/blast-execution-visual.json, driven end to end
// through the real console dispatch -> claim -> walk -> board -> drive ->
// tick -> land pipeline (mirrors this file's own #553 suite above), rather
// than through tickLocomotion/moveTo directly the way
// tests/unit/engine/Locomotion.test.ts's own "#1278" suite does. Chosen over
// inventing a new integration file per dev-testing-strategy's own
// references/integration-suites.md: no listed suite's minimum-scenario table
// names agent-occupancy/dense-grid convergence, and this file already owns
// "N holes queued via drill_plan grid all eventually land, none lost" as its
// own subject (see "every hole eventually lands..." above) — this is that
// same claim under the one additional condition (agent occupancy's dense
// convergence, 1m spacing, more drillers than one crew) #1278 is about.
describe('drill_plan grid — dense 1m-spacing grid under agent occupancy converges without a permanent stall (#1278)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('8 drillers/drill_rigs dispatched at an 8-hole, 1m-spacing grid all eventually land their own hole, none abandoned', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:48 staffed:true').success).toBe(true);
    const state = ctx.state!;
    // Setup-only affordability — hiring/purchasing the extra crew below is
    // not the behavior under test.
    state.cash = 1_000_000;

    // 7 more drillers + drill_rigs beyond staffed:true's own single crew (1
    // driller, 1 drill_rig) — several rigs converging on adjacent, 1m-spaced
    // holes is what actually reproduces #1278's density; one lone crew never
    // contends with itself.
    for (let i = 0; i < 7; i++) {
      const beforeCount = state.employees.employees.length;
      expect(run('employee hire role:driller').success).toBe(true);
      const hired = state.employees.employees[beforeCount]!;
      expect(run(`employee assign_skill ${hired.id} skill:driving.drill_rig level:1`).success).toBe(true);
      expect(run('vehicle buy drill_rig tier:1').success).toBe(true);
    }

    const planResult = run('drill_plan grid rows:2 cols:4 spacing:1 depth:8 start:20,20');
    expect(planResult.success).toBe(true);
    expect(state.plannedDrillHoles).toHaveLength(8);
    expect(state.drillHoles).toHaveLength(0);

    // Generous bound: 8 holes, 8 driller/drill_rig pairs available, at most a
    // handful of AGENT_OCCUPANCY_WAIT_TICKS-scale contests to resolve on top
    // of the real drilling work itself — nowhere near the ticks a genuine,
    // unresolved deadlock would need (it would simply never drain
    // plannedDrillHoles at all within this budget).
    const MAX_TICKS = 400;
    const tickOutputs: string[] = [];
    for (let i = 0; i < MAX_TICKS && state.plannedDrillHoles.length > 0; i++) {
      // Established staffed-roster drive-to-completion pattern (see
      // entity-ground-contact.test.ts's own tickUntilGone/driveToCompletion) —
      // fatigue never interrupts this run's own convergence question.
      for (const emp of state.employees.employees) emp.fatigue = 100;
      tickOutputs.push(run('tick 1').output);
    }

    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.drillHoles).toHaveLength(8);
    // tick.ts's own "ACTION ABANDONED" line is the console-visible signal for
    // exactly the stuck-claim-released-back-to-the-pool outcome
    // result.abandoned reports at the unit level — never fired across a
    // successful, fully-converged run.
    expect(tickOutputs.some(output => output.includes('ACTION ABANDONED'))).toBe(false);
  });
});

// ── blast_plan load queues orders instead of writing finished holes (#1342) ──

function explosivesTotal(state: { finances: Parameters<typeof getFinancialReport>[0]; tickCount: number }): number {
  const report = getFinancialReport(state.finances, state.tickCount);
  return report.expensesByCategory.find(c => c.category === 'explosives')?.total ?? 0;
}

/** Drills + charges a 2x2 grid, lands everything, saves it as `default`. */
function setupSavedPlan() {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);
  expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
  const state = ctx.state!;
  expect(run('drill_plan grid rows:2 cols:2 spacing:5 depth:8 start:14,14').success).toBe(true);
  tickUntil(run, () => state.plannedDrillHoles.length === 0, 800);
  expect(state.drillHoles).toHaveLength(4);
  expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
  tickUntil(run, () => Object.keys(state.plannedChargesByHole).length === 0, 800);
  expect(Object.keys(state.chargesByHole)).toHaveLength(4);
  expect(run('blast_plan save').success).toBe(true);
  return { run, state };
}

/**
 * Empties the site of drilled holes and charges without firing, so the crater
 * and debris of a real blast cannot make the reloaded holes unreachable.
 */
function clearHolesWithoutBlast(state: { cash: number; finances: { cash: number }; drillHoles: unknown[]; chargesByHole: Record<string, unknown> }): void {
  // Keep the mine solvent while the crew works (the first run spent the starting cash).
  state.cash = 5_000_000;
  state.finances.cash = 5_000_000;
  state.drillHoles.length = 0;
  for (const k of Object.keys(state.chargesByHole)) delete state.chargesByHole[k];
}

/** Fires the loaded plan's blast so the site holds no holes, keeping the saved plan. */
function fireBlast(
  run: (cmd: string) => { success: boolean },
  state: { cash: number; finances: { cash: number }; drillHoles: unknown[]; employees: { employees: Array<{ x: number; z: number }> }; vehicles: { vehicles: Array<{ x: number; z: number }> } },
): void {
  // Move the whole crew and fleet clear of the blast zone so the shot does not
  // kill the workers the reloaded plan needs.
  for (const unit of [...state.employees.employees, ...state.vehicles.vehicles]) { unit.x = 2; unit.z = 2; }
  // The ore revenue is not what these tests are about; keep the mine solvent while the crew works.
  state.cash = 5_000_000;
  state.finances.cash = 5_000_000;
  expect(run('blast').success).toBe(true);
  expect(state.drillHoles).toHaveLength(0);
}

describe('blast_plan load — orders the saved plan instead of writing finished holes (#1342)', () => {
  it('same tick: drillHoles unchanged, N planned holes, N drill_hole actions, no new chargesByHole entries', () => {
    const { run, state } = setupSavedPlan();
    fireBlast(run, state);
    const chargedBefore = Object.keys(state.chargesByHole).length;

    const result = run('blast_plan load');
    expect(result.success).toBe(true);

    expect(state.drillHoles).toHaveLength(0);
    expect(state.plannedDrillHoles).toHaveLength(4);
    expect(state.pendingActions.filter(a => a.type === 'drill_hole')).toHaveLength(4);
    expect(Object.keys(state.chargesByHole)).toHaveLength(chargedBefore);
    expect(Object.keys(state.plannedChargesByHole)).toHaveLength(4);
  });

  it('queues one charge_hole action per saved charge, deducts the summed orderCost and books an explosives expense', () => {
    const { run, state } = setupSavedPlan();
    fireBlast(run, state);
    const cashBefore = state.cash;
    const explosivesBefore = explosivesTotal(state);

    expect(run('blast_plan load').success).toBe(true);

    const chargeActions = state.pendingActions.filter(a => a.type === 'charge_hole');
    expect(chargeActions).toHaveLength(4);
    const sum = chargeActions.reduce((acc, a) => acc + (a.payload['orderCost'] as number), 0);
    expect(sum).toBeGreaterThan(0);
    expect(state.cash).toBeCloseTo(cashBefore - sum, 5);
    expect(explosivesTotal(state) - explosivesBefore).toBeCloseTo(sum, 5);
    for (const a of chargeActions) {
      const id = a.payload['holeId'] as string;
      expect(state.plannedDrillHoles.some(h => h.id === id)).toBe(true);
      expect(state.plannedChargesByHole[id]).toBeDefined();
    }
  });

  it('ghosts exist for the ordered holes: every planned hole has a queued drill_hole action', () => {
    const { run, state } = setupSavedPlan();
    fireBlast(run, state);
    expect(run('blast_plan load').success).toBe(true);
    expect(state.plannedDrillHoles).toHaveLength(4);
    for (const h of state.plannedDrillHoles) {
      expect(state.pendingActions.some(a => a.type === 'drill_hole' && a.payload['holeId'] === h.id && a.status === 'queued')).toBe(true);
    }
  });

  it('ticking drills the holes, then each charge lands only after its own hole; chargesByHole ends under the new ids', () => {
    const { run, state } = setupSavedPlan();
    clearHolesWithoutBlast(state);
    expect(run('blast_plan load').success).toBe(true);
    const newIds = state.plannedDrillHoles.map(h => h.id);

    for (let i = 0; i < 1500 && (state.plannedDrillHoles.length > 0 || Object.keys(state.plannedChargesByHole).length > 0); i++) {
      for (const emp of state.employees.employees) emp.fatigue = 100;
      run('tick 1');
      for (const id of Object.keys(state.chargesByHole)) {
        expect(state.drillHoles.some(h => h.id === id)).toBe(true);
      }
    }
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.drillHoles.map(h => h.id).sort()).toEqual([...newIds].sort());
    expect(Object.keys(state.chargesByHole).sort()).toEqual([...newIds].sort());
  });

  it('a pre-existing order and drilled hole keep their ids; loaded holes get distinct ids even when saved ids overlap live ones', () => {
    const { run, state } = setupSavedPlan();
    clearHolesWithoutBlast(state);
    expect(run('drill_plan add x:25 z:25 depth:8').success).toBe(true);
    tickUntil(run, () => state.plannedDrillHoles.length === 0, 800);
    const liveId = state.drillHoles[0]!.id;
    // A still-planned (undrilled) hole, ordered right before the load.
    expect(run('drill_plan add x:10 z:10 depth:8').success).toBe(true);
    const orderedHole = { ...state.plannedDrillHoles[0]! };
    const orderedAction = { ...state.pendingActions.find(a => a.type === 'drill_hole' && a.payload['holeId'] === orderedHole.id)! };
    // Saved plan reuses the live hole's id.
    const saved = state.savedPlans['default']!;
    saved.drillHoles = saved.drillHoles.map((h, i) => (i === 0 ? { ...h, id: liveId } : h));
    saved.chargesByHole = { [liveId]: Object.values(saved.chargesByHole)[0]! };

    expect(run('blast_plan load').success).toBe(true);

    expect(state.drillHoles[0]!.id).toBe(liveId);
    // The pre-existing order is untouched: same hole record, same queued action.
    expect(state.plannedDrillHoles.find(h => h.id === orderedHole.id)).toEqual(orderedHole);
    const actionAfter = state.pendingActions.find(a => a.type === 'drill_hole' && a.payload['holeId'] === orderedHole.id);
    expect(actionAfter?.id).toBe(orderedAction.id);
    expect(actionAfter?.type).toBe(orderedAction.type);
    expect(actionAfter?.payload).toEqual(orderedAction.payload);
    const plannedIds = state.plannedDrillHoles.map(h => h.id);
    expect(plannedIds).not.toContain(liveId);
    expect(new Set(plannedIds).size).toBe(plannedIds.length);
    for (const id of Object.keys(state.plannedChargesByHole)) expect(plannedIds).toContain(id);
  });

  it('insufficient cash refuses the whole load: no mutation, console.insufficient_funds', () => {
    const { run, state } = setupSavedPlan();
    fireBlast(run, state);
    state.cash = 1;
    state.finances.cash = 1;
    const actionsBefore = state.pendingActions.length;

    const result = run('blast_plan load');

    expect(result.success).toBe(false);
    expect(result.output).toContain('Insufficient funds');
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(Object.keys(state.plannedChargesByHole)).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(actionsBefore);
    expect(state.cash).toBe(1);
  });

  it('a missing plan still fails with No saved plan', () => {
    const { runner } = createRunner();
    expect(runner.run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const result = runner.run('blast_plan load name:nope');
    expect(result.success).toBe(false);
    expect(result.output).toContain('No saved plan');
  });

  it('skips holes already at the same x,z: loading twice orders nothing new the second time', () => {
    const { run, state } = setupSavedPlan();
    fireBlast(run, state);
    expect(run('blast_plan load').success).toBe(true);
    const cashAfterFirst = state.cash;
    const actions = state.pendingActions.length;

    const second = run('blast_plan load');

    expect(second.success).toBe(true);
    expect(second.output).toContain('adds nothing new');
    expect(state.plannedDrillHoles).toHaveLength(4);
    expect(state.pendingActions).toHaveLength(actions);
    expect(state.cash).toBe(cashAfterFirst);
  });

  it('partial skip against a planned hole: only the fresh holes and their charges are ordered and counted', () => {
    const { run, state } = setupSavedPlan();
    fireBlast(run, state);
    const saved = state.savedPlans['default']!;
    const { x, z } = saved.drillHoles[0]!;
    expect(run(`drill_plan add x:${x} z:${z} depth:8`).success).toBe(true);
    const plannedBefore = state.plannedDrillHoles.length;

    const result = run('blast_plan load');

    expect(result.success).toBe(true);
    expect(result.output).toContain('3 drill orders and 3 charge orders');
    expect(result.output).toContain('1 holes skipped');
    expect(state.plannedDrillHoles).toHaveLength(plannedBefore + 3);
    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(3);
  });

  it('partial skip against an already-drilled hole: the drilled hole is not re-ordered', () => {
    const { run, state } = setupSavedPlan();
    clearHolesWithoutBlast(state);
    const { x, z } = state.savedPlans['default']!.drillHoles[0]!;
    expect(run(`drill_plan add x:${x} z:${z} depth:8`).success).toBe(true);
    tickUntil(run, () => state.plannedDrillHoles.length === 0, 800);
    expect(state.drillHoles).toHaveLength(1);

    const result = run('blast_plan load');

    expect(result.success).toBe(true);
    expect(result.output).toContain('3 drill orders and 3 charge orders');
    expect(result.output).toContain('1 holes skipped');
    expect(state.drillHoles).toHaveLength(1);
    expect(state.plannedDrillHoles).toHaveLength(3);
    expect(state.plannedDrillHoles.some(h => h.x === x && h.z === z)).toBe(false);
  });

  it('a saved plan carries no sequence delays, and loading one adds none to state', () => {
    const { run, state } = setupSavedPlan();
    const saved = state.savedPlans['default']! as unknown as Record<string, unknown>;
    expect('sequenceDelays' in saved).toBe(false);
    clearHolesWithoutBlast(state);

    expect(run('blast_plan load').success).toBe(true);

    expect('sequenceDelays' in (state as unknown as Record<string, unknown>)).toBe(false);
  });

  it('a saved charge that fails validation refuses the whole load with no mutation', () => {
    const { run, state } = setupSavedPlan();
    fireBlast(run, state);
    const saved = state.savedPlans['default']!;
    const lastId = saved.drillHoles[3]!.id;
    saved.chargesByHole[lastId] = { ...saved.chargesByHole[lastId]!, explosiveId: 'no_such_explosive' };
    const cash = state.cash;
    const actions = state.pendingActions.length;

    const result = run('blast_plan load');

    expect(result.success).toBe(false);
    expect(result.output).toContain('Unknown explosive');
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(Object.keys(state.plannedChargesByHole)).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(actions);
    expect(state.cash).toBe(cash);
  });

  it('a refused site claim refuses the whole load with no mutation', () => {
    const { run, state } = setupSavedPlan();
    fireBlast(run, state);
    const saved = state.savedPlans['default']!;
    // Far outside the owned area: the expansion claim is refused.
    saved.drillHoles[0] = { ...saved.drillHoles[0]!, x: 5000, z: 5000 };
    const cash = state.cash;
    const actions = state.pendingActions.length;

    const result = run('blast_plan load');

    expect(result.success).toBe(false);
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(Object.keys(state.plannedChargesByHole)).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(actions);
    expect(state.cash).toBe(cash);
  });

  it('after a blast, load then an immediate blast fires nothing: no hole is drilled yet', () => {
    const { run, state } = setupSavedPlan();
    fireBlast(run, state);
    expect(run('blast_plan load').success).toBe(true);
    expect(state.plannedDrillHoles).toHaveLength(4);
    expect(state.drillHoles).toHaveLength(0);
    // Nothing is drilled, so firing clears no rock (the old instant load let it fire again).
    const report = run('blast') as { success: boolean; output?: string };
    expect(state.drillHoles).toHaveLength(0);
    expect(report.output ?? '').toContain('Cleared voxels: 0');
  });

  it('drill_plan remove on a loaded planned hole cancels its charge order and refunds the cost', () => {
    const { run, state } = setupSavedPlan();
    fireBlast(run, state);
    expect(run('blast_plan load').success).toBe(true);
    const cashAfterLoad = state.cash;
    const action = state.pendingActions.find(a => a.type === 'charge_hole')!;
    const holeId = action.payload['holeId'] as string;
    const cost = action.payload['orderCost'] as number;

    expect(run(`drill_plan remove hole:${holeId}`).success).toBe(true);

    expect(state.plannedChargesByHole[holeId]).toBeUndefined();
    expect(state.pendingActions.some(a => a.type === 'charge_hole' && a.payload['holeId'] === holeId)).toBe(false);
    expect(state.cash).toBeCloseTo(cashAfterLoad + cost, 5);
  });
});

// ── drill holes under a building or construction site are refused (#1359) ──
//
// living_quarters tier 1 is a 3x3 footprint, so `build living_quarters at:30,30`
// covers cells x 30..32, z 30..32. A hole there would be unblastable
// (protected_position) and stick ORDERED forever, so the order is refused.

function footprintGame() {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);
  expect(run('new_game seed:42 staffed:true').success).toBe(true);
  return { run, state: ctx.state! };
}

/** Orders living_quarters at 30,30 and leaves it a construction site (no ticks). */
function orderSite(run: (c: string) => { success: boolean }, state: { plannedBuildings: unknown[] }) {
  expect(run('build living_quarters at:30,30').success).toBe(true);
  expect(state.plannedBuildings.length).toBeGreaterThan(0);
}

/** Ticks until the site is finished. */
function finishBuilding(run: (c: string) => { success: boolean }, state: { plannedBuildings: unknown[]; buildings: { buildings: unknown[] } }) {
  tickUntil(run, () => state.plannedBuildings.length === 0, 1500);
  expect(state.plannedBuildings).toHaveLength(0);
  expect(state.buildings.buildings.length).toBeGreaterThan(0);
}

describe('drill_plan — refuses holes under a building or construction site (#1359)', () => {
  it('1. add on a finished building is refused with the localized reason, plan and actions untouched', () => {
    const { run, state } = footprintGame();
    orderSite(run, state);
    finishBuilding(run, state);
    const plannedBefore = [...state.plannedDrillHoles];
    const actionsBefore = [...state.pendingActions];

    const r = run('drill_plan add x:31 z:31 depth:8');
    expect(r.success).toBe(false);
    expect(r.output).toBe(t('mining.drill_plan.refused_footprint', { x: 31, z: 31 }));
    expect(state.plannedDrillHoles).toEqual(plannedBefore);
    expect(state.pendingActions).toEqual(actionsBefore);
  });

  it('2. add on a construction site (plannedBuildings only, no ticks) is refused', () => {
    const { run, state } = footprintGame();
    orderSite(run, state);
    expect(state.buildings.buildings).toHaveLength(0);
    const actionsBefore = state.pendingActions.length;

    const r = run('drill_plan add x:31 z:31 depth:8');
    expect(r.success).toBe(false);
    expect(r.output).toBe(t('mining.drill_plan.refused_footprint', { x: 31, z: 31 }));
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.pendingActions.filter(a => a.type === 'drill_hole')).toHaveLength(0);
    expect(state.pendingActions).toHaveLength(actionsBefore);
  });

  it('3. the far edge cell inside the footprint is refused; the cell just outside is accepted', () => {
    const { run, state } = footprintGame();
    orderSite(run, state);

    expect(run('drill_plan add x:30 z:30 depth:8').success).toBe(false);
    expect(run('drill_plan add x:32 z:32 depth:8').success).toBe(false);
    expect(state.plannedDrillHoles).toHaveLength(0);

    expect(run('drill_plan add x:33 z:30 depth:8').success).toBe(true);
    expect(run('drill_plan add x:29 z:30 depth:8').success).toBe(true);
    expect(run('drill_plan add x:30 z:33 depth:8').success).toBe(true);
    expect(state.plannedDrillHoles).toHaveLength(3);
  });

  it('4. fractional coordinates inside a footprint cell (31.7) are refused', () => {
    const { run, state } = footprintGame();
    orderSite(run, state);

    const r = run('drill_plan add x:31.7 z:30.2 depth:8');
    expect(r.success).toBe(false);
    expect(r.output).toBe(t('mining.drill_plan.refused_footprint', { x: 31.7, z: 30.2 }));
    expect(state.plannedDrillHoles).toHaveLength(0);

    // 32.9 still floors to 32 (inside); 33.1 floors to 33 (outside).
    expect(run('drill_plan add x:32.9 z:31 depth:8').success).toBe(false);
    expect(run('drill_plan add x:33.1 z:31 depth:8').success).toBe(true);
  });

  it('5. grid partially overlapping: states skipped count, holes and actions agree, ids H1..Hn contiguous', () => {
    const { run, state } = footprintGame();
    orderSite(run, state);

    // 4x4 grid spacing 1 from 29,29 -> x,z 29..32; cells with x,z in 30..32 (9) are covered, 7 remain.
    const r = run('drill_plan grid rows:4 cols:4 spacing:1 depth:8 start:29,29');
    expect(r.success).toBe(true);
    expect(r.output).toContain(t('mining.drill_plan.grid_skipped', { count: 9 }));

    const holes = state.plannedDrillHoles;
    expect(holes).toHaveLength(7);
    const actions = state.pendingActions.filter(a => a.type === 'drill_hole');
    expect(actions).toHaveLength(7);
    expect(holes.map(h => h.id)).toEqual(Array.from({ length: 7 }, (_, i) => `H${i + 1}`));
    expect(new Set(actions.map(a => a.payload['holeId']))).toEqual(new Set(holes.map(h => h.id)));
    for (const h of holes) {
      const inside = h.x >= 30 && h.x <= 32 && h.z >= 30 && h.z <= 32;
      expect(inside).toBe(false);
    }
  });

  it('6. grid fully under a building is refused; existing plan and actions are preserved', () => {
    const { run, state } = footprintGame();
    orderSite(run, state);
    expect(run('drill_plan add x:10 z:10 depth:8').success).toBe(true);
    const plannedBefore = [...state.plannedDrillHoles];
    const actionsBefore = [...state.pendingActions];

    const r = run('drill_plan grid rows:2 cols:2 spacing:1 depth:8 start:30,30');
    expect(r.success).toBe(false);
    expect(r.output).toBe(t('mining.drill_plan.grid_all_blocked'));
    expect(state.plannedDrillHoles).toEqual(plannedBefore);
    expect(state.pendingActions).toEqual(actionsBefore);
  });

  it('7. a refused add does not consume a hole id: the next accepted hole is H1', () => {
    const { run, state } = footprintGame();
    orderSite(run, state);

    expect(run('drill_plan add x:31 z:31 depth:8').success).toBe(false);
    expect(run('drill_plan add x:5 z:5 depth:8').success).toBe(true);
    expect(state.plannedDrillHoles.map(h => h.id)).toEqual(['H1']);
    expect(state.nextHoleId).toBe(2);
  });

  it('8. a grid beside a finished building drills fully: no hole is stuck ORDERED after 150 ticks, and blast reports no protected position', () => {
    const { run, state } = footprintGame();
    orderSite(run, state);
    finishBuilding(run, state);

    const r = run('drill_plan grid rows:3 cols:3 spacing:2 depth:6 start:29,29');
    expect(r.success).toBe(true);
    const ordered = state.plannedDrillHoles.length;
    expect(ordered).toBeGreaterThan(0);
    expect(ordered).toBeLessThan(9);

    tickUntil(run, () => state.plannedDrillHoles.length === 0, 150);
    expect(state.plannedDrillHoles).toHaveLength(0);
    expect(state.drillHoles).toHaveLength(ordered);
    expect(state.pendingActions.filter(a => a.type === 'drill_hole')).toHaveLength(0);

    expect(checkProtectedPositions(state.drillHoles, buildingFootprintOccupants(state))).toEqual([]);
  });

  it('9. a grid entirely clear of buildings reports no skipped cells', () => {
    const { run, state } = footprintGame();
    orderSite(run, state);

    const r = run('drill_plan grid rows:2 cols:2 spacing:3 depth:8 start:5,5');
    expect(r.success).toBe(true);
    expect(state.plannedDrillHoles).toHaveLength(4);
    expect(r.output).not.toMatch(/skipped/i);
  });
});

describe('drill_plan clear/remove/grid restores NavGrid cell cost (#1360)', () => {
  function setup() {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    const state = ctx.state!;
    const navGrid = state.navGrid;
    if (!navGrid) throw new Error('new_game produced no navGrid');
    const cell = (x: number, z: number) => {
      const c = navGrid.cellAt(x, z)!;
      return { type: c.type, moveCost: c.moveCost };
    };
    const occupancyEvents: unknown[] = [];
    ctx.emitter.on('nav:occupancy_changed', e => { occupancyEvents.push(e); });
    const drill = (cmdArgs: string, count: number) => {
      expect(run(`drill_plan add ${cmdArgs} depth:8`).success).toBe(true);
      tickUntil(run, () => state.drillHoles.length >= count, 800);
      expect(state.drillHoles.length).toBeGreaterThanOrEqual(count);
    };
    return { run, state, navGrid, cell, occupancyEvents, drill };
  }

  it('drill_plan clear restores a drilled hole cell to its pre-hole type and moveCost 1', () => {
    const { run, state, cell, drill } = setup();
    const before = cell(15, 15);
    expect(before.type).not.toBe('drill_hole');
    drill('x:15 z:15', 1);
    expect(cell(15, 15)).toEqual({ type: 'drill_hole', moveCost: 5 });

    expect(run('drill_plan clear').success).toBe(true);
    expect(state.drillHoles).toHaveLength(0);
    expect(cell(15, 15).type).not.toBe('drill_hole');
    expect(cell(15, 15)).toEqual(before);
    expect(cell(15, 15).moveCost).toBe(1);
  });

  it('drill_plan remove on a drilled hole restores its cell', () => {
    const { run, state, cell, drill } = setup();
    const before = cell(15, 15);
    drill('x:15 z:15', 1);
    const id = state.drillHoles[0]!.id;
    expect(cell(15, 15).type).toBe('drill_hole');

    expect(run(`drill_plan remove hole:${id}`).success).toBe(true);
    expect(cell(15, 15)).toEqual(before);
    expect(cell(15, 15).moveCost).toBe(1);
  });

  it('drill_plan grid at a different origin restores the old drilled cells', () => {
    const { run, state, cell, drill } = setup();
    const before = cell(15, 15);
    drill('x:15 z:15', 1);
    expect(cell(15, 15).type).toBe('drill_hole');

    expect(run('drill_plan grid rows:1 cols:2 spacing:4 depth:8 start:22,22 confirm:true').success).toBe(true);
    expect(state.drillHoles).toHaveLength(0);
    expect(cell(15, 15)).toEqual(before);
    expect(cell(15, 15).type).not.toBe('drill_hole');
  });

  it('clearing or removing planned-only (undrilled) holes emits no nav:occupancy_changed and leaves cells unchanged', () => {
    const { run, state, cell, occupancyEvents } = setup();
    const before = cell(15, 15);
    expect(run('drill_plan add x:15 z:15 depth:8').success).toBe(true);
    expect(run('drill_plan add x:18 z:18 depth:8').success).toBe(true);
    expect(state.plannedDrillHoles).toHaveLength(2);
    expect(state.drillHoles).toHaveLength(0);
    occupancyEvents.length = 0;

    expect(run(`drill_plan remove hole:${state.plannedDrillHoles[0]!.id}`).success).toBe(true);
    expect(occupancyEvents).toHaveLength(0);
    expect(run('drill_plan clear').success).toBe(true);
    expect(occupancyEvents).toHaveLength(0);
    expect(cell(15, 15)).toEqual(before);
  });

  it('emits one 1x1 nav:occupancy_changed per drilled hole on clear', () => {
    const { run, state, occupancyEvents, drill } = setup();
    drill('x:15 z:15', 1);
    drill('x:19 z:19', 2);
    expect(state.drillHoles).toHaveLength(2);
    occupancyEvents.length = 0;

    expect(run('drill_plan clear').success).toBe(true);
    expect(occupancyEvents).toHaveLength(2);
    for (const e of occupancyEvents as Array<{ region: { minX: number; maxX: number; minZ: number; maxZ: number } }>) {
      expect(e.region.minX).toBe(e.region.maxX);
      expect(e.region.minZ).toBe(e.region.maxZ);
    }
  });

  it('two drilled holes sharing a floored cell: removing one keeps drill_hole, removing the second restores', () => {
    const { run, state, cell, drill } = setup();
    const before = cell(15, 15);
    drill('x:15.2 z:15.2', 1);
    drill('x:15.7 z:15.7', 2);
    expect(state.drillHoles).toHaveLength(2);
    expect(cell(15, 15).type).toBe('drill_hole');

    expect(run(`drill_plan remove hole:${state.drillHoles[0]!.id}`).success).toBe(true);
    expect(state.drillHoles).toHaveLength(1);
    expect(cell(15, 15)).toEqual({ type: 'drill_hole', moveCost: 5 });

    expect(run(`drill_plan remove hole:${state.drillHoles[0]!.id}`).success).toBe(true);
    expect(cell(15, 15)).toEqual(before);
  });

  it('findPath across former hole cells costs the same as baseline after clear', () => {
    const { run, navGrid, drill } = setup();
    const req = { agentId: 0, fromX: 10, fromZ: 15, toX: 20, toZ: 15, avoidVehicles: false };
    const baseline = findPath(navGrid, req);
    expect(baseline.found).toBe(true);

    drill('x:14 z:15', 1);
    drill('x:15 z:15', 2);
    drill('x:16 z:15', 3);
    expect(run('drill_plan clear').success).toBe(true);

    const after = findPath(navGrid, req);
    expect(after.found).toBe(true);
    expect(after.totalCost).toBeCloseTo(baseline.totalCost, 6);
  });

  it('clear with an empty plan emits nothing and reports 0 holes', () => {
    const { run, occupancyEvents } = setup();
    const result = run('drill_plan clear');
    expect(result.success).toBe(true);
    expect(result.output).toBe('Cleared drill plan (0 holes)');
    expect(occupancyEvents).toHaveLength(0);
  });
});
