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
import { type GameContext, newGameCommand } from '../../src/console/commands/world.js';
import { campaignStartCommand } from '../../src/console/commands/campaign.js';
import { TutorialOverlay } from '../../src/ui/TutorialOverlay.js';
import { EventEmitter } from '../../src/core/state/EventEmitter.js';
import { createRunner } from '../../src/console/createRunner.js';
import { TUTORIAL_STEPS } from '../../src/ui/tutorialSteps.js';
import { TutorialRails } from '../../src/ui/tutorialRails.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCtx(): GameContext {
  return { state: null, grid: null, emitter: new EventEmitter() };
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
    newGameCommand(ctx, [], { seed: '42', size: '24' });
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
    newGameCommand(ctx, [], { seed: '42', size: '24' });
    campaignStartCommand(ctx, [], { level: 'tutorial_pit' });

    // There is no skip(): the tutorial cannot be abandoned, so the only route
    // out is finishing it. The game must not be left paused either way.
    const tutorial = new TutorialOverlay(container) as unknown as
      TutorialOverlay & { finish: () => void };
    overlay = tutorial;

    // Start with state → game pauses
    tutorial.start(ctx.state!);
    expect(ctx.state!.isPaused).toBe(true);

    tutorial.finish();
    expect(ctx.state!.isPaused).toBe(false);
  });

  // ── 4. start(undefined) with existing state does not pause ───────────────

  it('start(undefined) does not modify isPaused when state exists', () => {
    newGameCommand(ctx, [], { seed: '42', size: '24' });
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
    expect(runner.run('sequence auto delay_step:25').success).toBe(true);
    expect(runner.run('blast').success).toBe(true);

    const state = ctx.state!;
    expect(state.logistics.fragments.some(f => f.state === 'on_ground')).toBe(true);

    const step = TUTORIAL_STEPS.find(s => s.id === 'haul-debris')!;
    expect(step.waitsOnWork).toBe(true);

    const rails = new TutorialRails();
    rails.beginStep(
      { id: step.id, highlightTarget: step.highlightTarget, tickBudget: step.tickBudget, waitsOnWork: step.waitsOnWork },
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
});
