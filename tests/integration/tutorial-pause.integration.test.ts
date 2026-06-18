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
    const oe = container.querySelector('.bs-confirm-overlay') as HTMLElement;
    expect(oe.style.display).not.toBe('none');
  });

  // ── 3. skip unpauses ─────────────────────────────────────────────────────

  it('skip() resets isPaused to false', () => {
    newGameCommand(ctx, [], { seed: '42', size: '24' });
    campaignStartCommand(ctx, [], { level: 'tutorial_pit' });

    const tutorial = new TutorialOverlay(container);
    overlay = tutorial;

    // Start with state → game pauses
    tutorial.start(ctx.state!);
    expect(ctx.state!.isPaused).toBe(true);

    // Skip the tutorial → game unpauses
    tutorial.skip();
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
});
