// BlastSimulator2026 — set_policy threshold guards (#539)
//
// `set_policy hunger:<n> fatigue:<n> social:<n>` parses each override with
// `parseInt(v, 10)` and guards it with a bare `isNaN(v)`. `isNaN` only
// catches `NaN` — it does not catch `Infinity`. A digit string long enough
// to overflow `parseInt` (e.g. `'1' + '0'.repeat(400)`) parses to `Infinity`,
// and `isNaN(Infinity)` is `false`, so the guard never fires: the bare check
// lets a non-finite value get written straight into
// `state.sitePolicy.hungerRestThreshold` / `fatigueRestThreshold` /
// `socialBreakThreshold`. Same bug class as #519's `corrupt cost:` and
// #534's `employee raise amount:` / `new_game cash:` / `start_level cash:`
// sites — the fix replaces `isNaN(v)` with `Number.isFinite(v)` in all three
// guards. Control flow is unchanged: a rejected override is silently
// skipped (the command still returns `success: true`), and `revision` still
// bumps unconditionally.

import { describe, it, expect, beforeEach } from 'vitest';
import { type GameContext, newGameCommand } from '../../../src/console/commands/world.js';
import { setPolicyCommand } from '../../../src/console/commands/policy.js';
import { EventEmitter } from '../../../src/core/state/EventEmitter.js';

function makeCtx(): GameContext {
  const ctx: GameContext = { state: null, grid: null, emitter: new EventEmitter(), landscape: null, playableArea: null };
  newGameCommand(ctx, [], { mine_type: 'desert', seed: '42', size: '24' });
  return ctx;
}

// A digit string long enough that parseInt(str, 10) overflows to Infinity.
const OVERFLOW_DIGITS = '1' + '0'.repeat(400);

type Field = 'hunger' | 'fatigue' | 'social';
type ThresholdKey = 'hungerRestThreshold' | 'fatigueRestThreshold' | 'socialBreakThreshold';

const FIELDS: { field: Field; key: ThresholdKey }[] = [
  { field: 'hunger', key: 'hungerRestThreshold' },
  { field: 'fatigue', key: 'fatigueRestThreshold' },
  { field: 'social', key: 'socialBreakThreshold' },
];

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

  for (const { field, key } of FIELDS) {
    describe(`${field}: → sitePolicy.${key}`, () => {
      it(`rejects ${field}:notanumber, leaving the threshold unchanged (NaN case — already correct pre-fix)`, () => {
        const before = ctx.state!.sitePolicy[key];
        const result = setPolicyCommand(ctx, [], { mode: 'shift_8h', [field]: 'notanumber' });

        expect(result.success).toBe(true);
        expect(ctx.state!.sitePolicy[key]).toBe(before);
        expect(Number.isFinite(ctx.state!.sitePolicy[key])).toBe(true);
      });

      it(`rejects ${field}:<overflow digit string>, leaving the threshold unchanged and finite — reproduces #539`, () => {
        const before = ctx.state!.sitePolicy[key];
        const result = setPolicyCommand(ctx, [], { mode: 'shift_8h', [field]: OVERFLOW_DIGITS });

        expect(result.success).toBe(true);
        // This is the assertion that fails against the buggy bare isNaN(v)
        // guard: it lets Infinity through, so the threshold becomes Infinity
        // instead of staying at its pre-call value.
        expect(Number.isFinite(ctx.state!.sitePolicy[key])).toBe(true);
        expect(ctx.state!.sitePolicy[key]).toBe(before);
        expect(ctx.state!.sitePolicy[key]).not.toBe(Infinity);
      });

      it(`applies a legitimate ${field}:<n> override exactly (regression guard — fix must not over-reject valid input)`, () => {
        const result = setPolicyCommand(ctx, [], { mode: 'shift_8h', [field]: '33' });

        expect(result.success).toBe(true);
        expect(ctx.state!.sitePolicy[key]).toBe(33);
      });
    });
  }

  it('bumps the revision unconditionally even when an overflowing override is rejected', () => {
    const before = ctx.state!.sitePolicy.revision;
    const result = setPolicyCommand(ctx, [], { mode: 'shift_8h', hunger: OVERFLOW_DIGITS });

    expect(result.success).toBe(true);
    expect(ctx.state!.sitePolicy.revision).toBe(before + 1);
  });

  it('rejects an overflowing override on one field without disturbing a valid override on another', () => {
    const result = setPolicyCommand(ctx, [], {
      mode: 'shift_8h',
      hunger: OVERFLOW_DIGITS,
      fatigue: '20',
    });

    expect(result.success).toBe(true);
    expect(Number.isFinite(ctx.state!.sitePolicy.hungerRestThreshold)).toBe(true);
    expect(ctx.state!.sitePolicy.hungerRestThreshold).not.toBe(Infinity);
    expect(ctx.state!.sitePolicy.fatigueRestThreshold).toBe(20);
  });

  it('does not poison sitePolicy thresholds for the rest of the session after a rejected overflow override', () => {
    setPolicyCommand(ctx, [], { mode: 'shift_8h', hunger: OVERFLOW_DIGITS });
    expect(Number.isFinite(ctx.state!.sitePolicy.hungerRestThreshold)).toBe(true);

    // A later, legitimate call must still apply cleanly.
    const result = setPolicyCommand(ctx, [], { mode: 'shift_8h', hunger: '45' });
    expect(result.success).toBe(true);
    expect(ctx.state!.sitePolicy.hungerRestThreshold).toBe(45);
  });
});
