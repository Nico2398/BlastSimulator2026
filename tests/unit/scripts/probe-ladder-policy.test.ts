import { describe, it, expect } from 'vitest';
import {
  decideLadderEventOption,
  decideLadderReach,
  reachableShotDepthM,
  type LadderReachInput,
  decideLadderRamp,
  decideLadderSafety,
  decideLadderShotGate,
  LADDER_GATE_MIN_GRADE,
  LADDER_GATE_RUBBLE_KG,
  LADDER_GATE_RUNWAY_TICKS,
  type LadderRampInput,
  type LadderShotGateInput,
  type LadderSafetyInput,
} from '../../../scripts/shared/probe-ladder-policy';

const rampBase: LadderRampInput = {
  floorDepthM: 10,
  rampedFloorM: 5,
  cash: 10000,
  rampCost: 2000,
  reserve: 3000,
};

describe('decideLadderRamp', () => {
  it('orders when the floor is deeper and the reserve survives', () => {
    expect(decideLadderRamp(rampBase)).toBe('order');
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

describe('decideLadderShotGate', () => {
  // payrollPerTick 1 makes runway equal cash exactly, so boundaries carry no rounding.
  const gateBase: LadderShotGateInput = {
    grade: LADDER_GATE_MIN_GRADE,
    rubbleKg: 0,
    cash: LADDER_GATE_RUNWAY_TICKS * 1000 + 1e9,
    payrollPerTick: 1,
  };

  it('constants are positive finite', () => {
    for (const c of [LADDER_GATE_RUBBLE_KG, LADDER_GATE_RUNWAY_TICKS]) {
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThan(0);
    }
    expect(LADDER_GATE_MIN_GRADE).toBeGreaterThan(1);
  });

  it('fires with a clear pit and a long runway', () => {
    expect(decideLadderShotGate(gateBase)).toBe('fire');
  });

  it('holds when rubble exceeds the threshold', () => {
    expect(decideLadderShotGate({ ...gateBase, rubbleKg: LADDER_GATE_RUBBLE_KG + 1 })).toBe('hold');
  });

  it('fires when rubble is exactly at the threshold', () => {
    expect(decideLadderShotGate({ ...gateBase, rubbleKg: LADDER_GATE_RUBBLE_KG })).toBe('fire');
  });

  it('fires when rubble is below the threshold', () => {
    expect(decideLadderShotGate({ ...gateBase, rubbleKg: LADDER_GATE_RUBBLE_KG / 2 })).toBe('fire');
  });

  it('holds when the payroll runway is short', () => {
    expect(decideLadderShotGate({ ...gateBase, cash: LADDER_GATE_RUNWAY_TICKS / 2 })).toBe('hold');
  });

  it('holds when cash is zero with payroll running', () => {
    expect(decideLadderShotGate({ ...gateBase, cash: 0 })).toBe('hold');
  });

  it('holds when cash is negative', () => {
    expect(decideLadderShotGate({ ...gateBase, cash: -1000 })).toBe('hold');
  });

  it('fires when the runway is exactly the threshold', () => {
    expect(decideLadderShotGate({ ...gateBase, cash: LADDER_GATE_RUNWAY_TICKS })).toBe('fire');
  });

  it('treats zero payroll as infinite runway', () => {
    expect(decideLadderShotGate({ ...gateBase, cash: 0, payrollPerTick: 0 })).toBe('fire');
  });

  it('holds on rubble even when the runway is infinite', () => {
    expect(
      decideLadderShotGate({ ...gateBase, payrollPerTick: 0, rubbleKg: LADDER_GATE_RUBBLE_KG + 1 }),
    ).toBe('hold');
  });

  it('holds when both rubble and runway fail', () => {
    expect(
      decideLadderShotGate({ ...gateBase, rubbleKg: LADDER_GATE_RUBBLE_KG + 1, cash: 0 }),
    ).toBe('hold');
  });

  it('applies at grades above the minimum', () => {
    expect(
      decideLadderShotGate({ ...gateBase, grade: LADDER_GATE_MIN_GRADE + 2, rubbleKg: LADDER_GATE_RUBBLE_KG + 1 }),
    ).toBe('hold');
  });

  it('passes grade 1 through even with heavy rubble and no cash', () => {
    expect(
      decideLadderShotGate({
        grade: LADDER_GATE_MIN_GRADE - 1,
        rubbleKg: LADDER_GATE_RUBBLE_KG * 100 + 1,
        cash: 0,
        payrollPerTick: 1000,
      }),
    ).toBe('fire');
  });

  it('passes grade 0 and below through', () => {
    expect(decideLadderShotGate({ ...gateBase, grade: 0, rubbleKg: LADDER_GATE_RUBBLE_KG + 1 })).toBe('fire');
  });
});

describe('decideLadderEventOption', () => {
  it('skips an option that hires', () => {
    expect(decideLadderEventOption([true, false, false])).toBe(1);
  });

  it('keeps the first option when it hires nobody', () => {
    expect(decideLadderEventOption([false, true])).toBe(0);
  });

  it('falls back to the first option when every option hires', () => {
    expect(decideLadderEventOption([true, true])).toBe(0);
    expect(decideLadderEventOption([])).toBe(0);
  });
});

const reachBase: LadderReachInput = {
  rampSlopeRatio: 0.3,
  fleetClimbRatio: 0.4,
  affordableTier2Upgrade: false,
};

describe('decideLadderReach', () => {
  it('fires when the finished ramp is climbable', () => {
    expect(decideLadderReach(reachBase)).toBe('fire');
  });

  it('fires when ramp and fleet ratios are equal', () => {
    expect(decideLadderReach({ ...reachBase, rampSlopeRatio: 0.4, fleetClimbRatio: 0.4 })).toBe('fire');
  });

  it('fires on a climbable ramp even when an upgrade is affordable', () => {
    expect(decideLadderReach({ ...reachBase, affordableTier2Upgrade: true })).toBe('fire');
  });

  it('asks for a ramp first when none is finished', () => {
    expect(decideLadderReach({ ...reachBase, rampSlopeRatio: Infinity })).toBe('ramp_first');
    expect(
      decideLadderReach({ ...reachBase, rampSlopeRatio: Infinity, affordableTier2Upgrade: true }),
    ).toBe('ramp_first');
  });

  it('upgrades first when the ramp is too steep and an upgrade is affordable', () => {
    expect(
      decideLadderReach({ ...reachBase, rampSlopeRatio: 0.5, affordableTier2Upgrade: true }),
    ).toBe('upgrade_first');
  });

  it('shrinks when the ramp is too steep and no upgrade is affordable', () => {
    expect(decideLadderReach({ ...reachBase, rampSlopeRatio: 0.5 })).toBe('shrink');
  });

  it('never fires on a ramp just above the fleet ratio without an affordable upgrade', () => {
    expect(
      decideLadderReach({ ...reachBase, rampSlopeRatio: 0.4001, fleetClimbRatio: 0.4 }),
    ).not.toBe('fire');
  });

});

describe('reachableShotDepthM', () => {
  it('is the ramp run times the climb ratio when below the hole depth', () => {
    expect(reachableShotDepthM(20, 0.25, 12)).toBeCloseTo(5);
  });

  it('is capped at the hole depth', () => {
    expect(reachableShotDepthM(100, 0.5, 12)).toBe(12);
  });

  it('is 0 for a zero ramp run', () => {
    expect(reachableShotDepthM(0, 0.5, 12)).toBe(0);
  });

  it('is never negative', () => {
    expect(reachableShotDepthM(-5, 0.5, 12)).toBe(0);
    expect(reachableShotDepthM(20, -0.5, 12)).toBe(0);
  });

  it('is 0 for a zero hole depth', () => {
    expect(reachableShotDepthM(20, 0.5, 0)).toBe(0);
  });

  it('is monotonic non-decreasing in the fleet climb ratio', () => {
    let prev = -1;
    for (let r = 0; r <= 1.5; r += 0.05) {
      const v = reachableShotDepthM(20, r, 12);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(12);
      prev = v;
    }
  });

  it('is monotonic non-decreasing in the ramp run', () => {
    let prev = -1;
    for (let run = 0; run <= 100; run += 5) {
      const v = reachableShotDepthM(run, 0.25, 12);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(12);
      prev = v;
    }
  });
});
