// BlastSimulator2026 — spoilHeapsNeeded: when the ladder builds another spoil heap (#2085).
// LADDER_MAX_SPOIL_HEAPS is a module-local const (4) in scripts/shared/probe-strategies.ts.

import { describe, it, expect } from 'vitest';
import { spoilHeapsNeeded } from '../../../scripts/shared/probe-strategies.js';
import { SPOIL_HEAP_CAPACITY_KG } from '../../../src/core/config/balance.js';

const MAX_HEAPS = 4;

describe('spoilHeapsNeeded', () => {
  it('is false with no barren rubble pending, whatever the heap count', () => {
    for (let n = 0; n <= MAX_HEAPS + 2; n++) expect(spoilHeapsNeeded(0, n)).toBe(false);
  });

  it('is true when one kg exceeds the combined capacity of k heaps, below the cap', () => {
    for (let k = 0; k < MAX_HEAPS; k++) expect(spoilHeapsNeeded(k * SPOIL_HEAP_CAPACITY_KG + 1, k)).toBe(true);
  });

  it('is false when the rubble fits the existing capacity (boundary included)', () => {
    for (let k = 1; k <= MAX_HEAPS; k++) {
      expect(spoilHeapsNeeded(k * SPOIL_HEAP_CAPACITY_KG, k)).toBe(false);
      expect(spoilHeapsNeeded(k * SPOIL_HEAP_CAPACITY_KG - 1, k)).toBe(false);
    }
  });

  it('is false once the heap cap is reached, however much rubble is pending', () => {
    expect(spoilHeapsNeeded(MAX_HEAPS * SPOIL_HEAP_CAPACITY_KG + 1, MAX_HEAPS)).toBe(false);
    expect(spoilHeapsNeeded(100 * SPOIL_HEAP_CAPACITY_KG, MAX_HEAPS)).toBe(false);
    expect(spoilHeapsNeeded(100 * SPOIL_HEAP_CAPACITY_KG, MAX_HEAPS + 3)).toBe(false);
  });
});
