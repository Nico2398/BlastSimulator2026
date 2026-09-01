// BlastSimulator2026 — Integration tests: Tutorial flow
// Verifies the console commands invoked by the Tutorial button in main.ts
// produce the expected game state: new_game seed:42 size:24 + campaign start level:tutorial_pit.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { campaignStartCommand } from '../../src/console/commands/campaign.js';
import { getLevel } from '../../src/core/campaign/Level.js';
import { createRunner } from '../../src/console/createRunner.js';
import type { MiningContext } from '../../src/console/commands/mining.js';
import { TUTORIAL_STEPS } from '../../src/ui/tutorialSteps.js';
import { TutorialRails } from '../../src/ui/tutorialRails.js';
import { countBuildingsOfType } from '../../src/ui/tutorialStepHelpers.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { makeEmptyGameContext, makeGameContext } from '../helpers/gameContext.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCtx(): GameContext {
  return makeEmptyGameContext();
}

// ── Tests ──────────────────────────────────────────────────────────────────

/** Starting cash comes from the level catalogue, not a copy of it. */
const TUTORIAL_START_CASH = getLevel('tutorial_pit')!.startingCash;

describe('Tutorial flow', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  // ── 1. new_game with tutorial params ──────────────────────────────────────

  it('new_game seed:42 size:24 creates game with correct params', () => {
    const result = newGameCommand(ctx, [], { seed: '42', size: '24' });

    expect(result.success).toBe(true);
    expect(ctx.state).not.toBeNull();
    expect(ctx.state!.seed).toBe(42);
    expect(ctx.state!.world).not.toBeNull();
    expect(ctx.state!.world!.sizeX).toBe(24);
    expect(ctx.state!.world!.sizeZ).toBe(24);

    // Grid should be generated with matching dimensions
    expect(ctx.grid).not.toBeNull();
    expect(ctx.grid!.sizeX).toBe(24);
    expect(ctx.grid!.sizeZ).toBe(24);
  });

  // ── 2. campaign start on new_game'd context ───────────────────────────────

  it('followed by campaign start level:tutorial_pit sets up tutorial level', () => {
    // First set up the game environment
    ctx = makeGameContext({ seed: '42', size: '24' });

    // Then start the tutorial level
    const result = campaignStartCommand(ctx, [], { level: 'tutorial_pit' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('tutorial_pit');
    expect(result.output).toContain('32×20×32');
    expect(result.output).toContain(`$${TUTORIAL_START_CASH.toLocaleString('en-US')}`);

    // State should reflect the tutorial_pit level config
    expect(ctx.state).not.toBeNull();
    expect(ctx.state!.campaign.activeLevelId).toBe('tutorial_pit');
    expect(ctx.state!.cash).toBe(TUTORIAL_START_CASH);

    // World should be set up with tutorial_pit dimensions (32×20×32, #458 T6.1/D13)
    expect(ctx.state!.world).not.toBeNull();
    expect(ctx.state!.world!.sizeX).toBe(32);
    expect(ctx.state!.world!.sizeY).toBe(20);
    expect(ctx.state!.world!.sizeZ).toBe(32);
    expect(ctx.state!.world!.gridReady).toBe(true);
  });

  // ── 3. Full tutorial flow produces playable state ─────────────────────────

  it('full tutorial flow (new_game + campaign start) produces playable state', () => {
    // Simulate what the Tutorial button handler does:
    //   mainMenu.hide()
    //   window.__gameConsole('new_game seed:42 size:24')
    //   window.__gameConsole('campaign start level:tutorial_pit')
    //   tutorial.start()

    ctx = makeGameContext({ seed: '42', size: '24' });
    campaignStartCommand(ctx, [], { level: 'tutorial_pit' });

    // Verify game context is fully set up
    expect(ctx.state).not.toBeNull();
    expect(ctx.grid).not.toBeNull();

    // Campaign state is active
    expect(ctx.state!.campaign.activeLevelId).toBe('tutorial_pit');

    // Seed from new_game is preserved through the level transition
    expect(ctx.state!.seed).toBe(42);

    // Grid matches tutorial_pit dimensions from Level.ts (#458 T6.1/D13)
    expect(ctx.grid!.sizeX).toBe(32);
    expect(ctx.grid!.sizeY).toBe(20);
    expect(ctx.grid!.sizeZ).toBe(32);

    // World state matches
    expect(ctx.state!.world!.sizeX).toBe(32);
    expect(ctx.state!.world!.sizeY).toBe(20);
    expect(ctx.state!.world!.sizeZ).toBe(32);
    expect(ctx.state!.world!.gridReady).toBe(true);

    // Nav grid should be built
    expect(ctx.state!.navGrid).not.toBeNull();

    // Starting cash matches tutorial_pit config
    expect(ctx.state!.cash).toBe(TUTORIAL_START_CASH);
  });
});

// ── haul-debris step (#552): self-dispatching, no manual "vehicle haul" ────
//
// #552 retires the Fleet panel's manual Haul button in favor of automatic
// dispatch: on-ground fragments spawn haul_debris/fragment_debris
// PendingActions that a qualified employee claims, fetches a free hauler
// for, and drives on their own (#549/#550's machinery). This is the real
// "stuck on 17/24" playthrough bug's functional half — the step must
// actually complete via automatic dispatch alone, with no `vehicle haul`
// command anywhere in the sequence. The clock-holding half is covered
// separately in tutorial-pause.integration.test.ts.

describe('haul-debris step (#552): self-dispatching, no manual command', () => {
  it('is the 25th of 32 tutorial steps (0-based index 24), between contract-accept and contract-deliver', () => {
    // #553 inserts build-driving-center/train-driller/buy-drill-rig-assign
    // right after hire-driller, shifting every later step (including this
    // one) up by 3 from their pre-#553 positions. #555 inserts
    // train-digger/buy-rock-digger-assign right after that trio, shifting
    // this step up 2 more (19 -> 21). #681 inserts
    // build-living-quarters/set-early-policy right after hire-driller too,
    // shifting this step up 2 more again (21 -> 23). #556/#817 then moved
    // contract-accept from above build-storage to below it — the count is
    // unchanged (still index 23), but the step immediately before this one is
    // now contract-accept rather than build-storage: a contract's deadline
    // starts at acceptance, and ordering the warehouse is real queued work
    // now, so accepting first spent that deadline watching a construction
    // site while contract-deliver waited on a delivery that could no longer
    // complete. #557 inserts evacuate-zone between 'sequence' and 'blast' —
    // both well before this step — shifting it up 1 more (23 -> 24).
    const ids = TUTORIAL_STEPS.map(s => s.id);
    const idx = ids.indexOf('haul-debris');
    expect(idx).toBe(24);
    expect(ids[idx - 1]).toBe('contract-accept');
    expect(ids[idx - 2]).toBe('build-storage');
    expect(ids[idx + 1]).toBe('contract-deliver');
  });

  it('completes via automatic hauling alone: fragments move on_ground -> stored with no "vehicle haul" command issued', () => {
    const { runner, ctx } = createRunner();
    const commandsRun: string[] = [];
    const run = (cmd: string) => {
      commandsRun.push(cmd);
      return runner.run(cmd);
    };

    // Staffed opening (#551) skips manual hire/purchase setup: driller,
    // blaster, a truck-licensed driver and two excavator-licensed drivers,
    // plus an unmanned drill_rig/debris_hauler/rock_digger/rock_fragmenter
    // fleet — exactly the roster/fleet automatic haul dispatch needs, with
    // no vehicle pre-assigned to anyone.
    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    expect(run('build freight_warehouse at:6,6').success).toBe(true);
    expect(run('drill_plan grid rows:3 cols:3 spacing:5 depth:8 start:14,14').success).toBe(true);
    // drill_plan grid now queues one drill_hole PendingAction per hole
    // instead of writing them straight into state.drillHoles (#553) — the
    // staffed driller/drill_rig above land them same as any other queued
    // action. Tops up needs each tick so this solo multi-hole drive can't be
    // derailed by an unrelated needs collapse mid-drive.
    for (let i = 0; i < 400 && ctx.state!.plannedDrillHoles.length > 0; i++) {
      for (const emp of ctx.state!.employees.employees) {
        emp.hunger = 100;
        emp.fatigue = 100;
        emp.breakNeed = 100;
      }
      run('tick 1');
    }
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    // #554: charging is real work too — drain the ordered charges the same
    // way the drill plan above was drained before blasting.
    for (let i = 0; i < 400 && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
      for (const emp of ctx.state!.employees.employees) {
        emp.hunger = 100;
        emp.fatigue = 100;
        emp.breakNeed = 100;
      }
      run('tick 1');
    }
    expect(run('sequence auto delay_step:25').success).toBe(true);
    const blastResult = run('blast');
    expect(blastResult.success).toBe(true);

    const state = ctx.state!;
    expect(state.logistics.fragments.some(f => f.state === 'on_ground')).toBe(true);
    expect(state.logistics.storedMassKg).toBe(0);

    const step = TUTORIAL_STEPS.find(s => s.id === 'haul-debris')!;
    const snapshot = step.captureSnapshot!(state);

    // Automatic dispatch alone: nothing here ever issues `vehicle haul` or
    // assigns a driver by hand — the roster/fleet from staffed:true has to
    // self-organize.
    for (let i = 0; i < 400 && !step.isComplete(state, snapshot); i++) {
      run('tick 1');
    }

    expect(step.isComplete(state, snapshot)).toBe(true);
    expect(state.logistics.storedMassKg).toBeGreaterThan(0);
    expect(state.logistics.fragments.some(f => f.state === 'stored')).toBe(true);
    expect(commandsRun.some(cmd => cmd.startsWith('vehicle haul'))).toBe(false);
  });
});

// ── evacuate before you fire (#557) ─────────────────────────────────────────
//
// The tutorial's evacuate-zone step (between 'sequence' and 'blast') exists
// because the console command it's teaching has real teeth: with
// ctx.tutorialActive set, `blast` refuses to fire while anyone is still
// standing in the danger zone, and the refusal must leave the whole blast
// step a no-op — no cash spent, no plan cleared, no blast recorded — not just
// an error string.

describe('blast refuses to fire on an occupied zone during the tutorial (#557)', () => {
  function setup(): { ctx: MiningContext; runCmd: (cmd: string) => ReturnType<ReturnType<typeof createRunner>['runner']['run']> } {
    const { runner, ctx } = createRunner();
    ctx.tutorialActive = true;
    const runCmd = (cmd: string) => runner.run(cmd);
    expect(runCmd('new_game seed:42 size:48 mine_type:desert staffed:true').success).toBe(true);
    expect(runCmd('drill_plan grid rows:3 cols:3 spacing:3 depth:8 start:15,15').success).toBe(true);
    for (let i = 0; i < 400 && ctx.state!.plannedDrillHoles.length > 0; i++) {
      for (const emp of ctx.state!.employees.employees) {
        emp.hunger = 100;
        emp.fatigue = 100;
        emp.breakNeed = 100;
      }
      runCmd('tick 1');
    }
    expect(runCmd('charge hole:* explosive:boomite amount:8 stemming:2').success).toBe(true);
    for (let i = 0; i < 400 && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
      for (const emp of ctx.state!.employees.employees) {
        emp.hunger = 100;
        emp.fatigue = 100;
        emp.breakNeed = 100;
      }
      runCmd('tick 1');
    }
    expect(runCmd('sequence auto delay_step:25').success).toBe(true);
    return { ctx, runCmd };
  }

  it('refuses to fire while the danger zone is still occupied: no cash spent, no plan cleared, no blast recorded', () => {
    const { ctx, runCmd } = setup();
    const state = ctx.state!;

    // Leave the crew standing inside the danger zone instead of clearing it.
    for (const emp of state.employees.employees) {
      emp.x = 16;
      emp.z = 16;
    }

    const beforeCash = state.cash;
    const beforeHoleCount = state.drillHoles.length;
    const beforeChargeCount = Object.keys(state.chargesByHole).length;
    const beforeBlastCount = state.damage.blastCount;

    const result = runCmd('blast');

    expect(result.success, 'blast fired while tutorialActive and the zone was occupied').toBe(false);
    expect(result.output.length).toBeGreaterThan(0);
    expect(state.cash).toBe(beforeCash);
    expect(state.drillHoles.length).toBe(beforeHoleCount);
    expect(Object.keys(state.chargesByHole).length).toBe(beforeChargeCount);
    expect(state.damage.blastCount).toBe(beforeBlastCount);
  });

  it('fires once the zone is genuinely clear of every employee and vehicle', () => {
    const { ctx, runCmd } = setup();
    const state = ctx.state!;

    // Evacuate everyone well clear of the danger zone before firing.
    for (const emp of state.employees.employees) {
      emp.x = 44;
      emp.z = 44;
    }
    for (const veh of state.vehicles.vehicles) {
      veh.x = 44;
      veh.z = 44;
    }

    const result = runCmd('blast');

    expect(result.success, result.output).toBe(true);
    expect(state.damage.blastCount).toBe(1);
  });

  it('without tutorialActive, the same occupied zone does not block firing — the gate is tutorial-only', () => {
    const { runner, ctx } = createRunner();
    ctx.tutorialActive = false;
    const runCmd = (cmd: string) => runner.run(cmd);
    expect(runCmd('new_game seed:42 size:48 mine_type:desert staffed:true').success).toBe(true);
    expect(runCmd('drill_plan grid rows:3 cols:3 spacing:3 depth:8 start:15,15').success).toBe(true);
    const state = ctx.state!;
    for (let i = 0; i < 400 && state.plannedDrillHoles.length > 0; i++) {
      for (const emp of state.employees.employees) {
        emp.hunger = 100;
        emp.fatigue = 100;
        emp.breakNeed = 100;
      }
      runCmd('tick 1');
    }
    expect(runCmd('charge hole:* explosive:boomite amount:8 stemming:2').success).toBe(true);
    for (let i = 0; i < 400 && Object.keys(state.plannedChargesByHole).length > 0; i++) {
      for (const emp of state.employees.employees) {
        emp.hunger = 100;
        emp.fatigue = 100;
        emp.breakNeed = 100;
      }
      runCmd('tick 1');
    }
    expect(runCmd('sequence auto delay_step:25').success).toBe(true);

    for (const emp of state.employees.employees) {
      emp.x = 16;
      emp.z = 16;
    }

    const result = runCmd('blast');
    expect(result.success, result.output).toBe(true);
  });
});

// ── train-driller/train-digger (#903): booked training must not deadlock ──
//
// Bug 1 of #903: `employee train <id> skill:...` sets the employee's
// trainingState, but hasOutstandingWork (tutorialGuide.ts) only ever reads
// activeActionId/pendingDriverVehicleId/destinationX — none of which a
// trainee carries. Once train-driller/train-digger's own 25-tick tickBudget
// is spent (typically while the player is still navigating panels, before
// the course is even booked — an entirely legitimate hold, waiting on the
// player), TutorialRails.updateClock never sees the booked course as
// outstanding work and never lifts it again. In the real app, main.ts's own
// render loop refuses to call `tick` at all while isPaused (`if
// (ctx.state && !ctx.state.isPaused && autoTickEnabled) { ... tick ... }`),
// so tickTraining (EmployeeTraining.ts) never runs another tick and the
// course can never finish — the tutorial deadlocks at stage 2/3 forever.
//
// These tests drive the real engine (createRunner, real ticks, real
// TutorialRails) and — critically — gate every tick on `!state.isPaused`,
// exactly like main.ts's own loop, rather than ticking unconditionally: a
// loop that ticks regardless of pause state would force the course to
// finish through sheer test-harness brute force and never observe the
// deadlock a real player hits.

function makeDrillingCenterReady(
  run: (cmd: string) => ReturnType<ReturnType<typeof createRunner>['runner']['run']>,
  ctx: ReturnType<typeof createRunner>['ctx'],
): void {
  expect(run('new_game seed:42 size:32').success).toBe(true);
  // Fixed employee-id convention the tutorial itself relies on (see
  // tutorialSteps.ts's own train-driller/train-digger comments): the
  // surveyor hired first is employee #1, the driller hired next is #2.
  expect(run('employee hire role:surveyor').success).toBe(true);
  expect(run('employee hire role:driller').success).toBe(true);
  expect(run('build driving_center at:10,8').success).toBe(true);

  for (let i = 0; i < 400 && countBuildingsOfType(ctx.state!, 'driving_center') === 0; i++) {
    for (const emp of ctx.state!.employees.employees) {
      emp.hunger = 100;
      emp.fatigue = 100;
      emp.breakNeed = 100;
    }
    run('tick 1');
  }
  expect(countBuildingsOfType(ctx.state!, 'driving_center')).toBeGreaterThan(0);
}

/**
 * Advances the game the way main.ts's real render loop does: a tick only
 * happens while the game is not paused. Returns whether at least one tick
 * actually ran.
 */
function tickIfUnpaused(
  run: (cmd: string) => ReturnType<ReturnType<typeof createRunner>['runner']['run']>,
  state: GameState,
): boolean {
  if (state.isPaused) return false;
  state.employees.employees.forEach((emp) => {
    emp.hunger = 100;
    emp.fatigue = 100;
    emp.breakNeed = 100;
  });
  run('tick 1');
  return true;
}

describe('train-driller (#903): a booked course must not deadlock the tutorial clock', () => {
  it('the driver rig course finishes and the tutorial advances to buy-drill-rig-assign with no further player input', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    makeDrillingCenterReady(run, ctx);

    const step = TUTORIAL_STEPS.find(s => s.id === 'train-driller')!;
    expect(step.waitsOnWork).toBe(true);
    expect(step.tickBudget).toBe(25);

    const rails = new TutorialRails();
    rails.beginStep(
      {
        id: step.id,
        ...(step.highlightTarget !== undefined ? { highlightTarget: step.highlightTarget } : {}),
        ...(step.tickBudget !== undefined ? { tickBudget: step.tickBudget } : {}),
        ...(step.waitsOnWork !== undefined ? { waitsOnWork: step.waitsOnWork } : {}),
      },
      ctx.state,
    );

    // Simulate the click/panel-navigation time before the player actually
    // books the course: nothing is outstanding yet, so the budget
    // legitimately runs out and the clock correctly holds, waiting on the
    // player — true with or without the fix.
    for (let i = 0; i < step.tickBudget! + 5; i++) {
      tickIfUnpaused(run, ctx.state!);
      rails.updateClock(ctx.state);
    }
    expect(ctx.state!.isPaused, 'the clock should have legitimately held while waiting on the player to click Train').toBe(true);

    const trainResult = run('employee train 2 skill:driving.drill_rig');
    expect(trainResult.success, trainResult.output).toBe(true);

    const snapshot = step.captureSnapshot ? step.captureSnapshot(ctx.state!) : {};
    let everTicked = false;

    // From here on, exactly like main.ts, a tick only happens while
    // !isPaused — so if updateClock never lifts the hold, no further tick
    // ever runs and the course can never finish.
    for (let i = 0; i < 400 && !step.isComplete(ctx.state!, snapshot); i++) {
      if (tickIfUnpaused(run, ctx.state!)) everTicked = true;
      rails.updateClock(ctx.state);
    }

    expect(everTicked, 'the clock never lifted once the course was booked — a real player would be stuck at stage 2/3 forever').toBe(true);
    expect(step.isComplete(ctx.state!, snapshot)).toBe(true);
    expect(ctx.state!.isPaused).toBe(false);

    const driller = ctx.state!.employees.employees.find(e => e.id === 2)!;
    expect(driller.qualifications.some(q => q.category === 'driving.drill_rig')).toBe(true);

    // No further player input beyond booking the course and ticking: the
    // step's own completion is what the tutorial uses to advance, and the
    // very next step in the canonical order is buy-drill-rig-assign.
    const idx = TUTORIAL_STEPS.findIndex(s => s.id === 'train-driller');
    expect(TUTORIAL_STEPS[idx + 1]!.id).toBe('buy-drill-rig-assign');
  });
});

