// BlastSimulator2026 — `corrupt` command grants protections and lowers exposure (#1407)
import { describe, it, expect, beforeEach } from 'vitest';
import { corruptCommand } from '../../../src/console/commands/corruption.js';
import { makeGameContext, type GameContext } from '../../helpers/gameContext.js';
import { createCorruptionState } from '../../../src/core/economy/Corruption.js';
import {
  BRIBE_CORRUPTION_DELTA,
  BRIBERY_FAILURE_CORRUPTION_DELTA,
  WITNESS_EXPOSURE_REDUCTION,
  BRIBE_PROTECTION_DAYS,
  TICKS_PER_DAY,
} from '../../../src/core/config/balance.js';

/** Run one bribe at a given tick on a clean corruption state; the console seeds its RNG from seed + tickCount. */
function bribeAt(ctx: GameContext, target: string, tick: number): boolean {
  const s = ctx.state!;
  s.corruption = createCorruptionState();
  s.tickCount = tick;
  s.cash = 10_000_000;
  corruptCommand(ctx, [], { target });
  return s.corruption.attempts[0]!.success;
}

function findTick(ctx: GameContext, target: string, wantSuccess: boolean): number {
  for (let tick = 1; tick < 300; tick++) {
    if (bribeAt(ctx, target, tick) === wantSuccess) return tick;
  }
  throw new Error(`no ${wantSuccess ? 'successful' : 'failed'} bribe found`);
}

describe('corrupt command — protections (#1407)', () => {
  let ctx: GameContext;
  beforeEach(() => { ctx = makeGameContext({ seed: 42 }); });

  it('successful judge bribe adds its delta and grants a protection', () => {
    const tick = findTick(ctx, 'judge', true);
    const s = ctx.state!;
    s.mafia.exposureRisk = 0;
    bribeAt(ctx, 'judge', tick);
    expect(s.corruption.level).toBe(BRIBE_CORRUPTION_DELTA.judge);
    expect(s.corruption.protections).toHaveLength(1);
    expect(s.corruption.protections[0]!.target).toBe('judge');
    expect(s.corruption.protections[0]!.expiresAtTick).toBe(tick + BRIBE_PROTECTION_DAYS.judge * TICKS_PER_DAY);
  });

  it('failed bribe adds only the failure delta and grants nothing', () => {
    const tick = findTick(ctx, 'inspector', false);
    bribeAt(ctx, 'inspector', tick);
    const s = ctx.state!;
    expect(s.corruption.level).toBe(BRIBERY_FAILURE_CORRUPTION_DELTA);
    expect(s.corruption.protections).toHaveLength(0);
  });

  it('failed re-bribe leaves the held protection untouched', () => {
    const tick = findTick(ctx, 'inspector', false);
    const s = ctx.state!;
    bribeAt(ctx, 'inspector', tick);
    s.corruption.protections.push({ target: 'inspector', expiresAtTick: tick + 5, dismissalsLeft: 0 });
    s.cash = 10_000_000;
    s.corruption.attempts.length = 0;
    s.tickCount = tick;
    corruptCommand(ctx, [], { target: 'inspector' });
    expect(s.corruption.protections).toEqual([{ target: 'inspector', expiresAtTick: tick + 5, dismissalsLeft: 0 }]);
  });

  it('successful witness bribe lowers exposure by the configured amount', () => {
    const tick = findTick(ctx, 'witness', true);
    const s = ctx.state!;
    s.mafia.exposureRisk = 0.6;
    s.corruption = createCorruptionState();
    s.tickCount = tick;
    s.cash = 10_000_000;
    corruptCommand(ctx, [], { target: 'witness' });
    expect(s.mafia.exposureRisk).toBeCloseTo(0.6 - WITNESS_EXPOSURE_REDUCTION, 6);
    expect(s.corruption.protections).toHaveLength(0);
  });

  it('witness exposure reduction clamps at 0', () => {
    const tick = findTick(ctx, 'witness', true);
    const s = ctx.state!;
    s.mafia.exposureRisk = 0.05;
    s.corruption = createCorruptionState();
    s.tickCount = tick;
    s.cash = 10_000_000;
    corruptCommand(ctx, [], { target: 'witness' });
    expect(s.mafia.exposureRisk).toBe(0);
  });

  it('failed witness bribe leaves exposure unchanged', () => {
    const tick = findTick(ctx, 'witness', false);
    const s = ctx.state!;
    s.mafia.exposureRisk = 0.6;
    s.corruption = createCorruptionState();
    s.tickCount = tick;
    s.cash = 10_000_000;
    corruptCommand(ctx, [], { target: 'witness' });
    expect(s.mafia.exposureRisk).toBe(0.6);
  });

  it('status output lists active protections', () => {
    const tick = findTick(ctx, 'union_leader', true);
    const s = ctx.state!;
    s.corruption = createCorruptionState();
    s.tickCount = tick;
    s.cash = 10_000_000;
    corruptCommand(ctx, [], { target: 'union_leader' });
    const out = corruptCommand(ctx, [], {}).output;
    expect(out).toContain('union_leader');
  });
});
