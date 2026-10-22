import { describe, it, expect } from 'vitest';
import {
  decideLadderEventOption,
  decideLadderReach,
  decideLadderDeepen,
  decideFreshShotSite,
  rampProtectionZones,
  shotOverlapsProtectedRamp,
  LADDER_RAMP_PROTECT_MARGIN_M,
  type LadderDeepenInput,
  type FreshSiteInput,
  type ProtectedZone,
  type RampFootprintInput,
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
};

describe('decideLadderReach', () => {
  it('fires when the finished ramp is climbable', () => {
    expect(decideLadderReach(reachBase)).toBe('fire');
  });

  it('fires when ramp and fleet ratios are equal', () => {
    expect(decideLadderReach({ rampSlopeRatio: 0.4, fleetClimbRatio: 0.4 })).toBe('fire');
  });

  it('asks for a ramp first when none is finished', () => {
    expect(decideLadderReach({ ...reachBase, rampSlopeRatio: Infinity })).toBe('ramp_first');
  });

  it('shrinks when the ramp is too steep for the fleet', () => {
    expect(decideLadderReach({ ...reachBase, rampSlopeRatio: 0.5 })).toBe('shrink');
  });

  it('never fires on a ramp just above the fleet ratio', () => {
    expect(decideLadderReach({ rampSlopeRatio: 0.4001, fleetClimbRatio: 0.4 })).toBe('shrink');
  });

  it('only ever answers fire, ramp_first or shrink', () => {
    const allowed = ['fire', 'ramp_first', 'shrink'];
    for (const rampSlopeRatio of [0, 0.1, 0.4, 0.9, Infinity]) {
      for (const fleetClimbRatio of [0.1, 0.4, 0.9]) {
        expect(allowed).toContain(decideLadderReach({ rampSlopeRatio, fleetClimbRatio }));
      }
    }
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

const deepenBase: LadderDeepenInput = {
  orderedRubbleCount: 0,
  orderlessRubbleCount: 0,
  sealedRubbleCount: 0,
  haulPending: false,
};

describe('decideLadderDeepen', () => {
  it('deepens a clear crater', () => {
    expect(decideLadderDeepen(deepenBase)).toBe('deepen');
  });

  it('deepens although sealed rubble remains: no hauler can reach it, waiting would stall forever', () => {
    expect(decideLadderDeepen({ ...deepenBase, sealedRubbleCount: 40 })).toBe('deepen');
  });

  it('waits while ordered rubble remains', () => {
    expect(decideLadderDeepen({ ...deepenBase, orderedRubbleCount: 1 })).toBe('wait');
  });

  it('waits while reachable orderless rubble remains', () => {
    expect(decideLadderDeepen({ ...deepenBase, orderlessRubbleCount: 1 })).toBe('wait');
  });

  it('waits while a haul is pending', () => {
    expect(decideLadderDeepen({ ...deepenBase, haulPending: true })).toBe('wait');
  });

  it('waits on a pending haul even with sealed rubble only', () => {
    expect(decideLadderDeepen({ ...deepenBase, sealedRubbleCount: 5, haulPending: true })).toBe('wait');
  });
});

const siteBase: FreshSiteInput = { oreKgUnderSite: 1000, siteOreKgFloor: 500, groundOreKgRemaining: 10_000 };

describe('decideFreshShotSite', () => {
  it('fires at a site holding more ore than the floor', () => {
    expect(decideFreshShotSite(siteBase)).toBe('fire');
  });

  it('fires at a site holding exactly the floor', () => {
    expect(decideFreshShotSite({ ...siteBase, oreKgUnderSite: 500 })).toBe('fire');
  });

  it('skips a site below the floor while ore remains elsewhere', () => {
    expect(decideFreshShotSite({ ...siteBase, oreKgUnderSite: 499 })).toBe('skip');
    expect(decideFreshShotSite({ ...siteBase, oreKgUnderSite: 0 })).toBe('skip');
  });

  it('fires at a barren site when no ore remains anywhere in the ground', () => {
    expect(decideFreshShotSite({ ...siteBase, oreKgUnderSite: 0, groundOreKgRemaining: 0 })).toBe('fire');
  });
});

describe('rampProtectionZones and shotOverlapsProtectedRamp', () => {
  const MARGIN = 4;
  // Ramp runs +x from (10,10) over 20 m, ending at x=30.
  const ramp: RampFootprintInput = { x: 10, z: 10, runM: 20, dirX: 1, dirZ: 0 };
  const site = (x: number, z: number, span = 4): ProtectedZone => ({ x, z, span });

  it('margin constant is non-negative and finite', () => {
    expect(Number.isFinite(LADDER_RAMP_PROTECT_MARGIN_M)).toBe(true);
    expect(LADDER_RAMP_PROTECT_MARGIN_M).toBeGreaterThanOrEqual(0);
  });

  it('no ramps give no zones and no overlap', () => {
    expect(rampProtectionZones([], MARGIN)).toEqual([]);
    expect(shotOverlapsProtectedRamp(site(10, 10), [])).toBe(false);
  });

  it('a ramp yields at least one zone with positive span', () => {
    const zones = rampProtectionZones([ramp], MARGIN);
    expect(zones.length).toBeGreaterThan(0);
    for (const z of zones) expect(z.span).toBeGreaterThan(0);
  });

  it('a site on the ramp corridor overlaps', () => {
    const zones = rampProtectionZones([ramp], MARGIN);
    expect(shotOverlapsProtectedRamp(site(18, 9), zones)).toBe(true);
    expect(shotOverlapsProtectedRamp(site(11, 10), zones)).toBe(true);
    expect(shotOverlapsProtectedRamp(site(28, 10), zones)).toBe(true);
  });

  it('a site just past the ramp end but within the margin overlaps', () => {
    const zones = rampProtectionZones([ramp], MARGIN);
    expect(shotOverlapsProtectedRamp(site(30 + MARGIN - 2, 10, 2), zones)).toBe(true);
  });

  it('a site far from the ramp does not overlap', () => {
    const zones = rampProtectionZones([ramp], MARGIN);
    expect(shotOverlapsProtectedRamp(site(10, 80), zones)).toBe(false);
    expect(shotOverlapsProtectedRamp(site(30 + MARGIN + 20, 10), zones)).toBe(false);
  });

  it('protects the corridor, not a whole crater-sized square around the ramp', () => {
    const zones = rampProtectionZones([ramp], MARGIN);
    // 20 m across the corridor from its axis is well outside run-length 20 + margin 4 of lateral reach.
    expect(shotOverlapsProtectedRamp(site(18, 10 + 20), zones)).toBe(false);
    expect(shotOverlapsProtectedRamp(site(18, 10 - 24), zones)).toBe(false);
  });

  it('follows the ramp direction', () => {
    const zones = rampProtectionZones([{ x: 10, z: 10, runM: 20, dirX: 0, dirZ: 1 }], MARGIN);
    expect(shotOverlapsProtectedRamp(site(9, 28), zones)).toBe(true);
    expect(shotOverlapsProtectedRamp(site(28, 9), zones)).toBe(false);
  });

  it('covers every ramp given', () => {
    const second: RampFootprintInput = { x: 100, z: 100, runM: 10, dirX: 1, dirZ: 0 };
    const zones = rampProtectionZones([ramp, second], MARGIN);
    expect(shotOverlapsProtectedRamp(site(18, 9), zones)).toBe(true);
    expect(shotOverlapsProtectedRamp(site(104, 99), zones)).toBe(true);
    expect(shotOverlapsProtectedRamp(site(60, 60), zones)).toBe(false);
  });

  describe('shotOverlapsProtectedRamp on explicit zones', () => {
    const zone: ProtectedZone = { x: 10, z: 10, span: 10 }; // covers [10,20] x [10,20]

    it('overlaps when the footprints intersect', () => {
      expect(shotOverlapsProtectedRamp({ x: 15, z: 15, span: 10 }, [zone])).toBe(true);
      expect(shotOverlapsProtectedRamp({ x: 12, z: 12, span: 2 }, [zone])).toBe(true);
    });

    it('does not overlap beyond the zone', () => {
      expect(shotOverlapsProtectedRamp({ x: 25, z: 10, span: 3 }, [zone])).toBe(false);
      expect(shotOverlapsProtectedRamp({ x: 10, z: 25, span: 3 }, [zone])).toBe(false);
      expect(shotOverlapsProtectedRamp({ x: 0, z: 0, span: 5 }, [zone])).toBe(false);
    });

    it('edges that merely touch are not an overlap', () => {
      expect(shotOverlapsProtectedRamp({ x: 20, z: 10, span: 5 }, [zone])).toBe(false);
      expect(shotOverlapsProtectedRamp({ x: 5, z: 10, span: 5 }, [zone])).toBe(false);
      expect(shotOverlapsProtectedRamp({ x: 10, z: 20, span: 5 }, [zone])).toBe(false);
    });

    it('overlaps when any one of several zones is hit', () => {
      const far: ProtectedZone = { x: 100, z: 100, span: 5 };
      expect(shotOverlapsProtectedRamp({ x: 101, z: 101, span: 2 }, [zone, far])).toBe(true);
    });
  });
});
