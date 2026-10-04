// BlastSimulator2026 — Console: ramp width on build_ramp and the widen_ramp command (#1298)

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildRampCommand, cancelRampCommand, widenRampCommand, type MiningContext,
} from '../../../src/console/commands/mining.js';
import { tickCommand } from '../../../src/console/commands/events.js';

import { RAMP_COST_PER_METER_PER_WIDTH } from '../../../src/core/config/balance.js';
import { rampFootprint } from '../../../src/core/mining/RampWidening.js';
import { makeEmptyGameContext, makeGameContext } from '../../helpers/gameContext.js';

const ORDER = { origin: '5,5', direction: 'south', length: '5', depth: '2' };

function makeCtx(): MiningContext {
  const ctx = makeGameContext({ mineType: 'desert', seed: 1, size: 32, staffed: true });
  ctx.state!.cash = 10_000_000;
  return ctx;
}

function drive(ctx: MiningContext, maxTicks = 600): void {
  for (let i = 0; i < maxTicks && ctx.state!.plannedRamps.length > 0; i++) {
    for (const emp of ctx.state!.employees.employees) emp.fatigue = 100;
    tickCommand(ctx, ['1'], {});
  }
}

describe('build_ramp width:', () => {
  it.each([3, 5, 7])('orders a %i wide ramp charging length * width * per-width rate', (width) => {
    const ctx = makeCtx();
    const before = ctx.state!.cash;
    const r = buildRampCommand(ctx, [], { ...ORDER, width: String(width) });
    expect(r.success).toBe(true);
    expect(before - ctx.state!.cash).toBeCloseTo(5 * width * RAMP_COST_PER_METER_PER_WIDTH, 6);
    expect(ctx.state!.plannedRamps[0]!.def.width ?? 3).toBe(width);
  });

  it('defaults to 3 wide when no width is given', () => {
    const ctx = makeCtx();
    const before = ctx.state!.cash;
    expect(buildRampCommand(ctx, [], ORDER).success).toBe(true);
    expect(before - ctx.state!.cash).toBeCloseTo(5 * 3 * RAMP_COST_PER_METER_PER_WIDTH, 6);
  });

  it.each(['4', '0', '9', 'abc', '-3'])('refuses width:%s without charging or queueing', (width) => {
    const ctx = makeCtx();
    const before = ctx.state!.cash;
    const actions = ctx.state!.pendingActions.length;
    const r = buildRampCommand(ctx, [], { ...ORDER, width });
    expect(r.success).toBe(false);
    expect(ctx.state!.cash).toBe(before);
    expect(ctx.state!.plannedRamps).toHaveLength(0);
    expect(ctx.state!.pendingActions.length).toBe(actions);
  });

  it('records a BuiltRamp of the ordered width once dug, footprint matching the carved corridor', () => {
    const ctx = makeCtx();
    buildRampCommand(ctx, [], { ...ORDER, width: '5' });
    drive(ctx);
    expect(ctx.state!.plannedRamps).toHaveLength(0);
    expect(ctx.state!.builtRamps).toHaveLength(1);
    const built = ctx.state!.builtRamps[0]!;
    expect(built.id).toBe(1);
    expect(built.width).toBe(5);
    expect(built.footprint).toEqual(rampFootprint(built.def, 5));
  });

});

