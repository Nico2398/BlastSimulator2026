// BlastSimulator2026 — Integration tests: collapse recovery for a
// vehicle-driving employee, with and without a living_quarters (#593).
//
// Building a living_quarters used to leave a vehicle-driving employee
// permanently stuck COLLAPSING after their first rest: a Tier-1
// living_quarters' single-visit replenishment (~11, gameplay-employee-needs)
// lands well under the gauge's own warning threshold, so the instant the
// collapse-rest completed, autoInsertNeedTasks (NeedTaskInsertion.ts) queued another
// rest self-targeted at the same employee — and claimActionsTargetedAtEmployee
// (tickEmployees, EmployeeDispatchSteps.ts) claims and promotes a self-targeted action
// unconditionally, ahead of ever giving fillIdleEmployeeFromQueueOrPool's
// cost-based pool selection a chance to resume the employee's own
// interrupted, still-queued drill_hole action. The employee cycled rest to
// rest at the building forever; their vehicle sat released, idle, with no
// driver. The no-building path never hit this — NEED_REST_NO_BUILDING_CAP
// clears every warning threshold in one completion.
//
// Uses the console/createRunner layer (mirrors drill-plan-queueing.test.ts)
// so the full collapse -> rest -> resume -> reboard pipeline runs exactly as
// a real player's `tick` commands would drive it.

import { describe, it, expect } from 'vitest';
import { createRunner } from '../../src/console/createRunner.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { tickUntil } from './helpers.js';

/** Sets up a staffed new_game, hands employee #1 the drill_rig, and lets them drill at least one hole before the test forces a collapse. */
function setupDrivingDriller(): { run: (cmd: string) => unknown; state: GameState } {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);

  expect(run('new_game seed:42 size:32 staffed:true')).toMatchObject({ success: true });
  const state = ctx.state!;

  expect(run('vehicle driver 1 1')).toMatchObject({ success: true });
  expect(run('drill_plan grid rows:2 cols:2 spacing:5 depth:8 start:14,14')).toMatchObject({ success: true });

  // Let the driller actually board and land at least one hole first, so the
  // forced collapse below interrupts a real vehicle-gated drill_hole action —
  // not merely the walk-to-board.
  tickUntil(run, () => state.drillHoles.length >= 1, 200);
  expect(state.drillHoles.length).toBeGreaterThanOrEqual(1);

  return { run, state };
}

describe('Vehicle-driving employee collapse recovery (#593)', () => {
  it('baseline (no living_quarters): a collapsing driller resumes and finishes drilling', () => {
    const { run, state } = setupDrivingDriller();
    const driver = state.employees.employees.find(e => e.id === 1)!;

    driver.fatigue = 4; // below NEED_COLLAPSE_THRESHOLDS.fatigue (5) — collapses next tick

    let collapsedAtLeastOnce = false;
    tickUntil(run, () => {
      if (driver.collapsing) collapsedAtLeastOnce = true;
      return state.drillHoles.length === 4;
    }, 900);

    expect(collapsedAtLeastOnce).toBe(true);
    expect(state.drillHoles).toHaveLength(4);
  });

  it('a living_quarters in range no longer strands a collapsing driller — they reboard and resume the interrupted hole (#593 regression)', () => {
    const { run, state } = setupDrivingDriller();
    const driver = state.employees.employees.find(e => e.id === 1)!;
    const vehicle = state.vehicles.vehicles.find(v => v.id === 1)!;
    const interruptedActionId = driver.activeActionId;

    expect(run('build living_quarters at:12,12 tier:1')).toMatchObject({ success: true });
    driver.fatigue = 4;

    tickUntil(run, () => driver.collapsing, 50);
    expect(driver.collapsing).toBe(true);
    expect(vehicle.driverId).toBeNull(); // released back to idle at the moment of collapse

    tickUntil(run, () => !driver.collapsing, 400);
    expect(driver.collapsing).toBe(false);

    // Before the fix: autoInsertNeedTasks re-trapped the driller in another
    // rest the instant this one completed, self-targeted and zero distance
    // away, and claimActionsTargetedAtEmployee (EmployeeDispatchSteps.ts) claimed and
    // promoted it unconditionally ahead of ever reaching the cost-based pool
    // selection that would resume the interrupted drill_hole — the driller
    // cycled rest-to-rest at the building forever and never reboarded. The
    // fix's evidence isn't full hole completion (a Tier-1 living_quarters'
    // deliberately modest single-visit replenishment, gameplay-employee-needs,
    // is genuinely too small a buffer for a vehicle-driving role's own
    // active-task drain rate to sustain many holes without more rests —
    // that's this session's balance, not a bug) — it's that the SAME
    // interrupted action actually reboards and goes back to in_progress.
    tickUntil(run, () => {
      const action = state.pendingActions.find(a => a.id === interruptedActionId);
      return action !== undefined && action.status === 'in_progress';
    }, 500);

    expect(vehicle.driverId).toBe(driver.id);
    const resumedAction = state.pendingActions.find(a => a.id === interruptedActionId);
    expect(resumedAction?.status).toBe('in_progress');
  });

  it("a driving employee's driverId is cleanly re-established after a collapse-into-living_quarters-rest cycle, not left dangling", () => {
    const { run, state } = setupDrivingDriller();
    const driver = state.employees.employees.find(e => e.id === 1)!;
    const vehicle = state.vehicles.vehicles.find(v => v.id === 1)!;

    expect(run('build living_quarters at:12,12 tier:1')).toMatchObject({ success: true });
    driver.fatigue = 4;

    tickUntil(run, () => driver.collapsing, 50);
    expect(driver.collapsing).toBe(true);
    // Released back to idle at the moment of collapse (interruptActiveAction).
    expect(vehicle.driverId).toBeNull();

    tickUntil(run, () => !driver.collapsing, 400);
    expect(driver.collapsing).toBe(false);

    // The employee must actually reboard — driverId comes back to this exact
    // employee, not left null while they sit idle forever, and not handed to
    // anyone else (nobody else on this roster holds driving.drill_rig).
    tickUntil(run, () => vehicle.driverId === driver.id, 500);
    expect(vehicle.driverId).toBe(driver.id);
  });
});
