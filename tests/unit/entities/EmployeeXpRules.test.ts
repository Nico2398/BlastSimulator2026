// BlastSimulator2026 — Unit tests for computeXpPerTick (issue #619)
//
// computeXpPerTick lives in src/core/entities/EmployeeXpRules.ts and was
// extracted from GameLoop.ts's tickTaskProgress
// (`const xpPerTick = 1 + Math.floor(currentLevel * 0.5);`).
//
// Formula: XP_PER_TICK_BASE + floor(proficiencyLevel * XP_PER_TICK_LEVEL_SCALE)
// With XP_PER_TICK_BASE = 1 and XP_PER_TICK_LEVEL_SCALE = 0.5, pinned values:
//   level 1 -> 1, level 2 -> 2, level 3 -> 2, level 4 -> 3, level 5 -> 3

import { describe, it, expect } from 'vitest';
import { computeXpPerTick } from '../../../src/core/entities/EmployeeXpRules.js';
import { XP_PER_TICK_BASE, XP_PER_TICK_LEVEL_SCALE } from '../../../src/core/config/balance.js';

describe('computeXpPerTick', () => {
  it('returns 1 XP for proficiency level 1 (Rookie, minimum boundary)', () => {
    expect(computeXpPerTick(1)).toBe(1);
  });

  it('returns 2 XP for proficiency level 2', () => {
    expect(computeXpPerTick(2)).toBe(2);
  });

  it('returns 2 XP for proficiency level 3', () => {
    expect(computeXpPerTick(3)).toBe(2);
  });

  it('returns 3 XP for proficiency level 4', () => {
    expect(computeXpPerTick(4)).toBe(3);
  });

  it('returns 3 XP for proficiency level 5 (Master, maximum boundary)', () => {
    expect(computeXpPerTick(5)).toBe(3);
  });

  it('matches the formula derived directly from the balance constants for every level', () => {
    // Stays correct if XP_PER_TICK_BASE / XP_PER_TICK_LEVEL_SCALE are later
    // retuned — asserts the *relationship*, not just today's pinned numbers.
    const levels: Array<1 | 2 | 3 | 4 | 5> = [1, 2, 3, 4, 5];
    for (const level of levels) {
      const expected = XP_PER_TICK_BASE + Math.floor(level * XP_PER_TICK_LEVEL_SCALE);
      expect(computeXpPerTick(level)).toBe(expected);
    }
  });

  it('is non-decreasing as proficiency level increases (rejects an inverted formula)', () => {
    let previous = computeXpPerTick(1);
    for (const level of [2, 3, 4, 5] as const) {
      const current = computeXpPerTick(level);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('always returns an integer XP award (never a fractional tick grant)', () => {
    for (const level of [1, 2, 3, 4, 5] as const) {
      const award = computeXpPerTick(level);
      expect(Number.isInteger(award)).toBe(true);
    }
  });
});
