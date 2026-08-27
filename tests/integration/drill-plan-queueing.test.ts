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

/** Runs `tick 1` until `predicate(state)` is true or `maxTicks` is exhausted. */
function tickUntil(
  run: (cmd: string) => unknown,
  predicate: () => boolean,
  maxTicks = 400,
): void {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    run('tick 1');
  }
}

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
