// BlastSimulator2026 — Full-level integration test: Level 1 Lose — Criminal Arrest
// Goal: Start level 1, engage in corruption / mafia activities until
// exposure is high enough to trigger an arrest.
//
// Mafia exposure comes from arranged accidents and framings (#1409: smuggling no
// longer adds per-tick exposure; the tax audit is its risk channel).
// Arrest triggers at exposureRisk >= 0.9.
// Mafia is unlocked once the corruption meter reaches MAFIA_UNLOCK_THRESHOLD
// (#1407: successful bribes add 5-15, failed ones 2), so several bribes are needed.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  makeCampaignCtx,
  tickWithEvents,
} from './helpers.js';
import { MAFIA_UNLOCK_THRESHOLD, ARREST_EXPOSURE_THRESHOLD } from '../../../src/core/config/balance.js';
import { hireEmployee } from '../../../src/core/entities/Employee.js';
import { Random } from '../../../src/core/math/Random.js';
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

  it('arranging accidents accumulates exposure until arrested', () => {
    bribeUntilMafiaUnlocked(ctx);
    expect(ctx.state!.corruption.mafiaUnlocked).toBe(true);
    expect(ctx.state!.mafia.exposureRisk).toBe(0);

    // Plenty of cash and victims: every accident adds exposure (more when it fails).
    ctx.state!.cash += 1_000_000;
    for (let i = 0; i < 16; i++) hireEmployee(ctx.state!.employees, 'driller', new Random(100 + i));
    for (const emp of ctx.state!.employees.employees.slice()) {
      if (ctx.state!.mafia.exposureRisk >= ARREST_EXPOSURE_THRESHOLD) break;
      if (!emp.alive) continue;
      mafiaCommand(ctx, ['accident'], { employee: String(emp.id) });
    }
    expect(ctx.state!.mafia.exposureRisk).toBeGreaterThanOrEqual(ARREST_EXPOSURE_THRESHOLD);

    // Detach the active level so the arrest races nothing else.
    ctx.state!.campaign.activeLevelId = null;
    tickWithEvents(ctx, 5);

    expect(ctx.state!.arrest.arrested).toBe(true);
    expect(ctx.state!.levelEndReason).toBe('arrest');
  });

  it('smuggling at full volume adds no exposure and does not get the player arrested', () => {
    bribeUntilMafiaUnlocked(ctx);
    const result = mafiaCommand(ctx, ['smuggle'], { volume: '1' });
    expect(result.success).toBe(true);
    expect(ctx.state!.mafia.smugglingVolume).toBe(1);

    tickWithEvents(ctx, 120);

    expect(ctx.state!.mafia.exposureRisk).toBe(0);
    expect(ctx.state!.arrest.arrested).toBe(false);
    expect(ctx.state!.levelEndReason).not.toBe('arrest');
  });
});
