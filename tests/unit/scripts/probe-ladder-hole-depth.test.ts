import { describe, it, expect } from 'vitest';
import { LADDER_HOLE_DEPTH_M, SHOT } from '../../../scripts/shared/probe-strategies';
import { breakoutHoleDepthM, LADDER_TIGHT_BURDEN_M } from '../../../scripts/shared/probe-ladder-policy';
import { floorToKgResolution } from '../../../scripts/shared/probe-ladder';
import { chargeColumnM, fillChargeKg } from '../../../src/core/mining/ChargePlan';
import { chargeKgPerMetre } from '../../../src/core/mining/HoleDiameter';
import { DRILL_RIG_MAX_DEPTH_M } from '../../../src/core/config/balance';

describe('LADDER_HOLE_DEPTH_M (#2066, #2091)', () => {
  // A ladder hole is charged full: krackle fills it from the bottom up to the shot's stemming (the ladder's
  // `fullHoleKg`), so its column stands as tall as the hole less the stemming.
  const DIAMETER_M = 0.089;
  const fullKg = floorToKgResolution(fillChargeKg(LADDER_HOLE_DEPTH_M, SHOT.stemming, DIAMETER_M, 'krackle'));
  const column = chargeColumnM(fullKg, DIAMETER_M, 'krackle');

  it('is the depth a fully charged krackle hole in a tight pattern breaks out of', () => {
    expect(LADDER_HOLE_DEPTH_M).toBeLessThanOrEqual(breakoutHoleDepthM(column, LADDER_TIGHT_BURDEN_M));
  });

  it('a full hole\'s column reaches the stemming (less its 0.1 kg rounding): the burden over it is the stemming, within the tight burden', () => {
    expect(column).toBeLessThanOrEqual(LADDER_HOLE_DEPTH_M - SHOT.stemming + 1e-9);
    expect(column).toBeGreaterThan(LADDER_HOLE_DEPTH_M - SHOT.stemming - 0.1 / chargeKgPerMetre(DIAMETER_M, 'krackle') - 1e-9);
    expect(SHOT.stemming).toBeLessThanOrEqual(LADDER_TIGHT_BURDEN_M);
  });

  it('goes past the 10 m grade 2 asks', () => {
    expect(LADDER_HOLE_DEPTH_M).toBeGreaterThan(10);
  });

  it('is within the tier-1 rig the kits carry', () => {
    expect(LADDER_HOLE_DEPTH_M).toBeLessThanOrEqual(DRILL_RIG_MAX_DEPTH_M[1]);
  });
});
