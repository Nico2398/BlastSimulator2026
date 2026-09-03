// BlastSimulator2026 — set_policy threshold guards (#539)
//
// `set_policy fatigue:<n>` parses the override with `parseInt(v, 10)` and
// guards it with a bare `isNaN(v)`. `isNaN` only catches `NaN` — it does not
// catch `Infinity`. A digit string long enough to overflow `parseInt` (e.g.
// `'1' + '0'.repeat(400)`) parses to `Infinity`, and `isNaN(Infinity)` is
// `false`, so the guard never fires: the bare check lets a non-finite value
// get written straight into `state.sitePolicy.fatigueRestThreshold`. Same bug
// class as #519's `corrupt cost:` and #534's `employee raise amount:` /
// `new_game cash:` / `start_level cash:` sites — the fix replaces
// `isNaN(v)` with `Number.isFinite(v)` in the guard. Control flow is
// unchanged: a rejected override is silently skipped (the command still
// returns `success: true`), and `revision` still bumps unconditionally.
//
// #928: `hunger`/`social` fields (and hungerRestThreshold/
// socialBreakThreshold) were removed — `fatigue` is the sole settable
// threshold now.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext } from '../../../src/console/commands/world.js';
import { setPolicyCommand } from '../../../src/console/commands/policy.js';
import { makeGameContext } from '../../helpers/gameContext.js';

function makeCtx(): GameContext {
  return makeGameContext({ mineType: 'desert', seed: 42, size: 24 });
}

// A digit string long enough that parseInt(str, 10) overflows to Infinity.
const OVERFLOW_DIGITS = '1' + '0'.repeat(400);

describe('set_policy threshold guards (#539)', () => {
  let ctx: GameContext;

  beforeEach(() => {
    ctx = makeCtx();
  });

  // Sanity check on the premise, same as the #534 start_level test.
  it('parseInt overflows the digit fixture to Infinity, and isNaN does not catch it', () => {
    expect(parseInt(OVERFLOW_DIGITS, 10)).toBe(Infinity);
    expect(isNaN(Infinity)).toBe(false);
  });

  describe('fatigue: → sitePolicy.fatigueRestThreshold', () => {
    it('rejects fatigue:notanumber, leaving the threshold unchanged (NaN case — already correct pre-fix)', () => {
      const before = ctx.state!.sitePolicy.fatigueRestThreshold;
      const result = setPolicyCommand(ctx, [], { mode: 'shift_8h', fatigue: 'notanumber' });

      expect(result.success).toBe(true);
      expect(ctx.state!.sitePolicy.fatigueRestThreshold).toBe(before);
      expect(Number.isFinite(ctx.state!.sitePolicy.fatigueRestThreshold)).toBe(true);
    });

    it('rejects fatigue:<overflow digit string>, leaving the threshold unchanged and finite — reproduces #539', () => {
      const before = ctx.state!.sitePolicy.fatigueRestThreshold;
      const result = setPolicyCommand(ctx, [], { mode: 'shift_8h', fatigue: OVERFLOW_DIGITS });

      expect(result.success).toBe(true);
      // This is the assertion that fails against the buggy bare isNaN(v)
      // guard: it lets Infinity through, so the threshold becomes Infinity
      // instead of staying at its pre-call value.
      expect(Number.isFinite(ctx.state!.sitePolicy.fatigueRestThreshold)).toBe(true);
      expect(ctx.state!.sitePolicy.fatigueRestThreshold).toBe(before);
      expect(ctx.state!.sitePolicy.fatigueRestThreshold).not.toBe(Infinity);
    });

    it('applies a legitimate fatigue:<n> override exactly (regression guard — fix must not over-reject valid input)', () => {
      const result = setPolicyCommand(ctx, [], { mode: 'shift_8h', fatigue: '33' });

      expect(result.success).toBe(true);
      expect(ctx.state!.sitePolicy.fatigueRestThreshold).toBe(33);
    });
  });

  it('bumps the revision unconditionally even when an overflowing override is rejected', () => {
    const before = ctx.state!.sitePolicy.revision;
    const result = setPolicyCommand(ctx, [], { mode: 'shift_8h', fatigue: OVERFLOW_DIGITS });

    expect(result.success).toBe(true);
    expect(ctx.state!.sitePolicy.revision).toBe(before + 1);
  });

  it('does not poison sitePolicy thresholds for the rest of the session after a rejected overflow override', () => {
    setPolicyCommand(ctx, [], { mode: 'shift_8h', fatigue: OVERFLOW_DIGITS });
    expect(Number.isFinite(ctx.state!.sitePolicy.fatigueRestThreshold)).toBe(true);

    // A later, legitimate call must still apply cleanly.
    const result = setPolicyCommand(ctx, [], { mode: 'shift_8h', fatigue: '45' });
    expect(result.success).toBe(true);
    expect(ctx.state!.sitePolicy.fatigueRestThreshold).toBe(45);
  });
});
