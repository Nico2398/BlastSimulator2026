import { describe, it, expect } from 'vitest';
import {
  decideLadderRamp,
  decideLadderSafety,
  type LadderRampInput,
  type LadderSafetyInput,
} from '../../../scripts/shared/probe-ladder-policy';

const rampBase: LadderRampInput = {
  rubbleKg: 0,
  pendingHaul: false,
  deepenTargetOpen: true,
  floorDepthM: 10,
  rampedFloorM: 5,
  cash: 10000,
  rampCost: 2000,
  reserve: 3000,
};

describe('decideLadderRamp', () => {
  it('orders when every condition holds', () => {
    expect(decideLadderRamp(rampBase)).toBe('order');
  });

  it('skips while rubble remains', () => {
    expect(decideLadderRamp({ ...rampBase, rubbleKg: 1 })).toBe('skip');
  });

  it('skips while a haul is pending', () => {
    expect(decideLadderRamp({ ...rampBase, pendingHaul: true })).toBe('skip');
  });

  it('skips when no deepen target is open', () => {
    expect(decideLadderRamp({ ...rampBase, deepenTargetOpen: false })).toBe('skip');
  });

  it('skips when the floor is no deeper than the last ramped floor', () => {
    expect(decideLadderRamp({ ...rampBase, floorDepthM: 5 })).toBe('skip');
    expect(decideLadderRamp({ ...rampBase, floorDepthM: 4 })).toBe('skip');
  });

  it('skips when the ramp would eat into the reserve', () => {
    expect(decideLadderRamp({ ...rampBase, cash: 4999 })).toBe('skip');
  });

  it('orders when cash minus ramp cost equals the reserve exactly', () => {
    expect(decideLadderRamp({ ...rampBase, cash: 5000 })).toBe('order');
  });
});

const safetyBase: LadderSafetyInput = {
  safetyTargetOpen: false,
  neighboursBelowTarget: false,
  officeBuilt: false,
  canAfford: true,
};

describe('decideLadderSafety', () => {
  it('does nothing when neither target is open', () => {
    expect(decideLadderSafety(safetyBase)).toBe('none');
  });

  it('builds an office when safety is open, none exists and it is affordable', () => {
    expect(decideLadderSafety({ ...safetyBase, safetyTargetOpen: true })).toBe('build_office');
  });

  it('upgrades the office when one is already built', () => {
    expect(
      decideLadderSafety({ ...safetyBase, safetyTargetOpen: true, officeBuilt: true }),
    ).toBe('upgrade_office');
  });

  it('handles neighbours when only neighbours are below target', () => {
    expect(decideLadderSafety({ ...safetyBase, neighboursBelowTarget: true })).toBe('neighbours');
  });

  it('falls through to neighbours when safety is open but unaffordable and neighbours are open', () => {
    expect(
      decideLadderSafety({
        ...safetyBase,
        safetyTargetOpen: true,
        canAfford: false,
        neighboursBelowTarget: true,
      }),
    ).toBe('neighbours');
  });

  it('does nothing when safety is open but unaffordable and neighbours are not open', () => {
    expect(
      decideLadderSafety({ ...safetyBase, safetyTargetOpen: true, canAfford: false }),
    ).toBe('none');
  });
});
