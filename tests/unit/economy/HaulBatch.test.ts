// BlastSimulator2026 — Tests for HaulBatch (#1370)
//
// selectHaulBatch picks the fragments one haul trip carries: the primary
// always rides; extras join in the given order while cumulative mass stays
// within vehicle capacity and storage room, and the count within maxItems.

import { describe, it, expect } from 'vitest';
import { haulBatchMaxItems, selectHaulBatch, type HaulCandidate } from '../../../src/core/economy/HaulBatch.js';
import { HAUL_BATCH_FINES_FRAGMENT_KG, HAUL_BATCH_RADIUS_CELLS } from '../../../src/core/config/balance.js';
import { getVehicleDefByTier } from '../../../src/core/entities/Vehicle.js';

const c = (fragmentId: number, massKg: number): HaulCandidate => ({ fragmentId, massKg });
const ids = (batch: HaulCandidate[]) => batch.map(b => b.fragmentId);

describe('selectHaulBatch', () => {
  it('returns just the primary when there are no extras', () => {
    expect(ids(selectHaulBatch(c(1, 500), [], 4000, 99999, 6))).toEqual([1]);
  });

  it('puts the primary first and adds extras in the given order while they fit', () => {
    const batch = selectHaulBatch(c(1, 1000), [c(2, 1000), c(3, 1000)], 4000, 99999, 6);
    expect(ids(batch)).toEqual([1, 2, 3]);
  });

  it('keeps the batch within capacity: cumulative mass equal to capacity fits, one kg over does not', () => {
    expect(ids(selectHaulBatch(c(1, 1000), [c(2, 1000), c(3, 1000), c(4, 1000)], 4000, 99999, 6))).toEqual([1, 2, 3, 4]);
    expect(ids(selectHaulBatch(c(1, 1000), [c(2, 1000), c(3, 1000), c(4, 1001)], 4000, 99999, 6))).toEqual([1, 2, 3]);
  });

  it('keeps the batch within the storage room left', () => {
    const batch = selectHaulBatch(c(1, 1000), [c(2, 1000), c(3, 1000)], 4000, 2500, 6);
    expect(ids(batch)).toEqual([1, 2]);
  });

  it('caps the batch at maxItems, primary included', () => {
    const extras = [2, 3, 4, 5, 6, 7, 8].map(i => c(i, 10));
    expect(selectHaulBatch(c(1, 10), extras, 4000, 99999, 3)).toHaveLength(3);
    expect(selectHaulBatch(c(1, 10), extras, 4000, 99999, haulBatchMaxItems(4000))).toHaveLength(haulBatchMaxItems(4000));
  });

  it('maxItems of 1 yields only the primary', () => {
    expect(ids(selectHaulBatch(c(1, 10), [c(2, 10)], 4000, 99999, 1))).toEqual([1]);
  });

  it('a primary heavier than capacity rides alone', () => {
    expect(ids(selectHaulBatch(c(1, 5000), [c(2, 10), c(3, 10)], 4000, 99999, 6))).toEqual([1]);
  });

  it('a primary exactly at capacity rides alone (no room left for extras)', () => {
    expect(ids(selectHaulBatch(c(1, 4000), [c(2, 1)], 4000, 99999, 6))).toEqual([1]);
  });

  it('skips an extra that would overflow and takes a later smaller one that fits', () => {
    const batch = selectHaulBatch(c(1, 2000), [c(2, 3000), c(3, 1500), c(4, 600)], 4000, 99999, 6);
    expect(ids(batch)).toEqual([1, 3]);
    // 2000 + 1500 = 3500; 600 would reach 4100 > 4000
  });

  it('a later smaller extra fits after an overflowing one is skipped, up to the limit', () => {
    const batch = selectHaulBatch(c(1, 2000), [c(2, 3000), c(3, 1000), c(4, 1000)], 4000, 99999, 6);
    expect(ids(batch)).toEqual([1, 3, 4]);
  });

  it('a primary that exceeds the storage room still rides (caller already gated it)', () => {
    expect(ids(selectHaulBatch(c(1, 500), [c(2, 1)], 4000, 100, 6))).toEqual([1]);
  });

  it('never mutates its inputs', () => {
    const extras = [c(2, 10), c(3, 10)];
    const copy = JSON.parse(JSON.stringify(extras));
    selectHaulBatch(c(1, 10), extras, 4000, 99999, 6);
    expect(extras).toEqual(copy);
  });

  it('balance constants: radius 8 cells, fines-bound fragment 625 kg', () => {
    expect(HAUL_BATCH_RADIUS_CELLS).toBe(8);
    expect(HAUL_BATCH_FINES_FRAGMENT_KG).toBe(625);
  });
});

describe('haulBatchMaxItems', () => {
  const capacity = (tier: 1 | 2 | 3) => getVehicleDefByTier('debris_hauler', tier).capacity;

  it('carries 6, 10 and 16 pieces on tier 1, 2 and 3 haulers', () => {
    expect([1, 2, 3].map(t => haulBatchMaxItems(capacity(t as 1 | 2 | 3)))).toEqual([6, 10, 16]);
  });

  it('fills a truck on mass with fragments at the fines bound or heavier', () => {
    for (const tier of [1, 2, 3] as const) {
      const n = haulBatchMaxItems(capacity(tier));
      const goodKg = HAUL_BATCH_FINES_FRAGMENT_KG * 1.1;
      const extras = Array.from({ length: 30 }, (_, i) => c(i + 2, goodKg));
      const batch = selectHaulBatch(c(1, goodKg), extras, capacity(tier), Infinity, n);
      expect(batch.length).toBeLessThan(n + 1);
      expect(batch.reduce((s, b) => s + b.massKg, 0) + goodKg).toBeGreaterThan(capacity(tier));
    }
  });

  it('meets the count first with fines, leaving the bed part empty', () => {
    const n = haulBatchMaxItems(capacity(3));
    const extras = Array.from({ length: 40 }, (_, i) => c(i + 2, 200));
    const batch = selectHaulBatch(c(1, 200), extras, capacity(3), Infinity, n);
    expect(batch).toHaveLength(n);
    expect(batch.length * 200).toBeLessThan(capacity(3) / 2);
  });

  it('never drops below one item for a tiny truck', () => {
    expect(haulBatchMaxItems(100)).toBe(1);
    expect(haulBatchMaxItems(0)).toBe(1);
  });
});
