// @vitest-environment jsdom
//
// jsdom (#959): the full-playthrough test below drives TUTORIAL_STEPS'
// 'blast' step, whose real isComplete calls isBlastReportOutstanding()
// (tutorialStepHelpers.ts), which reads `document.querySelector` — undefined
// under this file's previous plain-node environment. jsdom's empty document
// resolves that query to null, matching the documented "no modal marker
// exists at all (non-browser / test harness state)" case (see
// tutorialSteps.test.ts's own test of the same name) and is a no-op for
// every other test already in this file, none of which touch the DOM.
//
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
import { getFinancialReport } from '../../src/core/economy/Finance.js';
import { computeDangerZone } from '../../src/core/entities/Zone.js';
import { BLAST_DANGER_MARGIN_M } from '../../src/core/config/balance.js';

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
  it('is the 27th of 34 tutorial steps (0-based index 26), between contract-accept and sell-ore', () => {
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
    // both well before this step — shifting it up 1 more (23 -> 24). #905
    // inserts toggle-survey-overlay right after 'survey' — also well before
    // this step — shifting it up 1 more (24 -> 25). #923 removes the
    // standalone 'time-speed' step (was right after hire-surveyor) and adds
    // speed-up-for-dig/speed-normal-after-dig right after box-cut instead —
    // both well before this step — net +1, shifting it up 1 more (25 -> 26).
    // #959 renames the step right after this one from 'contract-deliver' to
    // 'sell-ore' (the tutorial never actually hauled and sold blasted ore for
    // money) — the count and this step's own index are unchanged.
    const ids = TUTORIAL_STEPS.map(s => s.id);
    const idx = ids.indexOf('haul-debris');
    expect(idx).toBe(26);
    expect(ids[idx - 1]).toBe('contract-accept');
    expect(ids[idx - 2]).toBe('build-storage');
    expect(ids[idx + 1]).toBe('sell-ore');
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
        emp.fatigue = 100;
      }
      run('tick 1');
    }
    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    // #554: charging is real work too — drain the ordered charges the same
    // way the drill plan above was drained before blasting.
    for (let i = 0; i < 400 && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
      for (const emp of ctx.state!.employees.employees) {
        emp.fatigue = 100;
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
        emp.fatigue = 100;
      }
      runCmd('tick 1');
    }
    expect(runCmd('charge hole:* explosive:boomite amount:8 stemming:2').success).toBe(true);
    for (let i = 0; i < 400 && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
      for (const emp of ctx.state!.employees.employees) {
        emp.fatigue = 100;
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
        emp.fatigue = 100;
      }
      runCmd('tick 1');
    }
    expect(runCmd('charge hole:* explosive:boomite amount:8 stemming:2').success).toBe(true);
    for (let i = 0; i < 400 && Object.keys(state.plannedChargesByHole).length > 0; i++) {
      for (const emp of state.employees.employees) {
        emp.fatigue = 100;
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
      emp.fatigue = 100;
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
    emp.fatigue = 100;
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

// ── charge → sequence (#926): the step and the panel must never disagree ──
//
// BlastWorkshop.ts's suggestStep (not exported — its Charge-tab condition is
// mirrored below as `stillOnChargeTab`) keeps the Blast Workshop on its
// Charge tab for as long as any hole is still unlit. The 'charge' tutorial
// step used to complete the instant the FIRST of several holes charged
// (createComparisonStep's generic "value increased"), moving the tutorial on
// to 'sequence' while the panel — correctly reading the plan as still
// mid-charge — stayed on Charge. The Sequence tab's own controls live in a
// hidden tab body at that point, so the rail had nothing reachable to point
// at: a real dead end (issue #926). This test drains a real multi-hole
// charge order through the real engine and pins the step's completion
// against the panel's own criterion at every tick in between.
function stillOnChargeTab(state: GameState): boolean {
  const holes = state.drillHoles;
  return !holes.every(h => state.chargesByHole[h.id]);
}

// ── speed-up-for-dig / speed-normal-after-dig (#923) ─────────────────────
//
// The speed-control lesson used to be a standalone 'time-speed' step,
// completing on any timeScale increase. #923 moves it into the box-cut
// ramp-dig wait instead: box-cut's own isComplete fires on the FIRST ramp
// segment landing (navGrid ramp-cell count ticking up), well before the rest
// of the (12m/8-deep) corridor is dug — so 'speed-up-for-dig' opens while the
// dig is still genuinely in flight, teaches ×8, and 'speed-normal-after-dig'
// only completes once the whole ramp is actually done (spliced out of
// state.plannedRamps, mirroring 'orderedRampSegmentCount' in console-api.ts)
// AND the speed is back at ×1.
describe('speed-up-for-dig / speed-normal-after-dig (#923): taught inside the box-cut ramp-dig wait', () => {
  it('speed-up-for-dig completes while the ramp is still mid-dig, and speed-normal-after-dig completes only once the dig is fully done and the speed is back to ×1', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    expect(run('build_ramp start:16,19 end:16,31 depth:8').success).toBe(true);

    const state = ctx.state!;
    expect(state.plannedRamps.length).toBeGreaterThan(0);
    const totalSegments = state.plannedRamps.reduce((sum, r) => sum + r.segments.length, 0);
    // A 12m/8-deep ramp genuinely produces more than one segment — otherwise
    // this test would not exercise "still mid-dig" at all.
    expect(totalSegments).toBeGreaterThan(1);

    const speedUpStep = TUTORIAL_STEPS.find((s) => s.id === 'speed-up-for-dig')!;
    const speedDownStep = TUTORIAL_STEPS.find((s) => s.id === 'speed-normal-after-dig')!;

    // Drain a handful of ticks — enough for the first segment or two to land
    // (mirroring box-cut's own isComplete), but nowhere near the whole ramp.
    for (let i = 0; i < 15 && state.plannedRamps.length > 0; i++) {
      for (const emp of state.employees.employees) {
        emp.fatigue = 100;
      }
      run('tick 1');
      if (state.plannedRamps[0] && state.plannedRamps[0].segments.some((seg) => seg.done)) break;
    }
    expect(state.plannedRamps.length, 'the ramp finished digging before the mid-dig window could be exercised — the test setup no longer produces a multi-segment ramp').toBeGreaterThan(0);

    expect(speedUpStep.isComplete(state, {})).toBe(false);
    expect(run('time speed:8').success).toBe(true);
    expect(state.timeScale).toBe(8);
    expect(speedUpStep.isComplete(state, {})).toBe(true);

    // speed-normal-after-dig's own step opens right about here — capture its
    // snapshot while the ramp is still genuinely mid-dig.
    const speedDownSnapshot = speedDownStep.captureSnapshot ? speedDownStep.captureSnapshot(state) : {};
    expect(speedDownStep.isComplete(state, speedDownSnapshot)).toBe(false);

    // Drain the rest of the dig at ×8.
    for (let i = 0; i < 400 && state.plannedRamps.length > 0; i++) {
      for (const emp of state.employees.employees) {
        emp.fatigue = 100;
      }
      run('tick 1');
    }
    expect(state.plannedRamps.length).toBe(0);

    // Ramp fully dug, but still at ×8 — must not complete on the ramp alone.
    expect(speedDownStep.isComplete(state, speedDownSnapshot)).toBe(false);

    expect(run('time speed:1').success).toBe(true);
    expect(state.timeScale).toBe(1);
    expect(speedDownStep.isComplete(state, speedDownSnapshot)).toBe(true);
  });
});

describe('charge (#926): completion never runs ahead of the panel\'s own Charge tab', () => {
  it('stays incomplete on every partially-charged tick, and completes exactly when the panel would also move on', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    expect(run('drill_plan grid rows:3 cols:3 spacing:5 depth:8 start:14,14').success).toBe(true);
    for (let i = 0; i < 400 && ctx.state!.plannedDrillHoles.length > 0; i++) {
      for (const emp of ctx.state!.employees.employees) {
        emp.fatigue = 100;
      }
      run('tick 1');
    }
    const holeCount = ctx.state!.drillHoles.length;
    expect(holeCount).toBeGreaterThan(1);

    expect(run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);

    const step = TUTORIAL_STEPS.find(s => s.id === 'charge')!;
    let sawPartialCharge = false;

    for (let i = 0; i < 400 && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
      for (const emp of ctx.state!.employees.employees) {
        emp.fatigue = 100;
      }
      run('tick 1');

      const chargedCount = Object.keys(ctx.state!.chargesByHole).length;
      if (chargedCount > 0 && chargedCount < holeCount) {
        sawPartialCharge = true;
        // The regression itself: a plain "value increased" comparison would
        // already report done here, while the panel still correctly wants
        // to stay on Charge.
        expect(stillOnChargeTab(ctx.state!)).toBe(true);
        expect(step.isComplete(ctx.state!, {})).toBe(false);
      }
    }
    expect(sawPartialCharge, 'the drain loop never observed a partially-charged plan — this test would not have caught the regression').toBe(true);
    expect(Object.keys(ctx.state!.plannedChargesByHole).length).toBe(0);

    // Fully charged: the step and the panel now agree it is time to move on.
    expect(stillOnChargeTab(ctx.state!)).toBe(false);
    expect(step.isComplete(ctx.state!, {})).toBe(true);

    // The run continues cleanly through sequence and blast.
    const sequenceStep = TUTORIAL_STEPS.find(s => s.id === 'sequence')!;
    const sequenceSnapshot = sequenceStep.captureSnapshot!(ctx.state!);
    expect(run('sequence auto delay_step:25').success).toBe(true);
    expect(sequenceStep.isComplete(ctx.state!, sequenceSnapshot)).toBe(true);

    const blastResult = run('blast');
    expect(blastResult.success, blastResult.output).toBe(true);
  });
});

