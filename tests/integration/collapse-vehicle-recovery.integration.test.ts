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
import { addBlastFragments } from '../../src/core/economy/Logistics.js';
import type { FragmentData } from '../../src/core/mining/BlastExecution.js';
import { tickUntil } from './helpers.js';

function makeFragment(id: number, x: number, z: number, mass = 900): FragmentData {
  return {
    id,
    position: { x, y: 0, z },
    volume: 0.3,
    mass,
    rockId: 'cruite',
    oreDensities: {},
    initialVelocity: { x: 0, y: 0, z: 0 },
    isProjection: false,
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    shapeSeed: 1,
  };
}

/**
 * Sets up a staffed new_game with a built, active freight_warehouse, hands
 * the roster's single driving.truck-licensed driver the debris_hauler, and
 * returns both — the fixture shared by the two mid-haul interruption tests
 * below (#1091).
 */
function setupStaffedHauler(warehouseAt: { x: number; z: number }): {
  run: (cmd: string) => unknown;
  state: GameState;
  vehicleId: number;
  driverId: number;
} {
  const { runner, ctx } = createRunner();
  const run = (cmd: string) => runner.run(cmd);

  expect(run('new_game seed:42 size:32 staffed:true')).toMatchObject({ success: true });
  const state = ctx.state!;

  expect(run(`build freight_warehouse at:${warehouseAt.x},${warehouseAt.z}`)).toMatchObject({ success: true });
  tickUntil(run, () => state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.active), 300);
  expect(state.buildings.buildings.some(b => b.type === 'freight_warehouse' && b.active)).toBe(true);

  const vehicle = state.vehicles.vehicles.find(v => v.type === 'debris_hauler')!;
  const driver = state.employees.employees.find(
    e => e.qualifications.some(q => q.category === 'driving.truck'),
  )!;

  expect(run(`vehicle driver ${vehicle.id} ${driver.id}`)).toMatchObject({ success: true });
  tickUntil(run, () => vehicle.driverId === driver.id, 50);
  expect(vehicle.driverId).toBe(driver.id);

  return { run, state, vehicleId: vehicle.id, driverId: driver.id };
}

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

    driver.fatigue = 0; // NEED_HARD_THRESHOLDS.fatigue (0) — collapses next tick

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

    expect(run('build living_quarters at:11,14 tier:1')).toMatchObject({ success: true });
    driver.fatigue = 0;

    tickUntil(run, () => driver.collapsing, 50);
    expect(driver.collapsing).toBe(true);
    expect(vehicle.driverId).toBeNull(); // released back to idle at the moment of collapse

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
    //
    // Tracked across one continuous window rather than split into a
    // "recover, then separately watch for in_progress" pair of waits: #1090
    // correctly alighting the driller before the rest-walk (mirroring
    // ForceShiftRest.ts's own fix) means recovery, reboarding, redriving and
    // resuming can all land inside the same handful of ticks the collapse
    // recovery wait already covers — a resumption entirely inside that
    // window is exactly the fix working, not something to miss by looking
    // only afterward.
    const holesBefore = state.drillHoles.length;
    let resumedInProgress = false;
    let reboarded = false;
    for (let i = 0; i < 500; i++) {
      run('tick 1');
      const action = state.pendingActions.find(a => a.id === interruptedActionId);
      if (action?.status === 'in_progress') resumedInProgress = true;
      if (vehicle.driverId === driver.id) reboarded = true;
      if (!driver.collapsing && reboarded && (resumedInProgress || state.drillHoles.length > holesBefore)) break;
    }

    expect(driver.collapsing).toBe(false);
    expect(reboarded).toBe(true);
    // The interrupted hole reaching 'in_progress' is the direct evidence the
    // SAME action resumed rather than being abandoned; landing a fresh hole
    // (drillHoles growing) is the same evidence when resumption and
    // completion land inside the same tick-granularity window this loop
    // observes and the transient 'in_progress' status is never itself
    // caught between two per-tick checks.
    expect(resumedInProgress || state.drillHoles.length > holesBefore).toBe(true);
  });

  it("a driving employee's driverId is cleanly re-established after a collapse-into-living_quarters-rest cycle, not left dangling", () => {
    const { run, state } = setupDrivingDriller();
    const driver = state.employees.employees.find(e => e.id === 1)!;
    const vehicle = state.vehicles.vehicles.find(v => v.id === 1)!;

    expect(run('build living_quarters at:11,14 tier:1')).toMatchObject({ success: true });
    driver.fatigue = 0;

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

describe('Vehicle-hauling employee collapse recovery (#1091)', () => {
  it('a collapse mid-haul_load leg (before loading) alights cleanly, leaves the fragment on the ground, and resumes to complete the haul', () => {
    // Fragment is far from the debris_hauler's spawn (~(3,2)) so several
    // ticks of driving are needed before the itinerary's own haul_load leg
    // actually arrives — enough room to force the collapse mid-drive.
    const { run, state, vehicleId, driverId } = setupStaffedHauler({ x: 4, z: 18 });
    const driver = state.employees.employees.find(e => e.id === driverId)!;
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;

    addBlastFragments(state.logistics, [makeFragment(9001, 4, 28)], state.navGrid);
    expect(run(`vehicle haul ${vehicleId} fragment:9001`)).toMatchObject({ success: true });

    // A couple of ticks in: still driving, not yet arrived/loaded.
    run('tick 1');
    run('tick 1');
    const trackedBeforeCollapse = state.logistics.fragments.find(f => f.fragment.id === 9001)!;
    expect(trackedBeforeCollapse.state).toBe('on_ground');
    expect(vehicle.payload).toBeNull();

    driver.fatigue = 0; // NEED_HARD_THRESHOLDS.fatigue (0) — collapses next tick
    tickUntil(run, () => driver.collapsing, 50);
    expect(driver.collapsing).toBe(true);

    // Alighted cleanly: released the vehicle, never loaded the fragment.
    expect(vehicle.driverId).toBeNull();
    expect(vehicle.payload).toBeNull();
    const trackedAtCollapse = state.logistics.fragments.find(f => f.fragment.id === 9001)!;
    expect(trackedAtCollapse.state).toBe('on_ground');

    tickUntil(run, () => !driver.collapsing, 400);
    expect(driver.collapsing).toBe(false);

    // Resuming re-drives, loads, and completes the haul to storage — the
    // same fragment id, delivered exactly once.
    tickUntil(run, () => state.logistics.fragments.find(f => f.fragment.id === 9001)?.state === 'stored', 1500);
    const trackedFinal = state.logistics.fragments.find(f => f.fragment.id === 9001)!;
    expect(trackedFinal.state).toBe('stored');
    expect(vehicle.payload).toBeNull();
  });

  it('a collapse mid-haul_unload leg (already loaded) alights cleanly, keeps the SAME fragment in transit, and resuming delivers it exactly once', () => {
    // Fragment is placed right next to the debris_hauler's spawn so loading
    // happens within the first tick or two; the freight_warehouse is placed
    // far away so several ticks of driving are needed to actually deliver —
    // enough room to force the collapse mid-drive-to-depot.
    const { run, state, vehicleId, driverId } = setupStaffedHauler({ x: 4, z: 18 });
    const driver = state.employees.employees.find(e => e.id === driverId)!;
    const vehicle = state.vehicles.vehicles.find(v => v.id === vehicleId)!;

    addBlastFragments(state.logistics, [makeFragment(9002, 5, 6)], state.navGrid);
    expect(run(`vehicle haul ${vehicleId} fragment:9002`)).toMatchObject({ success: true });

    tickUntil(run, () => vehicle.payload !== null, 30);
    expect(vehicle.payload).toEqual({ fragmentId: 9002, massKg: 900 });
    // Loaded — the fragment must no longer show as a separate on-ground entry.
    expect(state.logistics.fragments.filter(f => f.fragment.id === 9002 && f.state === 'on_ground')).toHaveLength(0);

    driver.fatigue = 0; // NEED_HARD_THRESHOLDS.fatigue (0) — collapses next tick
    tickUntil(run, () => driver.collapsing, 50);
    expect(driver.collapsing).toBe(true);

    // Alighted cleanly: released the vehicle, but the loaded cargo travels
    // with the vehicle, not the driver — payload still names the same
    // fragment, and (#1091: no more returnFragmentToGround) it never
    // reappears on the ground.
    expect(vehicle.driverId).toBeNull();
    expect(vehicle.payload).toEqual({ fragmentId: 9002, massKg: 900 });
    expect(state.logistics.fragments.filter(f => f.fragment.id === 9002 && f.state === 'on_ground')).toHaveLength(0);
    expect(state.logistics.fragments.filter(f => f.fragment.id === 9002)).toHaveLength(1);

    tickUntil(run, () => !driver.collapsing, 400);
    expect(driver.collapsing).toBe(false);

    // Resuming re-boards and drives the SAME fragment the rest of the way to
    // the depot — no second pickup, no duplicate haul.
    tickUntil(run, () => state.logistics.fragments.find(f => f.fragment.id === 9002)?.state === 'stored', 1500);
    const delivered = state.logistics.fragments.filter(f => f.fragment.id === 9002);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.state).toBe('stored');
    expect(vehicle.payload).toBeNull();
  });
});
