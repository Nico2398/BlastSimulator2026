// @vitest-environment jsdom
// BlastSimulator2026 — Integration tests: tutorial clock determinism (#1550)
// Scripted tutorial scenarios went bankrupt nondeterministically: the overlay's
// real-time 250 ms guide timer called TutorialRails.updateClock(), which set
// state.isPaused once a step's tick budget was spent, and the console `tick N`
// then stopped after one tick. With clockFollowsTimer:false (scenario mode) the
// clock must only move on commands (onCommandExecuted), never on wall time.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { campaignStartCommand } from '../../src/console/commands/campaign.js';
import { createRunner } from '../../src/console/createRunner.js';
import { TutorialOverlay } from '../../src/ui/TutorialOverlay.js';
import { TUTORIAL_STEPS } from '../../src/ui/tutorialSteps.js';
import { DEFAULT_TICK_BUDGET } from '../../src/ui/tutorialGuide.js';

const GUIDE_WAIT_MS = 2_000; // many 250 ms guide passes

describe('Tutorial clock determinism (#1550)', () => {
  let container: HTMLDivElement;
  let overlay: TutorialOverlay | null;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    overlay = null;
    try { localStorage.removeItem('bs_tutorial_done'); } catch { /* ignore */ }
  });

  afterEach(() => {
    overlay?.dispose();
    container.remove();
    vi.useRealTimers();
  });

  /** Fresh tutorial level, overlay started on step 0 and the opening pause lifted. */
  function setup(options?: { clockFollowsTimer?: boolean }) {
    const { runner, ctx } = createRunner();
    expect(runner.run('new_game seed:42 size:24').success).toBe(true);
    expect(campaignStartCommand(ctx, [], { level: 'tutorial_pit' }).success).toBe(true);
    const tutorial = options ? new TutorialOverlay(container, options) : new TutorialOverlay(container);
    overlay = tutorial;
    tutorial.start(ctx.state!);
    ctx.state!.isPaused = false;
    return { runner, ctx, tutorial };
  }

  it('step 0 has a small tick budget that a scripted tick spends', () => {
    expect(TUTORIAL_STEPS[0]!.guided).not.toBe(false);
    expect(TUTORIAL_STEPS[0]!.waitsOnWork).not.toBe(true);
    expect(TUTORIAL_STEPS[0]!.tickBudget ?? DEFAULT_TICK_BUDGET).toBeLessThanOrEqual(12);
  });

  it('clockFollowsTimer:false: guide timer never pauses the game after the budget is spent', () => {
    const { runner, ctx } = setup({ clockFollowsTimer: false });
    expect(runner.run('tick 12').success).toBe(true);
    expect(ctx.state!.isPaused).toBe(false);

    vi.advanceTimersByTime(GUIDE_WAIT_MS);
    expect(ctx.state!.isPaused).toBe(false);
  });

  it('clockFollowsTimer:false: tick 40 after a spent-budget step advances exactly 40 ticks', () => {
    const { runner, ctx } = setup({ clockFollowsTimer: false });
    runner.run('tick 12');
    vi.advanceTimersByTime(GUIDE_WAIT_MS);

    const before = ctx.state!.tickCount;
    expect(runner.run('tick 40').success).toBe(true);
    expect(ctx.state!.tickCount - before).toBe(40);
    vi.advanceTimersByTime(GUIDE_WAIT_MS);
    expect(ctx.state!.isPaused).toBe(false);
  });

  it('clockFollowsTimer:false: onCommandExecuted never pauses, so a later tick 40 runs in full', () => {
    const { runner, ctx, tutorial } = setup({ clockFollowsTimer: false });
    expect(runner.run('tick 12').success).toBe(true);
    tutorial.onCommandExecuted(ctx.state!); // as main.ts does after each command
    expect(ctx.state!.isPaused).toBe(false);
    vi.advanceTimersByTime(GUIDE_WAIT_MS);
    expect(ctx.state!.isPaused).toBe(false);

    const before = ctx.state!.tickCount;
    expect(runner.run('tick 40').success).toBe(true);
    tutorial.onCommandExecuted(ctx.state!);
    expect(ctx.state!.tickCount - before).toBe(40);
    expect(ctx.state!.isPaused).toBe(false);
  });

  it('clockFollowsTimer:false: onCommandExecuted does not hold while the budget is unspent', () => {
    const { runner, ctx, tutorial } = setup({ clockFollowsTimer: false });
    runner.run('tick 1');
    tutorial.onCommandExecuted(ctx.state!);
    expect(ctx.state!.isPaused).toBe(false);
  });

  it('default option: the guide timer still pauses the game once the budget is spent', () => {
    const { runner, ctx } = setup();
    runner.run('tick 12');
    expect(ctx.state!.isPaused).toBe(false);

    vi.advanceTimersByTime(GUIDE_WAIT_MS);
    expect(ctx.state!.isPaused).toBe(true);
  });

  it('explicit clockFollowsTimer:true behaves like the default', () => {
    const { runner, ctx } = setup({ clockFollowsTimer: true });
    runner.run('tick 12');
    vi.advanceTimersByTime(GUIDE_WAIT_MS);
    expect(ctx.state!.isPaused).toBe(true);
  });
});
