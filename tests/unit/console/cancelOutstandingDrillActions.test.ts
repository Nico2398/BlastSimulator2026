import { describe, it, expect, beforeEach } from 'vitest';
import { createRunner } from '../../../src/console/createRunner.js';
import { cancelOutstandingDrillActions } from '../../../src/console/commands/mining/shared.js';
import { resetHoleIds } from '../../../src/core/mining/DrillPlan.js';

function setup(gridCmd = 'drill_plan grid rows:2 cols:3 spacing:4 depth:8 start:14,14') {
  const { runner, ctx } = createRunner();
  expect(runner.run('new_game seed:42 size:32 staffed:true').success).toBe(true);
  expect(runner.run(gridCmd).success).toBe(true);
  return { runner, state: ctx.state! };
}

describe('cancelOutstandingDrillActions (#1346)', () => {
  beforeEach(() => resetHoleIds());

  it('cancels every drill_hole action, empties plannedDrillHoles and returns the count', () => {
    const { state } = setup();
    const n = state.plannedDrillHoles.length;
    expect(n).toBe(6);
    expect(state.pendingActions.filter(a => a.type === 'drill_hole')).toHaveLength(n);

    expect(cancelOutstandingDrillActions(state)).toBe(n);

    expect(state.pendingActions.filter(a => a.type === 'drill_hole')).toHaveLength(0);
    expect(state.plannedDrillHoles).toHaveLength(0);
  });

  it('removes the matching ghost previews', () => {
    const { state } = setup();
    expect(state.ghostPreviews.length).toBeGreaterThan(0);
    cancelOutstandingDrillActions(state);
    expect(state.ghostPreviews).toHaveLength(0);
  });

  it('returns 0 and changes nothing when no hole is ordered (boundary)', () => {
    const { runner, state } = setup('drill_plan grid rows:1 cols:1 spacing:4 depth:8 start:14,14');
    for (let i = 0; i < 2000 && state.plannedDrillHoles.length > 0; i++) runner.run('tick 1');
    expect(state.plannedDrillHoles).toHaveLength(0);
    const drilled = state.drillHoles.length;
    expect(drilled).toBe(1);

    expect(cancelOutstandingDrillActions(state)).toBe(0);
    expect(state.drillHoles).toHaveLength(drilled);
  });

  it('leaves already drilled holes in place', () => {
    const { runner, state } = setup();
    for (let i = 0; i < 2000 && state.drillHoles.length < 1; i++) runner.run('tick 1');
    const drilled = state.drillHoles.length;
    const remaining = state.plannedDrillHoles.length;
    expect(remaining).toBeGreaterThan(0);

    expect(cancelOutstandingDrillActions(state)).toBe(remaining);
    expect(state.drillHoles).toHaveLength(drilled);
  });

  it('leaves other action types alone (charge_hole stays)', () => {
    const { runner, state } = setup();
    for (let i = 0; i < 2000 && state.drillHoles.length < 1; i++) runner.run('tick 1');
    const id = state.drillHoles[0]!.id;
    expect(runner.run(`charge hole:${id} explosive:boomite amount:5 stemming:2`).success).toBe(true);
    const charges = state.pendingActions.filter(a => a.type === 'charge_hole').length;
    expect(charges).toBe(1);

    cancelOutstandingDrillActions(state);

    expect(state.pendingActions.filter(a => a.type === 'charge_hole')).toHaveLength(charges);
    expect(state.pendingActions.filter(a => a.type === 'drill_hole')).toHaveLength(0);
  });

  it('is idempotent: a second call returns 0', () => {
    const { state } = setup();
    expect(cancelOutstandingDrillActions(state)).toBeGreaterThan(0);
    expect(cancelOutstandingDrillActions(state)).toBe(0);
  });
});
