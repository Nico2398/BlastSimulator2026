// BlastSimulator2026 — Full-level integration test: Level 1 Lose — Criminal Arrest
// Goal: Start level 1, engage in corruption / mafia activities until
// exposure is high enough to trigger an arrest.
//
// Mafia exposure accumulates at +0.02/tick when smuggling is active.
// Arrest triggers at exposureRisk >= 0.9.
// Mafia is unlocked after 3 corruption attempts (MAFIA_UNLOCK_THRESHOLD).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtx,
  tickWithEvents,
} from './helpers.js';
import { corruptCommand, mafiaCommand } from '../../../src/console/commands/events.js';

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
    // Bribe an inspector (costs $8,000 each)
    const result1 = corruptCommand(ctx, [], { target: 'inspector' });
    expect(result1.success).toBe(true);
    expect(ctx.state!.cash).toBe(42000); // 50000 - 8000

    const result2 = corruptCommand(ctx, [], { target: 'inspector' });
    expect(result2.success).toBe(true);
    expect(ctx.state!.cash).toBe(34000); // 42000 - 8000

    const result3 = corruptCommand(ctx, [], { target: 'inspector' });
    expect(result3.success).toBe(true);
    expect(ctx.state!.cash).toBe(26000); // 34000 - 8000

    // After 3 bribes, mafia should be unlocked
    expect(ctx.state!.corruption.mafiaUnlocked).toBe(true);
    expect(ctx.state!.corruption.level).toBeGreaterThanOrEqual(3);
  });

  it('activates smuggling and accumulates exposure until arrested', () => {
    // Unlock mafia via bribes
    corruptCommand(ctx, [], { target: 'inspector' });
    corruptCommand(ctx, [], { target: 'inspector' });
    corruptCommand(ctx, [], { target: 'inspector' });
    expect(ctx.state!.corruption.mafiaUnlocked).toBe(true);

    // Activate smuggling
    const smuggleResult = mafiaCommand(ctx, ['smuggle'], {});
    expect(smuggleResult.success).toBe(true);
    expect(ctx.state!.mafia.smugglingActive).toBe(true);

    // Starting exposure should be 0
    expect(ctx.state!.mafia.exposureRisk).toBe(0);

    // Tick 60 times (need ~45 ticks at +0.02/tick to reach 0.9)
    tickWithEvents(ctx, 60);

    // Verify exposure accumulated
    expect(ctx.state!.mafia.exposureRisk).toBeGreaterThanOrEqual(0.9);

    // Verify arrest triggered
    expect(ctx.state!.arrest.arrested).toBe(true);
  });
});
