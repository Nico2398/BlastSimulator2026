// @vitest-environment jsdom
// BlastSimulator2026 — Integration tests: Tutorial pause behaviour (#371)
// Verifies that tutorial.start(ctx.state) pauses the game (isPaused = true).
// The bug: main.ts calls tutorial.start() without args so isPaused is never set.
// The fix: main.ts passes ctx.state to tutorial.start().
//
// These tests simulate the EXACT flow from main.ts:
//   - new_game seed:42 size:24
//   - campaign start level:tutorial_pit
//   - tutorial.start(ctx.state ?? undefined)     ← the FIX

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { GameContext } from '../../src/console/commands/world.js';
import { campaignStartCommand } from '../../src/console/commands/campaign.js';
import { TutorialOverlay } from '../../src/ui/TutorialOverlay.js';
import type { GameState } from '../../src/core/state/GameState.js';
import { createRunner } from '../../src/console/createRunner.js';
import { TUTORIAL_STEPS } from '../../src/ui/tutorialSteps.js';
import { TutorialRails } from '../../src/ui/tutorialRails.js';
import { makeGameContext } from '../helpers/gameContext.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCtx(): GameContext {
  return makeGameContext({ seed: '42', size: '24' });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Tutorial pause behaviour (#371)', () => {
  let ctx: GameContext;
  let container: HTMLDivElement;
  /** Track the overlay so we can dispose it in afterEach. */
  let overlay: TutorialOverlay | null;

  beforeEach(() => {
    ctx = makeCtx();
    container = document.createElement('div');
    document.body.appendChild(container);
    overlay = null;
    try { localStorage.removeItem('bs_tutorial_done'); } catch { /* ignore */ }
  });

  afterEach(() => {
    overlay?.dispose();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  // ── 1. start with state pauses ───────────────────────────────────────────

  it('start(ctx.state) sets isPaused = true', () => {
    // Simulate the Tutorial button flow from main.ts:
    //   window.__gameConsole('new_game seed:42 size:24')
    //   window.__gameConsole('campaign start level:tutorial_pit')
    //   tutorial.start(ctx.state ?? undefined)     ← the FIX
    campaignStartCommand(ctx, [], { level: 'tutorial_pit' });

    const tutorial = new TutorialOverlay(container);
    overlay = tutorial;

    // This call simulates the FIXED code behaviour
    tutorial.start(ctx.state!);

    // After the fix, the overlay receives the state and pauses the game
    expect(ctx.state!.isPaused).toBe(true);
  });

  // ── 2. start() without state does not crash ──────────────────────────────

  it('start(undefined) does not crash (null-case path)', () => {
    const tutorial = new TutorialOverlay(container);
    overlay = tutorial;

    // Calling start(undefined) must not throw
    expect(() => tutorial.start(undefined)).not.toThrow();

    // The overlay should be visible even without a state
    const oe = container.querySelector('.bs-tutorial-overlay') as HTMLElement;
    expect(oe.style.display).not.toBe('none');
  });

  // ── 3. skip unpauses ─────────────────────────────────────────────────────

  it('finishing resets isPaused to false', () => {
    campaignStartCommand(ctx, [], { level: 'tutorial_pit' });

    // There is no skip(): the tutorial cannot be abandoned, so the only route
    // out is finishing it. The game must not be left paused either way.
    const tutorial: TutorialOverlay = new TutorialOverlay(container);
    overlay = tutorial;
    const tutorialPrivate = tutorial as unknown as {
      start: (state: GameState) => void;
      finish: () => void;
    };

    // Start with state → game pauses
    tutorialPrivate.start(ctx.state!);
    expect(ctx.state!.isPaused).toBe(true);

    tutorialPrivate.finish();
    expect(ctx.state!.isPaused).toBe(false);
  });

  // ── 4. start(undefined) with existing state does not pause ───────────────

  it('start(undefined) does not modify isPaused when state exists', () => {
    campaignStartCommand(ctx, [], { level: 'tutorial_pit' });

    const tutorial = new TutorialOverlay(container);
    overlay = tutorial;

    // Pass undefined explicitly — should not affect the state
    tutorial.start(undefined);

    // The game should NOT be paused because undefined was passed
    expect(ctx.state!.isPaused).toBe(false);
  });

  // ── 5. haul-debris step (#552): clock never gets stuck held ─────────────
  //
  // The real "stuck on 17/24" playthrough bug: before #552,
  // hasOutstandingWork/isWorkInProgress/workSignature (tutorialGuide.ts) only
  // ever looked at employees and PendingActions, never at a vehicle's own
  // haulingPhase/breakPhase. A driver who had already boarded a hauler and
  // was mid-drive read as "fully idle" (no activeActionId, no destination),
  // so TutorialRails.updateClock held the clock — permanently, since a held
  // clock stops the very ticks the drive needed to finish. This test drives
  // the real engine (createRunner, real ticks) through an automatic haul and
  // asserts the clock is never held while the haul is genuinely progressing.
  it('haul-debris (#552): TutorialRails never holds the clock while automatic hauling is genuinely in progress', () => {
    const { runner, ctx } = createRunner();

    expect(runner.run('new_game seed:42 size:32 staffed:true').success).toBe(true);
    expect(runner.run('build freight_warehouse at:6,6').success).toBe(true);
    expect(runner.run('drill_plan grid rows:3 cols:3 spacing:5 depth:8 start:14,14').success).toBe(true);
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
      runner.run('tick 1');
    }
    expect(runner.run('charge hole:* explosive:boomite amount:5 stemming:2').success).toBe(true);
    // #554: charging is real work too — drain the ordered charges the same
    // way the drill plan above was drained before blasting.
    for (let i = 0; i < 400 && Object.keys(ctx.state!.plannedChargesByHole).length > 0; i++) {
      for (const emp of ctx.state!.employees.employees) {
        emp.hunger = 100;
        emp.fatigue = 100;
        emp.breakNeed = 100;
      }
      runner.run('tick 1');
    }
    expect(runner.run('sequence auto delay_step:25').success).toBe(true);
    expect(runner.run('blast').success).toBe(true);

    const state = ctx.state!;
    expect(state.logistics.fragments.some(f => f.state === 'on_ground')).toBe(true);

    const step = TUTORIAL_STEPS.find(s => s.id === 'haul-debris')!;
    expect(step.waitsOnWork).toBe(true);

    const rails = new TutorialRails();
    rails.beginStep(
      {
        id: step.id,
        ...(step.highlightTarget !== undefined ? { highlightTarget: step.highlightTarget } : {}),
        ...(step.tickBudget !== undefined ? { tickBudget: step.tickBudget } : {}),
        ...(step.waitsOnWork !== undefined ? { waitsOnWork: step.waitsOnWork } : {}),
      },
      state,
    );

    const snapshot = step.captureSnapshot!(state);
    let everHeld = false;

    for (let i = 0; i < 400 && !step.isComplete(state, snapshot); i++) {
      runner.run('tick 1');
      const held = rails.updateClock(state);
      if (held) everHeld = true;
    }

    expect(step.isComplete(state, snapshot)).toBe(true);
    expect(everHeld).toBe(false);
    expect(state.isPaused).toBe(false);
  });

  // ── 6. step 0 pause/resume behaviour (#904) ─────────────────────────────
  //
  // The tutorial's opening step moves from 'time-speed' to 'hire-surveyor':
  // suggesting a faster clock made no sense as the very first card, with an
  // empty site and nothing queued that a faster clock would deliver sooner.
  // The first place the player genuinely waits is 'survey' (waitsOnWork:true).
  // #923: the speed-control lesson no longer sits anywhere near the opening
  // any more — it moved off this stretch entirely into the box-cut ramp-dig
  // wait, much further down the tutorial (the genuinely longest wait, not
  // the very first one), so 'hire-surveyor' now advances straight to
  // 'survey' with nothing standalone in between.
  //
  // Two hard constraints from #904 apply to whichever step ends up first:
  //   1. tutorial_start leaves the game paused (#585) — the opening step must
  //      still be completable while state.isPaused is true, and completing it
  //      must be what resumes the clock (no new resume mechanism needed).
  //   2. Step ids are referenced by name elsewhere (scenario JSON, other
  //      tests) — this suite pins the id, not just an index.
  describe('tutorial step 0 completes while paused and resumes the clock (#904)', () => {
    it('opens on hire-surveyor, not time-speed', () => {
      // TUTORIAL_STEPS[0] is hire-surveyor — the tutorial's opening step must
      // be completable immediately, with no wait, per #904.
      expect(TUTORIAL_STEPS[0]!.id).toBe('hire-surveyor');
    });

    it('step 0 is completable while state.isPaused is still true, right after tutorial_start (#585)', () => {
      const { runner, ctx } = createRunner();
      expect(runner.run('new_game seed:42 size:24').success).toBe(true);
      expect(campaignStartCommand(ctx, [], { level: 'tutorial_pit' }).success).toBe(true);

      const tutorial = new TutorialOverlay(container);
      overlay = tutorial;
      tutorial.start(ctx.state!);
      expect(ctx.state!.isPaused).toBe(true);

      // hire-surveyor's completion checks only state.employees — a genuinely
      // new hire of the target role — never the clock, so it completes
      // without a single tick having run.
      expect(TUTORIAL_STEPS[0]!.id).toBe('hire-surveyor');
      expect(runner.run('employee hire role:surveyor').success).toBe(true);
      tutorial.onCommandExecuted(ctx.state!);
      expect(ctx.state!.isPaused).toBe(false);
    });

    it('completing tutorial step 0 resumes the clock, whichever step is first (regression guard)', () => {
      // Step-identity-agnostic: exercises the existing
      // advanceToNextStep() -> releaseClock() path, unconditional on which
      // step is actually first. Passes both before and after the #904 reorder.
      const { runner, ctx } = createRunner();
      expect(runner.run('new_game seed:42 size:24').success).toBe(true);
      expect(campaignStartCommand(ctx, [], { level: 'tutorial_pit' }).success).toBe(true);

      const tutorial = new TutorialOverlay(container);
      overlay = tutorial;
      tutorial.start(ctx.state!);
      expect(ctx.state!.isPaused).toBe(true);

      const step0 = TUTORIAL_STEPS[0]!;
      if (step0.commands && step0.commands.length > 0) {
        // A step whose own hint is a runnable command (e.g. any hire step) —
        // run it for real, the same way a player's click would.
        expect(runner.run(step0.commands[0]!).success).toBe(true);
      } else {
        // Fallback kept for a future opening step with no command hint of
        // its own (#923: the old 'time-speed' step this branch used to
        // cover no longer exists anywhere near the opening — the current
        // opening step, hire-surveyor, always takes the branch above).
        ctx.state!.timeScale = (ctx.state!.timeScale ?? 1) + 1;
      }

      tutorial.onCommandExecuted(ctx.state!);
      expect(ctx.state!.isPaused).toBe(false);
    });
  });
});