describe('train-digger (#903): a booked course must not deadlock the tutorial clock', () => {
  it('the excavator course finishes and the tutorial advances to buy-rock-digger-assign with no further player input', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);
    makeDrillingCenterReady(run, ctx);

    const step = TUTORIAL_STEPS.find(s => s.id === 'train-digger')!;
    expect(step.waitsOnWork).toBe(true);
    expect(step.tickBudget).toBe(25);

    const rails = new TutorialRails();
    rails.beginStep(
      {
        id: step.id,
        ...(step.highlightTarget !== undefined ? { highlightTarget: step.highlightTarget } : {}),
        ...(step.tickBudget !== undefined ? { tickBudget: step.tickBudget } : {}),
        ...(step.waitsOnWork !== undefined ? { waitsOnWork: step.waitsOnWork } : {}),
      },
      ctx.state,
    );

    for (let i = 0; i < step.tickBudget! + 5; i++) {
      tickIfUnpaused(run, ctx.state!);
      rails.updateClock(ctx.state);
    }
    expect(ctx.state!.isPaused, 'the clock should have legitimately held while waiting on the player to click Train').toBe(true);

    // The surveyor hired first (employee #1) trains here — idle since their
    // one-off survey job, matching train-digger's own comment convention.
    const trainResult = run('employee train 1 skill:driving.excavator');
    expect(trainResult.success, trainResult.output).toBe(true);

    const snapshot = step.captureSnapshot ? step.captureSnapshot(ctx.state!) : {};
    let everTicked = false;

    for (let i = 0; i < 400 && !step.isComplete(ctx.state!, snapshot); i++) {
      if (tickIfUnpaused(run, ctx.state!)) everTicked = true;
      rails.updateClock(ctx.state);
    }

    expect(everTicked, 'the clock never lifted once the course was booked — a real player would be stuck at stage 2/3 forever').toBe(true);
    expect(step.isComplete(ctx.state!, snapshot)).toBe(true);
    expect(ctx.state!.isPaused).toBe(false);

    const surveyor = ctx.state!.employees.employees.find(e => e.id === 1)!;
    expect(surveyor.qualifications.some(q => q.category === 'driving.excavator')).toBe(true);

    const idx = TUTORIAL_STEPS.findIndex(s => s.id === 'train-digger');
    expect(TUTORIAL_STEPS[idx + 1]!.id).toBe('buy-rock-digger-assign');
  });
});
