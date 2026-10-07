// BlastSimulator2026 — computeDemolitionDurationTicks (#1392)

import { describe, it, expect } from 'vitest';
import { computeDemolitionDurationTicks } from '../../../src/core/entities/DemolitionDuration.js';
import type { BuildingTier } from '../../../src/core/entities/Building.js';
import type { VehicleTier } from '../../../src/core/entities/Vehicle.js';

const TIERS: readonly (1 | 2 | 3)[] = [1, 2, 3];

describe('computeDemolitionDurationTicks', () => {
  it('returns a positive integer for a typical building', () => {
    const ticks = computeDemolitionDurationTicks(6, 1, 1);
    expect(Number.isInteger(ticks)).toBe(true);
    expect(ticks).toBeGreaterThan(0);
  });

  it('never drops below one tick, even for a one-cell tier-1 building and the best vehicle', () => {
    expect(computeDemolitionDurationTicks(1, 1, 3)).toBeGreaterThanOrEqual(1);
  });

  it('grows with footprint cells', () => {
    let previous = 0;
    for (const cells of [1, 2, 4, 6, 9, 16]) {
      const ticks = computeDemolitionDurationTicks(cells, 2, 1);
      expect(ticks).toBeGreaterThanOrEqual(previous);
      previous = ticks;
    }
    expect(computeDemolitionDurationTicks(16, 2, 1)).toBeGreaterThan(computeDemolitionDurationTicks(1, 2, 1));
  });

  it('grows with building tier', () => {
    const [t1, t2, t3] = TIERS.map(b => computeDemolitionDurationTicks(9, b as BuildingTier, 1));
    expect(t2!).toBeGreaterThan(t1!);
    expect(t3!).toBeGreaterThan(t2!);
  });

  it('shrinks with vehicle tier', () => {
    const [v1, v2, v3] = TIERS.map(v => computeDemolitionDurationTicks(9, 2, v as VehicleTier));
    expect(v2!).toBeLessThan(v1!);
    expect(v3!).toBeLessThanOrEqual(v2!);
  });

  it('a tier-3 destroyer is strictly faster than a tier-1 destroyer on every building tier and size', () => {
    for (const cells of [1, 4, 9, 16]) {
      for (const b of TIERS) {
        const slow = computeDemolitionDurationTicks(cells, b as BuildingTier, 1);
        const fast = computeDemolitionDurationTicks(cells, b as BuildingTier, 3);
        expect(fast, `cells=${cells} tier=${b}`).toBeLessThan(slow);
      }
    }
  });

  it('is deterministic', () => {
    expect(computeDemolitionDurationTicks(6, 3, 2)).toBe(computeDemolitionDurationTicks(6, 3, 2));
  });

  it('is monotonic across the whole grid of inputs', () => {
    for (const b of TIERS) for (const v of TIERS) {
      for (let cells = 1; cells < 20; cells++) {
        expect(computeDemolitionDurationTicks(cells + 1, b as BuildingTier, v as VehicleTier))
          .toBeGreaterThanOrEqual(computeDemolitionDurationTicks(cells, b as BuildingTier, v as VehicleTier));
      }
    }
  });
});
