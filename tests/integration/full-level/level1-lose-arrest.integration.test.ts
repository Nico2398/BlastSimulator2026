// BlastSimulator2026 — Full-level integration test: Level 1 Lose — Criminal Arrest
// Goal: Start level 1, engage in corruption / mafia activities until
// exposure is high enough to trigger an arrest.
//
// Mafia exposure accumulates at +0.02/tick when smuggling is active.
// Arrest triggers at exposureRisk >= 0.9.
// Mafia is unlocked once the corruption meter reaches MAFIA_UNLOCK_THRESHOLD
// (#1407: successful bribes add 5-15, failed ones 2), so several bribes are needed.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtx,
  tickWithEvents,
} from './helpers.js';
import { MAFIA_UNLOCK_THRESHOLD } from '../../../src/core/config/balance.js';
import { bribeFailureFine } from '../../../src/core/economy/Corruption.js';
import { corruptCommand, mafiaCommand } from '../../../src/console/commands/events.js';

/** Bribe inspectors (funded for it) until the corruption meter latches the mafia unlock. */
function bribeUntilMafiaUnlocked(ctx: ReturnType<typeof makeCampaignCtx>, maxBribes = 30): void {
  ctx.state!.cash += 1_000_000;
  for (let i = 0; i < maxBribes && !ctx.state!.corruption.mafiaUnlocked; i++) {
    corruptCommand(ctx, [], { target: 'inspector' });
  }
}

describe('Level 1 — Lose — Criminal Arrest', () => {
  let ctx: ReturnType<typeof makeCampaignCtx>;

  beforeEach(() => {
    ctx = makeCampaignCtx('dusty_hollow');
  });

  it('starts with no corruption or mafia exposure', () => {
    expect(ctx.state!.corruption.level).toBe(0);
    expect(ctx.state!.corruption.mafiaUnlocked).toBe(false);
    expect(ctx.state!.mafia.exposureRisk).toBe(0);
    expect(ctx.state!.arrest.arrested).toBe(false);
  });

  it('can bribe officials to unlock mafia access', () => {
    // One bribe is far from enough for the mafia (#1407).
    ctx.state!.cash += 1_000_000;
    corruptCommand(ctx, [], { target: 'inspector' });
    expect(ctx.state!.corruption.mafiaUnlocked).toBe(false);

    // A failed attempt also draws a scandal fine; track cash across the rest.
    let expected = ctx.state!.cash;
    let guard = 0;
    while (!ctx.state!.corruption.mafiaUnlocked && guard++ < 30) {
      const result = corruptCommand(ctx, [], { target: 'inspector' });
      expect(result.success).toBe(true);
      const attempt = ctx.state!.corruption.attempts.at(-1)!;
      expected -= attempt.cost + (attempt.success ? 0 : bribeFailureFine(attempt.cost));
      expect(ctx.state!.cash).toBe(expected);
    }

    expect(ctx.state!.corruption.mafiaUnlocked).toBe(true);
    expect(ctx.state!.corruption.level).toBeGreaterThanOrEqual(MAFIA_UNLOCK_THRESHOLD);
    expect(ctx.state!.corruption.attempts.length).toBeGreaterThan(3);
  });

  it('activates smuggling and accumulates exposure until arrested', () => {
    // Unlock mafia via bribes
    bribeUntilMafiaUnlocked(ctx);
    expect(ctx.state!.corruption.mafiaUnlocked).toBe(true);

    // Activate smuggling
    const smuggleResult = mafiaCommand(ctx, ['smuggle'], {});
    expect(smuggleResult.success).toBe(true);
    expect(ctx.state!.mafia.smugglingActive).toBe(true);

    // Starting exposure should be 0
    expect(ctx.state!.mafia.exposureRisk).toBe(0);

    // Smuggling income would clear the profit target in ~13 ticks and freeze
    // the mine as 'completed' (#1313) long before exposure reaches the arrest
    // threshold. Replaying a completed level still ends in victory (#1310), so
    // detach the active level instead: no profit target, arrest races alone.
    ctx.state!.campaign.activeLevelId = null;

    // Tick 60 times (need ~45 ticks at +0.02/tick to reach 0.9)
    tickWithEvents(ctx, 60);

    // Verify exposure accumulated
    expect(ctx.state!.mafia.exposureRisk).toBeGreaterThanOrEqual(0.9);

    // Verify arrest triggered
    expect(ctx.state!.arrest.arrested).toBe(true);

    expect(ctx.state!.levelEndReason).toBe('arrest');
  });
});
