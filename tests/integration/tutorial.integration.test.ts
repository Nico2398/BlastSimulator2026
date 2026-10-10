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

import { HIRING_ROLES } from '../../src/core/entities/HiringPool.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { campaignStartCommand } from '../../src/console/commands/campaign.js';
import { getLevel } from '../../src/core/campaign/Level.js';
import { createRunner } from '../../src/console/createRunner.js';
import type { MiningContext } from '../../src/console/commands/mining.js';
import { TUTORIAL_STEPS } from '../../src/ui/tutorialSteps.js';
import { TutorialRails } from '../../src/ui/tutorialRails.js';
import { formatDollars } from '../../src/core/economy/formatMoney.js';
import { goalChipParams } from '../../src/ui/tutorialStepsClosing.js';
import { countBuildingsOfType } from '../../src/ui/tutorialStepHelpers.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { makeEmptyGameContext, makeGameContext } from '../helpers/gameContext.js';
import { getOperatingProfit } from '../../src/core/economy/Finance.js';
import { isFillableSaleOffer, hasFillableOreSaleOffer } from '../../src/core/economy/Contract.js';
import {
  DRILL_GRID_DEFAULT_SPACING_M,
  DRILL_GRID_DEFAULT_DEPTH_M,
  CHARGE_DEFAULT_AMOUNT_KG,
  CHARGE_DEFAULT_STEMMING_M,
  ORE_PRICES,
  TUTORIAL_HIRING_SCRIPT,
  TUTORIAL_ORE_SALE_OFFER,
} from '../../src/core/config/balance.js';
import { REGION } from '../../src/ui/tutorialStages.js';
import { FORBIDDEN_COMMAND, playContracts, playTick, tickUntil, type Run } from '../helpers/playthrough.js';

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
    expect(result.output).toContain('32×32');
    expect(result.output).toContain(`$${TUTORIAL_START_CASH.toLocaleString('en-US')}`);

    // State should reflect the tutorial_pit level config
    expect(ctx.state).not.toBeNull();
    expect(ctx.state!.campaign.activeLevelId).toBe('tutorial_pit');
    expect(ctx.state!.cash).toBe(TUTORIAL_START_CASH);

    // World should be set up with tutorial_pit dimensions (32x32, datum 11, #458 T6.1/D13, #1191)
    expect(ctx.state!.world).not.toBeNull();
    expect(ctx.state!.world!.sizeX).toBe(32);
    expect(ctx.state!.world!.datum).toBe(11);
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
    expect(ctx.grid!.sizeZ).toBe(32);

    // World state matches
    expect(ctx.state!.world!.sizeX).toBe(32);
    expect(ctx.state!.world!.datum).toBe(11);
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
  it('sits directly after build-storage and before finances/needs/sell-ore', () => {
    // #1335 removes contract-accept: the player accepts the one fillable ore
    // offer inside sell-ore instead, so haul-debris follows build-storage
    // directly (24 -> 23). Earlier shifts (#553/#555/#557/#681/#905/#923/
    // #1015/#1328) are all upstream of this step and unchanged.
    const ids = TUTORIAL_STEPS.map(s => s.id);
    // #1339: the two workaround licence courses are gone and one fragmenter
    // course is added after the blast, so this step's absolute index is not
    // pinned here — only its neighbours.
    const idx = ids.indexOf('haul-debris');
    expect(idx).toBeGreaterThan(0);
    expect(ids[idx - 1]).toBe('build-storage');
    expect(ids).not.toContain('contract-accept');
    // #1328: finances and needs now sit between haul-debris and sell-ore, so
    // the first sale is the last guided step (it is followed by 'free-play').
    expect(ids[idx + 1]).toBe('finances');
    expect(ids[idx + 2]).toBe('needs');
    expect(ids[idx + 3]).toBe('sell-ore');
    expect(ids.slice(-2)).toEqual(['free-play', 'congratulations']);
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
    expect(run('new_game seed:42 size:32 staffed:true cash:500000').success).toBe(true);
    // #1264: this test's multiple staffed drivers self-organizing an
    // automatic haul is exactly the multi-agent shape agent occupancy
    // governs — unconditional since #1207.
    expect(run('build freight_warehouse at:6,9').success).toBe(true);
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

// ── evacuate before you fire (#557, reworked by #1362) ──────────────────────
//
// #1362 removed the tutorial-only refusal: `blast` (Fire anyway) fires even on
// an occupied zone and `blast detonate` is the
// evacuate-zone step's action — it arms the horn + auto-fire sequence.

describe('the tutorial no longer refuses to fire on an occupied zone (#1362)', () => {
  function setup(): { ctx: MiningContext; runCmd: (cmd: string) => ReturnType<ReturnType<typeof createRunner>['runner']['run']> } {
    const { runner, ctx } = createRunner();
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
    return { ctx, runCmd };
  }

  it('fires on an occupied zone (Fire anyway): no refusal', () => {
    const { ctx, runCmd } = setup();
    const state = ctx.state!;
    for (const emp of state.employees.employees) {
      emp.x = 16;
      emp.z = 16;
    }

    const result = runCmd('blast');

    expect(result.success, result.output).toBe(true);
    expect(state.damage.blastCount).toBe(1);
  });

  it('blast detonate during the tutorial arms the sequence instead of refusing or firing at once', () => {
    const { ctx, runCmd } = setup();
    const state = ctx.state!;
    for (const emp of state.employees.employees) {
      emp.x = 16;
      emp.z = 16;
    }

    const result = runCmd('blast detonate');

    expect(result.success, result.output).toBe(true);
    expect(state.pendingDetonation).not.toBeNull();
    expect(state.damage.blastCount).toBe(0);
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
});

// ── Tutorial training (#1339): one real need, the rock fragmenter ──
//
// Every role now arrives able to do its own job (a driller drills, a driver
// hauls and digs), so the two per-employee licence courses the tutorial used to
// spend ~$250k on (train-driller / train-digger, hard-coded employees 1 and 2)
// are gone. ONE Driving Center course remains, with a real need: after the
// first blast leaves oversized boulders, somebody must learn the rock
// fragmenter. #903's deadlock guard (a booked course must not freeze the clock)
// carries over to that step.

describe('tutorial training steps (#1339)', () => {
  const ids = TUTORIAL_STEPS.map(s => s.id);

  it('has no train-driller or train-digger step', () => {
    expect(ids).not.toContain('train-driller');
    expect(ids).not.toContain('train-digger');
  });

  it('has exactly one training step, train-fragmenter', () => {
    const trainingIds = ids.filter(id => id.startsWith('train-'));
    expect(trainingIds).toEqual(['train-fragmenter']);
  });

  it('orders train-fragmenter after blast', () => {
    expect(ids.indexOf('train-fragmenter')).toBeGreaterThan(ids.indexOf('blast'));
  });

  it('builds the driving center after the first blast (it is no longer a pre-blast detour)', () => {
    expect(ids.indexOf('build-driving-center')).toBeGreaterThan(ids.indexOf('blast'));
  });

  it('builds the driving center before the fragmenter course that needs it', () => {
    expect(ids.indexOf('build-driving-center')).toBeLessThan(ids.indexOf('train-fragmenter'));
  });

  it('hires the driver before the box-cut (a driver arrives able to dig the ramp)', () => {
    expect(ids.indexOf('hire-driver')).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf('hire-driver')).toBeLessThan(ids.indexOf('box-cut'));
  });

  it('keeps the vehicle-purchase steps that crew the rig and digger', () => {
    expect(ids).toContain('buy-drill-rig-assign');
    expect(ids).toContain('buy-rock-digger-assign');
    expect(ids.indexOf('buy-rock-digger-assign')).toBeLessThan(ids.indexOf('box-cut'));
    expect(ids.indexOf('buy-drill-rig-assign')).toBeLessThan(ids.indexOf('drill-plan'));
  });

  it('no step command hard-codes an employee id for training', () => {
    for (const step of TUTORIAL_STEPS) {
      for (const cmd of step.commands ?? []) {
        expect(cmd, step.id).not.toMatch(/^employee train \d+/);
      }
    }
  });

  describe('train-fragmenter completion', () => {
    it('is incomplete on a fresh game and complete once ANY employee holds driving.rock_fragmenter', () => {
      const { runner, ctx } = createRunner();
      const run = (cmd: string) => runner.run(cmd);
      expect(run('new_game seed:42 size:32').success).toBe(true);
      const step = TUTORIAL_STEPS.find(s => s.id === 'train-fragmenter')!;
      expect(step).toBeDefined();
      const snapshot = step.captureSnapshot ? step.captureSnapshot(ctx.state!) : {};
      expect(step.isComplete(ctx.state!, snapshot)).toBe(false);

      // A driver holds truck + excavator on hire — neither is the fragmenter.
      expect(run('employee hire role:driver').success).toBe(true);
      expect(step.isComplete(ctx.state!, snapshot)).toBe(false);

      // Not the first employee, not any fixed id: whoever holds the licence.
      expect(run('employee hire role:surveyor').success).toBe(true);
      const last = ctx.state!.employees.employees[ctx.state!.employees.employees.length - 1]!;
      expect(run(`employee assign_skill ${last.id} skill:driving.rock_fragmenter level:1`).success).toBe(true);
      expect(step.isComplete(ctx.state!, snapshot)).toBe(true);
    });

    it('does not complete on the excavator licence alone', () => {
      const { runner, ctx } = createRunner();
      const run = (cmd: string) => runner.run(cmd);
      expect(run('new_game seed:42 size:32').success).toBe(true);
      expect(run('employee hire role:surveyor').success).toBe(true);
      const emp = ctx.state!.employees.employees[0]!;
      expect(run(`employee assign_skill ${emp.id} skill:driving.excavator level:1`).success).toBe(true);
      const step = TUTORIAL_STEPS.find(s => s.id === 'train-fragmenter')!;
      expect(step.isComplete(ctx.state!, step.captureSnapshot ? step.captureSnapshot(ctx.state!) : {})).toBe(false);
    });
  });

  describe('train-fragmenter (#903 carried over): a booked course must not deadlock the tutorial clock', () => {
    it('the fragmenter course finishes with no further player input once booked', () => {
      const { runner, ctx } = createRunner();
      const run = (cmd: string) => runner.run(cmd);
      expect(run('new_game seed:42 size:32').success).toBe(true);
      expect(run('employee hire role:driver').success).toBe(true);
      expect(run('build driving_center at:6,7').success).toBe(true);
      for (let i = 0; i < 400 && countBuildingsOfType(ctx.state!, 'driving_center') === 0; i++) {
        for (const emp of ctx.state!.employees.employees) emp.fatigue = 100;
        run('tick 1');
      }
      expect(countBuildingsOfType(ctx.state!, 'driving_center')).toBeGreaterThan(0);

      const step = TUTORIAL_STEPS.find(s => s.id === 'train-fragmenter')!;
      expect(step.waitsOnWork).toBe(true);
      const budget = step.tickBudget ?? 25;

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

      // Click time before the course is booked: the clock legitimately holds.
      for (let i = 0; i < budget + 5; i++) {
        tickIfUnpaused(run, ctx.state!);
        rails.updateClock(ctx.state);
      }
      expect(ctx.state!.isPaused, 'the clock should hold while waiting on the player to click Train').toBe(true);

      // Whoever the player picks: look the driver up by role, never by id.
      const trainee = ctx.state!.employees.employees.find(e => e.role === 'driver')!;
      const trainResult = run(`employee train ${trainee.id} skill:driving.rock_fragmenter`);
      expect(trainResult.success, trainResult.output).toBe(true);

      const snapshot = step.captureSnapshot ? step.captureSnapshot(ctx.state!) : {};
      let everTicked = false;
      for (let i = 0; i < 400 && !step.isComplete(ctx.state!, snapshot); i++) {
        if (tickIfUnpaused(run, ctx.state!)) everTicked = true;
        rails.updateClock(ctx.state);
      }

      expect(everTicked, 'the clock never lifted once the course was booked').toBe(true);
      expect(step.isComplete(ctx.state!, snapshot)).toBe(true);
      expect(ctx.state!.isPaused).toBe(false);
      expect(trainee.qualifications.some(q => q.category === 'driving.rock_fragmenter')).toBe(true);
    });
  });
});

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

// ── charge → evacuate-zone (#926): the step and the panel must never disagree ──
//
// BlastWorkshop.ts's suggestStep (not exported — its Charge-tab condition is
// mirrored below as `stillOnChargeTab`) keeps the Blast Workshop on its
// Charge tab for as long as any hole is still unlit. The 'charge' tutorial
// step used to complete the instant the FIRST of several holes charged
// (createComparisonStep's generic "value increased"), moving the tutorial on
// to the next step while the panel — correctly reading the plan as still
// mid-charge — stayed on Charge. The next tab's own controls live in a
// hidden tab body at that point, so the rail had nothing reachable to point
// at: a real dead end (issue #926). This test drains a real multi-hole
// charge order through the real engine and pins the step's completion
// against the panel's own criterion at every tick in between.
function stillOnChargeTab(state: GameState): boolean {
  const holes = state.drillHoles;
  return !holes.every(h => state.chargesByHole[h.id]);
}

describe('charge (#926): completion never runs ahead of the panel\'s own Charge tab', () => {
  it('stays incomplete on every partially-charged tick, and completes exactly when the panel would also move on', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('new_game seed:42 size:32 staffed:true cash:500000').success).toBe(true);
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

    // The run continues straight to evacuate-zone and blast (no sequence step).
    expect(TUTORIAL_STEPS.some(s => s.id === 'sequence')).toBe(false);

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
  it('runs drill-plan/charge exactly as scripted and blasts cleanly', () => {
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

    // 5. Evacuate crew and vehicles beyond the danger zone — mirrors the
    // 'blast refuses to fire on an occupied zone' tests above, which move
    // everyone to a corner clear of computeDangerZone(state.drillHoles,
    // BLAST_DANGER_MARGIN_M). tutorial_pit is a 32x32 grid and the drill
    // plan's own danger zone (15m margin around the REGION.drill 3x3/4m grid)
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

    // 6. blast
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

// ── #1330: the blast panel's own defaults must rate good or better ─────────
//
// A player who opens the panels and accepts every default on the tutorial
// square should get a clean shot. The commands are built from the balance
// constants (not read from TUTORIAL_STEPS) so this proves the defaults
// themselves, whatever the tutorial cards say.
describe('panel default parameters on the tutorial square rate good or better (#1330)', () => {
  it('drills a 3x3 grid and charges with the defaults, then blasts cleanly', () => {
    const { runner, ctx } = createRunner();
    const run = (cmd: string) => runner.run(cmd);

    expect(run('campaign start level:tutorial_pit staffed:true').success).toBe(true);
    const state = ctx.state!;

    const boxCutStep = TUTORIAL_STEPS.find((s) => s.id === 'box-cut')!;
    expect(run(boxCutStep.commands![0]!).success).toBe(true);
    for (let i = 0; i < 400 && state.plannedRamps.length > 0; i++) {
      for (const emp of state.employees.employees) emp.fatigue = 100;
      run('tick 1');
    }
    expect(state.plannedRamps.length).toBe(0);

    const spacing = DRILL_GRID_DEFAULT_SPACING_M;
    const cols = Math.round((REGION.drill.x2 - REGION.drill.x1) / spacing) + 1;
    const rows = Math.round((REGION.drill.z2 - REGION.drill.z1) / spacing) + 1;
    expect(cols).toBe(3);
    expect(rows).toBe(3);
    const drill = run(
      `drill_plan grid rows:${rows} cols:${cols} spacing:${spacing} depth:${DRILL_GRID_DEFAULT_DEPTH_M} start:${REGION.drill.x1},${REGION.drill.z1}`,
    );
    expect(drill.success, drill.output).toBe(true);
    for (let i = 0; i < 400 && state.plannedDrillHoles.length > 0; i++) {
      for (const emp of state.employees.employees) emp.fatigue = 100;
      run('tick 1');
    }
    expect(state.plannedDrillHoles.length).toBe(0);
    expect(state.drillHoles.length).toBe(9);

    const charge = run(
      `charge hole:* explosive:boomite amount:${CHARGE_DEFAULT_AMOUNT_KG} stemming:${CHARGE_DEFAULT_STEMMING_M}`,
    );
    expect(charge.success, charge.output).toBe(true);
    for (let i = 0; i < 400 && Object.keys(state.plannedChargesByHole).length > 0; i++) {
      for (const emp of state.employees.employees) emp.fatigue = 100;
      run('tick 1');
    }
    expect(Object.keys(state.plannedChargesByHole).length).toBe(0);


    const preAlive = state.employees.employees.filter(e => e.alive).length;
    const preVehicles = state.vehicles.vehicles.length;
    const preDeaths = state.damage.deathCount;
    for (const emp of state.employees.employees) { emp.x = 2; emp.z = 2; }
    for (const veh of state.vehicles.vehicles) { veh.x = 2; veh.z = 2; }

    const blast = run('blast');
    expect(blast.success, blast.output).toBe(true);

    const report = state.lastBlastReport;
    expect(report).not.toBeNull();
    expect(['good', 'perfect']).toContain(report!.rating);
    expect(report!.destroyedBuildings.length).toBe(0);
    expect(state.employees.employees.filter(e => e.alive).length).toBe(preAlive);
    expect(state.damage.deathCount).toBe(preDeaths);
    expect(state.vehicles.vehicles.length).toBe(preVehicles);
    expect(state.vehicles.vehicles.every(v => v.hp > 0)).toBe(true);
    expect((report!.accidents ?? []).some(a => a.type === 'death' || a.type === 'vehicle_destroyed')).toBe(false);
    expect(report!.clearedVoxels).toBeGreaterThan(0);
  });
});

// ── #1328: the tutorial can be WON by following the cards ──
//
// The guided part ends after the first ore sale ('sell-ore'). From the
// 'free-play' step on the rails are lifted and the clock is never held: the
// player plays on with ordinary actions toward the profit threshold, and the
// tutorial victory still fires on levelEndReason === 'completed'.
//
// This playthrough is deliberately honest: the guided phase runs only each
// step's own commands (plus the two documented carve-outs, evacuate-zone and
// toggle-survey-overlay, which have no console equivalent a player would
// use), and free play uses only what a player can do with every control
// enabled: tick, contract accept/deliver, event choose. No layoffs, no
// vehicle scrapping, no demolition, no fatigue writes, no auto-sell hacks
// beyond accepting/delivering contracts.
describe('full tutorial playthrough ends WON by following the cards then playing on (#1328)', () => {
  /** Free-play tick ceiling, a constant so a slow win cannot hide behind a raised cap. */
  const FREE_PLAY_TICK_CAP = 6000;

  /** Play the guided steps (everything before 'free-play') via each step's own commands. */
  function playGuidedPhase(run: Run, state: GameState): void {
    const acceptedInSellOre: string[] = [];
    for (const step of TUTORIAL_STEPS) {
      if (step.id === 'free-play') return;
      const snapshot = step.captureSnapshot ? step.captureSnapshot(state) : {};
      const maxTicks = Math.max(500, (step.tickBudget ?? 20) * 25);
      const complete = () => step.isComplete(state, snapshot);

      // Charge only once the drill queue has drained, as a patient player
      // clicking Charge All after the plan stops changing would.
      if (step.id === 'charge') tickUntil(run, state, 500, () => state.plannedDrillHoles.length === 0);

      if (step.id === 'toggle-survey-overlay') {
        // Carve-out: a DOM-only click (aria-pressed), no console equivalent;
        // the interaction-mode scenarios drive the real click.
        continue;
      }

      if (step.id === 'scores' || step.id === 'finances' || step.id === 'needs') {
        // Carve-out (#1334): these cards complete only on a DOM action (hover/click
        // the scores HUD, open the Finances/Crew panel) with no console equivalent;
        // this headless run has no DOM, so the interaction-mode scenarios drive them.
        continue;
      }

      if (step.id === 'evacuate-zone') {
        // #1362: the player presses Fire -> Detonate. That arms the sequence
        // (horn + auto-fire); the step is done only once the blast really fires
        // (#1591), so keep ticking while the zone clears.
        const armed = run('blast detonate');
        expect(armed.success, armed.output).toBe(true);
        tickUntil(run, state, maxTicks, complete);
        expect(complete(), `tutorial step "${step.id}" never completed`).toBe(true);
        continue;
      }

      for (const cmd of step.autoCommands ?? []) run(cmd);
      // The card's hint names a placeholder, never an id (#1339): resolve it
      // the way a player would, by picking the hired driver.
      const driver = state.employees.employees.find((e) => e.role === 'driver');
      for (const cmd of step.commands ?? []) run(cmd.replace('<driverId>', String(driver?.id ?? '')));

      if (step.id === 'sell-ore') {
        // #1335: the step is "accept the one fillable ore offer, deliver it".
        // Accept is only legal on a fillable ore_sale offer (what the rails
        // let a player click); rubble/supply/unfillable offers stay untouched.
        // With barren rock on a spoil heap the warehouse holds only ore (#1530), so the card's own
        // accept + deliver commands can already close a sale before the loop starts.
        const soldByCommands = complete();
        for (let i = 0; i < maxTicks && !complete(); i++) {
          for (const active of [...state.contracts.active]) {
            if (active.type !== 'ore_sale') continue;
            const amount = Math.min(active.quantityKg - active.deliveredKg, state.collectedOre[active.materialId] ?? 0);
            if (amount > 0) run(`contract deliver ${active.id} amount:${amount}`);
          }
          // The smallest-paying fillable offer: a player reaching the first sale sooner (#1586)
          // carries less accrued payroll, so the biggest offer alone can already cross the
          // tutorial's profit threshold and end the level inside the guided phase. Taking the
          // smaller one keeps the guided/free-play boundary this test exists to cross.
          const offer = state.contracts.available
            .filter((c) => isFillableSaleOffer(c, state.collectedOre, 0) && c.type === 'ore_sale')
            .sort((a, b) => a.quantityKg * a.pricePerKg - b.quantityKg * b.pricePerKg)[0];
          if (offer) {
            expect(run(`contract accept ${offer.id}`).success).toBe(true);
            acceptedInSellOre.push(offer.type);
          }
          playTick(run, state);
        }
        expect(soldByCommands || acceptedInSellOre.length > 0, 'sell-ore never accepted a fillable ore offer').toBe(true);
      } else {
        tickUntil(run, state, maxTicks, complete);
      }
      expect(complete(), `tutorial step "${step.id}" never completed`).toBe(true);
    }
  }

  function newTutorial() {
    const { runner, ctx } = createRunner();
    const commandsRun: string[] = [];
    const run: Run = (cmd) => {
      commandsRun.push(cmd);
      return runner.run(cmd);
    };
    expect(run('campaign start level:tutorial_pit').success).toBe(true);
    return { run, state: ctx.state!, commandsRun };
  }

  it('follows the cards to the first sale, then plays on freely to a genuine, solvent win', () => {
    const { run, state, commandsRun } = newTutorial();
    const freePlay = TUTORIAL_STEPS.find((s) => s.id === 'free-play')!;
    const target = getLevel('tutorial_pit')!.unlockThreshold;

    playGuidedPhase(run, state);

    // The guided part is over: the level is still running and not yet won.
    expect(state.levelEnded).toBe(false);
    expect(freePlay.isComplete(state, {})).toBe(false);

    // Free play: rails lifted, the clock is the player's. Drive the real
    // rails object over the real step so a clock hold is caught.
    const rails = new TutorialRails();
    rails.beginStep(freePlay, state);
    expect(state.isPaused).toBe(false);

    let ticks = 0;
    while (!state.levelEnded && ticks < FREE_PLAY_TICK_CAP) {
      playContracts(run, state);
      playTick(run, state);
      rails.updateClock(state);
      expect(state.isPaused, `clock held in free play at tick ${state.tickCount}`).toBe(false);
      ticks++;
    }

    expect(state.levelEndReason, `not won within ${FREE_PLAY_TICK_CAP} free-play ticks`).toBe('completed');
    expect(state.levelEndReason).not.toBe('bankruptcy');
    expect(state.cash).toBeGreaterThan(0);
    expect(freePlay.isComplete(state, {})).toBe(true);

    const operatingProfit = getOperatingProfit(state.finances);
    expect(operatingProfit).toBeGreaterThanOrEqual(target);

    // Honesty guard: no layoff / scrap / demolish hack anywhere in the run.
    expect(commandsRun.filter((c) => FORBIDDEN_COMMAND.test(c))).toEqual([]);
  }, 300_000);

  it('the goal chip params match net profit and the win target right after the guided phase', () => {
    const { run, state } = newTutorial();
    playGuidedPhase(run, state);

    const target = getLevel('tutorial_pit')!.unlockThreshold;
    const chip = goalChipParams(state);
    const operatingProfit = getOperatingProfit(state.finances);
    expect(chip.target).toBe(formatDollars(target));
    expect(chip.profit).toBe(formatDollars(operatingProfit));
  }, 120_000);

  it('after the first sale no rail disables a control and the clock is not held, however long the player idles', () => {
    const { run, state } = newTutorial();
    playGuidedPhase(run, state);

    const freePlay = TUTORIAL_STEPS.find((s) => s.id === 'free-play')!;
    const rails = new TutorialRails();
    rails.beginStep(freePlay, state);
    expect(rails.refresh(state).stageTotal).toBe(0);

    for (let i = 0; i < 400 && !state.levelEnded; i++) {
      playTick(run, state);
      expect(rails.updateClock(state)).toBe(false);
      expect(state.isPaused).toBe(false);
    }
  }, 120_000);
});


// ── Determinism: nothing the tutorial offers depends on click timing (#1600) ──

describe('Tutorial determinism (#1600)', () => {
  const HIRE_ROLES = ['surveyor', 'driller', 'manager', 'driver', 'blaster'] as const;

  /** Fresh tutorial with ample cash; idles `idleTicks` ticks, then hires one of every role. */
  function hireAfterIdling(idleTicks: number) {
    const { runner, ctx } = createRunner();
    const run: Run = (cmd) => runner.run(cmd);
    expect(run('campaign start level:tutorial_pit cash:5000000').success).toBe(true);
    const state = ctx.state!;
    for (let i = 0; i < idleTicks; i++) playTick(run, state);
    for (const role of HIRE_ROLES) expect(run(`employee hire role:${role}`).success).toBe(true);
    return state.employees.employees
      .filter((e) => e.hiredAtTick === state.tickCount)
      .map((e) => ({ role: e.role, name: e.name, unionized: e.unionized, salary: e.salary, qualifications: e.qualifications }));
  }

  it('two runs with different click timing hire identical employees', () => {
    const early = hireAfterIdling(0);
    const late = hireAfterIdling(137);
    expect(early).toHaveLength(HIRE_ROLES.length);
    expect(late).toEqual(early);
  });

  it('hires are independent of the refresh phase (24-tick boundary and beyond)', () => {
    const base = hireAfterIdling(0);
    for (const idle of [23, 24, 25, 100]) expect(hireAfterIdling(idle)).toEqual(base);
  });

  it('the hired employees are the scripted candidates', () => {
    const hired = hireAfterIdling(60);
    for (const h of hired) {
      const scripted = TUTORIAL_HIRING_SCRIPT.find((c) => c.role === h.role)!;
      expect(h.name).toBe(scripted.name);
      expect(h.unionized).toBe(scripted.unionized);
    }
  });

  it('the tutorial hiring pool offers one scripted candidate per role right after campaign start', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('campaign start level:tutorial_pit').success).toBe(true);
    const pool = ctx.state!.hiringPool;
    expect(pool.candidates.map((c) => c.id).sort((a, b) => a - b)).toEqual(TUTORIAL_HIRING_SCRIPT.map((c) => c.id));
  });

  it('non-tutorial levels keep seeded 3-per-role pools', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42 size:24').success).toBe(true);
    const candidates = ctx.state!.hiringPool.candidates;
    for (const role of HIRING_ROLES) expect(candidates.filter((c) => c.role === role)).toHaveLength(3);
    expect(ctx.state!.contracts.available.every((c) => c.quantityKg !== TUTORIAL_ORE_SALE_OFFER.quantityKg
      || c.deadlineTicks !== TUTORIAL_ORE_SALE_OFFER.deadlineTicks)).toBe(true);
  });

  function scriptedOffers(state: GameState) {
    const o = TUTORIAL_ORE_SALE_OFFER;
    return state.contracts.available.filter((c) => c.type === 'ore_sale' && c.materialId === o.materialId
      && c.quantityKg === o.quantityKg && c.deadlineTicks === o.deadlineTicks);
  }

  it('a fillable scripted ore-sale offer exists right after campaign start, with fixed terms', () => {
    const { runner, ctx } = createRunner();
    expect(runner.run('campaign start level:tutorial_pit').success).toBe(true);
    const state = ctx.state!;
    const o = TUTORIAL_ORE_SALE_OFFER;
    expect(scriptedOffers(state)).toHaveLength(1);
    expect(hasFillableOreSaleOffer(state.contracts.available, { [o.materialId]: o.quantityKg })).toBe(true);
    const multiplier = getLevel('tutorial_pit')!.contractPriceMultiplier;
    expect(scriptedOffers(state)[0]!.pricePerKg)
      .toBeCloseTo((ORE_PRICES as Record<string, number>)[o.materialId]! * o.priceFactor * multiplier, 6);
  });

  it('the scripted offer is still on the board after 0, 50, 500 and 2000 ticks, identical each time', () => {
    const { runner, ctx } = createRunner();
    const run: Run = (cmd) => runner.run(cmd);
    expect(run('campaign start level:tutorial_pit cash:50000000').success).toBe(true);
    const state = ctx.state!;
    const first = scriptedOffers(state)[0];
    expect(first).toBeDefined();
    const o = TUTORIAL_ORE_SALE_OFFER;
    for (const checkpoint of [0, 50, 500, 2000]) {
      while (state.tickCount < checkpoint && !state.levelEnded) playTick(run, state);
      const offers = scriptedOffers(state);
      expect(offers, `tick ${checkpoint}`).toHaveLength(1);
      expect(offers[0]!.pricePerKg, `tick ${checkpoint}`).toBe(first!.pricePerKg);
      expect(hasFillableOreSaleOffer(state.contracts.available, { [o.materialId]: o.quantityKg }), `tick ${checkpoint}`).toBe(true);
    }
  }, 120_000);

  it('the offer terms are identical across two runs idling different lengths', () => {
    const terms = (idle: number) => {
      const { runner, ctx } = createRunner();
      const run: Run = (cmd) => runner.run(cmd);
      run('campaign start level:tutorial_pit cash:50000000');
      for (let i = 0; i < idle; i++) playTick(run, ctx.state!);
      const c = scriptedOffers(ctx.state!)[0]!;
      return { materialId: c.materialId, quantityKg: c.quantityKg, pricePerKg: c.pricePerKg, deadlineTicks: c.deadlineTicks };
    };
    expect(terms(137)).toEqual(terms(0));
  });

  it('sell-ore starts without clockMustRun', () => {
    expect(TUTORIAL_STEPS.find((s) => s.id === 'sell-ore')!.clockMustRun).toBeUndefined();
  });
});
