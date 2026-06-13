// BlastSimulator2026 — Integration test: Tutorial level blocks random events
// Verifies that eventFreqMultiplier: 0 prevents both timer-based and
// condition-based events from firing during the tutorial.

import { describe, it, expect, beforeEach } from 'vitest';
import { makeCampaignCtx } from './helpers.js';
import { setupEvents, clearEvents } from '../../../src/core/events/index.js';
import { tickCommand, eventCommand } from '../../../src/console/commands/events.js';

describe('Tutorial Level — No Random Events', () => {
  let ctx: ReturnType<typeof makeCampaignCtx>;

  beforeEach(() => {
    clearEvents();
    setupEvents();
    ctx = makeCampaignCtx('tutorial_pit');
  });

  it('tutorial_pit starts with eventFreqMultiplier = 0', () => {
    expect(ctx.state!.events.eventFreqMultiplier).toBe(0);
  });

  it('no timer-based events fire after advancing many ticks', () => {
    // Advance 300 ticks — enough for many timer cycles if events were active
    for (let i = 0; i < 300; i++) {
      tickCommand(ctx, ['1'], {});
      // If any event fired, the game would pause
      if (ctx.state!.events.pendingEvent) {
        // Check it's not a random event (should not happen)
        const pid = ctx.state!.events.pendingEvent.eventId;
        expect(pid).not.toMatch(
          /^(union|politics|weather|mafia|lawsuit|traffic|unqualified|legendary|absurdium|lucky|barren)/,
        );
        break;
      }
    }
    // No random events should have fired
    expect(ctx.state!.events.pendingEvent).toBeNull();
  });

  it('manual event fire still works despite eventFreqMultiplier=0', () => {
    expect(ctx.state!.events.pendingEvent).toBeNull();

    const fireResult = eventCommand(ctx, ['fire', 'tutorial_synergy_consultant'], {});
    expect(fireResult.success).toBe(true);

    expect(ctx.state!.events.pendingEvent).not.toBeNull();
    expect(ctx.state!.events.pendingEvent!.eventId).toBe('tutorial_synergy_consultant');
  });

});