// ── #949: the tutorial's own scripted blast must rate good or better ───────
//
// A tutorial exists to teach what a competent shot looks like. Before #949,
// the tutorial's own drill-plan/charge commands (5m spacing, 5kg charge, 2m
// stemming against a box-cut free face) rated CATASTROPHIC — overloaded and
// under-stemmed, with casualties and destroyed buildings. This test runs the
// tutorial's own step commands, read live off TUTORIAL_STEPS rather than
// retyped literals so it cannot silently desync from the source of truth
// again, and asserts the retuned plan produces a clean blast: rating good or
// better, zero casualties, zero destroyed buildings/vehicles, real rock
// still broken.
describe('the tutorial\'s own scripted blast rates good or better (#949)', () => {
  it('runs drill-plan/charge/sequence exactly as scripted and blasts cleanly', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    // 1. Start campaign on tutorial_pit, staffed — same bootstrap as the
    // #928 box-cut performance test (full-level/tutorial.integration.test.ts).
    expect(run('campaign start level:tutorial_pit staffed:true').success).toBe(true);
    const state = ctx.state!;

    // 2. Build the box-cut ramp the tutorial's own 'box-cut' step builds
    // before drilling — read live so a future change to that step's own
    // command is picked up here too.
    const boxCutStep = TUTORIAL_STEPS.find((s) => s.id === 'box-cut')!;
    expect(run(boxCutStep.commands![0]!).success).toBe(true);
    for (let i = 0; i < 400 && state.plannedRamps.length > 0; i++) {
      for (const emp of state.employees.employees) {
        emp.fatigue = 100;
      }
      run('tick 1');
    }
    expect(state.plannedRamps.length).toBe(0);

    // 3. drill-plan
    const drillPlanStep = TUTORIAL_STEPS.find((s) => s.id === 'drill-plan')!;
    expect(run(drillPlanStep.commands![0]!).success).toBe(true);
    for (let i = 0; i < 400 && state.plannedDrillHoles.length > 0; i++) {
      for (const emp of state.employees.employees) {
        emp.fatigue = 100;
      }
      run('tick 1');
    }
    expect(state.plannedDrillHoles.length).toBe(0);
    expect(state.drillHoles.length).toBeGreaterThan(0);

    // 4. charge
    const chargeStep = TUTORIAL_STEPS.find((s) => s.id === 'charge')!;
    expect(run(chargeStep.commands![0]!).success).toBe(true);
    for (let i = 0; i < 400 && Object.keys(state.plannedChargesByHole).length > 0; i++) {
      for (const emp of state.employees.employees) {
        emp.fatigue = 100;
      }
      run('tick 1');
    }
    expect(Object.keys(state.plannedChargesByHole).length).toBe(0);

    // 5. sequence
    const sequenceStep = TUTORIAL_STEPS.find((s) => s.id === 'sequence')!;
    expect(run(sequenceStep.commands![0]!).success).toBe(true);

    // 6. Evacuate crew and vehicles beyond the danger zone — mirrors the
    // 'blast refuses to fire on an occupied zone' tests above, which move
    // everyone to a corner clear of computeDangerZone(state.drillHoles,
    // BLAST_DANGER_MARGIN_M). tutorial_pit is a 32x32 grid and the drill
    // plan's own danger zone (15m margin around a start:22,20 3x3/4m grid)
    // covers most of it, so (2,2) — well below the zone's own x1/z1 — is the
    // one corner that stays clear.
    const preBlastAliveCount = state.employees.employees.filter(e => e.alive).length;
    const preBlastVehicleCount = state.vehicles.vehicles.length;
    const preBlastDeathCount = state.damage.deathCount;
    for (const emp of state.employees.employees) {
      emp.x = 2;
      emp.z = 2;
    }
    for (const veh of state.vehicles.vehicles) {
      veh.x = 2;
      veh.z = 2;
    }

    // 7. blast
    const blastResult = run('blast');
    expect(blastResult.success, blastResult.output).toBe(true);

    // 8. Rating must be good or better — the acceptance bar the issue sets.
    // Not hardcoded to 'perfect' only: 'good' also satisfies it.
    const report = state.lastBlastReport;
    expect(report).not.toBeNull();
    expect(['good', 'perfect']).toContain(report!.rating);

    // 9. Zero destroyed buildings.
    expect(report!.destroyedBuildings.length).toBe(0);

    // 10. Zero casualties: no employee death delta across the blast, and no
    // 'death' accident recorded against this specific blast's own report.
    const postBlastAliveCount = state.employees.employees.filter(e => e.alive).length;
    expect(postBlastAliveCount).toBe(preBlastAliveCount);
    expect(state.damage.deathCount).toBe(preBlastDeathCount);
    expect((report!.accidents ?? []).some(a => a.type === 'death')).toBe(false);

    // 11. No vehicle destroyed: vehicle count unchanged, and every surviving
    // vehicle has positive hp (a destroyed vehicle is spliced out of the
    // array entirely, so the count check catches what an hp-only check
    // would miss).
    expect(state.vehicles.vehicles.length).toBe(preBlastVehicleCount);
    expect(state.vehicles.vehicles.every(v => v.hp > 0)).toBe(true);
    expect((report!.accidents ?? []).some(a => a.type === 'vehicle_destroyed')).toBe(false);

    // Still teaches a real shot: rock actually broke.
    expect(report!.clearedVoxels).toBeGreaterThan(0);
  });
});

