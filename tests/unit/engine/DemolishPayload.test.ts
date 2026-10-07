import { describe, it, expect } from 'vitest';
import { readDemolishPayload } from '../../../src/core/engine/DemolishPayload';

describe('readDemolishPayload', () => {
  it('reads a well-formed payload', () => {
    const fp: ReadonlyArray<readonly [number, number]> = [[1, 2], [3, 4]];
    expect(readDemolishPayload({ buildingId: 7, cost: 50, durationTicks: 12, footprint: fp, rebuildOrderId: 3 }))
      .toEqual({ buildingId: 7, cost: 50, durationTicks: 12, footprint: fp, rebuildOrderId: 3 });
  });

  it('falls back to neutral values for null or undefined payload', () => {
    const neutral = { buildingId: -1, cost: 0, durationTicks: 1, footprint: [], rebuildOrderId: null };
    expect(readDemolishPayload(null)).toEqual(neutral);
    expect(readDemolishPayload(undefined)).toEqual(neutral);
    expect(readDemolishPayload({})).toEqual(neutral);
  });

  it('rejects mistyped fields', () => {
    expect(readDemolishPayload({ buildingId: '7', cost: 'x', durationTicks: null, footprint: 'nope', rebuildOrderId: 'a' }))
      .toEqual({ buildingId: -1, cost: 0, durationTicks: 1, footprint: [], rebuildOrderId: null });
  });

  it('keeps zero values and null rebuild order', () => {
    expect(readDemolishPayload({ buildingId: 0, cost: 0, durationTicks: 0, footprint: [], rebuildOrderId: null }))
      .toEqual({ buildingId: 0, cost: 0, durationTicks: 0, footprint: [], rebuildOrderId: null });
  });
});