describe('widen_ramp', () => {
  function withBuiltRamp(width: '3' | '5' | '7' = '3') {
    const ctx = makeCtx();
    expect(buildRampCommand(ctx, [], { ...ORDER, width }).success).toBe(true);
    drive(ctx);
    expect(ctx.state!.builtRamps).toHaveLength(1);
    return ctx;
  }

  it('orders the widening, charging only the delta', () => {
    const ctx = withBuiltRamp('3');
    const before = ctx.state!.cash;
    const r = widenRampCommand(ctx, [], { id: '1', width: '5' });
    expect(r.success).toBe(true);
    expect(before - ctx.state!.cash).toBeCloseTo(5 * 2 * RAMP_COST_PER_METER_PER_WIDTH, 6);
    expect(ctx.state!.plannedRamps).toHaveLength(1);
    expect(ctx.state!.builtRamps[0]!.width).toBe(3);
  });

  it('widens the built ramp once the strips are dug', () => {
    const ctx = withBuiltRamp('3');
    widenRampCommand(ctx, [], { id: '1', width: '7' });
    drive(ctx);
    expect(ctx.state!.plannedRamps).toHaveLength(0);
    expect(ctx.state!.builtRamps).toHaveLength(1);
    expect(ctx.state!.builtRamps[0]!.width).toBe(7);
  });

  it('cancelling the widen order refunds the unspent cost and keeps the old width', () => {
    const ctx = withBuiltRamp('3');
    const before = ctx.state!.cash;
    expect(widenRampCommand(ctx, [], { id: '1', width: '5' }).success).toBe(true);
    const plannedId = ctx.state!.plannedRamps[0]!.id;
    const c = cancelRampCommand(ctx, plannedId);
    expect(c.success).toBe(true);
    expect(ctx.state!.cash).toBeCloseTo(before, 6);
    expect(ctx.state!.plannedRamps).toHaveLength(0);
    expect(ctx.state!.builtRamps[0]!.width).toBe(3);
    // not in flight any more: a new widen is accepted
    expect(widenRampCommand(ctx, [], { id: '1', width: '5' }).success).toBe(true);
  });

  const refusals: Array<[string, Record<string, string>, '3' | '5']> = [
    ['missing id', { width: '5' }, '3'],
    ['unknown id', { id: '99', width: '5' }, '3'],
    ['non-numeric id', { id: 'x', width: '5' }, '3'],
    ['missing width', { id: '1' }, '3'],
    ['width not an option', { id: '1', width: '4' }, '3'],
    ['width 0', { id: '1', width: '0' }, '3'],
    ['width too large', { id: '1', width: '9' }, '3'],
    ['width equal to current', { id: '1', width: '3' }, '3'],
    ['width narrower than current', { id: '1', width: '3' }, '5'],
  ];
  for (const [name, named, startWidth] of refusals) {
    it(`refuses ${name}, changing nothing`, () => {
      const ctx = withBuiltRamp(startWidth);
      const cash = ctx.state!.cash;
      const actions = ctx.state!.pendingActions.length;
      const r = widenRampCommand(ctx, [], named);
      expect(r.success).toBe(false);
      expect(r.output.length).toBeGreaterThan(0);
      expect(ctx.state!.cash).toBe(cash);
      expect(ctx.state!.plannedRamps).toHaveLength(0);
      expect(ctx.state!.pendingActions.length).toBe(actions);
    });
  }

  it('refuses when cash is insufficient, changing nothing', () => {
    const ctx = withBuiltRamp('3');
    ctx.state!.cash = 1;
    const r = widenRampCommand(ctx, [], { id: '1', width: '7' });
    expect(r.success).toBe(false);
    expect(ctx.state!.cash).toBe(1);
    expect(ctx.state!.plannedRamps).toHaveLength(0);
  });

  it('refuses a second widen while one is in flight', () => {
    const ctx = withBuiltRamp('3');
    expect(widenRampCommand(ctx, [], { id: '1', width: '5' }).success).toBe(true);
    const cash = ctx.state!.cash;
    const r = widenRampCommand(ctx, [], { id: '1', width: '7' });
    expect(r.success).toBe(false);
    expect(ctx.state!.cash).toBe(cash);
    expect(ctx.state!.plannedRamps).toHaveLength(1);
  });

  it('requires a loaded game', () => {
    const r = widenRampCommand(makeEmptyGameContext(), [], { id: '1', width: '5' });
    expect(r.success).toBe(false);
    expect(r.output).toContain('No game loaded');
  });
});