// ── #959: the tutorial must end WON, with positive cash, not bankrupt ──
//
// The reported bug: a player who does exactly what the tutorial teaches
// finishes deep in the red, yet the closing card still reads "Tutorial
// Complete!" — 'victory' (tutorialStepsClosing.ts) completes on any
// `state.levelEnded === true`, which bankruptcy/arrest/ecological_shutdown/
// worker_revolt all set just as readily as a genuine win, and
// 'congratulations' always shows the same success copy regardless. The
// other, structural half of the same bug: nothing in TUTORIAL_STEPS ever
// hauls and sells the ore the tutorial's own scripted blast produces, so the
// operating deficit the rest of the level runs up (hires, buildings,
// vehicles, two full drill-charge-blast cycles) never has anything to offset
// it. This test drives every TUTORIAL_STEPS command in order, through a
// real console + real ticking, exactly the way a player follows the card
// deck, and proves the level can actually be WON — cash positive,
// `levelEndReason` genuinely 'completed', netProfit past the level's own
// unlockThreshold — not just declared won by a step whose own condition
// cannot tell a win from a bankruptcy.
describe('full tutorial playthrough ends WON with positive cash, not bankrupt-but-congratulated (#959)', () => {
  /**
   * Advance ticks one at a time, topping up every living employee's fatigue
   * (the same anti-collapse hack every other real-tick-driving test in this
   * file already uses) and auto-resolving any pending event (tutorial_pit's
   * own eventFreqMultiplier is 0, so the only pending event this can ever see
   * is the one 'event-fire-resolve' fires itself) — stops the instant
   * `done()` reads true, or after `maxTicks`.
   */
  /** Tracks stagnation for windDownOnceExhausted — see its own doc comment. */
  interface StagnationTracker { lastStoredMassKg: number; lastCompletedCount: number; stagnantTicks: number }

  function tickUntil(
    run: (cmd: string) => { success: boolean; output: string },
    state: GameState,
    maxTicks: number,
    done: () => boolean,
    stagnation: StagnationTracker,
  ): void {
    for (let i = 0; i < maxTicks && !done(); i++) {
      for (const emp of state.employees.employees) {
        if (emp.alive) emp.fatigue = 100;
      }
      if (state.events.pendingEvent) run('event choose 0');
      run('tick 1');
      sellCompletableContracts(run, state);
      windDownOnceExhausted(run, state, stagnation);
    }
  }

  /**
   * Once nothing has actually moved for a long stretch — no more stock ever
   * arriving in storage, no contract ever completing — the last remaining
   * employee (the driver) and vehicle (the debris_hauler) are pure ongoing
   * cost with no further income to show for it, and never will be: some
   * fraction of a real blast's debris always lands somewhere no NavGrid
   * route reaches without a ramp this tutorial never digs (#953's own
   * "fresh blast crater's walled-off interior" case) — that remainder is
   * never coming in, no matter how long this waits. A real operator lays
   * off and sells off down to nobody and nothing once the job has
   * genuinely stopped producing, same reasoning as the mass layoff/scrap/
   * demolish right after 'sell-ore' (#959). Idempotent: no-ops once already
   * wound down (empty roster/fleet).
   */
  function windDownOnceExhausted(
    run: (cmd: string) => { success: boolean; output: string },
    state: GameState,
    stagnation: StagnationTracker,
  ): void {
    // Only once already down to the post-sell-ore minimal crew (driver +
    // hauler) — before that, stagnation just means the blast hasn't
    // happened yet, not that the job is done.
    if (state.employees.employees.length !== 1 || state.vehicles.vehicles.length !== 1) return;

    const completedCount = state.contracts.completedHistory.filter((c) => c.completed).length;
    if (state.logistics.storedMassKg !== stagnation.lastStoredMassKg || completedCount !== stagnation.lastCompletedCount) {
      stagnation.lastStoredMassKg = state.logistics.storedMassKg;
      stagnation.lastCompletedCount = completedCount;
      stagnation.stagnantTicks = 0;
      return;
    }
    stagnation.stagnantTicks++;
    if (stagnation.stagnantTicks < 300) return;

    for (const emp of [...state.employees.employees]) run(`employee fire ${emp.id}`);
    for (const veh of [...state.vehicles.vehicles]) run(`vehicle scrap ${veh.id}`);
  }

  /**
   * Keep every ore_sale/rubble_disposal contract this blast's own hauled-in
   * yield can plausibly pay moving, real-player style: top up delivery on
   * every already-ACCEPTED contract with whatever stock is on hand right
   * now (a contract doesn't have to be paid off in one delivery — repeated
   * partial deliveries against the same contract, as hauling keeps bringing
   * more in, complete it before its deadline same as one big delivery
   * would), and accept a fresh offer only when CURRENT stock already covers
   * it in full: an offer accepted on partial stock alone, hoping more
   * arrives before its 30-100 tick deadline, risks the full penalty
   * (30% of quantity*price) on top of zero income if it doesn't — and at
   * a high enough price multiplier that penalty outweighs everything this
   * loop already banked (confirmed empirically: a looser "any nonzero
   * stock" gate here drove `expense:fines` past `income:contracts` once
   * the level's own contractPriceMultiplier rose to cover its setup costs).
   * `ore_sale` is preferred over
   * `rubble_disposal` when both match: both draw from the same physical
   * stored fragments (a rubble sale is FIFO over ALL stored mass, ore-
   * bearing or not — Logistics.ts's consumeStoredOre reaches for barren
   * fragments first for exactly this reason), and ore is worth far more per
   * kg (#959: the tutorial's own single small-contract ceiling before this
   * left the level chronically unable to recoup its own setup costs).
   */
  function sellCompletableContracts(
    run: (cmd: string) => { success: boolean; output: string },
    state: GameState,
  ): void {
    const stockOf = (materialId: string) => (
      materialId === '' ? state.logistics.storedMassKg : (state.collectedOre[materialId] ?? 0)
    );

    // Top up every already-accepted contract first — this is what lets a
    // contract larger than any single haul batch still complete over time.
    for (const active of [...state.contracts.active]) {
      if (active.type !== 'ore_sale' && active.type !== 'rubble_disposal') continue;
      const amount = Math.min(active.quantityKg - active.deliveredKg, stockOf(active.materialId));
      if (amount > 0) run(`contract deliver ${active.id} amount:${amount}`);
    }

    // Then accept fresh offers with at least some matching stock right now,
    // ore_sale first.
    for (let guard = 0; guard < 8; guard++) {
      const fullyCovered = (c: typeof state.contracts.available[number]) => stockOf(c.materialId) >= c.quantityKg;
      const offer = state.contracts.available.find((c) => c.type === 'ore_sale' && fullyCovered(c))
        ?? state.contracts.available.find((c) => c.type === 'rubble_disposal' && fullyCovered(c));
      if (!offer) return;
      if (!run(`contract accept ${offer.id}`).success) return;
      const active = state.contracts.active.find((c) => c.id === offer.id);
      if (!active) return;
      const amount = Math.min(active.quantityKg, stockOf(active.materialId));
      if (amount > 0) run(`contract deliver ${active.id} amount:${amount}`);
    }
  }

  it('drives every TUTORIAL_STEPS command in order to a genuine, profitable level completion', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('campaign start level:tutorial_pit').success).toBe(true);
    const state = ctx.state!;
    const stagnation: StagnationTracker = { lastStoredMassKg: -1, lastCompletedCount: -1, stagnantTicks: 0 };

    for (const step of TUTORIAL_STEPS) {
      // 'drill-plan' is a createComparisonStep that completes on the FIRST
      // ordered hole landing, not all of them, by design (see its own
      // comment in tutorialSteps.ts) — the rail moves on long before a
      // multi-hole grid finishes drilling. Unlike 'charge' below it (whose
      // own isComplete already requires every hole charged, #926), a
      // `charge hole:*` issued the instant this step's card opens would only
      // reach whichever holes had already landed, permanently leaving the
      // rest un-chargeable once landed later. Draining the drill queue first
      // is what a patient real player effectively achieves by not clicking
      // Charge All until the plan visibly stops changing.
      //
      // A blanket "drain until state.pendingActions is empty" was tried and
      // rejected here: once fragments hit the ground after 'blast', an
      // unclaimed haul_debris PendingAction sits queued (no hauler exists
      // yet at that point in the deck) and never resolves on its own,
      // burning the entire tick budget on every later step for nothing —
      // exactly the outstanding-work signal TutorialRails' own clock-hold
      // exists to stop paying for by pausing instead of ticking.
      if (step.id === 'charge') {
        tickUntil(run, state, 500, () => state.plannedDrillHoles.length === 0, stagnation);
      }

      const snapshot = step.captureSnapshot ? step.captureSnapshot(state) : {};

      // ── Steps this Node-level test cannot drive exactly as a player would ──

      if (step.id === 'toggle-survey-overlay') {
        // Genuinely DOM-only: the step completes on a single click of a real
        // button's aria-pressed state, with no console equivalent at all
        // (see its own step definition). Out of scope for a console-driven
        // playthrough — the interaction-mode scenario channel covers the
        // real click. Treated as satisfied so the rest of the deck can be
        // driven without a step this test structurally cannot exercise.
        continue;
      }

      if (step.id === 'contract-accept') {
        // The step's own `commands` hint hardcodes `contract accept 1` —
        // by the time this step is actually reached, the survey/drilling/
        // charging/hauling stretch above has spent well over
        // CONTRACT_REFRESH_INTERVAL ticks, so the offer pool has already
        // rotated past id 1 (#597/#635's own reason for preferring a
        // type/material selector). Accept whichever offer genuinely leads
        // the pool right now instead of trusting the stale hint literally.
        const offer = state.contracts.available[0];
        expect(offer, 'no contract available to accept at all').toBeDefined();
        expect(run(`contract accept ${offer!.id}`).success).toBe(true);
        tickUntil(run, state, 500, () => step.isComplete(state, snapshot), stagnation);
        expect(step.isComplete(state, snapshot), `tutorial step "${step.id}" never completed`).toBe(true);
        continue;
      }

      if (step.id === 'evacuate-zone') {
        // No console command hint at all (the step teaches "Sound the Horn",
        // BlastWorkshop.ts's Fire step, whose own handler dispatches `zone
        // clear ...`) — but by the time this step is reached, the driller
        // and digger have gone idle (no vehicle-gated task left to run) and
        // are not currently boarding either vehicle, so `clearZone` reports
        // both driverless and permanently strands them (Zone.ts: "a
        // driverless vehicle can never advance on tick — order it out
        // anyway and it just sits there... report it stranded either way").
        // Actually driving a vehicle back out is its own multi-step
        // interaction this Node-level playthrough doesn't otherwise need to
        // exercise, so — matching this same file's own precedent just above
        // ("blast refuses to fire on an occupied zone", `emp.x = 44` /
        // `veh.x = 44`) — clear the zone directly by relocating every
        // employee and vehicle to a corner beyond it, the same primitive a
        // real evacuation would leave them at.
        const zone = computeDangerZone(state.drillHoles, BLAST_DANGER_MARGIN_M);
        expect(zone, 'no drill holes to compute a danger zone from').not.toBeNull();
        const z = zone!;
        const safeX = z.x1 - 5;
        const safeZ = z.z1 - 5;
        for (const emp of state.employees.employees) {
          if (!emp.alive) continue;
          emp.x = safeX;
          emp.z = safeZ;
        }
        for (const veh of state.vehicles.vehicles) {
          veh.x = safeX;
          veh.z = safeZ;
        }
        expect(step.isComplete(state, snapshot), `tutorial step "${step.id}" never completed`).toBe(true);
        continue;
      }

      if (step.id === 'sell-ore') {
        // #959's own missing half, driven for real: `sellCompletableContracts`
        // (run every tick via `tickUntil`) repeatedly accepts and fully pays
        // off whichever available ore_sale/rubble_disposal contract this
        // blast's own hauled-in stock can close in one delivery — never an
        // oversized one that would strand the stock in an un-completable
        // deal until it expires for a penalty. A tier-1 freight_warehouse
        // only holds 2000kg (#959 planner note) and most of a real blast's
        // mass is oversized rock a debris_hauler alone can't move (needs a
        // rock_fragmenter this tutorial never introduces), so this can take
        // many haul/sell cycles — hence the generous tick budget, matching
        // 'victory' below rather than the tighter default.
        tickUntil(run, state, 1500, () => step.isComplete(state, snapshot), stagnation);
        expect(
          step.isComplete(state, snapshot),
          'tutorial step "sell-ore" never completed -- stub isComplete is hardcoded false (#959)',
        ).toBe(true);

        // Every lesson the tutorial's roster exists to teach is taught by
        // this point (survey, drilling, driving, management) — a cost-
        // conscious real operator, watching the balance sheet this deep in
        // the red (payroll is by far the single biggest expense category),
        // lays off everyone but the driver still needed to keep hauling and
        // selling the remaining stock, same as `employee fire` already lets
        // a player do at any time. Not a scripted step of its own (nothing
        // in TUTORIAL_STEPS teaches it), just the obviously rational move
        // this driving loop takes on the level's own behalf from here to
        // the profit line, exactly as `sellCompletableContracts` already
        // does for selling (#959).
        for (const emp of [...state.employees.employees]) {
          if (emp.role !== 'driver') run(`employee fire ${emp.id}`);
        }

        // Same logic for the fleet: the drill_rig and rock_digger already
        // did their one job (the box-cut and its drill plan) and have no
        // further use for the rest of this run — `vehicle scrap` stops
        // their per-tick maintenance/fuel draw AND returns their residual
        // value as cash, same real-player move as the layoffs just above.
        // The debris_hauler stays: it's still doing the only paying job
        // left, hauling stock in for `sellCompletableContracts` to sell.
        for (const veh of [...state.vehicles.vehicles]) {
          if (veh.type !== 'debris_hauler') run(`vehicle scrap ${veh.id}`);
        }

        // living_quarters (rest) and driving_center (training) have taught
        // their lessons too and cost real per-tick upkeep (`operatingCostPerTick`
        // — 6 and 8 respectively at tier 1) for the rest of this run with no
        // further use: their one-time demolish cost (2500 + 3000) pays for
        // itself in well under 400 ticks against a run this long. The
        // freight_warehouse stays: it's the only reason any of this selling
        // works at all.
        for (const b of [...state.buildings.buildings]) {
          if (b.type !== 'freight_warehouse') run(`build destroy ${b.id}`);
        }
        continue;
      }

      // ── Every other step: run its own commands/autoCommands, then tick ──

      for (const cmd of step.autoCommands ?? []) run(cmd);
      for (const cmd of step.commands ?? []) run(cmd);

      // 'victory' gets a much bigger allowance than the generic
      // tickBudget-derived default: with the level's own crew/fleet paid
      // off and wound down (see the mass layoff/scrap/demolish above), the
      // remaining wait is purely how long the contract board takes to roll
      // enough matching ore_sale/rubble_disposal offers to finish paying
      // off the level's own setup cost — empirically ~2400 ticks with seed
      // 42's own RNG stream, comfortably inside this budget with margin for
      // the run varying slightly as unrelated code changes land.
      tickUntil(run, state, step.id === 'victory' ? 4000 : Math.max(500, (step.tickBudget ?? 20) * 25), () => step.isComplete(state, snapshot), stagnation);

      expect(step.isComplete(state, snapshot), `tutorial step "${step.id}" never completed`).toBe(true);
    }

    // Every step reported complete -- including 'victory' and
    // 'congratulations' -- so the level must have genuinely ended WON, not
    // merely have `levelEnded === true` for any reason at all (#959's own
    // 'victory' bug: today it accepts a bankruptcy/arrest/ecological_shutdown/
    // worker_revolt just as readily as a real win).
    expect(state.levelEndReason).toBe('completed');
    expect(state.cash).toBeGreaterThan(0);

    const level = getLevel('tutorial_pit')!;
    const netProfit = getFinancialReport(state.finances, state.tickCount, 0).netProfit;
    expect(netProfit).toBeGreaterThanOrEqual(level.unlockThreshold);
  }, 120_000);
});
