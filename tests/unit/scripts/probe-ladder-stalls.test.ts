import { describe, it, expect } from 'vitest';
import {
  decideBuriedPattern,
  decideLadderHaulerBuy,
  rampStartsInsideCrater,
  LADDER_MAX_HAULERS,
  LADDER_STALE_RAMP_TICKS,
} from '../../../scripts/shared/probe-ladder-policy';
import { LADDER_UPGRADE_ROLES } from '../../../scripts/shared/probe-strategies';

describe('ladder never upgrades haulers (#2076)', () => {
  it('leaves debris haulers at tier 1: a fleet upgraded around one licensed driver stalls when that driver dies', () => {
    expect(LADDER_UPGRADE_ROLES).not.toContain('debris_hauler');
    expect(LADDER_UPGRADE_ROLES).toContain('drill_rig');
  });
});

describe('decideLadderHaulerBuy', () => {
  const base = { haulers: 2, cash: 1_000_000, cost: 50_000, reserve: 150_000, rubbleKg: 10_000 };
  it('buys while rubble lies and the reserve survives', () => {
    expect(decideLadderHaulerBuy(base)).toBe('buy');
  });
  it('skips at the cap, with no rubble, or when the reserve would be breached', () => {
    expect(decideLadderHaulerBuy({ ...base, haulers: LADDER_MAX_HAULERS })).toBe('skip');
    expect(decideLadderHaulerBuy({ ...base, rubbleKg: 0 })).toBe('skip');
    expect(decideLadderHaulerBuy({ ...base, cash: 190_000 })).toBe('skip');
  });
});

describe('rampStartsInsideCrater', () => {
  const crater = { craterX: 8, craterZ: 44, craterSpan: 8 };
  it('is true for a start on the crater footprint', () => {
    expect(rampStartsInsideCrater({ ...crater, startX: 15, startZ: 48 })).toBe(true);
  });
  it('is false once the start clears the footprint on either axis', () => {
    expect(rampStartsInsideCrater({ ...crater, startX: 16, startZ: 48 })).toBe(false);
    expect(rampStartsInsideCrater({ ...crater, startX: 10, startZ: 52 })).toBe(false);
    expect(rampStartsInsideCrater({ ...crater, startX: 7, startZ: 48 })).toBe(false);
  });
});

describe('decideBuriedPattern with a stale-ramp window', () => {
  it('drops a blocked ramp only after LADDER_STALE_RAMP_TICKS', () => {
    const dropAfterTicks = LADDER_STALE_RAMP_TICKS;
    expect(decideBuriedPattern({ buriedHoleCount: 12, buriedSinceTick: 100, tick: 100 + dropAfterTicks - 1, dropAfterTicks }).action).toBe('wait');
    expect(decideBuriedPattern({ buriedHoleCount: 12, buriedSinceTick: 100, tick: 100 + dropAfterTicks, dropAfterTicks }))
      .toEqual({ action: 'drop', buriedSinceTick: null });
  });
});
