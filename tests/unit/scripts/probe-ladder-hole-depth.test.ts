import { describe, it, expect } from 'vitest';
import { LADDER_HOLE_DEPTH_M } from '../../../scripts/shared/probe-strategies';
import { breakoutHoleDepthM, LADDER_TIGHT_BURDEN_M } from '../../../scripts/shared/probe-ladder-policy';
import { chargeColumnM, explosiveHoleLimits } from '../../../src/core/mining/ChargePlan';
import { getExplosive } from '../../../src/core/world/ExplosiveCatalog';
import { DRILL_RIG_MAX_DEPTH_M } from '../../../src/core/config/balance';

describe('LADDER_HOLE_DEPTH_M (#2066, #2091)', () => {
  const krackle = getExplosive('krackle')!;
  const fullKg = explosiveHoleLimits(krackle, 0.089).maxKg;

  it('is the depth a fully charged krackle hole in a tight pattern breaks out of', () => {
    expect(LADDER_HOLE_DEPTH_M).toBeLessThanOrEqual(breakoutHoleDepthM(chargeColumnM(fullKg, 0.089), LADDER_TIGHT_BURDEN_M));
  });

  it('goes past the 10 m grade 2 asks', () => {
    expect(LADDER_HOLE_DEPTH_M).toBeGreaterThan(10);
  });

  it('is within the tier-1 rig the kits carry', () => {
    expect(LADDER_HOLE_DEPTH_M).toBeLessThanOrEqual(DRILL_RIG_MAX_DEPTH_M[1]);
  });
});
