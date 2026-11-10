// BlastSimulator2026 — previewChargeOptimization: the tier-4 gate on the charge optimizer (#2204)
import { describe, it, expect } from 'vitest';
import { previewChargeOptimization } from '../../../src/core/mining/Software.js';
import { optimizeCharges } from '../../../src/core/mining/ChargeOptimizer.js';
import { SOFTWARE_TIER_OPTIMIZER, CHARGE_DEFAULT_STEMMING_M } from '../../../src/core/config/balance.js';
import { getAllExplosives } from '../../../src/core/world/ExplosiveCatalog.js';
import { mixedRockGrid, mixedRockHoles, gridFingerprint } from '../../helpers/optimizerFixtures.js';

const options = { explosiveIds: getAllExplosives().map(e => e.id), stemmingM: CHARGE_DEFAULT_STEMMING_M };

describe('previewChargeOptimization — software tier gate', () => {
  const grid = mixedRockGrid();
  const holes = mixedRockHoles();

  it('the optimizer tier is 4', () => {
    expect(SOFTWARE_TIER_OPTIMIZER).toBe(4);
  });

  it('returns null below tier 4', () => {
    for (const tier of [0, 1, 2, 3]) expect(previewChargeOptimization(holes, grid, tier, options), `tier ${tier}`).toBeNull();
  });

  it('returns the optimizer proposal at tier 4', () => {
    const proposal = previewChargeOptimization(holes, grid, 4, options);
    expect(proposal).not.toBeNull();
    expect(proposal).toEqual(optimizeCharges(holes, grid, options));
  });

  it('returns a proposal above tier 4 too', () => {
    expect(previewChargeOptimization(holes, grid, 5, options)).not.toBeNull();
  });

  it('forwards the permit limit and wet holes to the optimizer', () => {
    const wet = new Set([holes[0]!.id]);
    const proposal = previewChargeOptimization(holes, grid, 4, { ...options, wetHoleIds: wet, maxTotalKg: 25 })!;
    expect(proposal.permitKgLimit).toBe(25);
    expect(proposal).toEqual(optimizeCharges(holes, grid, { ...options, wetHoleIds: wet, maxTotalKg: 25 }));
  });

  it('changes neither holes nor grid', () => {
    const g = mixedRockGrid();
    const before = gridFingerprint(g);
    previewChargeOptimization(holes, g, 4, options);
    previewChargeOptimization(holes, g, 2, options);
    expect(gridFingerprint(g)).toBe(before);
  });
});
