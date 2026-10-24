// BlastSimulator2026 — spoilHeapsNeeded: when the ladder builds another spoil heap (#2085).

import { describe, it, expect } from 'vitest';
import { spoilHeapsNeeded, LADDER_MAX_SPOIL_HEAPS } from '../../../scripts/shared/probe-strategies.js';

describe('spoilHeapsNeeded', () => {
  it('is false with no blocked overflow, whatever the heap count', () => {
    for (let n = 0; n <= LADDER_MAX_SPOIL_HEAPS + 2; n++) expect(spoilHeapsNeeded(0, n)).toBe(false);
  });

  it('is true for any blocked overflow below the heap cap', () => {
    for (let k = 0; k < LADDER_MAX_SPOIL_HEAPS; k++) {
      expect(spoilHeapsNeeded(1, k)).toBe(true);
      expect(spoilHeapsNeeded(50_000, k)).toBe(true);
    }
  });

  it('is false once the heap cap is reached, however much overflow is blocked', () => {
    expect(spoilHeapsNeeded(1, LADDER_MAX_SPOIL_HEAPS)).toBe(false);
    expect(spoilHeapsNeeded(1_000_000, LADDER_MAX_SPOIL_HEAPS)).toBe(false);
    expect(spoilHeapsNeeded(1_000_000, LADDER_MAX_SPOIL_HEAPS + 3)).toBe(false);
  });
});
